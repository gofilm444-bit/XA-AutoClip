# API

Dokumentasi interaktif tersedia di `http://localhost:8000/docs`.

Alur utama:

1. `POST /api/projects`
2. `POST /api/projects/{id}/source`
3. `POST /api/projects/{id}/process`
4. Poll `GET /api/projects/{id}/status`
5. `GET /api/projects/{id}/candidates`
6. `POST /api/candidates/{id}/select`
7. `POST /api/candidates/{id}/transformation`
8. `POST /api/projects/{id}/voiceover`
9. `POST /api/transformations/{id}/assess`
10. `POST /api/transformations/{id}/preview` atau `/render`
11. `GET /api/renders/{id}/download`

