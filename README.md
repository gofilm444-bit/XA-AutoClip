# XA AutoClip

XA AutoClip (AutoClip Transform) adalah MVP full-stack untuk mengubah video
panjang menjadi konsep Facebook Reels yang menambahkan sudut baru, komentar
kreator, caption sosial media, subtitle, dan penilaian risiko.

Saat membuat proyek, pilih jenis video:

- **Podcast / Wawancara** untuk pencarian klip berbasis ucapan dan gagasan.
- **Bola / Olahraga** untuk pencarian momen berdasarkan lonjakan sorakan atau
  komentator dan perubahan adegan. Mode ini tetap dapat bekerja tanpa dialog.

## Batasan Penting

Aplikasi memberikan **transformative-use assessment**, **originality
assessment**, **copyright-risk indicator**, dan **repetition-risk indicator**.
Hasil bukan keputusan hukum, bukan jaminan monetisasi, dan selalu memerlukan
**manual review required**. Aplikasi tidak menyediakan downloader eksternal,
penghapus watermark, auto-posting, atau cara menghindari deteksi hak cipta.

## Paste Link Sumber

Pada form proyek baru, pengguna dapat memilih salah satu sumber: upload file
video, atau URL yang mengarah langsung ke file MP4, MOV, atau WebM. URL
lokal/private diblokir dan ukuran unduhan mengikuti batas upload aplikasi.
Jika file dan link sama-sama tersedia, file menjadi media yang diproses dan link
tetap disimpan sebagai atribusi sumber.

Link halaman platform digunakan untuk membaca metadata, tetapi bukan sebagai
file video. Untuk link seperti halaman YouTube, unggah file videonya atau gunakan
URL media langsung yang memang dapat diakses dan diproses.

Untuk YouTube, `YOUTUBE_API_KEY` dapat diisi agar judul dan deskripsi diambil
melalui YouTube Data API. Tanpa key, aplikasi tetap mencoba membaca deskripsi
dari halaman publik dan memakai oEmbed sebagai fallback metadata dasar.

## Caption Sosial Media

Transformation Editor membuat deskripsi siap tempel untuk unggahan sosial media.
Caption mengolah judul sumber menjadi kalimat, menambahkan hook dan kesimpulan
transformasi, pertanyaan interaksi, atribusi nama/link sumber, serta dua sampai
lima hashtag yang relevan. Caption dapat diedit, dibuat ulang, disimpan, dan
disalin ke clipboard.

## Subtitle Speech-to-Text

Subtitle di dalam video berasal dari audio asli pada timestamp klip terpilih,
bukan dari naskah komentar buatan engine. Untuk pertandingan, teks mengikuti
suara reporter; untuk podcast, teks mengikuti orang yang berbicara. Pada tahap
render, pengguna dapat memilih output `Bahasa Indonesia` atau `English`.

Mode `mock` hanya untuk demonstrasi alur dan tidak membaca ucapan asli. Render
baru sengaja dinonaktifkan pada mode ini agar teks simulasi tidak disalahartikan
sebagai transkrip. Aktifkan speech-to-text asli dengan:

```env
TRANSCRIPTION_PROVIDER=openai
TRANSCRIPTION_MODEL=whisper-1
TRANSLATION_MODEL=gpt-5.5
OPENAI_API_KEY=isi_api_key
```

Setelah mengganti provider, proses ulang video agar transcript segment dan
timestamp dibuat dari audio sebenarnya.

## Stack

- React 19, Vite, TypeScript, TanStack Query, React Hook Form, Zod, Tailwind.
- FastAPI, SQLAlchemy 2, Alembic, PostgreSQL, Pydantic v2.
- Celery, Redis, FFmpeg/ffprobe, ASS subtitle.
- Local UUID storage dengan provider abstraction.
- Mock AI dan mock transcription sebagai default.

## Menjalankan Dengan Docker

Prasyarat: Docker Desktop/Engine dengan Compose.

```bash
cp .env.example .env
docker compose up --build
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Frontend: `http://localhost:3000`  
API: `http://localhost:8000`  
OpenAPI: `http://localhost:8000/docs`

Migration dijalankan otomatis saat container API dimulai.

## Mode Development

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Atau jalankan `scripts/dev.ps1` pada Windows dan `scripts/dev.sh` pada Linux.

## Video Uji

FFmpeg harus tersedia bila script dijalankan di host:

```powershell
.\scripts\generate_test_video.ps1
```

```bash
./scripts/generate_test_video.sh
```

Video sintetis 45 detik dibuat di `storage/uploads/demo.mp4`.

## Menjalankan Test

```bash
docker compose run --rm api pytest
docker compose run --rm frontend npm test
docker compose run --rm frontend npm run build
docker compose run --rm api ruff check .
```

## Development Lokal

Python 3.12 dan FFmpeg diperlukan:

```bash
cd backend
python -m venv .venv
python -m pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload
```

Frontend memerlukan Node.js 22:

```bash
cd frontend
npm install
npm run dev
```

Worker:

```bash
cd backend
celery -A app.celery_app:celery_app worker --loglevel=INFO --concurrency=1
```

## Provider

Mode demo tidak memerlukan API key:

```env
AI_PROVIDER=mock
TRANSCRIPTION_PROVIDER=mock
YOUTUBE_API_KEY=
```

Provider `openai` mengirim audio hasil ekstraksi ke Speech-to-Text API untuk
mendapatkan segmen bertimestamp. File hanya dikirim ke provider eksternal bila
provider tersebut dipilih.

## Storage dan Privasi

Media disimpan di `STORAGE_ROOT/{project_uuid}` dan tidak disimpan dalam
database. Video pengguna tidak digunakan untuk training. Tombol hapus proyek
melakukan soft-delete record proyek dan menghapus media terkait. Retention
default 30 hari tersedia sebagai konfigurasi untuk cleanup terjadwal.

## Environment

Seluruh variable tersedia di `.env.example`, termasuk batas upload 2 GB,
durasi 7.200 detik, timeout job, provider, CORS, retention, dan threshold
originality/repetition.

## Troubleshooting

- `MEDIA_PROBE_FAILED`: pastikan file valid dan ffprobe tersedia.
- `AUDIO_EXTRACTION_FAILED`: periksa codec input dan log worker.
- Job tetap queued: pastikan Redis dan worker sehat.
- Frontend tidak terhubung: periksa `VITE_API_BASE_URL` dan `CORS_ORIGINS`.
- Render final nonaktif: perbaiki rekomendasi originality, simpan editor, lalu
  jalankan penilaian ulang.

Detail lanjutan tersedia di folder `docs/`.
