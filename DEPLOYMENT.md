# VM and GCP Deployment Notes

These notes are based on `Renal team Project Setup.pdf`.

## GCP Project

- Project ID: `proj-renal-shared`
- Region: `asia-south1`
- VM: `vm-renal-dataserver`
- Zone: `asia-south1-c`
- SSH access: IAP tunnel only
- Public ingress: ports `80` and `443`
- GCS public access: blocked by organization policy
- Cloud SQL: must be provisioned by Platform Engineering with private connectivity

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

The server writes each batch locally under `data/submissions/` and copies it to:

```text
gs://renal-data-your-name/submissions/<batch-id>
```

The VM service account needs bucket-level write permission and OAuth scope `https://www.googleapis.com/auth/cloud-platform` for GCS sync.

## Production Checklist

- Put the Node server behind Nginx or Caddy on `443` with TLS.
- Add hospital user authentication before collecting real patient data.
- Keep GCS buckets private and use IAM only for approved users/service accounts.
- Store secrets in Secret Manager, not in source files.
- Ask Platform Engineering for Cloud SQL if searchable metadata or reporting queries are required.
- Take VM disk snapshots before major system updates or migrations.
- Monitor disk space with `df -h`.
