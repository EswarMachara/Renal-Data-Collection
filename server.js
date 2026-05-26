const crypto = require("crypto");
const { execFile } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { Pool } = require("pg");

// ─── Load .env file (inline, no extra deps) ───────────────────────────────────
(function loadDotenv() {
  try {
    const lines = fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1); // preserve everything after first '='
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch { /* .env not found — rely on real environment variables */ }
})();

// ─── Configuration ────────────────────────────────────────────────────────────

const PUBLIC_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "0.0.0.0";
const GCS_BUCKET = process.env.GCS_BUCKET || "";
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 300 * 1024 * 1024);
const MAX_CHUNK_BYTES = Number(process.env.MAX_CHUNK_BYTES || 8 * 1024 * 1024);
const UPLOAD_CHUNK_BYTES = Math.min(Number(process.env.UPLOAD_CHUNK_BYTES || 5 * 1024 * 1024), MAX_CHUNK_BYTES);
const UPLOAD_SESSION_DIR = path.join(DATA_DIR, "upload-sessions");
const PARTICIPANT_MAP_FILE = path.join(DATA_DIR, "private", "participant-mapping.json");
const RAW_DATABASE_URL = process.env.DATABASE_URL || "";
const DATABASE_URL = /CHANGE_ME|USER:PASSWORD|HOST:5432/.test(RAW_DATABASE_URL) ? "" : RAW_DATABASE_URL;
const DB_SSL = process.env.DB_SSL || "disable";

// Auth configuration
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString("hex");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const HOSPITAL_CREDENTIALS_RAW = process.env.HOSPITAL_CREDENTIALS_JSON || "";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// ─── Static data ─────────────────────────────────────────────────────────────

const hospitals = [
  { id: "SCMC-RMN-KA", name: "Sri Chamundeshwari Medical College, Ramanagara Dist, Karnataka" },
  { id: "SH-SLM-TN",   name: "Shanmuga Hospital, Salem, Tamil Nadu" },
  { id: "JSS-MYS-KA",  name: "JSS Medical College, Mysore, Karnataka" },
  { id: "NH-BLR-KA",   name: "Nira Health Care Private Limited, Bangalore, Karnataka" },
  { id: "MIL-NDL-DL",  name: "Mahajan Imaging & Labs, New Delhi" }
];

const allowedStudyFlows   = new Set(["egfr", "kfre"]);
const allowedUploadModes  = new Set(["separate", "package", "clinical_document"]);
const allowedSexValues    = new Set(["Male", "Female", "Other"]);
const allowedYesNoValues  = new Set(["Yes", "No"]);
const allowedCkdStages    = new Set(["Normal", "1", "2", "3a", "3b", "4", "5", "Other"]);
const allowedEchogenicityValues = new Set(["Normal", "Mild Increased", "Moderate Increased", "Severe Increased"]);
const allowedKidneySizeValues = new Set(["Normal", "Small", "Enlarged"]);
const allowedParenchymalTextureValues = new Set(["Normal", "Altered"]);
const allowedKfreOutcomeStages = new Set(["1", "2", "3a", "3b", "4", "5"]);
const allowedKfreProgressionValues = new Set(["No change", "Improved", "Progressed", "Kidney failure", "Not assessed"]);
const allowedKfreEventTypes = new Set(["Dialysis", "Transplant"]);
const allowedFileFields   = new Set(["leftKidney", "rightKidney", "egfrReport", "patientPackage", "ultrasoundVideo", "clinicalDocument"]);

// ─── Database pool ────────────────────────────────────────────────────────────

const dbPool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: DB_SSL === "disable" ? false : { rejectUnauthorized: false } })
  : null;

let dbReady = false;

// ─── MIME types ───────────────────────────────────────────────────────────────

const mimeTypes = {
  ".css":  "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
  ".glb":  "model/gltf-binary"
};

// ─── Security headers ─────────────────────────────────────────────────────────

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

// ─── Core utilities ───────────────────────────────────────────────────────────

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...SECURITY_HEADERS
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

function buildResearchIdentifier(studyFlow, type) {
  const pathway = String(studyFlow || "egfr").toUpperCase();
  return `${pathway}-${type}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
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

function readRequestBody(req, maxBytes = MAX_BODY_BYTES, errorMessage = "Submission is too large.") {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error(errorMessage));
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
  const delimiter      = Buffer.from(`--${boundary}`);
  const headerDelimiter = Buffer.from("\r\n\r\n");
  const fields = {};
  const files  = [];

  splitBuffer(buffer, delimiter).forEach((part) => {
    let chunk = part;
    if (chunk.length === 0 || chunk.equals(Buffer.from("--\r\n")) || chunk.equals(Buffer.from("--"))) return;
    if (chunk.subarray(0, 2).toString("latin1") === "\r\n") chunk = chunk.subarray(2);
    if (chunk.subarray(-2).toString("latin1") === "\r\n") chunk = chunk.subarray(0, -2);
    if (chunk.subarray(-2).toString("latin1") === "--") chunk = chunk.subarray(0, -2);

    const headerEnd = chunk.indexOf(headerDelimiter);
    if (headerEnd === -1) return;

    const rawHeaders  = chunk.subarray(0, headerEnd).toString("latin1");
    const content     = chunk.subarray(headerEnd + headerDelimiter.length);
    const disposition = rawHeaders.split("\r\n").find((line) => line.toLowerCase().startsWith("content-disposition:"));
    if (!disposition) return;

    const name        = disposition.match(/name="([^"]+)"/)?.[1];
    const filename    = disposition.match(/filename="([^"]*)"/)?.[1];
    const contentType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "";
    if (!name) return;

    if (filename !== undefined) {
      files.push({ field: name, filename, contentType, content });
      return;
    }
    fields[name] = content.toString("utf8");
  });

  return { fields, files };
}

async function readSubmissionPayload(req) {
  const body        = await readRequestBody(req);
  const contentType = req.headers["content-type"] || "";

  if (contentType.includes("multipart/form-data")) {
    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ||
                     contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
    if (!boundary) throw new Error("Multipart boundary is missing.");

    const multipart = parseMultipartBody(body, boundary);
    const payload   = parseJsonPayload(Buffer.from(multipart.fields.payload || "{}", "utf8"));
    const fileMap   = new Map();
    multipart.files.forEach((file) => {
      const match = file.field.match(/^file_(\d+)_(.+)$/);
      if (!match) return;
      const index     = Number(match[1]);
      const fieldName = match[2];
      const files     = fileMap.get(index) || [];
      files.push({ fieldName, name: file.filename, type: file.contentType || "application/octet-stream", size: file.content.length, content: file.content });
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

// ─── Password helpers ─────────────────────────────────────────────────────────

function scryptAsync(password, salt, keylen) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scryptAsync(password, salt, 64);
  return { hash: hash.toString("hex"), salt };
}

async function verifyDbPassword(username, password) {
  if (!dbPool || !dbReady) return null;
  try {
    const result = await dbPool.query(
      "SELECT user_id, password_hash, password_salt, hospital_id, role FROM users WHERE username = $1 AND active = true",
      [username]
    );
    const user = result.rows[0];
    if (!user) return null;
    const hash   = await scryptAsync(password, user.password_salt, 64);
    const stored = Buffer.from(user.password_hash, "hex");
    if (hash.length !== stored.length || !crypto.timingSafeEqual(hash, stored)) return null;
    return { userId: user.user_id, hospitalId: user.hospital_id, role: user.role };
  } catch {
    return null;
  }
}

// ─── Env-var credential bridge ────────────────────────────────────────────────

const envCredentials = new Map(); // username → { password, hospitalId, role }

function setupEnvCredentials() {
  if (ADMIN_PASSWORD) {
    envCredentials.set("admin", { password: ADMIN_PASSWORD, hospitalId: null, role: "admin" });
  }
  if (HOSPITAL_CREDENTIALS_RAW) {
    try {
      const parsed = JSON.parse(HOSPITAL_CREDENTIALS_RAW);
      for (const [hospitalId, password] of Object.entries(parsed)) {
        if (hospitals.some((h) => h.id === hospitalId) && typeof password === "string") {
          envCredentials.set(hospitalId, { password, hospitalId, role: "hospital" });
        }
      }
    } catch {
      console.warn("[auth] HOSPITAL_CREDENTIALS_JSON is not valid JSON — env-var credentials skipped.");
    }
  }
}

function verifyEnvPassword(username, password) {
  const cred = envCredentials.get(username);
  if (!cred) return null;
  // Timing-safe comparison via HMAC so length differences don't leak info
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(cred.password).digest();
  const actual   = crypto.createHmac("sha256", AUTH_SECRET).update(password).digest();
  if (!crypto.timingSafeEqual(expected, actual)) return null;
  return { userId: username, hospitalId: cred.hospitalId, role: cred.role };
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const loginAttempts = new Map(); // ip → { count, resetAt }
const memoryConsents = new Map(); // consentId → { uhid, hospitalId, userId, consentVersion, createdAt }

function checkRateLimit(ip) {
  const now   = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

function resetRateLimit(ip) {
  loginAttempts.delete(ip);
}

// ─── Session management ───────────────────────────────────────────────────────

const memorySessions = new Map(); // sessionId → { userId, hospitalId, role, expiresAt }

function createMemorySession(userId, hospitalId, role) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  memorySessions.set(sessionId, { userId, hospitalId, role, expiresAt });
  return { sessionId, expiresAt: new Date(expiresAt).toISOString() };
}

async function createDbSession(userId, hospitalId, role) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await dbPool.query(
    "INSERT INTO sessions (session_id, user_id, hospital_id, role, expires_at) VALUES ($1, $2, $3, $4, $5)",
    [sessionId, userId, hospitalId || null, role, expiresAt.toISOString()]
  );
  return { sessionId, expiresAt: expiresAt.toISOString() };
}

async function resolveSession(sessionId) {
  if (!sessionId) return null;

  if (dbPool && dbReady) {
    try {
      const result = await dbPool.query(
        "SELECT user_id, hospital_id, role FROM sessions WHERE session_id = $1 AND expires_at > now()",
        [sessionId]
      );
      if (result.rows[0]) {
        const row = result.rows[0];
        return { userId: row.user_id, hospitalId: row.hospital_id, role: row.role };
      }
    } catch { /* fall through to memory sessions */ }
  }

  const session = memorySessions.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    memorySessions.delete(sessionId);
    return null;
  }
  return { userId: session.userId, hospitalId: session.hospitalId, role: session.role };
}

async function destroySession(sessionId) {
  memorySessions.delete(sessionId);
  if (dbPool && dbReady) {
    try {
      await dbPool.query("DELETE FROM sessions WHERE session_id = $1", [sessionId]);
    } catch { /* non-fatal */ }
  }
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

let authConfigured = false; // set after setupEnvCredentials() runs

async function requireAuth(req, res) {
  if (!authConfigured) {
    // Dev mode: no credentials configured — all requests pass as anonymous admin
    return { userId: "anonymous", hospitalId: null, role: "admin" };
  }
  const authHeader = req.headers["authorization"] || "";
  const token      = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    sendJson(res, 401, { ok: false, error: "Authentication required." });
    return null;
  }
  const session = await resolveSession(token);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "Session expired or invalid. Please sign in again." });
    return null;
  }
  return session;
}

// ─── Audit logging ────────────────────────────────────────────────────────────

async function logAudit({ event, userId = null, hospitalId = null, recordId = null, ip = null, req = null, details = null }) {
  const userAgent = req ? (req.headers["user-agent"] || "").slice(0, 300) : null;
  if (dbPool && dbReady) {
    try {
      await dbPool.query(
        "INSERT INTO audit_logs (event_type, user_id, hospital_id, record_id, ip_address, user_agent, details) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [event, userId, hospitalId, recordId, ip, userAgent, details ? JSON.stringify(details) : null]
      );
    } catch (err) {
      console.error("[audit]", err.message);
    }
  } else {
    console.log(`[AUDIT] ${new Date().toISOString()} ${event}`, JSON.stringify({ userId, hospitalId, recordId, ip }));
  }
}

// ─── Static file server ───────────────────────────────────────────────────────

function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  const requestUrl   = new URL(req.url, `http://${req.headers.host}`);
  const decodedPath  = decodeURIComponent(requestUrl.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath     = path.resolve(PUBLIC_DIR, relativePath);

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
      "Content-Type":  mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Content-Length": fileBuffer.length,
      "Cache-Control":  "no-store",
      ...SECURITY_HEADERS
    });
    if (req.method === "HEAD") { res.end(); return; }
    res.end(fileBuffer);
  });
}

// ─── GCS sync ─────────────────────────────────────────────────────────────────

function copyToGcs(localPath) {
  return new Promise((resolve) => {
    if (!GCS_BUCKET) { resolve({ synced: false }); return; }
    const gcsPath = `gs://${GCS_BUCKET.replace(/^gs:\/\//, "")}`;
    execFile("gsutil", ["-m", "rsync", "-r", localPath, gcsPath], (error, stdout, stderr) => {
      resolve({ synced: !error, gcsPath, error: error ? (stderr || stdout || error.message).trim() : "" });
    });
  });
}

// ─── Database initialisation ──────────────────────────────────────────────────

async function initializeDatabase() {
  if (!dbPool) return;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");

    // Core hospital reference table
    await client.query(`
      CREATE TABLE IF NOT EXISTS hospitals (
        hospital_id  text PRIMARY KEY,
        hospital_name text NOT NULL,
        active       boolean NOT NULL DEFAULT true,
        created_at   timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Auth: users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id       text PRIMARY KEY,
        username      text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        password_salt text NOT NULL,
        hospital_id   text REFERENCES hospitals(hospital_id),
        role          text NOT NULL DEFAULT 'hospital',
        active        boolean NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Auth: sessions
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id  text PRIMARY KEY,
        user_id     text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        hospital_id text,
        role        text NOT NULL,
        expires_at  timestamptz NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)");

    // Consent records
    await client.query(`
      CREATE TABLE IF NOT EXISTS consents (
        consent_id      text PRIMARY KEY,
        uhid            text NOT NULL,
        hospital_id     text NOT NULL REFERENCES hospitals(hospital_id),
        user_id         text NOT NULL REFERENCES users(user_id),
        study_flow      text NOT NULL DEFAULT 'egfr',
        consent_version text NOT NULL DEFAULT '1.0',
        consented_at    timestamptz NOT NULL DEFAULT now(),
        ip_address      text,
        user_agent      text
      )
    `);
    await client.query("ALTER TABLE consents ADD COLUMN IF NOT EXISTS study_flow text NOT NULL DEFAULT 'egfr'");
    await client.query("CREATE INDEX IF NOT EXISTS idx_consents_uhid ON consents(uhid, hospital_id)");

    // Protected mapping from hospital UHID to the pseudonymous research participant identity.
    await client.query(`
      CREATE TABLE IF NOT EXISTS participants (
        participant_id text PRIMARY KEY,
        hospital_id    text NOT NULL REFERENCES hospitals(hospital_id),
        study_flow     text NOT NULL,
        uhid           text NOT NULL,
        created_at     timestamptz NOT NULL DEFAULT now(),
        UNIQUE (hospital_id, study_flow, uhid)
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_participants_lookup ON participants(hospital_id, study_flow, uhid)");

    // Audit log
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        log_id      bigserial PRIMARY KEY,
        event_type  text NOT NULL,
        user_id     text,
        hospital_id text,
        record_id   text,
        ip_address  text,
        user_agent  text,
        details     jsonb,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC)");

    // Submissions
    await client.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        record_id            text PRIMARY KEY,
        batch_id             text NOT NULL,
        received_at          timestamptz NOT NULL,
        hospital_session_id  text NOT NULL REFERENCES hospitals(hospital_id),
        hospital_session_name text NOT NULL,
        hospital_id          text NOT NULL REFERENCES hospitals(hospital_id),
        hospital_name        text NOT NULL,
        participant_id       text REFERENCES participants(participant_id),
        consent_id           text REFERENCES consents(consent_id),
        study_flow           text NOT NULL DEFAULT 'egfr',
        kfre_data            jsonb,
        study_id             text,
        enrollment_date      date,
        site_center          text,
        consent_obtained     text,
        upload_mode          text NOT NULL,
        uhid                 text NOT NULL,
        age                  integer NOT NULL,
        sex                  text NOT NULL,
        height_cm            numeric(6,2),
        weight_kg            numeric(6,2) NOT NULL,
        bmi                  numeric(5,2),
        ethnicity            text,
        occupation           text,
        known_ckd            text,
        ckd_duration         text,
        ckd_stage            text NOT NULL,
        ckd_stage_remarks    text,
        dialysis             text,
        dialysis_frequency   integer,
        diabetic             text NOT NULL,
        diabetic_stage       text,
        diabetes_duration    numeric(5,2),
        hypertension         text,
        hypertension_duration numeric(5,2),
        cardiovascular_disease text,
        family_kidney_history  text,
        reviewed_at          timestamptz,
        reviewed_by          text,
        local_path           text,
        gcs_synced           boolean NOT NULL DEFAULT false,
        gcs_path             text,
        metadata             jsonb NOT NULL,
        created_at           timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Add consent_id to existing tables if upgrading (idempotent)
    await client.query("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS participant_id text REFERENCES participants(participant_id)");
    await client.query("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS consent_id text REFERENCES consents(consent_id)");
    await client.query("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS study_flow text NOT NULL DEFAULT 'egfr'");
    await client.query("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS kfre_data jsonb");
    await client.query("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS reviewed_by text");
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'submissions'
            AND column_name = 'ckd_stage'
            AND data_type <> 'text'
        ) THEN
          ALTER TABLE submissions ALTER COLUMN ckd_stage TYPE text USING ckd_stage::text;
        END IF;
      END $$;
    `);
    await client.query("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ckd_stage_remarks text");

    await client.query(`
      CREATE TABLE IF NOT EXISTS submission_files (
        file_id       bigserial PRIMARY KEY,
        record_id     text NOT NULL REFERENCES submissions(record_id) ON DELETE CASCADE,
        field_name    text NOT NULL,
        original_name text NOT NULL,
        stored_name   text NOT NULL,
        bucket_path   text NOT NULL,
        mime_type     text NOT NULL,
        size_bytes    bigint NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query("CREATE INDEX IF NOT EXISTS idx_submissions_hospital_received ON submissions(hospital_id, received_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_submissions_uhid ON submissions(uhid)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_submission_files_record ON submission_files(record_id)");

    // Seed hospital reference data
    for (const hospital of hospitals) {
      await client.query(
        `INSERT INTO hospitals (hospital_id, hospital_name)
         VALUES ($1, $2)
         ON CONFLICT (hospital_id)
         DO UPDATE SET hospital_name = EXCLUDED.hospital_name, active = true`,
        [hospital.id, hospital.name]
      );
    }

    await client.query("COMMIT");
    dbReady = true;
  } catch (err) {
    await client.query("ROLLBACK");
    dbReady = false;
    throw err;
  } finally {
    client.release();
  }
}

// ─── DB persistence helpers ───────────────────────────────────────────────────

function toNullable(value) {
  return value && value !== "-" ? value : null;
}

function toNumberOrNull(value) {
  if (!value || value === "-") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTimestampOrNull(value) {
  if (!value || value === "-") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function readLocalParticipantMappings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PARTICIPANT_MAP_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalParticipantMappings(mappings) {
  fs.mkdirSync(path.dirname(PARTICIPANT_MAP_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(PARTICIPANT_MAP_FILE, JSON.stringify(mappings, null, 2), { mode: 0o600 });
  try { fs.chmodSync(PARTICIPANT_MAP_FILE, 0o600); } catch { /* best effort on non-POSIX systems */ }
}

async function resolveParticipantId(record) {
  const mappingKey = `${record.studyFlow}|${record.hospitalId}|${record.uhid}`;
  const mappings = readLocalParticipantMappings();
  const proposedId = mappings[mappingKey]?.participantId || buildResearchIdentifier(record.studyFlow, "P");
  let participantId = proposedId;

  if (dbPool && dbReady) {
    const result = await dbPool.query(
      `INSERT INTO participants (participant_id, hospital_id, study_flow, uhid)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (hospital_id, study_flow, uhid)
       DO UPDATE SET hospital_id = EXCLUDED.hospital_id
       RETURNING participant_id`,
      [proposedId, record.hospitalId, record.studyFlow, record.uhid]
    );
    participantId = result.rows[0].participant_id;
  }

  if (mappings[mappingKey]?.participantId !== participantId) {
    mappings[mappingKey] = {
      participantId,
      hospitalId: record.hospitalId,
      studyFlow: record.studyFlow,
      uhid: record.uhid,
      createdAt: mappings[mappingKey]?.createdAt || new Date().toISOString()
    };
    writeLocalParticipantMappings(mappings);
  }

  return participantId;
}

async function persistRecordsToDatabase({ batchId, batchDir, records, gcsResult }) {
  if (!dbPool) return { enabled: false, saved: false };
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    for (const record of records) {
      await client.query(
        `INSERT INTO submissions (
           record_id, batch_id, received_at,
           hospital_session_id, hospital_session_name,
           hospital_id, hospital_name,
           participant_id,
           consent_id,
           study_flow,
           kfre_data,
           study_id, enrollment_date, site_center, consent_obtained,
           upload_mode, uhid, age, sex, height_cm, weight_kg,
           bmi, ethnicity, occupation, known_ckd, ckd_duration, ckd_stage, ckd_stage_remarks,
           dialysis, dialysis_frequency, diabetic, diabetic_stage, diabetes_duration,
           hypertension, hypertension_duration, cardiovascular_disease,
           family_kidney_history, reviewed_at, local_path, gcs_synced, gcs_path, metadata
         )
         VALUES (
           $1,  $2,  $3,
           $4,  $5,
           $6,  $7,
           $8,
           $9,
           $10,
           $11,
           $12, $13, $14, $15,
           $16, $17, $18, $19, $20, $21,
           $22, $23, $24, $25, $26, $27, $28,
           $29, $30, $31, $32, $33,
           $34, $35, $36,
           $37, $38, $39, $40, $41, $42
         )
         ON CONFLICT (record_id) DO UPDATE SET
           gcs_synced = EXCLUDED.gcs_synced,
           gcs_path   = EXCLUDED.gcs_path,
           metadata   = EXCLUDED.metadata`,
        [
          record.recordId, batchId, record.receivedAt,
          record.hospitalSessionId, record.hospitalSessionName,
          record.hospitalId, record.hospitalName,
          record.participantId,
          record.consentId || null,
          record.studyFlow || "egfr",
          record.kfreForm ? JSON.stringify(record.kfreForm) : null,
          toNullable(record.studyId), toNullable(record.enrollmentDate),
          toNullable(record.siteCenter), toNullable(record.consentObtained),
          record.uploadMode, record.uhid, Number(record.age), record.sex,
          toNumberOrNull(record.heightCm), Number(record.weight),
          toNumberOrNull(record.bmi), toNullable(record.ethnicity),
          toNullable(record.occupation), toNullable(record.knownCkd),
          toNullable(record.ckdDuration), record.ckdStage, toNullable(record.ckdStageRemarks),
          toNullable(record.dialysis), toNumberOrNull(record.dialysisFrequency),
          record.diabetic, toNullable(record.diabeticStage),
          toNumberOrNull(record.diabetesDuration), toNullable(record.hypertension),
          toNumberOrNull(record.hypertensionDuration), toNullable(record.cardiovascularDisease),
          toNullable(record.familyKidneyHistory), toTimestampOrNull(record.reviewedAt),
          batchDir, Boolean(gcsResult.synced), gcsResult.gcsPath || null,
          JSON.stringify(record)
        ]
      );

      for (const file of record.files) {
        await client.query(
          `INSERT INTO submission_files (record_id, field_name, original_name, stored_name, bucket_path, mime_type, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [record.recordId, file.fieldName, file.originalName, file.storedName, file.bucketPath, file.type, Number(file.size || 0)]
        );
      }
    }
    await client.query("COMMIT");
    return { enabled: true, saved: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getDatabaseSummary(scopeHospitalId = null) {
  if (!dbPool || !dbReady) return null;

  const filter = scopeHospitalId ? [scopeHospitalId] : [];
  const cond   = scopeHospitalId ? "WHERE hospital_id = $1" : "";
  const activeHospitalCond = scopeHospitalId ? "AND hospital_id = $1" : "";
  const videoQuery = scopeHospitalId
    ? `SELECT COUNT(DISTINCT sf.record_id)::int AS value
       FROM submission_files sf
       JOIN submissions s ON sf.record_id = s.record_id
       WHERE s.hospital_id = $1 AND sf.field_name = 'ultrasoundVideo'`
    : `SELECT COUNT(DISTINCT record_id)::int AS value FROM submission_files WHERE field_name = 'ultrasoundVideo'`;
  const diabeticCond = scopeHospitalId
    ? "WHERE hospital_id = $1 AND ckd_stage <> 'Normal'"
    : "WHERE ckd_stage <> 'Normal'";
  const hospitalBreakdownQuery = `
    SELECT h.hospital_id, h.hospital_name,
           COUNT(DISTINCT s.record_id)::int AS patients,
           COUNT(DISTINCT CASE WHEN sf.field_name = 'ultrasoundVideo' THEN s.record_id END)::int AS videos,
           COUNT(DISTINCT CASE WHEN s.reviewed_at IS NOT NULL THEN s.record_id END)::int AS reviewed
    FROM hospitals h
    LEFT JOIN submissions s ON s.hospital_id = h.hospital_id
    LEFT JOIN submission_files sf ON sf.record_id = s.record_id
    WHERE h.active = true ${scopeHospitalId ? "AND h.hospital_id = $1" : ""}
    GROUP BY h.hospital_id, h.hospital_name
    ORDER BY patients DESC, h.hospital_name ASC`;

  const [partners, summary, stages, diabetic, videos, recent, breakdown, ages] = await Promise.all([
    dbPool.query(`SELECT COUNT(*)::int AS hospitals FROM hospitals WHERE active = true ${activeHospitalCond}`, filter),
    dbPool.query(`SELECT COUNT(*)::int AS patients, (COUNT(*) FILTER (WHERE reviewed_at IS NOT NULL))::int AS reviewed FROM submissions ${cond}`, filter),
    dbPool.query(`SELECT ckd_stage AS label, COUNT(*)::int AS value FROM submissions ${cond} GROUP BY ckd_stage ORDER BY CASE ckd_stage WHEN 'Normal' THEN 0 WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3a' THEN 3 WHEN '3b' THEN 4 WHEN '4' THEN 5 WHEN '5' THEN 6 WHEN 'Other' THEN 7 ELSE 8 END`, filter),
    dbPool.query(`SELECT diabetic AS label, COUNT(*)::int AS value FROM submissions ${diabeticCond} GROUP BY diabetic`, filter),
    dbPool.query(videoQuery, filter),
    dbPool.query(`SELECT record_id, participant_id, batch_id, hospital_id, hospital_name, uhid, study_flow, upload_mode, received_at, reviewed_at FROM submissions ${cond} ORDER BY received_at DESC LIMIT 10`, filter),
    dbPool.query(hospitalBreakdownQuery, filter),
    dbPool.query(`SELECT age FROM submissions ${cond}`, filter)
  ]);

  const ageSeries = {};
  ages.rows.forEach(({ age }) => {
    const numericAge = Number(age);
    if (!Number.isFinite(numericAge) || numericAge < 18) return;
    const lowerBound = Math.floor(numericAge / 10) * 10;
    const bucket = numericAge >= 80 ? "80+" : `${lowerBound}-${lowerBound + 9}`;
    ageSeries[bucket] = (ageSeries[bucket] || 0) + 1;
  });
  const ageBucketOrder = ["18-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80+"];
  const ageBuckets = Object.entries(ageSeries)
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((first, second) => ageBucketOrder.indexOf(first.bucket) - ageBucketOrder.indexOf(second.bucket));
  const recentRecords = recent.rows.map((row) => ({
    recordId: row.record_id,
    participantId: row.participant_id,
    batchId: row.batch_id,
    hospitalId: row.hospital_id,
    hospitalName: row.hospital_name,
    uhid: row.uhid,
    studyFlow: row.study_flow || "egfr",
    uploadMode: row.upload_mode,
    receivedAt: row.received_at,
    reviewedAt: row.reviewed_at || null
  }));

  return {
    summary: {
      hospitals: partners.rows[0]?.hospitals || 0,
      patients:  summary.rows[0]?.patients  || 0,
      videos:    videos.rows[0]?.value       || 0,
      reviewed:  summary.rows[0]?.reviewed  || 0,
      pending:   (summary.rows[0]?.patients || 0) - (summary.rows[0]?.reviewed || 0)
    },
    stages:   stages.rows,
    diabetic: diabetic.rows,
    hospitalBreakdown: breakdown.rows.map((row) => ({
      hospitalId: row.hospital_id,
      hospitalName: row.hospital_name,
      patients: row.patients,
      videos: row.videos,
      reviewed: row.reviewed
    })),
    ageBuckets,
    recentRecords
  };
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function cleanText(value, maxLength = 160) {
  return String(value || "")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function optionalText(value, maxLength = 160) {
  return cleanText(value, maxLength) || "-";
}

function requiredText(item, field, label, maxLength = 160) {
  const value = cleanText(item[field], maxLength);
  if (!value) throw new Error(`${label} is required.`);
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
  if (!allowedValues.has(value)) throw new Error(`${label} has an invalid value.`);
  return value;
}

function optionalYesNo(item, field, label) {
  const value = cleanText(item[field], 12);
  if (!value || value === "-") return "-";
  if (!allowedYesNoValues.has(value)) throw new Error(`${label} must be Yes or No.`);
  return value;
}

function optionalChoice(item, field, label, allowedValues) {
  const value = cleanText(item?.[field], 80);
  if (!value || value === "-") return "-";
  if (!allowedValues.has(value)) throw new Error(`${label} has an invalid value.`);
  return value;
}

function requiredNumber(item, field, label, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const rawValue = cleanText(item[field], 40);
  if (!rawValue) throw new Error(`${label} is required.`);
  if (!/^\d+(\.\d+)?$/.test(rawValue)) throw new Error(`${label} must be a valid non-negative number.`);
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be between ${min} and ${max}${integer ? " as a whole number" : ""}.`);
  }
  return integer ? String(value) : String(Number(value.toFixed(2)));
}

function optionalNumber(item, field, label, options) {
  const rawValue = cleanText(item[field], 40);
  if (!rawValue || rawValue === "-") return "-";
  return requiredNumber(item, field, label, options);
}

function optionalDate(item, field, label) {
  const value = cleanText(item[field], 20);
  if (!value || value === "-") return "-";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD format.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a valid date.`);
  const today = new Date().toISOString().slice(0, 10);
  if (value > today) throw new Error(`${label} cannot be in the future.`);
  return value;
}

function requiredDate(item, field, label) {
  const value = optionalDate(item, field, label);
  if (value === "-") throw new Error(`${label} is required.`);
  return value;
}

function parseDateFilter(value, label, endOfDay = false) {
  const cleaned = cleanText(value, 20);
  if (!cleaned) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) throw new Error(`${label} must use YYYY-MM-DD format.`);
  const date = new Date(`${cleaned}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is not a valid date.`);
  return date;
}

function applySubmissionFilters(records, { reviewed = "", search = "", dateFrom = null, dateTo = null } = {}) {
  let filtered = records;
  if (reviewed === "yes") filtered = filtered.filter((record) => record.reviewedAt);
  if (reviewed === "no")  filtered = filtered.filter((record) => !record.reviewedAt);
  if (dateFrom) filtered = filtered.filter((record) => new Date(record.receivedAt) >= dateFrom);
  if (dateTo)   filtered = filtered.filter((record) => new Date(record.receivedAt) <= dateTo);
  if (search) {
    const normalizedSearch = search.toLowerCase().trim();
    filtered = filtered.filter((record) =>
      (record.uhid       || "").toLowerCase().includes(normalizedSearch) ||
      (record.participantId || "").toLowerCase().includes(normalizedSearch) ||
      (record.recordId   || "").toLowerCase().includes(normalizedSearch) ||
      (record.hospitalId || "").toLowerCase().includes(normalizedSearch)
    );
  }
  return filtered;
}

// ─── File normalisation ───────────────────────────────────────────────────────

function normalizeFiles(files, { requireContent = true } = {}) {
  if (!Array.isArray(files)) throw new Error("Submission files are missing.");
  return files.map((file) => {
    const fieldName   = cleanText(file.fieldName, 60);
    if (!allowedFileFields.has(fieldName)) throw new Error(`Unsupported upload field: ${fieldName || "unknown"}.`);
    const name        = cleanText(file.name, 180) || "upload.bin";
    const size        = Number(file.size || 0);
    let contentSize   = 0;
    if (Buffer.isBuffer(file.content)) {
      contentSize = file.content.length;
    } else if (file.contentBase64) {
      contentSize = Buffer.byteLength(file.contentBase64 || "", "base64");
    } else if (file.sourcePath) {
      try { contentSize = fs.statSync(file.sourcePath).size; } catch { contentSize = 0; }
    }
    if (!Number.isFinite(size) || size < 0) throw new Error(`${name} has an invalid file size.`);
    if (requireContent && contentSize <= 0) throw new Error(`${name} is empty or invalid.`);
    if (!requireContent && size <= 0) throw new Error(`${name} is empty or invalid.`);
    return { ...file, fieldName, name, type: cleanText(file.type, 120) || "application/octet-stream", size: size || contentSize };
  });
}

function normalizeKidneyFinding(rawFinding, label) {
  const finding = rawFinding && typeof rawFinding === "object" && !Array.isArray(rawFinding) ? rawFinding : {};
  const structural = finding.structural && typeof finding.structural === "object" && !Array.isArray(finding.structural)
    ? finding.structural
    : {};

  return {
    lengthCm:            optionalNumber(finding, "lengthCm", `${label} kidney length`, { min: 0.1, max: 30 }),
    widthCm:             optionalNumber(finding, "widthCm", `${label} kidney width`, { min: 0.1, max: 20 }),
    corticalThicknessMm: optionalNumber(finding, "corticalThicknessMm", `${label} cortical thickness`, { min: 0.1, max: 50 }),
    echogenicity:        optionalChoice(finding, "echogenicity", `${label} echogenicity`, allowedEchogenicityValues),
    structural: {
      kidneySize:          optionalChoice(structural, "kidneySize", `${label} kidney size`, allowedKidneySizeValues),
      parenchymalTexture:  optionalChoice(structural, "parenchymalTexture", `${label} parenchymal texture`, allowedParenchymalTextureValues),
      cysts:               optionalYesNo(structural, "cysts", `${label} cysts`),
      stones:              optionalYesNo(structural, "stones", `${label} stones`),
      hydronephrosis:      optionalYesNo(structural, "hydronephrosis", `${label} hydronephrosis`),
      others:              optionalText(structural.others, 160)
    }
  };
}

function normalizeUltrasoundFindings(rawFindings) {
  const findings = rawFindings && typeof rawFindings === "object" && !Array.isArray(rawFindings) ? rawFindings : {};
  return {
    right: normalizeKidneyFinding(findings.right, "Right"),
    left:  normalizeKidneyFinding(findings.left, "Left")
  };
}

function normalizeKfreForm(rawForm, studyFlow) {
  if (studyFlow !== "kfre") return null;
  if (!rawForm || typeof rawForm !== "object" || Array.isArray(rawForm)) {
    throw new Error("KFRE clinical and outcome data are required.");
  }
  const examination = rawForm.clinicalExamination || {};
  const outcomes = rawForm.outcomes || {};
  const normalized = {
    clinicalExamination: {
      systolicBp:    requiredNumber(examination, "systolicBp", "Systolic blood pressure", { min: 50, max: 300, integer: true }),
      diastolicBp:   requiredNumber(examination, "diastolicBp", "Diastolic blood pressure", { min: 30, max: 200, integer: true }),
      heartRate:     requiredNumber(examination, "heartRate", "Heart rate", { min: 20, max: 250, integer: true }),
      waistHipRatio: requiredNumber(examination, "waistHipRatio", "Waist-to-hip ratio", { min: 0.3, max: 3 })
    },
    followUp: null,
    outcomes: {
      ckdStage:           requiredChoice(outcomes, "ckdStage", "KFRE outcome CKD stage", allowedKfreOutcomeStages),
      rapidProgression:   requiredChoice(outcomes, "rapidProgression", "Rapid progression", allowedYesNoValues),
      kidneyFailureEvent: requiredChoice(outcomes, "kidneyFailureEvent", "Kidney failure event", allowedYesNoValues),
      eventDate:          "-",
      eventType:          "-"
    }
  };
  if (Number(normalized.clinicalExamination.systolicBp) <= Number(normalized.clinicalExamination.diastolicBp)) {
    throw new Error("Systolic blood pressure must be greater than diastolic blood pressure.");
  }

  if (rawForm.followUp !== null && rawForm.followUp !== undefined) {
    const followUp = rawForm.followUp;
    if (!followUp || typeof followUp !== "object" || Array.isArray(followUp)) {
      throw new Error("KFRE follow-up data are invalid.");
    }
    const visit = requiredText(followUp, "visit", "Follow-up visit", 10);
    if (!/^T[1-9]\d*$/.test(visit)) throw new Error("Follow-up visit must be a valid timepoint such as T1 or T2.");
    normalized.followUp = {
      visit,
      months:             requiredNumber(followUp, "months", "Follow-up timepoint", { min: 0, max: 240 }),
      repeatCreatinine:   requiredNumber(followUp, "repeatCreatinine", "Repeat creatinine", { min: 0.01, max: 100 }),
      updatedEgfr:        requiredNumber(followUp, "updatedEgfr", "Updated eGFR", { min: 0, max: 250 }),
      ckdProgression:     requiredChoice(followUp, "ckdProgression", "CKD progression", allowedKfreProgressionValues),
      hospitalization:    requiredChoice(followUp, "hospitalization", "Hospitalization", allowedYesNoValues),
      dialysisInitiated:  requiredChoice(followUp, "dialysisInitiated", "Dialysis initiated", allowedYesNoValues),
      transplant:         requiredChoice(followUp, "transplant", "Transplant", allowedYesNoValues)
    };
  }

  if (normalized.outcomes.kidneyFailureEvent === "Yes") {
    normalized.outcomes.eventDate = requiredDate(outcomes, "eventDate", "Kidney failure event date");
    normalized.outcomes.eventType = requiredChoice(outcomes, "eventType", "Kidney failure event type", allowedKfreEventTypes);
  }

  return normalized;
}

function computeDataQualityWarnings(record) {
  const warnings = [];
  const age = Number(record.age);
  const heightCm = record.heightCm === "-" ? null : Number(record.heightCm);
  const weightKg = record.weight === "-" ? null : Number(record.weight);
  const bmi = record.bmi === "-" ? null : Number(record.bmi);

  if (Number.isFinite(age) && age >= 90) warnings.push("Patient age is 90 years or above; verify age entry.");
  if (Number.isFinite(weightKg) && (weightKg < 30 || weightKg > 180)) warnings.push("Weight is outside the usual adult range; verify weight entry.");
  if (Number.isFinite(heightCm) && (heightCm < 120 || heightCm > 210)) warnings.push("Height is outside the usual adult range; verify height entry.");
  if (!Number.isFinite(heightCm)) warnings.push("Height is missing; BMI cannot be independently verified.");
  if (Number.isFinite(heightCm) && Number.isFinite(weightKg) && Number.isFinite(bmi)) {
    const calculatedBmi = weightKg / ((heightCm / 100) ** 2);
    if (Math.abs(calculatedBmi - bmi) > 1) warnings.push("BMI differs from height/weight calculation; verify BMI.");
    if (bmi < 16 || bmi > 40) warnings.push("BMI is outside the usual adult range; verify height and weight.");
  }
  if (["3a", "3b", "4", "5"].includes(record.ckdStage)) {
    if (record.knownCkd === "No") warnings.push("Advanced CKD stage selected while Known CKD is No; verify clinical history.");
  }
  if (record.diabetic === "No" && record.diabetesDuration !== "-") warnings.push("Diabetes duration is present while Diabetes Mellitus is No.");
  if (record.hypertension === "No" && record.hypertensionDuration !== "-") warnings.push("Hypertension duration is present while Hypertension is No.");

  return warnings;
}

function normalizeSubmission(item, options = {}) {
  const hospitalId   = validateIdentifier(requiredText(item, "hospitalId", "Hospital ID", 80), "Hospital ID");
  const hospital     = hospitals.find((entry) => entry.id === hospitalId);
  if (!hospital) throw new Error("Hospital ID is not recognized.");

  const hospitalName = requiredText(item, "hospitalName", "Hospital name", 180);
  if (hospitalName !== hospital.name) throw new Error("Hospital name does not match the selected Hospital ID.");

  const uhid       = validateIdentifier(requiredText(item, "uhid", "Patient Unique ID", 80), "Patient Unique ID");
  const studyFlow  = requiredChoice(item, "studyFlow", "Study pathway", allowedStudyFlows);
  const uploadMode = requiredChoice(item, "uploadMode", "Upload mode", allowedUploadModes);
  const files      = normalizeFiles(item.files, options);
  const consentId  = cleanText(item.consentId || item.consent_id, 100) || null;
  const heightCm   = requiredNumber(item, "heightCm", "Height", { min: 50, max: 250 });
  const weight     = requiredNumber(item, "weight", "Weight", { min: 10, max: 400 });
  const bmiValue   = Number((Number(weight) / ((Number(heightCm) / 100) ** 2)).toFixed(2));
  if (bmiValue < 5 || bmiValue > 100) {
    throw new Error("Height and weight produce an implausible BMI; verify both measurements.");
  }
  const bmi        = String(bmiValue);

  const normalized = {
    hospitalSessionId:    hospitalId,
    hospitalSessionName:  hospital.name,
    hospitalId,
    hospitalName:         hospital.name,
    consentId,
    studyFlow,
    studyId:              optionalText(item.studyId, 80),
    enrollmentDate:       optionalDate(item, "enrollmentDate", "Date of enrollment"),
    siteCenter:           optionalText(item.siteCenter, 140),
    consentObtained:      optionalYesNo(item, "consentObtained", "Consent obtained"),
    uploadMode,
    uhid,
    age:                  requiredNumber(item, "age", "Age", { min: 18, max: 120, integer: true }),
    sex:                  requiredChoice(item, "sex", "Sex", allowedSexValues),
    heightCm,
    weight,
    bmi,
    ethnicity:            optionalText(item.ethnicity, 100),
    occupation:           optionalText(item.occupation, 120),
    knownCkd:             optionalYesNo(item, "knownCkd", "Known CKD"),
    ckdDuration:          optionalText(item.ckdDuration, 80),
    ckdStage:             requiredChoice(item, "ckdStage", "CKD stage", allowedCkdStages),
    ckdStageRemarks:      optionalText(item.ckdStageRemarks, 240),
    dialysis:             optionalYesNo(item, "dialysis", "Dialysis"),
    dialysisFrequency:    optionalNumber(item, "dialysisFrequency", "Dialysis frequency", { min: 0, max: 21, integer: true }),
    diabetic:             requiredChoice(item, "diabetic", "Diabetic status", allowedYesNoValues),
    diabeticStage:        optionalText(item.diabeticStage, 120),
    diabetesDuration:     optionalNumber(item, "diabetesDuration", "Diabetes duration", { min: 0, max: 120 }),
    hypertension:         optionalYesNo(item, "hypertension", "Hypertension"),
    hypertensionDuration: optionalNumber(item, "hypertensionDuration", "Hypertension duration", { min: 0, max: 120 }),
    cardiovascularDisease:  optionalYesNo(item, "cardiovascularDisease", "Cardiovascular disease"),
    familyKidneyHistory:    optionalYesNo(item, "familyKidneyHistory", "Family history of kidney disease"),
    ultrasoundFindings:      studyFlow === "egfr" ? normalizeUltrasoundFindings(item.ultrasoundFindings) : null,
    kfreForm:                normalizeKfreForm(item.kfreForm, studyFlow),
    reviewedAt:           null,
    files
  };

  if (studyFlow === "kfre" && uploadMode !== "clinical_document") {
    throw new Error("KFRE submissions must use the clinical document upload pathway.");
  }
  if (studyFlow === "egfr" && uploadMode === "clinical_document") {
    throw new Error("Clinical-document-only upload is available only for KFRE submissions.");
  }
  if (studyFlow === "kfre") {
    if (files.length !== 1 || !files.some((file) => file.fieldName === "clinicalDocument")) {
      throw new Error("KFRE submission requires one kidney-related clinical document.");
    }
  } else if (files.some((file) => file.fieldName === "clinicalDocument")) {
    throw new Error("KFRE clinical documents cannot be uploaded through the eGFR pathway.");
  }
  if (uploadMode === "separate") {
    const missing = ["leftKidney", "rightKidney", "egfrReport"].find((f) => !files.some((file) => file.fieldName === f));
    if (missing) throw new Error("Separate-file mode requires left kidney, right kidney, and eGFR report files.");
  }
  if (uploadMode === "package" && !files.some((f) => f.fieldName === "patientPackage")) {
    throw new Error("ZIP package upload is required for package mode.");
  }
  if (uploadMode === "package" && files.some((f) => f.fieldName === "patientPackage" && path.extname(f.name || "").toLowerCase() !== ".zip")) {
    throw new Error("Patient package must be a .zip file.");
  }
  if (["3a", "3b", "4", "5"].includes(normalized.ckdStage) && normalized.dialysis === "-") {
    throw new Error("Dialysis status is required for CKD stage 3a, 3b, 4, or 5.");
  }
  if (normalized.ckdStage === "Other" && normalized.ckdStageRemarks === "-") {
    throw new Error("Remarks are required when CKD stage is Other.");
  }
  if (normalized.ckdStage !== "Other") {
    normalized.ckdStageRemarks = "-";
  }
  if (normalized.dialysis === "Yes" && normalized.dialysisFrequency === "-") {
    throw new Error("Dialysis frequency is required when dialysis is Yes.");
  }
  if (normalized.diabetic === "Yes" && normalized.diabeticStage === "-") {
    throw new Error("Diabetes classification is required when diabetic status is Yes.");
  }

  normalized.dataQualityWarnings = computeDataQualityWarnings(normalized);
  return normalized;
}

// ─── File storage helpers ─────────────────────────────────────────────────────

function getFileCategory(fieldName) {
  const categories = {
    leftKidney:      ["images",    "left-kidney", "left-kidney"],
    rightKidney:     ["images",    "right-kidney", "right-kidney"],
    mixed:           ["packages",  "", "mixed"],
    mixedKidney:     ["packages",  "", "mixed"],
    patientPackage:  ["packages",  "", "source-package"],
    ultrasoundVideo: ["videos",    "", "ultrasound-video"],
    egfrReport:      ["documents", "", "egfr-report"],
    clinicalDocument:["documents", "", "kfre-clinical-document"]
  };
  return categories[fieldName] || ["documents", "", fieldName || "document"];
}

function buildStoredFileName(recordId, label, originalName, timestamp, suffix) {
  const extension       = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
  const timestampPart   = timestamp.replace(/[-:TZ.]/g, "").slice(0, 14);
  return `${sanitizeFileName(recordId, "record")}_${sanitizeFileName(label, "file")}_${timestampPart}_${suffix}${extension}`;
}

function getFileContent(file) {
  if (Buffer.isBuffer(file.content)) return file.content;
  return Buffer.from(file.contentBase64 || "", "base64");
}

function writeSubmissionFile(file, localPath, syncPath) {
  if (file.sourcePath) {
    fs.copyFileSync(file.sourcePath, localPath);
    fs.copyFileSync(file.sourcePath, syncPath);
    return fs.statSync(file.sourcePath).size;
  }

  const fileContent = getFileContent(file);
  fs.writeFileSync(localPath, fileContent);
  fs.writeFileSync(syncPath,  fileContent);
  return fileContent.length;
}

function sessionCanAccessUpload(session, uploadSession) {
  if (!session || !uploadSession) return false;
  if (session.role === "admin") return true;
  return session.userId === uploadSession.userId && session.hospitalId === uploadSession.hospitalId;
}

function getUploadSessionPath(uploadId) {
  if (!/^[a-f0-9]{32}$/.test(uploadId || "")) throw new Error("Invalid upload session ID.");
  return path.join(UPLOAD_SESSION_DIR, uploadId);
}

function getUploadManifestPath(uploadId) {
  return path.join(getUploadSessionPath(uploadId), "manifest.json");
}

async function readUploadSession(uploadId) {
  const manifestPath = getUploadManifestPath(uploadId);
  return JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
}

async function writeUploadSession(uploadSession) {
  const sessionDir = getUploadSessionPath(uploadSession.uploadId);
  await fs.promises.mkdir(sessionDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(sessionDir, "manifest.json"),
    JSON.stringify(uploadSession, null, 2)
  );
}

// ─── Route handlers ───────────────────────────────────────────────────────────

// GET /api/hospitals — public; no auth required (just the hospital list)
function handleGetHospitals(req, res) {
  sendJson(res, 200, { ok: true, hospitals });
}

// POST /api/auth/login
async function handleLogin(req, res) {
  const ip = req.socket?.remoteAddress || "unknown";

  if (!checkRateLimit(ip)) {
    sendJson(res, 429, { ok: false, error: "Too many login attempts. Please wait 15 minutes and try again." });
    return;
  }

  let body;
  try {
    body = parseJsonPayload(await readRequestBody(req));
  } catch {
    sendJson(res, 400, { ok: false, error: "Invalid request body." });
    return;
  }

  const username = cleanText(body.username, 80);
  const password = cleanText(body.password, 200);

  if (!username || !password) {
    sendJson(res, 400, { ok: false, error: "Username and password are required." });
    return;
  }

  let user = null;

  // DB users take precedence when DB is ready
  if (dbPool && dbReady) {
    user = await verifyDbPassword(username, password);
  }

  // Fall back to env-var credentials
  if (!user && envCredentials.size > 0) {
    user = verifyEnvPassword(username, password);
  }

  if (!user) {
    await logAudit({ event: "login_failed", ip, req, details: { username } });
    // Constant-time delay to limit timing oracle
    await new Promise((r) => setTimeout(r, 200));
    sendJson(res, 401, { ok: false, error: "Invalid username or password." });
    return;
  }

  resetRateLimit(ip);

  let sessionResult;
  try {
    sessionResult = (dbPool && dbReady)
      ? await createDbSession(user.userId, user.hospitalId, user.role)
      : createMemorySession(user.userId, user.hospitalId, user.role);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: "Failed to create session." });
    return;
  }

  await logAudit({ event: "login", userId: user.userId, hospitalId: user.hospitalId, ip, req });

  const hospital = hospitals.find((h) => h.id === user.hospitalId);
  sendJson(res, 200, {
    ok: true,
    token: sessionResult.sessionId,
    expiresAt: sessionResult.expiresAt,
    user: {
      userId:       user.userId,
      hospitalId:   user.hospitalId,
      hospitalName: hospital?.name || null,
      role:         user.role
    }
  });
}

// POST /api/auth/logout
async function handleLogout(req, res) {
  const authHeader = req.headers["authorization"] || "";
  const token      = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (token) {
    const session = await resolveSession(token);
    if (session) {
      await destroySession(token);
      await logAudit({ event: "logout", userId: session.userId, hospitalId: session.hospitalId, ip: req.socket?.remoteAddress, req });
    }
  }
  sendJson(res, 200, { ok: true });
}

// GET /api/auth/me
async function handleMe(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  const hospital = hospitals.find((h) => h.id === session.hospitalId);
  sendJson(res, 200, {
    ok: true,
    user: {
      userId:       session.userId,
      hospitalId:   session.hospitalId,
      hospitalName: hospital?.name || null,
      role:         session.role
    }
  });
}

// POST /api/consent
async function handleConsentRecord(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  let body;
  try {
    body = parseJsonPayload(await readRequestBody(req));
  } catch {
    sendJson(res, 400, { ok: false, error: "Invalid request body." });
    return;
  }

  let uhid, hospitalId, studyFlow;
  try {
    uhid       = validateIdentifier(cleanText(body.uhid, 80), "Patient ID");
    studyFlow  = requiredChoice(body, "studyFlow", "Study pathway", allowedStudyFlows);
    hospitalId = session.role === "admin"
      ? validateIdentifier(cleanText(body.hospitalId, 80), "Hospital ID")
      : session.hospitalId;
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message });
    return;
  }

  if (!hospitals.some((h) => h.id === hospitalId)) {
    sendJson(res, 400, { ok: false, error: "Invalid hospital ID." });
    return;
  }

  const consentVersion = `${studyFlow}-1.0`;
  const consentId      = `consent-${crypto.randomBytes(8).toString("hex")}`;
  const ip             = req.socket?.remoteAddress || null;
  memoryConsents.set(consentId, {
    uhid,
    hospitalId,
    userId: session.userId,
    studyFlow,
    consentVersion,
    createdAt: new Date().toISOString()
  });

  if (dbPool && dbReady) {
    try {
      await dbPool.query(
        `INSERT INTO consents (consent_id, uhid, hospital_id, user_id, study_flow, consent_version, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [consentId, uhid, hospitalId, session.userId, studyFlow, consentVersion, ip, (req.headers["user-agent"] || "").slice(0, 300)]
      );
    } catch (err) {
      sendJson(res, 500, { ok: false, error: "Failed to record consent." });
      return;
    }
  }

  await logAudit({
    event: "consent_recorded", userId: session.userId, hospitalId, ip, req,
    details: { uhid, consentId, studyFlow, consentVersion }
  });

  sendJson(res, 200, { ok: true, consentId, studyFlow, consentVersion });
}

async function verifySubmissionConsent(record) {
  if (!record.consentId) {
    throw new Error("Recorded e-consent is required before submission.");
  }

  if (dbPool && dbReady) {
    const result = await dbPool.query(
      "SELECT consent_id FROM consents WHERE consent_id = $1 AND uhid = $2 AND hospital_id = $3 AND study_flow = $4",
      [record.consentId, record.uhid, record.hospitalId, record.studyFlow]
    );
    if (!result.rows[0]) {
      throw new Error("Consent record was not found for this patient. Please return to E-Consent and record consent again.");
    }
    return;
  }

  const consent = memoryConsents.get(record.consentId);
  if (!consent || consent.uhid !== record.uhid || consent.hospitalId !== record.hospitalId || consent.studyFlow !== record.studyFlow) {
    throw new Error("Consent record was not found for this patient. Please return to E-Consent and record consent again.");
  }
}

async function finalizeSubmissionBatch({ normalizedSubmissions, session, req }) {
  if (session.role === "hospital" && session.hospitalId) {
    const wrongHospital = normalizedSubmissions.find((item) => item.hospitalId !== session.hospitalId);
    if (wrongHospital) {
      const err = new Error("You can only submit records for your assigned hospital.");
      err.statusCode = 403;
      throw err;
    }
  }

  for (const record of normalizedSubmissions) {
    await verifySubmissionConsent(record);
  }

  const now      = new Date();
  const batchId  = `${now.toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
  const batchDir = path.join(DATA_DIR, "submissions", batchId);
  const gcsSyncDir = path.join(DATA_DIR, "gcs-sync", batchId);
  fs.mkdirSync(batchDir,   { recursive: true });
  fs.mkdirSync(gcsSyncDir, { recursive: true });

  const records = [];
  for (const item of normalizedSubmissions) {
    const participantId = await resolveParticipantId(item);
    const recordId  = buildResearchIdentifier(item.studyFlow, "R");
    const recordDir = path.join(batchDir, recordId);
    fs.mkdirSync(recordDir, { recursive: true });
    const cloudRecordPrefix = path.join("raw", item.studyFlow, item.hospitalId, participantId, recordId);

    const storedFiles = item.files.map((file) => {
      const fieldName                     = sanitizeFileName(file.fieldName || "upload");
      const [topLevelFolder, subFolder, label] = getFileCategory(fieldName);
      const storedName    = buildStoredFileName(recordId, label, file.name || "upload.bin", now.toISOString(), recordId.slice(-6));
      const relativeFolder = subFolder
        ? path.join(cloudRecordPrefix, topLevelFolder, subFolder)
        : path.join(cloudRecordPrefix, topLevelFolder);
      const localFolder = path.join(recordDir, relativeFolder);
      const syncFolder  = path.join(gcsSyncDir, relativeFolder);
      fs.mkdirSync(localFolder, { recursive: true });
      fs.mkdirSync(syncFolder,  { recursive: true });

      const storedSize = writeSubmissionFile(
        file,
        path.join(localFolder, storedName),
        path.join(syncFolder,  storedName)
      );

      return {
        fieldName,
        originalName: file.name,
        storedName,
        bucketPath: path.posix.join(cloudRecordPrefix, topLevelFolder, subFolder, storedName).replace(/\/+/g, "/"),
        type:        file.type || "application/octet-stream",
        size:        Number(file.size || storedSize || 0)
      };
    });

    const metadata = {
      recordId,
      participantId,
      receivedAt:           now.toISOString(),
      hospitalSessionId:    item.hospitalSessionId,
      hospitalSessionName:  item.hospitalSessionName,
      hospitalId:           item.hospitalId,
      hospitalName:         item.hospitalName,
      consentId:            item.consentId || null,
      studyFlow:            item.studyFlow,
      studyId:              item.studyId,
      enrollmentDate:       item.enrollmentDate,
      siteCenter:           item.siteCenter,
      consentObtained:      item.consentObtained,
      uploadMode:           item.uploadMode,
      uhid:                 item.uhid,
      age:                  item.age,
      sex:                  item.sex,
      heightCm:             item.heightCm,
      weight:               item.weight,
      bmi:                  item.bmi,
      ethnicity:            item.ethnicity,
      occupation:           item.occupation,
      knownCkd:             item.knownCkd,
      ckdDuration:          item.ckdDuration,
      ckdStage:             item.ckdStage,
      ckdStageRemarks:      item.ckdStageRemarks,
      dialysis:             item.dialysis,
      dialysisFrequency:    item.dialysisFrequency,
      diabetic:             item.diabetic,
      diabeticStage:        item.diabeticStage,
      diabetesDuration:     item.diabetesDuration,
      hypertension:         item.hypertension,
      hypertensionDuration: item.hypertensionDuration,
      cardiovascularDisease:  item.cardiovascularDisease,
      familyKidneyHistory:    item.familyKidneyHistory,
      ultrasoundFindings:    item.ultrasoundFindings,
      kfreForm:              item.kfreForm,
      dataQualityWarnings:  item.dataQualityWarnings || [],
      reviewedAt:           item.reviewedAt || null,
      files:                storedFiles
    };

    fs.writeFileSync(path.join(recordDir, "metadata.json"), JSON.stringify(metadata, null, 2));
    records.push(metadata);
  }

  fs.writeFileSync(
    path.join(batchDir, "batch-manifest.json"),
    JSON.stringify({ batchId, receivedAt: now.toISOString(), records }, null, 2)
  );

  const gcsResult = await copyToGcs(gcsSyncDir);
  const dbResult  = await persistRecordsToDatabase({ batchId, batchDir, records, gcsResult });

  for (const record of records) {
    await logAudit({
      event: "submission_created",
      userId: session.userId, hospitalId: record.hospitalId, recordId: record.recordId,
      ip: req.socket?.remoteAddress, req,
      details: { batchId, studyFlow: record.studyFlow, uploadMode: record.uploadMode }
    });
  }

  return {
    ok: true,
    batchId,
    received:      records.length,
    localPath:     batchDir,
    gcsSynced:     gcsResult.synced,
    gcsPath:       gcsResult.gcsPath || null,
    gcsError:      gcsResult.error || null,
    dbSaved:       dbResult.saved,
    dbConfigured:  dbResult.enabled
  };
}

// POST /api/submissions
async function handleSubmission(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const payload     = await readSubmissionPayload(req);
    const submissions = Array.isArray(payload.submissions) ? payload.submissions : [];
    if (!submissions.length) {
      sendJson(res, 400, { ok: false, error: "No submissions received." });
      return;
    }

    const normalizedSubmissions = submissions.map((item) => normalizeSubmission(item));
    const result = await finalizeSubmissionBatch({ normalizedSubmissions, session, req });
    sendJson(res, 200, result);
  } catch (err) {
    await logAudit({
      event: "submission_failed",
      userId: session.userId,
      hospitalId: session.hospitalId,
      ip: req.socket?.remoteAddress,
      req,
      details: { error: err.message }
    });
    sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
  }
}

// POST /api/uploads/init — create a resumable upload session
async function handleUploadInit(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  let body;
  try {
    body = parseJsonPayload(await readRequestBody(req, 1024 * 1024, "Upload metadata is too large."));
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || "Invalid request body." });
    return;
  }

  try {
    const normalizedSubmission = normalizeSubmission(body.submission || {}, { requireContent: false });
    if (session.role === "hospital" && session.hospitalId && normalizedSubmission.hospitalId !== session.hospitalId) {
      sendJson(res, 403, { ok: false, error: "You can only submit records for your assigned hospital." });
      return;
    }
    await verifySubmissionConsent(normalizedSubmission);

    const uploadId   = crypto.randomBytes(16).toString("hex");
    const now        = new Date().toISOString();
    const uploadFiles = normalizedSubmission.files.map((file, index) => ({
      index,
      fieldName:     file.fieldName,
      name:          file.name,
      type:          file.type,
      size:          Number(file.size || 0),
      chunkSize:     UPLOAD_CHUNK_BYTES,
      receivedBytes: 0,
      chunks:        {}
    }));

    const uploadSession = {
      uploadId,
      status:     "receiving",
      createdAt:  now,
      updatedAt:  now,
      userId:     session.userId,
      hospitalId: normalizedSubmission.hospitalId,
      role:       session.role,
      submission: {
        ...normalizedSubmission,
        files: uploadFiles.map(({ chunks, receivedBytes, chunkSize, index, ...file }) => file)
      },
      files: uploadFiles
    };

    await writeUploadSession(uploadSession);
    await Promise.all(uploadFiles.map((file) =>
      fs.promises.mkdir(path.join(getUploadSessionPath(uploadId), "chunks", String(file.index)), { recursive: true })
    ));

    await logAudit({
      event: "upload_session_created",
      userId: session.userId, hospitalId: normalizedSubmission.hospitalId,
      ip: req.socket?.remoteAddress, req,
      details: { uploadId, fileCount: uploadFiles.length, totalBytes: uploadFiles.reduce((sum, file) => sum + file.size, 0) }
    });

    sendJson(res, 200, {
      ok: true,
      uploadId,
      chunkSize: UPLOAD_CHUNK_BYTES,
      files: uploadFiles.map(({ chunks, ...file }) => file)
    });
  } catch (err) {
    await logAudit({
      event: "upload_session_init_failed",
      userId: session.userId,
      hospitalId: session.hospitalId,
      ip: req.socket?.remoteAddress,
      req,
      details: { error: err.message }
    });
    sendJson(res, 400, { ok: false, error: err.message });
  }
}

// GET /api/uploads/:uploadId/status — inspect resumable upload progress
async function handleUploadStatus(req, res, uploadId) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const uploadSession = await readUploadSession(uploadId);
    if (!sessionCanAccessUpload(session, uploadSession)) {
      sendJson(res, 403, { ok: false, error: "Access denied." });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      uploadId,
      status: uploadSession.status,
      files: uploadSession.files.map((file) => ({
        index: file.index,
        fieldName: file.fieldName,
        name: file.name,
        size: file.size,
        receivedBytes: file.receivedBytes || 0,
        receivedChunks: Object.keys(file.chunks || {}).map(Number).sort((a, b) => a - b)
      }))
    });
  } catch {
    sendJson(res, 404, { ok: false, error: "Upload session not found." });
  }
}

// PUT /api/uploads/:uploadId/files/:fileIndex/chunks/:chunkIndex
async function handleUploadChunk(req, res, uploadId, fileIndex, chunkIndex) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const uploadSession = await readUploadSession(uploadId);
    if (!sessionCanAccessUpload(session, uploadSession)) {
      sendJson(res, 403, { ok: false, error: "Access denied." });
      return;
    }
    if (uploadSession.status !== "receiving") {
      sendJson(res, 409, { ok: false, error: "Upload session is not accepting chunks." });
      return;
    }

    const file = uploadSession.files[Number(fileIndex)];
    if (!file || file.index !== Number(fileIndex)) {
      sendJson(res, 404, { ok: false, error: "Upload file not found." });
      return;
    }

    const expectedChunks = Math.ceil(file.size / UPLOAD_CHUNK_BYTES);
    if (!Number.isInteger(Number(chunkIndex)) || Number(chunkIndex) < 0 || Number(chunkIndex) >= expectedChunks) {
      sendJson(res, 400, { ok: false, error: "Invalid chunk index." });
      return;
    }

    const chunk = await readRequestBody(req, MAX_CHUNK_BYTES, "Upload chunk is too large.");
    const expectedSize = Number(chunkIndex) === expectedChunks - 1
      ? file.size - (Number(chunkIndex) * UPLOAD_CHUNK_BYTES)
      : UPLOAD_CHUNK_BYTES;
    if (chunk.length !== expectedSize) {
      sendJson(res, 400, { ok: false, error: "Chunk size does not match expected size." });
      return;
    }

    const chunkDir = path.join(getUploadSessionPath(uploadId), "chunks", String(file.index));
    await fs.promises.mkdir(chunkDir, { recursive: true });
    const chunkPath = path.join(chunkDir, `${String(chunkIndex).padStart(8, "0")}.part`);
    const wasReceived = Boolean(file.chunks?.[chunkIndex]);
    await fs.promises.writeFile(chunkPath, chunk);

    file.chunks = file.chunks || {};
    file.chunks[chunkIndex] = { size: chunk.length, receivedAt: new Date().toISOString() };
    file.receivedBytes = Object.values(file.chunks).reduce((sum, part) => sum + Number(part.size || 0), 0);
    uploadSession.updatedAt = new Date().toISOString();
    await writeUploadSession(uploadSession);

    sendJson(res, 200, {
      ok: true,
      uploadId,
      fileIndex: file.index,
      chunkIndex: Number(chunkIndex),
      duplicate: wasReceived,
      receivedBytes: file.receivedBytes,
      fileComplete: file.receivedBytes === file.size
    });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || "Failed to save upload chunk." });
  }
}

async function assembleUploadFile(uploadId, file) {
  const expectedChunks = Math.ceil(file.size / UPLOAD_CHUNK_BYTES);
  if (Object.keys(file.chunks || {}).length !== expectedChunks || Number(file.receivedBytes || 0) !== Number(file.size)) {
    throw new Error(`${file.name} is incomplete. Please retry the upload.`);
  }

  const sessionDir = getUploadSessionPath(uploadId);
  const assembledDir = path.join(sessionDir, "assembled");
  await fs.promises.mkdir(assembledDir, { recursive: true });
  const assembledPath = path.join(assembledDir, `${file.index}-${sanitizeFileName(file.name, "upload.bin")}`);
  const writeStream = fs.createWriteStream(assembledPath);

  for (let chunkIndex = 0; chunkIndex < expectedChunks; chunkIndex += 1) {
    const chunkPath = path.join(sessionDir, "chunks", String(file.index), `${String(chunkIndex).padStart(8, "0")}.part`);
    await new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(chunkPath);
      readStream.on("error", reject);
      readStream.on("end", resolve);
      readStream.pipe(writeStream, { end: false });
    });
  }

  await new Promise((resolve, reject) => {
    writeStream.end((err) => err ? reject(err) : resolve());
  });

  const stat = await fs.promises.stat(assembledPath);
  if (stat.size !== file.size) throw new Error(`${file.name} failed integrity verification.`);
  return assembledPath;
}

// POST /api/uploads/:uploadId/complete — finalize chunked upload into submission storage
async function handleUploadComplete(req, res, uploadId) {
  const session = await requireAuth(req, res);
  if (!session) return;

  let uploadSession;
  try {
    uploadSession = await readUploadSession(uploadId);
  } catch {
    sendJson(res, 404, { ok: false, error: "Upload session not found." });
    return;
  }

  if (!sessionCanAccessUpload(session, uploadSession)) {
    sendJson(res, 403, { ok: false, error: "Access denied." });
    return;
  }

  try {
    uploadSession.status = "finalizing";
    uploadSession.updatedAt = new Date().toISOString();
    await writeUploadSession(uploadSession);

    const assembledFiles = [];
    for (const file of uploadSession.files) {
      const sourcePath = await assembleUploadFile(uploadId, file);
      assembledFiles.push({
        fieldName: file.fieldName,
        name:      file.name,
        type:      file.type,
        size:      file.size,
        sourcePath
      });
    }

    const normalizedSubmission = normalizeSubmission({
      ...uploadSession.submission,
      files: assembledFiles
    });
    const result = await finalizeSubmissionBatch({ normalizedSubmissions: [normalizedSubmission], session, req });

    uploadSession.status = "completed";
    uploadSession.completedAt = new Date().toISOString();
    uploadSession.result = { batchId: result.batchId, gcsSynced: result.gcsSynced, dbSaved: result.dbSaved };
    await writeUploadSession(uploadSession);

    await logAudit({
      event: "upload_session_completed",
      userId: session.userId, hospitalId: uploadSession.hospitalId,
      ip: req.socket?.remoteAddress, req,
      details: { uploadId, batchId: result.batchId }
    });

    fs.rm(getUploadSessionPath(uploadId), { recursive: true, force: true }, () => {});
    sendJson(res, 200, result);
  } catch (err) {
    uploadSession.status = "failed";
    uploadSession.error = err.message;
    uploadSession.updatedAt = new Date().toISOString();
    try { await writeUploadSession(uploadSession); } catch { /* ignore */ }
    await logAudit({
      event: "upload_session_failed",
      userId: session.userId, hospitalId: uploadSession.hospitalId,
      ip: req.socket?.remoteAddress, req,
      details: { uploadId, error: err.message }
    });
    sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
  }
}

// ─── Submission filesystem helpers ───────────────────────────────────────────

async function readAllSubmissions(scopeHospitalId = null) {
  const submissionsDir = path.join(DATA_DIR, "submissions");
  const results = [];
  let batchDirs;
  try { batchDirs = await fs.promises.readdir(submissionsDir); } catch { return results; }

  for (const batchId of batchDirs) {
    const batchPath = path.join(submissionsDir, batchId);
    let stat;
    try { stat = await fs.promises.stat(batchPath); } catch { continue; }
    if (!stat.isDirectory()) continue;

    let recordDirs;
    try { recordDirs = await fs.promises.readdir(batchPath); } catch { continue; }

    for (const recordId of recordDirs) {
      if (recordId.endsWith(".json")) continue;
      const metaPath = path.join(batchPath, recordId, "metadata.json");
      let meta;
      try { meta = JSON.parse(await fs.promises.readFile(metaPath, "utf8")); } catch { continue; }
      if (scopeHospitalId && meta.hospitalId !== scopeHospitalId) continue;
      results.push({ ...meta, batchId, _metaPath: metaPath });
    }
  }

  results.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
  return results;
}

async function findSubmissionById(recordId) {
  const submissionsDir = path.join(DATA_DIR, "submissions");
  let batchDirs;
  try { batchDirs = await fs.promises.readdir(submissionsDir); } catch { return null; }

  for (const batchId of batchDirs) {
    const metaPath = path.join(submissionsDir, batchId, recordId, "metadata.json");
    try {
      const meta = JSON.parse(await fs.promises.readFile(metaPath, "utf8"));
      return { ...meta, batchId, _metaPath: metaPath };
    } catch { continue; }
  }
  return null;
}

// GET /api/submissions — paginated list, scoped by role
async function handleGetSubmissions(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const url    = new URL(req.url, `http://${req.headers.host}`);
  const page   = Math.max(1, parseInt(url.searchParams.get("page")  || "1",  10));
  const limit  = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
  const reviewed = url.searchParams.get("reviewed") || "";
  const search   = (url.searchParams.get("search")  || "").toLowerCase().trim();
  let dateFrom, dateTo;
  try {
    dateFrom = parseDateFilter(url.searchParams.get("dateFrom") || "", "From date");
    dateTo   = parseDateFilter(url.searchParams.get("dateTo")   || "", "To date", true);
    if (dateFrom && dateTo && dateFrom > dateTo) throw new Error("From date cannot be after To date.");
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message });
    return;
  }
  const filterHospital = session.role === "hospital"
    ? session.hospitalId
    : (url.searchParams.get("hospitalId") || "");

  try {
    let all = await readAllSubmissions(filterHospital || null);

    all = applySubmissionFilters(all, { reviewed, search, dateFrom, dateTo });

    const total = all.length;
    const items = all.slice((page - 1) * limit, page * limit).map((r) => ({
      recordId:     r.recordId,
      participantId:r.participantId || null,
      batchId:      r.batchId,
      hospitalId:   r.hospitalId,
      hospitalName: r.hospitalName,
      uhid:         r.uhid,
      studyFlow:    r.studyFlow || "egfr",
      age:          r.age,
      sex:          r.sex,
      ckdStage:     r.ckdStage,
      uploadMode:   r.uploadMode,
      fileCount:    Array.isArray(r.files) ? r.files.length : 0,
      qualityWarningCount: Array.isArray(r.dataQualityWarnings) ? r.dataQualityWarnings.length : 0,
      receivedAt:   r.receivedAt,
      reviewedAt:   r.reviewedAt  || null,
      reviewedBy:   r.reviewedBy  || null,
      consentId:    r.consentId   || null
    }));

    sendJson(res, 200, { ok: true, total, page, limit, items });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/submissions/:recordId — full detail
async function handleGetSubmissionDetail(req, res, recordId) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const submission = await findSubmissionById(recordId);
  if (!submission) {
    sendJson(res, 404, { ok: false, error: "Submission not found." });
    return;
  }
  if (session.role === "hospital" && submission.hospitalId !== session.hospitalId) {
    sendJson(res, 403, { ok: false, error: "Access denied." });
    return;
  }

  const { _metaPath, ...data } = submission;
  sendJson(res, 200, { ok: true, submission: data });
}

// PATCH /api/submissions/:recordId — mark / unmark reviewed (admin only)
async function handleReviewSubmission(req, res, recordId) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (session.role !== "admin") {
    sendJson(res, 403, { ok: false, error: "Only admin users can mark submissions as reviewed." });
    return;
  }

  const submission = await findSubmissionById(recordId);
  if (!submission) {
    sendJson(res, 404, { ok: false, error: "Submission not found." });
    return;
  }

  let body;
  try { body = parseJsonPayload(await readRequestBody(req)); } catch {
    sendJson(res, 400, { ok: false, error: "Invalid request body." }); return;
  }

  const markReviewed = body.reviewed !== false;
  const { _metaPath, ...meta } = submission;
  meta.reviewedAt  = markReviewed ? new Date().toISOString() : null;
  meta.reviewedBy  = markReviewed ? session.userId           : null;

  try {
    fs.writeFileSync(_metaPath, JSON.stringify(meta, null, 2));
    if (dbPool && dbReady) {
      await dbPool.query(
        "UPDATE submissions SET reviewed_at = $1, reviewed_by = $2 WHERE record_id = $3",
        [meta.reviewedAt, meta.reviewedBy, meta.recordId]
      );
    }
  } catch {
    sendJson(res, 500, { ok: false, error: "Failed to update submission." });
    return;
  }

  await logAudit({
    event: markReviewed ? "submission_reviewed" : "submission_review_cleared",
    userId: session.userId, hospitalId: meta.hospitalId, recordId: meta.recordId,
    ip: req.socket?.remoteAddress, req
  });

  sendJson(res, 200, { ok: true, reviewedAt: meta.reviewedAt, reviewedBy: meta.reviewedBy });
}

// GET /api/submissions/export — full CSV export respecting current filters
async function handleExportSubmissions(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const url            = new URL(req.url, `http://${req.headers.host}`);
  const reviewed       = url.searchParams.get("reviewed") || "";
  const search         = (url.searchParams.get("search") || "").toLowerCase().trim();
  let dateFrom, dateTo;
  try {
    dateFrom = parseDateFilter(url.searchParams.get("dateFrom") || "", "From date");
    dateTo   = parseDateFilter(url.searchParams.get("dateTo")   || "", "To date", true);
    if (dateFrom && dateTo && dateFrom > dateTo) throw new Error("From date cannot be after To date.");
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message });
    return;
  }
  const filterHospital = session.role === "hospital"
    ? session.hospitalId
    : (url.searchParams.get("hospitalId") || "");

  try {
    let all = await readAllSubmissions(filterHospital || null);
    all = applySubmissionFilters(all, { reviewed, search, dateFrom, dateTo });

    const cols = [
      "recordId", "participantId", "batchId", "studyFlow", "hospitalId", "hospitalName", "uhid",
      "age", "sex", "heightCm", "weight", "bmi", "ethnicity", "occupation",
      "ckdStage", "ckdStageRemarks", "knownCkd", "ckdDuration", "dialysis", "dialysisFrequency",
      "diabetic", "diabeticStage", "diabetesDuration",
      "hypertension", "hypertensionDuration", "cardiovascularDisease", "familyKidneyHistory",
      "uploadMode", "fileCount", "consentId", "enrollmentDate", "receivedAt",
      "reviewedAt", "reviewedBy", "dataQualityWarnings"
    ];

    const headers = [
      "Record ID", "Participant ID", "Batch ID", "Study Pathway", "Hospital ID", "Hospital Name", "Patient ID (UHID)",
      "Age", "Sex", "Height (cm)", "Weight (kg)", "BMI", "Ethnicity", "Occupation",
      "Kidney Status / CKD Stage", "CKD Stage Remarks", "Known CKD", "CKD Duration", "Dialysis", "Dialysis Frequency",
      "Diabetic", "Diabetic Stage", "Diabetes Duration",
      "Hypertension", "Hypertension Duration", "Cardiovascular Disease", "Family Kidney History",
      "Upload Mode", "File Count", "Consent ID", "Enrollment Date", "Received At",
      "Reviewed At", "Reviewed By", "Data Quality Warnings"
    ];

    function csvCell(v) {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }

    const rows = [headers.join(",")];
    for (const r of all) {
      const fileCount = Array.isArray(r.files) ? r.files.length : 0;
      const row = cols.map((c) => {
        if (c === "fileCount") return fileCount;
        if (c === "dataQualityWarnings") return csvCell((r.dataQualityWarnings || []).join(" | "));
        return csvCell(r[c]);
      });
      rows.push(row.join(","));
    }

    await logAudit({
      event: "submissions_exported",
      userId: session.userId,
      hospitalId: filterHospital || session.hospitalId || null,
      ip: req.socket?.remoteAddress,
      req,
      details: {
        count: all.length,
        filters: {
          hospitalId: filterHospital || "",
          reviewed,
          search,
          dateFrom: url.searchParams.get("dateFrom") || "",
          dateTo: url.searchParams.get("dateTo") || ""
        }
      }
    });

    const csv      = rows.join("\r\n");
    const dateStr  = new Date().toISOString().slice(0, 10);
    const filename = `tanuh-submissions-${dateStr}.csv`;

    res.writeHead(200, {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length":      Buffer.byteLength(csv, "utf8"),
      ...SECURITY_HEADERS
    });
    res.end(csv);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

// Compute full summary from filesystem (used when DB is not ready)
async function getFilesystemSummary(scopeHospitalId = null) {
  const all = await readAllSubmissions(scopeHospitalId);

  // Seed hospital map from known hospitals list so zero-record hospitals still appear (admin only)
  const hospitalMap = {};
  if (!scopeHospitalId) {
    for (const h of hospitals) {
      hospitalMap[h.id] = { hospitalId: h.id, hospitalName: h.name, patients: 0, videos: 0, reviewed: 0 };
    }
  }

  const stageCounts   = {};
  const diabeticCounts = {};
  const ageSeries     = {};
  let totalVideos   = 0;
  let totalReviewed = 0;

  for (const r of all) {
    const hid = r.hospitalId;
    if (!hospitalMap[hid]) {
      hospitalMap[hid] = { hospitalId: hid, hospitalName: r.hospitalName || hid, patients: 0, videos: 0, reviewed: 0 };
    }
    hospitalMap[hid].patients++;

    const hasVideo = (r.files || []).some((f) => f.fieldName === "ultrasoundVideo");
    if (hasVideo) { hospitalMap[hid].videos++; totalVideos++; }
    if (r.reviewedAt) { hospitalMap[hid].reviewed++; totalReviewed++; }

    // CKD stage distribution
    const stage = r.ckdStage || "Other";
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;

    // Diabetic split (exclude Normal kidney status)
    if (r.ckdStage !== "Normal") {
      const diab = r.diabetic === "Yes" ? "Yes" : "No";
      diabeticCounts[diab] = (diabeticCounts[diab] || 0) + 1;
    }

    // Age buckets
    const age = parseInt(r.age, 10);
    if (!isNaN(age) && age >= 18) {
      const low    = Math.floor(age / 10) * 10;
      const bucket = age >= 80 ? "80+" : `${low}-${low + 9}`;
      ageSeries[bucket] = (ageSeries[bucket] || 0) + 1;
    }
  }

  const hospitalBreakdown = Object.values(hospitalMap)
    .sort((a, b) => b.patients - a.patients);

  const recentRecords = all.slice(0, 10).map((r) => ({
    recordId:    r.recordId,
    participantId:r.participantId || null,
    batchId:     r.batchId,
    hospitalId:  r.hospitalId,
    hospitalName:r.hospitalName,
    uhid:        r.uhid,
    studyFlow:   r.studyFlow || "egfr",
    uploadMode:  r.uploadMode,
    receivedAt:  r.receivedAt,
    reviewedAt:  r.reviewedAt || null
  }));

  const stageOrder = ["Normal","1","2","3a","3b","4","5","Other"];
  const stages = Object.entries(stageCounts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => (stageOrder.indexOf(a.label) + 1 || 99) - (stageOrder.indexOf(b.label) + 1 || 99));

  const ageBucketOrder = ["18-29","30-39","40-49","50-59","60-69","70-79","80+"];
  const ageBuckets = Object.entries(ageSeries)
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => (ageBucketOrder.indexOf(a.bucket) + 1 || 99) - (ageBucketOrder.indexOf(b.bucket) + 1 || 99));

  return {
    summary: {
      hospitals: scopeHospitalId ? Object.keys(hospitalMap).length : hospitals.length,
      patients:  all.length,
      videos:    totalVideos,
      reviewed:  totalReviewed,
      pending:   all.length - totalReviewed
    },
    stages,
    diabetic:          Object.entries(diabeticCounts).map(([label, value]) => ({ label, value })),
    hospitalBreakdown,
    ageBuckets,
    recentRecords
  };
}

// GET /api/dashboard-summary
async function handleDashboardSummary(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const scopeHospitalId = session.role === "hospital" ? session.hospitalId : null;

  try {
    // Try PostgreSQL first; fall back to filesystem so metrics are always available
    let summary = await getDatabaseSummary(scopeHospitalId);
    if (!summary) summary = await getFilesystemSummary(scopeHospitalId);
    sendJson(res, 200, { ok: true, dbConfigured: Boolean(dbPool && dbReady), summary });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

// ─── HTTP router ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = requestUrl;

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service:        "tanuh-renal-data-server",
      gcsConfigured:  Boolean(GCS_BUCKET),
      dbConfigured:   Boolean(dbPool),
      dbReady,
      authConfigured
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/hospitals") {
    handleGetHospitals(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    handleLogin(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    handleLogout(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/auth/me") {
    handleMe(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/consent") {
    handleConsentRecord(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/dashboard-summary") {
    handleDashboardSummary(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/submissions") {
    handleSubmission(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/uploads/init") {
    handleUploadInit(req, res);
    return;
  }

  const uploadChunkMatch = pathname.match(/^\/api\/uploads\/([a-f0-9]{32})\/files\/(\d+)\/chunks\/(\d+)$/);
  if (uploadChunkMatch && req.method === "PUT") {
    handleUploadChunk(req, res, uploadChunkMatch[1], Number(uploadChunkMatch[2]), Number(uploadChunkMatch[3]));
    return;
  }

  const uploadActionMatch = pathname.match(/^\/api\/uploads\/([a-f0-9]{32})\/(status|complete)$/);
  if (uploadActionMatch) {
    if (uploadActionMatch[2] === "status" && req.method === "GET") {
      handleUploadStatus(req, res, uploadActionMatch[1]);
      return;
    }
    if (uploadActionMatch[2] === "complete" && req.method === "POST") {
      handleUploadComplete(req, res, uploadActionMatch[1]);
      return;
    }
  }

  if (req.method === "GET" && pathname === "/api/submissions") {
    handleGetSubmissions(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/submissions/export") {
    handleExportSubmissions(req, res);
    return;
  }

  const submissionDetailMatch = pathname.match(/^\/api\/submissions\/([^/]+)$/);
  if (submissionDetailMatch) {
    const recordId = decodeURIComponent(submissionDetailMatch[1]);
    if (req.method === "GET")   { handleGetSubmissionDetail(req, res, recordId); return; }
    if (req.method === "PATCH") { handleReviewSubmission(req, res, recordId);    return; }
  }

  serveStatic(req, res);
});

// ─── Startup ──────────────────────────────────────────────────────────────────

setupEnvCredentials();
authConfigured = envCredentials.size > 0 || Boolean(DATABASE_URL);

initializeDatabase()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`TANUH Renal Screening Portal running at http://${HOST}:${PORT}`);
      console.log(`PostgreSQL metadata storage: ${dbReady ? "enabled" : "disabled"}`);
      console.log(`Authentication: ${authConfigured ? "enabled" : "DISABLED (dev mode — set ADMIN_PASSWORD or DATABASE_URL)"}`);
      if (authConfigured && envCredentials.size > 0) {
        console.log(`Env-var credentials active for: ${[...envCredentials.keys()].join(", ")}`);
      }
    });
  })
  .catch((err) => {
    console.error("Failed to initialise PostgreSQL metadata storage:", err.message);
    process.exit(1);
  });
