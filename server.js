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

const hospitals = [
  {
    id: "SCMC-RMN-KA",
    name: "Sri Chamundeshwari Medical College, Ramanagara Dist, Karnataka"
  },
  {
    id: "SH-SLM-TN",
    name: "Shanmuga Hospital, Salem, Tamil Nadu"
  },
  {
    id: "JSS-MYS-KA",
    name: "JSS Medical College, Mysore, Karnataka"
  },
  {
    id: "NH-BLR-KA",
    name: "Nira Health Care Private Limited, Bangalore, Karnataka"
  },
  {
    id: "MIL-NDL-DL",
    name: "Mahajan Imaging & Labs, New Delhi"
  }
];

const allowedUploadModes = new Set(["separate", "package"]);
const allowedSexValues = new Set(["Male", "Female", "Other"]);
const allowedYesNoValues = new Set(["Yes", "No"]);
const allowedCkdStages = new Set(["1", "2", "3", "4"]);
const allowedFileFields = new Set(["leftKidney", "rightKidney", "egfrReport", "patientPackage", "ultrasoundVideo"]);

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

function cleanText(value, maxLength = 160) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function optionalText(value, maxLength = 160) {
  return cleanText(value, maxLength) || "-";
}

function requiredText(item, field, label, maxLength = 160) {
  const value = cleanText(item[field], maxLength);
  if (!value) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function validateIdentifier(value, label) {
  if (!/^[a-zA-Z0-9._-]{2,80}$/.test(value)) {
    throw new Error(`${label} must use 2-80 letters, numbers, dots, underscores, or hyphens.`);
  }
  return value;
}

function requiredChoice(item, field, label, allowedValues) {
  const value = requiredText(item, field, label, 120);
  if (!allowedValues.has(value)) {
    throw new Error(`${label} has an invalid value.`);
  }
  return value;
}

function optionalYesNo(item, field, label) {
  const value = cleanText(item[field], 12);
  if (!value || value === "-") {
    return "-";
  }
  if (!allowedYesNoValues.has(value)) {
    throw new Error(`${label} must be Yes or No.`);
  }
  return value;
}

function requiredNumber(item, field, label, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const rawValue = cleanText(item[field], 40);
  if (!rawValue) {
    throw new Error(`${label} is required.`);
  }
  if (!/^\d+(\.\d+)?$/.test(rawValue)) {
    throw new Error(`${label} must be a valid non-negative number.`);
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be between ${min} and ${max}${integer ? " as a whole number" : ""}.`);
  }
  return integer ? String(value) : String(Number(value.toFixed(2)));
}

function optionalNumber(item, field, label, options) {
  const rawValue = cleanText(item[field], 40);
  if (!rawValue || rawValue === "-") {
    return "-";
  }
  return requiredNumber(item, field, label, options);
}

function optionalDate(item, field, label) {
  const value = cleanText(item[field], 20);
  if (!value || value === "-") {
    return "-";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid date.`);
  }
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (date > tomorrow) {
    throw new Error(`${label} cannot be in the future.`);
  }
  return value;
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) {
    throw new Error("Submission files are missing.");
  }

  return files.map((file) => {
    const fieldName = cleanText(file.fieldName, 60);
    if (!allowedFileFields.has(fieldName)) {
      throw new Error(`Unsupported upload field: ${fieldName || "unknown"}.`);
    }

    const name = cleanText(file.name, 180) || "upload.bin";
    const size = Number(file.size || 0);
    const contentSize = Buffer.isBuffer(file.content) ? file.content.length : Buffer.byteLength(file.contentBase64 || "", "base64");
    if (!Number.isFinite(size) || size < 0 || contentSize <= 0) {
      throw new Error(`${name} is empty or invalid.`);
    }

    return {
      ...file,
      fieldName,
      name,
      type: cleanText(file.type, 120) || "application/octet-stream",
      size: size || contentSize
    };
  });
}

function normalizeSubmission(item) {
  const hospitalId = validateIdentifier(requiredText(item, "hospitalId", "Hospital ID", 80), "Hospital ID");
  const hospital = hospitals.find((entry) => entry.id === hospitalId);
  if (!hospital) {
    throw new Error("Hospital ID is not recognized.");
  }

  const hospitalName = requiredText(item, "hospitalName", "Hospital name", 180);
  if (hospitalName !== hospital.name) {
    throw new Error("Hospital name does not match the selected Hospital ID.");
  }

  const uhid = validateIdentifier(requiredText(item, "uhid", "Patient Unique ID", 80), "Patient Unique ID");
  const uploadMode = requiredChoice(item, "uploadMode", "Upload mode", allowedUploadModes);
  const files = normalizeFiles(item.files);

  const normalized = {
    hospitalSessionId: hospitalId,
    hospitalSessionName: hospital.name,
    hospitalId,
    hospitalName: hospital.name,
    studyId: optionalText(item.studyId, 80),
    enrollmentDate: optionalDate(item, "enrollmentDate", "Date of enrollment"),
    siteCenter: optionalText(item.siteCenter, 140),
    consentObtained: optionalYesNo(item, "consentObtained", "Consent obtained"),
    uploadMode,
    uhid,
    age: requiredNumber(item, "age", "Age", { min: 18, max: 120, integer: true }),
    sex: requiredChoice(item, "sex", "Sex", allowedSexValues),
    heightCm: optionalNumber(item, "heightCm", "Height", { min: 30, max: 250 }),
    weight: requiredNumber(item, "weight", "Weight", { min: 1, max: 300 }),
    bmi: optionalNumber(item, "bmi", "BMI", { min: 5, max: 80 }),
    ethnicity: optionalText(item.ethnicity, 100),
    occupation: optionalText(item.occupation, 120),
    knownCkd: optionalYesNo(item, "knownCkd", "Known CKD"),
    ckdDuration: optionalText(item.ckdDuration, 80),
    ckdStage: requiredChoice(item, "ckdStage", "CKD stage", allowedCkdStages),
    dialysis: optionalYesNo(item, "dialysis", "Dialysis"),
    dialysisFrequency: optionalNumber(item, "dialysisFrequency", "Dialysis frequency", { min: 0, max: 21, integer: true }),
    diabetic: requiredChoice(item, "diabetic", "Diabetic status", allowedYesNoValues),
    diabeticStage: optionalText(item.diabeticStage, 120),
    diabetesDuration: optionalNumber(item, "diabetesDuration", "Diabetes duration", { min: 0, max: 120 }),
    hypertension: optionalYesNo(item, "hypertension", "Hypertension"),
    hypertensionDuration: optionalNumber(item, "hypertensionDuration", "Hypertension duration", { min: 0, max: 120 }),
    cardiovascularDisease: optionalYesNo(item, "cardiovascularDisease", "Cardiovascular disease"),
    familyKidneyHistory: optionalYesNo(item, "familyKidneyHistory", "Family history of kidney disease"),
    reviewedAt: optionalText(item.reviewed_at || item.reviewedAt, 60),
    files
  };

  if (uploadMode === "separate") {
    const requiredSeparateFiles = ["leftKidney", "rightKidney", "egfrReport"];
    const missingFile = requiredSeparateFiles.find((fieldName) => !files.some((file) => file.fieldName === fieldName));
    if (missingFile) {
      throw new Error("Separate-file mode requires left kidney, right kidney, and eGFR report files.");
    }
  }

  if (uploadMode === "package" && !files.some((file) => file.fieldName === "patientPackage")) {
    throw new Error("ZIP package upload is required for package mode.");
  }

  if (uploadMode === "package" && files.some((file) => file.fieldName === "patientPackage" && path.extname(file.name || "").toLowerCase() !== ".zip")) {
    throw new Error("Patient package must be a .zip file.");
  }

  if ((normalized.ckdStage === "3" || normalized.ckdStage === "4") && normalized.dialysis === "-") {
    throw new Error("Dialysis status is required for CKD stage 3 or 4.");
  }

  if (normalized.dialysis === "Yes" && normalized.dialysisFrequency === "-") {
    throw new Error("Dialysis frequency is required when dialysis is Yes.");
  }

  if (normalized.diabetic === "Yes" && normalized.diabeticStage === "-") {
    throw new Error("Diabetes classification is required when diabetic status is Yes.");
  }

  return normalized;
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

    const normalizedSubmissions = submissions.map(normalizeSubmission);

    const now = new Date();
    const batchId = `${now.toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
    const batchDir = path.join(DATA_DIR, "submissions", batchId);
    const gcsSyncDir = path.join(DATA_DIR, "gcs-sync", batchId);
    fs.mkdirSync(batchDir, { recursive: true });
    fs.mkdirSync(gcsSyncDir, { recursive: true });

    const records = normalizedSubmissions.map((item, index) => {
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
        hospitalSessionId: item.hospitalSessionId,
        hospitalSessionName: item.hospitalSessionName,
        hospitalId: item.hospitalId,
        hospitalName: item.hospitalName,
        studyId: item.studyId,
        enrollmentDate: item.enrollmentDate,
        siteCenter: item.siteCenter,
        consentObtained: item.consentObtained,
        uploadMode: item.uploadMode,
        uhid: item.uhid,
        age: item.age,
        sex: item.sex,
        heightCm: item.heightCm,
        weight: item.weight,
        bmi: item.bmi,
        ethnicity: item.ethnicity,
        occupation: item.occupation,
        knownCkd: item.knownCkd,
        ckdDuration: item.ckdDuration,
        ckdStage: item.ckdStage,
        dialysis: item.dialysis,
        dialysisFrequency: item.dialysisFrequency,
        diabetic: item.diabetic,
        diabeticStage: item.diabeticStage,
        diabetesDuration: item.diabetesDuration,
        hypertension: item.hypertension,
        hypertensionDuration: item.hypertensionDuration,
        cardiovascularDisease: item.cardiovascularDisease,
        familyKidneyHistory: item.familyKidneyHistory,
        reviewedAt: item.reviewedAt || null,
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
