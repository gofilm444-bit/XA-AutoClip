# Arsitektur

React/Vite menyediakan alur pengguna dan polling progres. FastAPI menangani
validasi, CRUD, upload streaming, serta kontrak OpenAPI. PostgreSQL menyimpan
state dan artefak terstruktur. Celery/Redis menjalankan ffprobe, FFmpeg,
transkripsi, kandidat, dan render dengan concurrency satu. File media disimpan
melalui `LocalStorageProvider` dalam folder UUID proyek.

Provider AI, transkripsi, dan storage dipisahkan dari endpoint. Mode default
memakai provider mock deterministik. Semua proses FFmpeg memakai argument list,
timeout, path tervalidasi, dan tidak menggunakan `shell=True`.

