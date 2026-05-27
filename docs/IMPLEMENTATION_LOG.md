# TANUH Renal Screening Portal — Implementation Log

**Domain:** tanuh.ai  
**Project:** AI-Based eGFR Research Registry  
**Stack:** Vanilla HTML/CSS/JS · Node.js (raw `http.createServer`) · PostgreSQL (`pg`, optional) · Google Cloud Storage (`gsutil`)  
**Last updated:** 2026-05-23

---

## Partner Hospitals

| Hospital ID | Name | Location |
|---|---|---|
| SCMC-RMN-KA | Sri Chamundeshwari Medical College | Ramanagara Dist, Karnataka |
| SH-SLM-TN | Shanmuga Hospital | Salem, Tamil Nadu |
| JSS-MYS-KA | JSS Medical College | Mysore, Karnataka |
| NH-BLR-KA | Nira Health Care Private Limited | Bangalore, Karnataka |
| MIL-NDL-DL | Mahajan Imaging & Labs | New Delhi |

---

## Completed Implementations

---

### Phase A — Authentication, Consent & Audit Trail

**Goal:** Secure the portal before real hospital data is collected. Zero auth existed prior to this phase.

#### Backend — `server.js`

- **Inline `.env` loader** — IIFE at startup reads `.env` without requiring `dotenv` npm package. Real environment variables always take precedence.
- **Dual-mode authentication:**
  - *DB mode* — `crypto.scrypt` password hashing, sessions stored in `sessions` table (PostgreSQL). Active when `DATABASE_URL` is set.
  - *Env-var bridge mode* — `ADMIN_PASSWORD` and `HOSPITAL_CREDENTIALS_JSON` env vars allow the portal to be secured before DB credentials are available. Uses `crypto.timingSafeEqual` for constant-time comparison. Switches off automatically when DB becomes active.
- **Session tokens** — `crypto.randomBytes(32)` hex tokens, 8-hour TTL, looked up via `Authorization: Bearer <token>` header.
- **Rate limiting** — In-memory Map, max 5 failed login attempts per IP per 15 minutes. No npm package required.
- **Role-based access** — Two roles: `hospital` (scoped to own hospital ID) and `admin` (sees all hospitals).
- **Security headers** on all responses: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`.

**New API endpoints:**

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/api/auth/login` | Public | Username + password → session token |
| POST | `/api/auth/logout` | Authenticated | Invalidate session |
| GET | `/api/auth/me` | Authenticated | Returns `{ userId, username, hospitalId, role }` |
| GET | `/api/hospitals` | Authenticated | Returns hospital list (eliminates hardcoded duplication) |
| POST | `/api/consent` | Hospital / Admin | Records server-side consent before questionnaire |

**Protected existing endpoints:**

- `POST /api/submissions` — Hospital users can only submit for their own `hospitalId`
- `GET /api/dashboard-summary` — Admin sees all; hospital user sees own hospital only

**Database tables added** (created in `initializeDatabase`):

```sql
users        -- hospital_id = null for admin role; scrypt password hash + salt
consents     -- linked to uhid, hospital, user; stores ip + user-agent
sessions     -- active tokens with expires_at; indexed on expires_at
audit_logs   -- events: login, logout, login_failed, submission_created, consent_recorded
```

#### Frontend — `public/index.html`, `public/script.js`, `public/styles.css`

- **Login screen redesign** — Split-panel layout with TANUH branding, 8 keyframe animations (fade-in, slide-up, pulse glow on logo), responsive.
- **Password visibility toggle** — Eye icon switches between `type="password"` and `type="text"`.
- **Loading state** — Submit button shows spinner + "Signing in…" during request.
- **Shake animation** on failed login (`ls-shake` keyframe, 500ms).
- **Auth state** — `state.authSession` stored in `sessionStorage`. All `fetch` calls include `Authorization: Bearer` header via `authedFetch()`. Any `401` response clears session and redirects to login.
- **Hospital dropdown** — Read-only for hospital users (pre-filled from auth context). Admin keeps editable dropdown.
- **Logout button** in navbar — POSTs `/api/auth/logout`, clears session, returns to login screen.

#### Credentials (`.env`, git-ignored)

```
ADMIN_PASSWORD=<configured-outside-source-control>
HOSPITAL_CREDENTIALS_JSON={
  "SCMC-RMN-KA": "<configured-outside-source-control>",
  "SH-SLM-TN":   "<configured-outside-source-control>",
  "JSS-MYS-KA":  "<configured-outside-source-control>",
  "NH-BLR-KA":   "<configured-outside-source-control>",
  "MIL-NDL-DL":  "<configured-outside-source-control>"
}
```

> Username for each hospital = the Hospital ID (e.g., `SH-SLM-TN`).  
> Admin username = `admin`.

---

### Phase C — Admin Submissions Panel

**Goal:** Give admin (and hospital users) a structured view of all submitted records, with filtering, detail drill-down, and review tracking.

#### Backend — `server.js`

- **`readAllSubmissions(scopeHospitalId)`** — Scans `data/submissions/<batchId>/<recordId>/metadata.json` on disk. Sorts by `receivedAt` DESC. Accepts optional hospital scope.
- **`findSubmissionById(recordId)`** — Scans batch directories to locate a specific record.

**New API endpoints:**

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/submissions` | Authenticated | Paginated list; filters: `hospitalId`, `reviewed`, `search`, `page`, `limit` |
| GET | `/api/submissions/:recordId` | Authenticated | Full record detail |
| PATCH | `/api/submissions/:recordId` | Admin only | Mark or unmark as reviewed; writes `reviewedAt` + `reviewedBy` back to `metadata.json` |

#### Frontend — `public/index.html`, `public/script.js`, `public/styles.css`

- **Submissions tab** in navbar (visible after login).
- **Filter bar** — Hospital dropdown (admin only), Reviewed/Pending/All select, free-text search (Patient ID or Record ID), Apply + Reset buttons.
- **Submissions table** — Columns: #, Patient ID, Hospital, Age/Sex, CKD Stage, Upload Mode, Files, Received At, Status. Rows are clickable.
- **Pagination** — Prev/Next buttons with "Page X of Y (N records)" info.
- **Slide-in detail panel** — Animated right-side overlay showing full patient data, clinical data, submission metadata, file list, and review status.
- **Mark as Reviewed / Clear Review** button in detail panel footer (admin only). Updates table row badge in place without full reload.
- **CKD stage badges** — Color-coded: Stage 1 (green), Stage 2 (blue), Stage 3 (amber), Stage 4 (red).

---

### Phase D — UX Wizard / Stepper + Autosave

**Goal:** Guide hospital staff through the 4-step patient intake flow with clear visual progress and protect against data loss.

#### Stepper — `public/index.html`, `public/script.js`, `public/styles.css`

- **Sticky `#intake-stepper`** — Appears between navbar and main content during the intake flow (Landing → Consent → Questionnaire → eGFR Upload). Hidden on Dashboard and Submissions tabs.
- **TANUH teal gradient** background: `#041e22 → #073438 → #0a4a4e → #0d5f65`.
- **Step states:**
  - *Pending* — Ghost circle, muted label.
  - *Active* — White glowing circle with `stpPulse` animation (2.5s infinite ring expand).
  - *Done* — Filled `#14868c` circle with white checkmark SVG.
- **Connector lines** — Fill left-to-right (`scaleX(0 → 1)`) as steps are completed.
- **Patient chip** — Shows `hospitalId · uhid` in the stepper meta area once the patient is identified.
- **`maxStepReached`** — Steps only advance forward; can't undo done steps by navigating back.

#### Autosave — `public/script.js`

- **Draft key:** `tanuh_qdraft_${hospitalId}_${uhid}` — per-patient, not shared across sessions.
- **Scope:** All questionnaire form fields (inputs, selects) and radio groups.
- **Debounce:** 700ms after last keystroke before writing to `localStorage`.
- **Autosave indicator** in stepper meta area — shows "Saved HH:MM:SS" with a teal flash animation.
- **Draft restore toast** — Bottom-center fixed toast with "Restore draft?" prompt when returning to questionnaire with a saved draft. Buttons: Restore / Dismiss / Clear draft.
- **`clearDraft()`** called on: successful submission, starting a new patient record.

---

### Admin CSV Export

**Goal:** Allow the research team to pull all submission data into Excel/SPSS/Python without SSH access.

#### Backend — `server.js`

- **`GET /api/submissions/export`** — Respects same filters as the submissions table (`hospitalId`, `reviewed`, `search`). Returns all matching records (no pagination cap). Hospital users are automatically scoped to their own hospital.
- Routed **before** the `submissionDetailMatch` regex to prevent `export` being parsed as a record ID.
- Output: RFC 4180 compliant CSV with proper quoting (`csvCell()` helper).
- Response headers: `Content-Type: text/csv`, `Content-Disposition: attachment; filename="tanuh-submissions-YYYY-MM-DD.csv"`.

**31 CSV columns:**

| Group | Columns |
|---|---|
| Identifiers | Record ID, Batch ID, Hospital ID, Hospital Name, Patient ID (UHID) |
| Demographics | Age, Sex, Height (cm), Weight (kg), BMI, Ethnicity, Occupation |
| CKD | CKD Stage, Known CKD, CKD Duration, Dialysis, Dialysis Frequency |
| Comorbidities | Diabetic, Diabetic Stage, Diabetes Duration, Hypertension, Hypertension Duration, Cardiovascular Disease, Family Kidney History |
| Submission | Upload Mode, File Count, Consent ID, Enrollment Date, Received At |
| Review | Reviewed At, Reviewed By |

#### Frontend — `public/index.html`, `public/script.js`, `public/styles.css`

- **"Export CSV" button** in the submissions filter bar, right of Reset.
- Carries current filter state into the export request — what you see in the table is what you get in the CSV.
- Browser-native file download via `URL.createObjectURL()` + hidden `<a>` click.
- Button shows "Exporting…" (disabled) during request; restores icon + label on completion.
- Success/failure communicated via `showToast()`.
- **`.btn-export`** CSS — teal-outlined, fills teal on hover, disabled state respected.

---

### Phase E — Resumable Upload Pipeline

**Goal:** Make hospital uploads reliable for large ZIP/video files and weak network connections.

#### Backend — `server.js`

- **Upload sessions** are stored under `data/upload-sessions/<uploadId>/manifest.json` while an upload is in progress.
- **Chunked upload APIs**:

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/api/uploads/init` | Hospital / Admin | Validates submission metadata and creates an upload session |
| PUT | `/api/uploads/:uploadId/files/:fileIndex/chunks/:chunkIndex` | Owner / Admin | Stores one file chunk idempotently |
| GET | `/api/uploads/:uploadId/status` | Owner / Admin | Returns received chunks and byte progress |
| POST | `/api/uploads/:uploadId/complete` | Owner / Admin | Verifies all chunks, assembles files, finalizes normal submission storage |

- **Memory-safe large files** — chunks are written to disk first; final storage copies assembled files without loading the full video/ZIP into Node memory.
- **Integrity checks** — each chunk must match the expected size; assembled files must match the original file size before finalization.
- **Existing storage schema preserved** — final files still land under hospital-scoped `images/`, `mixed/`, `videos/`, and `documents/` folders.
- **Legacy fallback retained** — `POST /api/submissions` still supports direct multipart submission for small-file/testing workflows.

#### Frontend — `public/script.js`

- **Review modal now starts a resumable upload** instead of one large multipart request.
- **5 MB default chunks** via `UPLOAD_CHUNK_BYTES`, with retry logic per chunk.
- **Progress labels** show the active file and chunk count, then switch to finalizing/GCS sync.

---

## Pending / Planned Implementations

---

### Password Change Flow *(recommended next)*

**Why:** Hospitals are using auto-generated passwords from `.env` that they cannot change themselves. This is a security gap before real patient data collection begins.

**Scope:**
- `POST /api/auth/change-password` endpoint — requires current password + new password, enforces minimum strength, re-hashes with new salt, invalidates all other active sessions for that user.
- Settings modal accessible from the navbar (after login).
- Works in both DB mode and env-var bridge mode (env-var mode: updates the in-memory credential map; note: does not persist across server restarts until DB is live).

---

### Email Notifications

**Why:** Admin needs to know when a new submission arrives without manually checking the portal.

**Scope:**
- Alert email to admin when `POST /api/submissions` succeeds.
- Summary email (daily/weekly) of submission counts per hospital.
- Requires SMTP configuration (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFY_EMAIL` env vars).
- Uses Node.js built-in `net`/`tls` or a minimal SMTP library.

---

### Date Range Filter on Submissions Panel

**Why:** Once hundreds of records exist, filtering by "last 7 days" or a specific date range is essential for review workflows.

**Scope:**
- Add "From" and "To" date inputs to the submissions filter bar.
- Pass `dateFrom` / `dateTo` query params to `GET /api/submissions` and `GET /api/submissions/export`.
- Server filters by `receivedAt` timestamp.

---

### PostgreSQL Full Integration

**Why:** Currently the portal runs on filesystem-based submission storage. Once DB credentials are configured, all submissions, sessions, consents, and audit logs will persist in PostgreSQL for richer querying and data integrity.

**Current state:** `DATABASE_URL` in `.env` contains a placeholder (`CHANGE_ME`) which the server detects and disables DB mode automatically. The schema is fully defined in `initializeDatabase()` — it just needs live credentials.

**Steps when credentials are ready:**
1. Update `DATABASE_URL` in `.env` with the real connection string.
2. Confirm `DB_SSL` setting (`disable` for local, `require` for cloud).
3. Restart server — `initializeDatabase()` will run `CREATE TABLE IF NOT EXISTS` for all tables.
4. Create at least one DB user via `INSERT INTO users` with a scrypt-hashed password.
5. Env-var bridge mode will be ignored automatically once DB is active.

---

## Architecture Reference

```
Data Pipeline/
├── server.js          # Node.js HTTP server — all API endpoints, auth, file I/O
├── public/            # Static browser application served by server.js
│   ├── index.html     # Single-page app shell
│   ├── script.js      # Frontend logic (auth, tabs, stepper, autosave, submissions)
│   ├── styles.css     # Responsive TANUH design system
│   └── assets/        # TANUH, partner, and kidney-model assets
├── docs/              # Deployment guidance and implementation history
├── .env               # Secrets — git-ignored
├── .env.example       # Template for new deployments
├── data/
│   ├── submissions/   # <batchId>/<recordId>/metadata.json + uploaded files
│   └── gcs-sync/      # Mirror of submissions/, synced to GCS via gsutil
```

**Key design decisions:**
- No Express, no React, no Webpack — pure Node.js `http.createServer` + vanilla JS. Zero build step.
- No `dotenv` npm package — inline IIFE loader at server startup.
- Filesystem-first storage — submissions written to disk immediately; GCS sync is best-effort (failure doesn't block the response).
- DB is optional — portal works fully without PostgreSQL using env-var auth bridge and filesystem metadata.
- `LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu` prefix required for Node.js on this machine due to miniconda `libstdc++` conflict.

---

## Running the Server

```bash
# Start (development)
LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu PORT=8090 node server.js

# Access
http://127.0.0.1:8090

# Login
Admin:       username=admin,       password=<ADMIN_PASSWORD from .env>
Hospital:    username=<hospitalId>, password=<value from HOSPITAL_CREDENTIALS_JSON>
```
