# Deployment

Untuk Ubuntu, pasang Docker Engine dan plugin Compose, salin `.env.example`
menjadi `.env`, ubah kredensial database, origin CORS, dan URL publik, lalu
jalankan `docker compose up -d --build`.

Gunakan TLS di reverse proxy. Contoh dasar Nginx tersedia di `nginx/default.conf`.
Backup volume PostgreSQL dan media secara terpisah. Batasi akses volume storage,
atur retention, pantau disk, dan jangan menaruh secret di image atau repository.

