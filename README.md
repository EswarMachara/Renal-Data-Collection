# TANUH Renal Screening Portal

This is a VM-ready renal screening intake website inspired by the design and layout of:
https://bc-screener-research.tanuh.ai/

## Included Flows

- eGFR flow
  - Hospital dropdown with fixed hospital IDs
  - Diabetes classification dropdown shown when diabetic status is `Yes`
  - Separate-file upload mode for left kidney, right kidney, and clinical report
  - Single ZIP package mode for hospitals that export all patient files together
  - Ultrasound video upload field saved separately when provided

- VM/GCS submission path
  - Users review all entered details before a resumable VM/GCS upload starts
  - File uploads use chunked sessions via `/api/uploads/init`, `/api/uploads/:id/files/:fileIndex/chunks/:chunkIndex`, and `/api/uploads/:id/complete`
  - `POST /api/submissions` remains available for direct multipart submissions and small-file fallback
  - Dashboard shows upload progress for the reviewed record
  - Submissions are written under `data/submissions/`
  - If `GCS_BUCKET` is configured, each batch is synced to GCS with `gsutil rsync`
  - If `DATABASE_URL` is configured, normalized submission metadata is stored in PostgreSQL

## GCS Folder Layout

```text
gs://<bucket>/
  <hospitalID>/
    images/
      Left Kidney/
        <patientID>_left-kidney_<timestamp>_<suffix>_<original-name>
      Right Kidney/
        <patientID>_right-kidney_<timestamp>_<suffix>_<original-name>
    mixed/
      <patientID>_package_<timestamp>_<suffix>_<original-name>
    videos/
      <patientID>_ultrasound-video_<timestamp>_<suffix>_<original-name>
    documents/
      <patientID>_egfr-report_<timestamp>_<suffix>_<original-name>
      <patientID>_metadata_<timestamp>_<suffix>_metadata.json
```

## Files

- `index.html` - App structure and layout
- `styles.css` - Design system and responsive styles
- `script.js` - Tab logic, validations, review modal, and direct upload flow
- `server.js` - Static web server and submission API
- `DEPLOYMENT.md` - VM and GCP deployment notes

## Run Locally

```bash
npm start
```

Open:

```text
http://127.0.0.1:8000
```

For GCS sync, start the server with:

```bash
GCS_BUCKET=renal-data-your-name npm start
```

For PostgreSQL metadata storage, start the server with:

```bash
DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DATABASE' DB_SSL=disable npm start
```

Placeholder values such as `CHANGE_ME` are ignored by the server so the portal continues to run until real database credentials are configured.

The server creates these tables automatically when `DATABASE_URL` is set:

- `hospitals`
- `submissions`
- `submission_files`

The endpoint `GET /api/dashboard-summary` returns PostgreSQL-backed counts when the database is configured.

## Upload Limits

- `UPLOAD_CHUNK_BYTES` controls the browser chunk size; default is `5242880` bytes.
- `MAX_CHUNK_BYTES` is the largest chunk the server accepts; default is `8388608` bytes.
- `MAX_BODY_BYTES` still protects legacy direct multipart uploads; default is `314572800` bytes.

## Important Security Note

This code is now suitable for controlled VM testing with HTTPS, hospital authentication, audit logging, resumable uploads, private GCS sync, and optional PostgreSQL metadata storage. Before broad hospital rollout, finalize retention rules, database credentials, backup/restore, monitoring, and an approved secret-management path.
