# Rencana Implementasi

## Status

- [x] Audit workspace dan toolchain.
- [x] Tetapkan arsitektur monorepo dan mode demo.
- [x] Fondasi Docker, FastAPI, Celery, React, PostgreSQL, Redis.
- [x] Project CRUD, deklarasi sumber, upload streaming, metadata.
- [x] Pipeline audio, transkripsi mock, segmentasi, kandidat.
- [x] Transformation editor, caption, subtitle, dan export.
- [x] Originality gate dan repetition assessment.
- [x] Preview/final rendering dan unduhan.
- [x] Dokumentasi penggunaan, arsitektur, API, pipeline, gate, dan deployment.
- [x] Test utama ditulis untuk state, kandidat, originality, repetition, storage, subtitle, dan UI.
- [x] Migration PostgreSQL dijalankan hingga revision `0003 (head)`.
- [x] Backend pytest: 24 test lulus.
- [x] Backend Ruff: seluruh pemeriksaan lulus.
- [x] Frontend Vitest: 1 test lulus.
- [x] Frontend production build berhasil.
- [x] E2E smoke test upload sampai preview dan final MP4 berhasil.
- [x] Paste-link metadata sumber dengan autofill dan perlindungan SSRF.
- [x] Caption sosial media editable dengan atribusi sumber dan hashtag relevan.
- [x] Deskripsi video sumber tersimpan dan dipakai sebagai konteks engine/caption.
- [x] Subtitle render memakai speech-to-text audio bertimestamp.
- [x] Pilihan bahasa subtitle Bahasa Indonesia atau English tersedia per render.
- [x] Provider OpenAI transcription tersedia dan mode mock ditandai sebagai demo.
- [x] Workspace sidebar dan dashboard AI clipping diterapkan.
- [x] Pemilihan kandidat memakai daftar klip dan satu preview aktif.
- [x] Editor memiliki navigasi tahap sticky dari analisis hingga export.
- [x] Storyboard dan voice-over dihapus dari workflow aktif.
- [x] Originality gate tidak lagi mensyaratkan voice-over.
- [x] Render selalu mempertahankan audio asli video.

## Verifikasi Terakhir

Audit statis 12 Juni 2026:

- 80+ file proyek tersedia dan seluruh Dockerfile yang direferensikan ada.
- Konfigurasi JSON frontend valid.
- 29 route API terdaftar secara statis.
- Tidak ada pemanggilan subprocess dengan `shell=True`.
- Default provider mock dan threshold utama tersedia di `.env.example`.
- Docker Desktop 4.77.0 dan WSL 2.7.8 terpasang pada 12 Juni 2026.
- Lima service Compose berjalan: frontend, api, worker, PostgreSQL, dan Redis.
- `/health` dan `/ready` berhasil; frontend merespons HTTP 200.
- Preview terverifikasi H.264 540x960, 30 fps.
- Final terverifikasi H.264 1080x1920, 30 fps.
- Metadata link YouTube terverifikasi membaca judul, kreator, dan deskripsi asli.

Verifikasi 13 Juni 2026:

- Migration PostgreSQL berjalan hingga revision `0004 (head)`.
- Backend pytest: 35 test lulus.
- Backend Ruff: seluruh pemeriksaan lulus.
- Frontend Vitest: 1 test lulus.
- Frontend production build berhasil dan asset baru dilayani di port 3000.
- API context mengidentifikasi provider `mock` sebagai mode demo.
- API menolak render baru dengan HTTP 409 saat speech-to-text asli belum aktif.
- Frontend studio Vizard-like lulus Vitest dan production build.
- Asset workspace baru terverifikasi aktif pada `http://localhost:3000`.

## Catatan Lingkungan

Workspace awal kosong. Pada audit 12 Juni 2026, Git, Node.js, npm, Docker,
FFmpeg, dan ffprobe tidak tersedia di PATH. Python terdeteksi tetapi tidak
dapat dieksekusi karena masalah sesi logon Windows. Docker Compose menjadi
jalur eksekusi utama yang didokumentasikan.
