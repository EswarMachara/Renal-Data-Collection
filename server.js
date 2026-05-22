const crypto = require("crypto");
const { execFile } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PUBLIC_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "0.0.0.0";
const GCS_BUCKET = process.env.GCS_BUCKET || "";
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 300 * 1024 * 1024);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sanitizeFileName(value, fallback = "file") {
  const cleaned = String(value || fallback)
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 120);

  return cleaned || fallback;
}

function splitBuffer(buffer, delimiter) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);

  while (index !== -1) {
    parts.push(buffer.subarray(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }

  parts.push(buffer.subarray(start));
  return parts;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error("Submission is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));

    req.on("error", reject);
  });
}

function parseJsonPayload(buffer) {
  try {
    const rawBody = buffer.toString("utf8");
    return rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

function parseMultipartBody(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const headerDelimiter = Buffer.from("\r\n\r\n");
  const fields = {};
  const files = [];

  splitBuffer(buffer, delimiter).forEach((part) => {
    let chunk = part;
    if (chunk.length === 0 || chunk.equals(Buffer.from("--\r\n")) || chunk.equals(Buffer.from("--"))) {
      return;
    }

    if (chunk.subarray(0, 2).toString("latin1") === "\r\n") {
      chunk = chunk.subarray(2);
    }
    if (chunk.subarray(-2).toString("latin1") === "\r\n") {
      chunk = chunk.subarray(0, -2);
    }
    if (chunk.subarray(-2).toString("latin1") === "--") {
      chunk = chunk.subarray(0, -2);
    }

    const headerEnd = chunk.indexOf(headerDelimiter);
    if (headerEnd === -1) {
      return;
    }

    const rawHeaders = chunk.subarray(0, headerEnd).toString("latin1");
    const content = chunk.subarray(headerEnd + headerDelimiter.length);
    const disposition = rawHeaders
      .split("\r\n")
      .find((line) => line.toLowerCase().startsWith("content-disposition:"));
    if (!disposition) {
      return;
    }

    const name = disposition.match(/name="([^"]+)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    const contentType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "";
    if (!name) {
      return;
    }

    if (filename !== undefined) {
      files.push({
        field: name,
        filename,
        contentType,
        content
      });
      return;
    }

    fields[name] = content.toString("utf8");
  });

  return { fields, files };
}

async function readSubmissionPayload(req) {
  const body = await readRequestBody(req);
  const contentType = req.headers["content-type"] || "";

  if (contentType.includes("multipart/form-data")) {
    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
    if (!boundary) {
      throw new Error("Multipart boundary is missing.");
    }

    const multipart = parseMultipartBody(body, boundary);
    const payload = parseJsonPayload(Buffer.from(multipart.fields.payload || "{}", "utf8"));
    const fileMap = new Map();
    multipart.files.forEach((file) => {
      const match = file.field.match(/^file_(\d+)_(.+)$/);
      if (!match) {
        return;
      }
      const index = Number(match[1]);
      const fieldName = match[2];
      const files = fileMap.get(index) || [];
      files.push({
        fieldName,
        name: file.filename,
        type: file.contentType || "application/octet-stream",
        size: file.content.length,
        content: file.content
      });
      fileMap.set(index, files);
    });

    payload.submissions = (payload.submissions || []).map((item, index) => ({
      ...item,
      files: fileMap.get(index) || item.files || []
    }));
    return payload;
  }

  return parseJsonPayload(body);
}

function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(PUBLIC_DIR) || filePath.startsWith(DATA_DIR)) {
    sendJson(res, 403, { ok: false, error: "Forbidden." });
    return;
  }

  fs.readFile(filePath, (err, fileBuffer) => {
    if (err) {
      sendJson(res, 404, { ok: false, error: "Not found." });
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Content-Length": fileBuffer.length,
      "Cache-Control": "no-store"
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(fileBuffer);
  });
}

function copyToGcs(localPath) {
  return new Promise((resolve) => {
    if (!GCS_BUCKET) {
      resolve({ synced: false });
      return;
    }

    const gcsPath = `gs://${GCS_BUCKET.replace(/^gs:\/\//, "")}`;
    execFile("gsutil", ["-m", "rsync", "-r", localPath, gcsPath], (error, stdout, stderr) => {
      resolve({
        synced: !error,
        gcsPath,
        error: error ? (stderr || stdout || error.message).trim() : ""
      });
    });
  });
}

function validateSubmission(item) {
  const requiredFields = ["hospitalId", "hospitalName", "uploadMode", "uhid", "age", "sex", "weight", "ckdStage", "diabetic"];
  const missingField = requiredFields.find((field) => !String(item[field] || "").trim());
  if (missingField) {
    throw new Error(`Missing required field: ${missingField}`);
  }

  if (!Array.isArray(item.files)) {
    throw new Error("Submission files are missing.");
  }

  if (item.uploadMode === "separate") {
    const requiredSeparateFiles = ["leftKidney", "rightKidney", "egfrReport"];
    const missingFile = requiredSeparateFiles.find((fieldName) => !item.files.some((file) => file.fieldName === fieldName));
    if (missingFile) {
      throw new Error("Separate-file mode requires left kidney, right kidney, and eGFR report files.");
    }
  }

  if (item.uploadMode === "package" && !item.files.some((file) => file.fieldName === "patientPackage")) {
    throw new Error("ZIP package upload is required for package mode.");
  }

  if (item.uploadMode === "package" && item.files.some((file) => file.fieldName === "patientPackage" && path.extname(file.name || "").toLowerCase() !== ".zip")) {
    throw new Error("Patient package must be a .zip file.");
  }
}

function getFileCategory(fieldName) {
  const categories = {
    leftKidney: ["images", "Left Kidney", "left-kidney"],
    rightKidney: ["images", "Right Kidney", "right-kidney"],
    mixed: ["mixed", "", "mixed"],
    mixedKidney: ["mixed", "", "mixed"],
    patientPackage: ["mixed", "", "package"],
    ultrasoundVideo: ["videos", "", "ultrasound-video"],
    egfrReport: ["documents", "", "egfr-report"]
  };

  return categories[fieldName] || ["documents", "", fieldName || "document"];
}

function buildStoredFileName(patientId, label, originalName, timestamp, suffix) {
  const extension = path.extname(originalName);
  const baseName = path.basename(originalName, extension);
  const timestampPart = timestamp.replace(/[-:TZ.]/g, "").slice(0, 14);
  return `${sanitizeFileName(patientId, "patient")}_${sanitizeFileName(label, "file")}_${timestampPart}_${suffix}_${sanitizeFileName(baseName, "upload")}${extension}`;
}

function getFileContent(file) {
  if (Buffer.isBuffer(file.content)) {
    return file.content;
  }

  return Buffer.from(file.contentBase64 || "", "base64");
}

async function handleSubmission(req, res) {
  try {
    const payload = await readSubmissionPayload(req);
    const submissions = Array.isArray(payload.submissions) ? payload.submissions : [];
    if (!submissions.length) {
      sendJson(res, 400, { ok: false, error: "No submissions received." });
      return;
    }

    submissions.forEach(validateSubmission);

    const now = new Date();
    const batchId = `${now.toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
    const batchDir = path.join(DATA_DIR, "submissions", batchId);
    const gcsSyncDir = path.join(DATA_DIR, "gcs-sync", batchId);
    fs.mkdirSync(batchDir, { recursive: true });
    fs.mkdirSync(gcsSyncDir, { recursive: true });

    const records = submissions.map((item, index) => {
      const recordId = `${String(index + 1).padStart(3, "0")}-${sanitizeFileName(item.hospitalId)}-${sanitizeFileName(item.uhid)}-${crypto.randomBytes(3).toString("hex")}`;
      const recordDir = path.join(batchDir, recordId);
      fs.mkdirSync(recordDir, { recursive: true });

      const storedFiles = item.files.map((file) => {
        const fieldName = sanitizeFileName(file.fieldName || "upload");
        const [topLevelFolder, subFolder, label] = getFileCategory(fieldName);
        const storedName = buildStoredFileName(item.uhid, label, file.name || "upload.bin", now.toISOString(), recordId.slice(-6));
        const relativeFolder = subFolder
          ? path.join(item.hospitalId, topLevelFolder, subFolder)
          : path.join(item.hospitalId, topLevelFolder);
        const localFolder = path.join(recordDir, relativeFolder);
        const syncFolder = path.join(gcsSyncDir, relativeFolder);
        fs.mkdirSync(localFolder, { recursive: true });
        fs.mkdirSync(syncFolder, { recursive: true });

        const fileContent = getFileContent(file);
        fs.writeFileSync(path.join(localFolder, storedName), fileContent);
        fs.writeFileSync(path.join(syncFolder, storedName), fileContent);

        return {
          fieldName,
          originalName: file.name,
          storedName,
          bucketPath: path.posix.join(item.hospitalId, topLevelFolder, subFolder, storedName).replace(/\/+/g, "/"),
          type: file.type || "application/octet-stream",
          size: Number(file.size || fileContent.length || 0)
        };
      });

      const metadata = {
        recordId,
        receivedAt: now.toISOString(),
        hospitalId: item.hospitalId,
        hospitalName: item.hospitalName,
        uploadMode: item.uploadMode,
        uhid: item.uhid,
        age: item.age,
        sex: item.sex,
        weight: item.weight,
        ckdStage: item.ckdStage,
        dialysis: item.dialysis || "-",
        dialysisFrequency: item.dialysisFrequency || "-",
        diabetic: item.diabetic,
        diabeticStage: item.diabeticStage || "-",
        reviewedAt: item.reviewed_at || item.reviewedAt || null,
        files: storedFiles
      };

      fs.writeFileSync(path.join(recordDir, "metadata.json"), JSON.stringify(metadata, null, 2));
      const metadataFileName = buildStoredFileName(item.uhid, "metadata", "metadata.json", now.toISOString(), recordId.slice(-6));
      const metadataSyncFolder = path.join(gcsSyncDir, item.hospitalId, "documents");
      fs.mkdirSync(metadataSyncFolder, { recursive: true });
      fs.writeFileSync(path.join(metadataSyncFolder, metadataFileName), JSON.stringify(metadata, null, 2));
      return metadata;
    });

    fs.writeFileSync(
      path.join(batchDir, "batch-manifest.json"),
      JSON.stringify({ batchId, receivedAt: now.toISOString(), records }, null, 2)
    );

    const gcsResult = await copyToGcs(gcsSyncDir);
    sendJson(res, 200, {
      ok: true,
      batchId,
      received: records.length,
      localPath: batchDir,
      gcsSynced: gcsResult.synced,
      gcsPath: gcsResult.gcsPath || null,
      gcsError: gcsResult.error || null
    });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message });
  }
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "tanuh-renal-data-server",
      gcsConfigured: Boolean(GCS_BUCKET)
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/submissions") {
    handleSubmission(req, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`TANUH Renal Screening Portal running at http://${HOST}:${PORT}`);
});
