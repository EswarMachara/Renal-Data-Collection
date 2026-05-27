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
  - E-consent must be recorded before questionnaire/upload can proceed
  - Data-quality warnings flag values that should be reviewed without blocking submission

- VM/GCS submission path
  - Users review all entered details before a resumable VM/GCS upload starts
  - File uploads use chunked sessions via `/api/uploads/init`, `/api/uploads/:id/files/:fileIndex/chunks/:chunkIndex`, and `/api/uploads/:id/complete`
  - Interrupted uploads can resume from the last server-confirmed chunk while the review window remains open
  - `POST /api/submissions` remains available for direct multipart submissions and small-file fallback
  - Dashboard shows upload progress for the reviewed record
  - Admin submissions can be filtered by hospital, review status, search, and received-date range
  - Submissions and protected metadata are written under `data/submissions/`
  - If `GCS_BUCKET` is configured, each batch is synced to GCS with `gsutil rsync`
  - If `DATABASE_URL` is configured, normalized submission metadata and the UHID-to-participant mapping are stored in PostgreSQL
  - Cloud object paths use pseudonymous participant and record IDs rather than patient UHIDs

## GCS Folder Layout

```text
gs://<bucket>/
  raw/
    egfr/
      <hospital-code>/
        <participant-id>/
          <record-id>/
            images/
              left-kidney/
                <record-id>_left-kidney_<timestamp>_<suffix>.<ext>
              right-kidney/
                <record-id>_right-kidney_<timestamp>_<suffix>.<ext>
            documents/
              <record-id>_egfr-report_<timestamp>_<suffix>.<ext>
            videos/
              <record-id>_ultrasound-video_<timestamp>_<suffix>.<ext>
            packages/
              <record-id>_source-package_<timestamp>_<suffix>.zip
    kfre/
      <hospital-code>/
        <participant-id>/
          <record-id>/
            documents/
              <record-id>_kfre-clinical-document_<timestamp>_<suffix>.<ext>
```

Uploaded clinical files are synced to GCS. Questionnaire data and original patient-linked metadata remain in protected VM/PostgreSQL storage rather than being copied into the clinical-file bucket.

## Project Layout

```text
.
├── server.js                  # Node.js server, API, authentication, and persistence
├── public/                    # Browser-facing static application
│   ├── index.html
│   ├── script.js
│   ├── styles.css
│   └── assets/
├── docs/
│   ├── DEPLOYMENT.md          # VM and GCP deployment guidance
│   └── IMPLEMENTATION_LOG.md  # Sanitized implementation history
├── data/                      # Runtime submission storage; git-ignored
├── .env.example               # Environment variable template
└── package.json
```

The server serves only files under `public/`; runtime data and configuration remain outside the web root.

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
- `participants`
- `submissions`
- `submission_files`

The endpoint `GET /api/dashboard-summary` returns PostgreSQL-backed counts when the database is configured.

## Upload Limits

- `UPLOAD_CHUNK_BYTES` controls the browser chunk size; default is `5242880` bytes.
- `MAX_CHUNK_BYTES` is the largest chunk the server accepts; default is `8388608` bytes.
- `MAX_BODY_BYTES` still protects legacy direct multipart uploads; default is `314572800` bytes.

## Important Security Note

This code is now suitable for controlled VM testing with HTTPS, hospital authentication, audit logging, resumable uploads, private GCS sync, and optional PostgreSQL metadata storage. Before broad hospital rollout, finalize retention rules, database credentials, backup/restore, monitoring, and an approved secret-management path.
