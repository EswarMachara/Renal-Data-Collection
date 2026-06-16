# TANUH Renal Portal Data Schema

## Cloud Storage

New submissions are stored with storage schema version `2`.

```text
<bucket-root>/
  eGFR/
    <hospital-id>/
      patients/
        <patient-key>/
          records/
            <record-id>/
              packages/
                patient/
                  <patient-key>_patient-package_<timestamp>_<suffix>.zip
              videos/
                ultrasound/
                  <patient-key>_ultrasound-video_<timestamp>_<suffix>.<ext>
              metadata/
                record-metadata.json

  KFRE/
    <hospital-id>/
      patients/
        <patient-key>/
          records/
            <record-id>/
              documents/
                clinical/
                  <patient-key>_kfre-clinical-document_<timestamp>_<suffix>.<ext>
              metadata/
                record-metadata.json
```

`patient-key` is derived from the hospital-side patient unique ID and is scoped by hospital in the path.
`record-id` is the TANUH research record ID for one submission event.

Legacy paths remain readable through stored metadata, but new records use the structure above.

## SQL Tables

### hospitals

Stores partner hospital accounts and display names.

Important columns:

- `hospital_id`
- `hospital_name`
- `active`
- `last_login_at`
- `created_at`

### users

Stores login users with scrypt password hashes.

Important columns:

- `user_id`
- `username`
- `password_hash`
- `password_salt`
- `hospital_id`
- `role`
- `active`

### participants

Maps a hospital-scoped UHID into a pseudonymous TANUH participant ID.

Important columns:

- `participant_id`
- `hospital_id`
- `study_flow`
- `uhid`

Unique key:

- `(hospital_id, study_flow, uhid)`

### submissions

Stores one patient submission record.

Important columns:

- `record_id`
- `participant_id`
- `hospital_id`
- `study_flow`
- `uhid`
- `age`
- `sex`
- `known_ckd`
- `ckd_stage`
- `diabetic`
- `hypertension`
- `upload_mode`
- `kfre_data`
- `metadata`
- `schema_version`
- `patient_key`
- `storage_prefix`
- `bmi`
- `bmi_is_derived`
- `file_count`
- `total_file_size_bytes`
- `reviewed_at`
- `reviewed_by`
- `gcs_synced`
- `gcs_path`

Legacy-compatible nullable columns such as `study_id`, `enrollment_date`, `site_center`, `ethnicity`, and `occupation` are retained for old data and export compatibility, but new flows do not depend on them.

### submission_files

Stores one row per uploaded file/object.

Important columns:

- `record_id`
- `field_name`
- `original_name`
- `stored_name`
- `bucket_path`
- `storage_category`
- `storage_subfolder`
- `mime_type`
- `size_bytes`

### audit_logs

Stores operational events such as login, submission creation, review updates, and exports.

Important columns:

- `event_type`
- `user_id`
- `hospital_id`
- `record_id`
- `details`
- `created_at`
