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

function readJsonBody(req) {
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

    req.on("end", () => {
      try {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
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

function copyToGcs(localPath, batchId) {
  return new Promise((resolve) => {
    if (!GCS_BUCKET) {
      resolve({ synced: false });
      return;
    }

    const gcsPath = `gs://${GCS_BUCKET.replace(/^gs:\/\//, "")}/submissions/${batchId}`;
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
  const requiredFields = ["hospitalId", "uhid", "age", "sex", "weight", "ckdStage", "diabetic"];
  const missingField = requiredFields.find((field) => !String(item[field] || "").trim());
  if (missingField) {
    throw new Error(`Missing required field: ${missingField}`);
  }

  if (!Array.isArray(item.files) || item.files.length < 3) {
    throw new Error("Each submission must include left kidney, right kidney, and eGFR report files.");
  }
}

async function handleSubmission(req, res) {
  try {
    const payload = await readJsonBody(req);
    const submissions = Array.isArray(payload.submissions) ? payload.submissions : [];
    if (!submissions.length) {
      sendJson(res, 400, { ok: false, error: "No submissions received." });
      return;
    }

    submissions.forEach(validateSubmission);

    const now = new Date();
    const batchId = `${now.toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
    const batchDir = path.join(DATA_DIR, "submissions", batchId);
    fs.mkdirSync(batchDir, { recursive: true });

    const records = submissions.map((item, index) => {
      const recordId = `${String(index + 1).padStart(3, "0")}-${sanitizeFileName(item.hospitalId)}-${sanitizeFileName(item.uhid)}-${crypto.randomBytes(3).toString("hex")}`;
      const recordDir = path.join(batchDir, recordId);
      const filesDir = path.join(recordDir, "files");
      fs.mkdirSync(filesDir, { recursive: true });

      const storedFiles = item.files.map((file) => {
        const fileName = sanitizeFileName(file.name, "upload.bin");
        const fieldName = sanitizeFileName(file.fieldName || "upload");
        const storedName = `${fieldName}-${fileName}`;
        const filePath = path.join(filesDir, storedName);
        fs.writeFileSync(filePath, Buffer.from(file.contentBase64 || "", "base64"));
        return {
          fieldName,
          originalName: file.name,
          storedName,
          type: file.type || "application/octet-stream",
          size: Number(file.size || 0)
        };
      });

      const metadata = {
        recordId,
        receivedAt: now.toISOString(),
        hospitalId: item.hospitalId,
        uhid: item.uhid,
        age: item.age,
        sex: item.sex,
        weight: item.weight,
        ckdStage: item.ckdStage,
        dialysis: item.dialysis || "-",
        dialysisFrequency: item.dialysisFrequency || "-",
        diabetic: item.diabetic,
        diabeticStage: item.diabeticStage || "-",
        queuedAt: item.queued_at || item.queuedAt || null,
        files: storedFiles
      };

      fs.writeFileSync(path.join(recordDir, "metadata.json"), JSON.stringify(metadata, null, 2));
      return metadata;
    });

    fs.writeFileSync(
      path.join(batchDir, "batch-manifest.json"),
      JSON.stringify({ batchId, receivedAt: now.toISOString(), records }, null, 2)
    );

    const gcsResult = await copyToGcs(batchDir, batchId);
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
