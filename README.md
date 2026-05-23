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
  - Form data and files are posted as `multipart/form-data` to `POST /api/submissions`
  - Users review all entered details before a direct VM/GCS upload starts
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

## Important Security Note

This code is now suitable for VM testing, not yet final hospital production. Before collecting real patient data, add HTTPS, hospital user authentication, audit logging, retention rules, and a platform-approved private database path if structured clinical data must be queried centrally.
