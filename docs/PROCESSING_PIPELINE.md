# Processing Pipeline

Upload ditulis per 1 MiB sambil menghitung SHA-256. Worker memvalidasi stream
melalui ffprobe, mengekstrak WAV mono 16 kHz, melakukan transkripsi, membentuk
window 20-60 detik, memberi skor, menekan overlap, dan menyimpan lima kandidat.

Project memiliki dua jalur analisis:

- `podcast`: kandidat dibentuk dari window transkrip dan dinilai berdasarkan
  hook, konteks, informasi, emosi, kelancaran, durasi, dan potensi diskusi.
- `sports`: FFmpeg mengukur loudness audio serta perubahan scene. Kandidat
  dibentuk di sekitar puncak gabungan dengan 12 detik build-up dan 18 detik
  aftermath. Transkrip komentator bersifat tambahan, bukan syarat pemrosesan.

Render menghasilkan preview 540x960 atau final 1080x1920 H.264/AAC 30 fps.
Preset MVP meliputi blurred background, center crop, fit background, dan
picture-in-picture. Subtitle ASS dibakar ke video. Voice-over dinormalisasi
dan menjadi audio utama bila tersedia.
