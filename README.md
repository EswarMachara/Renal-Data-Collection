# TANUH Renal Screening Portal

This is a VM-ready renal screening intake website inspired by the design and layout of:
https://bc-screener-research.tanuh.ai/

## Included Flows

- eGFR flow
  - Left Kidney / Right Kidney selection
  - DICOM image upload (required)
  - Clinical document upload (required)
  - Ultrasound video upload (optional)
  - Strict validation that image and clinical document primary keys match

- KFRE flow
  - KFRE document upload only
  - Dedicated KFRE primary key

- VM/GCS submission path
  - Form data and files are posted to `POST /api/submissions`
  - Submissions are written under `data/submissions/`
  - If `GCS_BUCKET` is configured, each batch is synced to GCS with `gsutil rsync`

## Files

- `index.html` - App structure and layout
- `styles.css` - Design system and responsive styles
- `script.js` - Tab logic, validations, queue state
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

## Important Security Note

This code is now suitable for VM testing, not yet final hospital production. Before collecting real patient data, add HTTPS, hospital user authentication, audit logging, retention rules, and a platform-approved private database path if structured clinical data must be queried centrally.
