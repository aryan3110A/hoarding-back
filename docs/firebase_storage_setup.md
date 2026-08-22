# Firebase Storage Setup

This project keeps the frontend upload flow unchanged and lets the backend own image storage.

## Recommended Flow

1. Frontend uploads image files to the existing backend supervisor endpoints.
2. Backend validates files with `multer`.
3. Backend uploads each file to Firebase Storage when `MEDIA_STORAGE_PROVIDER=firebase`.
4. Backend stores the returned public media URL and storage metadata in the existing `siteImages` JSON payload.
5. Frontend renders `image_url` directly without needing Firebase client SDK code.

## Environment Variables

Set these in backend environment:

- `MEDIA_STORAGE_PROVIDER=firebase`
- `FIREBASE_PROJECT_ID=...`
- `FIREBASE_CLIENT_EMAIL=...`
- `FIREBASE_PRIVATE_KEY=...`
- `FIREBASE_STORAGE_BUCKET=...`

If newline handling for the private key is difficult in deployment, use `FIREBASE_PRIVATE_KEY_BASE64` instead of `FIREBASE_PRIVATE_KEY`.

## Storage Folder Structure

Firebase Storage does not use Firestore collections. Use bucket folder paths like this:

- `hoardings/{hoardingId}/supervisor/checklist/{YYYY}/{MM}/{filename}`
- `hoardings/{hoardingId}/supervisor/execution/mount/{YYYY}/{MM}/{filename}`
- `hoardings/{hoardingId}/supervisor/execution/remount/{YYYY}/{MM}/{filename}`
- `hoardings/{hoardingId}/supervisor/execution/unmount/{YYYY}/{MM}/{filename}`

Example:

- `hoardings/abc123/supervisor/execution/mount/2026/05/1716829000_mount-front-view.jpg`

## Stored Metadata in DB JSON

Each uploaded image entry keeps:

- `filename`
- `image_url`
- `url`
- `storage_provider`
- `storage_path`
- `original_name`
- `content_type`
- `size_bytes`
- `uploadedAt` or `timestamp`
- `uploaded_by`
- `type`

This makes Firebase replaceable later without losing the true object path.

## Current Backend Endpoints Using This

- `POST /api/supervisor/hoardings/:id/checklist-image`
- `POST /api/supervisor/hoardings/:id/execution-images`

## Notes

- Keep bucket access controlled through Firebase admin credentials on the backend.
- Do not upload directly from the frontend unless you also want to manage Firebase client auth and storage rules.
- If `MEDIA_STORAGE_PROVIDER` is not set to `firebase`, the app falls back to the current local `/uploads/...` flow.
