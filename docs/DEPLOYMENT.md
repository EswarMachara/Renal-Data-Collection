# VM and GCP Deployment Guide

These notes are based on `Renal team Project Setup.pdf`.

## GCP Project

- Project ID: `proj-renal-shared`
- Region: `asia-south1`
- VM: `vm-renal-dataserver`
- Zone: `asia-south1-c`
- SSH access: IAP tunnel only
- Public ingress: ports `80` and `443`
- GCS public access: blocked by organization policy
- Cloud SQL: `sql-renal-datacollection`
- Cloud SQL version: `POSTGRES_18`
- Cloud SQL connection name: `proj-renal-shared:asia-south1:sql-renal-datacollection`
- Cloud SQL networking: PSC enabled, public IPv4 disabled

## Local gcloud Setup

```bash
gcloud config configurations create renal-shared
gcloud config set project proj-renal-shared
gcloud config set compute/region asia-south1
```

## VM Login

```bash
gcloud compute ssh vm-renal-dataserver --tunnel-through-iap --project=proj-renal-shared --zone=asia-south1-c
```

## Create a Private GCS Bucket

Use a private bucket with Uniform Bucket-Level Access. Do not make the bucket public.

```bash
gcloud storage buckets create gs://renal-data-your-name --location=asia-south1 --uniform-bucket-level-access
```

## Run the App on the VM

Install Node.js 18 or newer on the VM, copy this project folder to the VM, then run:

```bash
npm start
```

For GCS sync:

```bash
GCS_BUCKET=renal-data-your-name npm start
```

For PostgreSQL metadata storage:

```bash
DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DATABASE' DB_SSL=disable npm start
```

Use Secret Manager or a systemd environment file with restricted permissions for database credentials. Do not commit credentials to Git.
Until real credentials are available, leave `DATABASE_URL` unset; placeholder values are ignored by the server.

The server writes each batch and its protected patient-linked metadata locally under `data/submissions/`. Uploaded clinical files are copied to GCS using pseudonymous participant and record identifiers:

```text
gs://renal-data-your-name/raw/
  egfr/<hospital-code>/<participant-id>/<record-id>/
    images/left-kidney/
    images/right-kidney/
    documents/
    videos/
    packages/
  kfre/<hospital-code>/<participant-id>/<record-id>/
    documents/
```

Patient UHIDs and questionnaire metadata are not written into GCS object paths or metadata files. Keep PostgreSQL active for the authoritative UHID-to-participant mapping; filesystem fallback data on the VM must be access restricted and backed up securely.

The VM service account needs bucket-level write permission and OAuth scope `https://www.googleapis.com/auth/cloud-platform` for GCS sync.

## Production Checklist

- Put the Node server behind Nginx or Caddy on `443` with TLS.
- Add hospital user authentication before collecting real patient data.
- Keep GCS buckets private and use IAM only for approved users/service accounts.
- Store secrets in Secret Manager, not in source files.
- Ask Platform Engineering for Cloud SQL if searchable metadata or reporting queries are required.
- Take VM disk snapshots before major system updates or migrations.
- Monitor disk space with `df -h`.
