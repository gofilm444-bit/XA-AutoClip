# Keputusan Teknis

## ADR-001: Shared Python application package

API dan Celery worker memakai paket `backend/app` yang sama. Ini menjaga model,
provider, transaksi database, state machine, dan aturan keamanan tetap konsisten.
Folder `worker/` berisi image entrypoint dan test khusus media.

## ADR-002: Mock-first vertical slice

Provider AI dan transkripsi default bersifat deterministik dan tidak memerlukan
API key. Provider nyata dipilih melalui environment variable dan gagal dengan
pesan eksplisit bila dependensi atau kredensial belum tersedia.

## ADR-003: PostgreSQL production, SQLite-compatible tests

Runtime Compose memakai PostgreSQL. Model dan repository tetap kompatibel
dengan SQLite untuk unit test cepat.

## ADR-004: Celery with eager development escape hatch

Proses media dikirim ke Celery/Redis. `CELERY_TASK_ALWAYS_EAGER=true` tersedia
untuk demo atau test tanpa worker terpisah, tetapi default Compose tetap memakai
worker concurrency satu.

## ADR-005: Heuristic assessment is not legal advice

Originality dan copyright risk adalah indikator produk berbasis heuristik,
bukan keputusan hukum, jaminan monetisasi, atau persetujuan fair use.

## ADR-006: Rendering remains deterministic

Semua command FFmpeg dibangun sebagai argument list, tidak memakai `shell=True`,
memiliki timeout, dan hanya menerima path yang telah divalidasi di storage root.

## ADR-007: Paste-link reads source metadata safely

Paste-link mengambil metadata publik seperti Open Graph, judul HTML, kreator,
deskripsi, dan thumbnail untuk mengisi deklarasi sumber. Inspector hanya menerima
HTTP/HTTPS, memblokir IP lokal/private/internal, membatasi redirect, timeout, dan
ukuran respons. Fitur ini tidak mengekstrak video dari halaman platform.

## ADR-008: Source declaration uses a simplified form

Pengguna hanya melihat link sumber, nama sumber, dan file video. Field deklarasi
lain memakai default internal untuk analisis/komentar substantif agar alur tetap
ringkas tanpa menghilangkan data yang dibutuhkan originality assessment.

## ADR-009: Social caption belongs to the transformation plan

Caption siap unggah disimpan bersama transformation plan agar dapat memakai
hook, sudut baru, kesimpulan, pertanyaan interaksi, nama sumber, dan link sumber.
Hashtag dibuat deterministik dari frasa penting judul sumber, dibatasi maksimal
lima, dan caption tetap dapat diedit atau dibuat ulang sebelum disalin.

## ADR-010: Source description enriches transformation context

Deskripsi video sumber disimpan terpisah dari deskripsi proyek, dibatasi 10.000
karakter, dan dapat dikoreksi setelah terbaca otomatis. Metadata YouTube
mengutamakan Data API bila `YOUTUBE_API_KEY` tersedia, lalu memakai halaman
publik dan oEmbed sebagai fallback. Engine dan caption hanya memakai ringkasan
bersih agar URL promosi dan deskripsi panjang tidak mendominasi hasil.

## ADR-011: Video subtitle follows source-audio timestamps

Subtitle render memakai `TranscriptSegment` yang bertumpang tindih dengan klip
terpilih. Naskah hook, komentar kreator, dan kesimpulan tidak lagi dipakai
sebagai pengganti speech-to-text. Bahasa output dipilih per render (`id` atau
`en`) dan diterjemahkan tanpa mengubah timestamp ucapan. Mode transkripsi
`mock` ditandai sebagai demo dan tidak diizinkan membuat render baru.

## ADR-012: Studio workflow uses a master-detail interface

UX mengikuti pola umum aplikasi AI clipping tanpa menyalin merek atau aset
produk lain. Navigasi memakai sidebar workspace, dashboard menonjolkan alur
upload hingga export, dan halaman kandidat memakai daftar klip di kiri dengan
satu preview aktif di kanan. Editor menyediakan navigasi tahap yang tetap
terlihat agar pengguna dapat berpindah antara analisis, caption, penilaian,
dan export tanpa kehilangan konteks.

## ADR-013: Storyboard and voice-over are removed from the active workflow

Workflow editor disederhanakan menjadi empat tahap: analisis, caption,
penilaian, dan export. Storyboard tidak lagi dihasilkan atau dinilai.
Voice-over tidak lagi menjadi syarat originality dan tidak dicampurkan ke
render; audio asli klip tetap dipakai. Kolom serta endpoint lama dipertahankan
sementara untuk kompatibilitas data proyek terdahulu.
