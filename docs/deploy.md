# Deployment

## Yang sudah diverifikasi

`./scripts/verify-deploy.sh` menjalankan jalur produksi dari awal sampai akhir dan sudah dijalankan di lingkungan ini:

1. Membuat database PostgreSQL kosong.
2. Build klien (`client/dist`) dan **bundle server menjadi satu file** `dist/server.mjs`.
3. Menjalankan `node dist/server.mjs` dengan `NODE_ENV=production` — Node biasa, tanpa `tsx`, tanpa TypeScript saat runtime.
4. Migrasi diterapkan otomatis; `/api/health` menjawab; halaman dan bundle klien tersaji.
5. `/api/metrics` menolak tanpa token (403) dan menjawab dengan token (200).
6. 20 klien sungguhan (WebSocket) mendaftar, membuat karakter, membentuk party, bertarung, dan mendapat loot selama 15 detik.
7. `SIGTERM` → server menyimpan semua pemain dan keluar dengan kode 0.
8. Database diperiksa: akun, karakter, progres, dan equipment tersimpan.

Hasil terakhir: `DEPLOY CHECK PASSED` — 5 migrasi, 20 akun, 20 karakter, 19 dengan progres tersimpan, 20 dengan equipment tersimpan, 0 koneksi putus.

## Yang BELUM diverifikasi

Tidak ada Docker daemon, systemd, atau nginx di lingkungan pembuatan. File berikut ditulis dengan hati-hati tetapi **belum pernah dijalankan**:

| File | Isi |
|---|---|
| `deploy/Dockerfile` | Build dua tahap; image akhir hanya berisi bundle, klien, dan migrasi; berjalan sebagai user `node`; punya healthcheck |
| `deploy/docker-compose.yml` | PostgreSQL 16 + Redis 7 + game |
| `deploy/aetherion.service` | Unit systemd dengan hardening dasar |
| `deploy/nginx.conf` | TLS, upgrade WebSocket, `X-Forwarded-For` |

Perintah yang dijalankan file-file itu sama dengan yang diverifikasi di atas (`node dist/server.mjs`), tetapi pembungkusnya sendiri belum diuji. Juga belum diuji: TLS, domain publik, dan jaringan internet sungguhan (semua pengujian memakai localhost).

## Langkah deploy tanpa Docker

```bash
# di server (Node 22+, PostgreSQL 16, Redis 7)
git clone <repo> /opt/aetherion && cd /opt/aetherion
npm install
npm run build:all
cp deploy/.env.example /etc/aetherion.env   # lalu isi DATABASE_URL, METRICS_TOKEN, dll.
set -a; . /etc/aetherion.env; set +a
npm run start:prod
```

## Konfigurasi (environment)

| Variabel | Default | Arti |
|---|---|---|
| `PORT`, `HOST` | 8080, 0.0.0.0 | Alamat dengar |
| `DATABASE_URL` | localhost dev | PostgreSQL |
| `REDIS_URL` | localhost | Redis (cache sesi, rate limit). Jika mati, server tetap jalan dengan fallback di memori |
| `METRICS_TOKEN` | kosong | Token Bearer untuk `/api/metrics`. Jika kosong, metrics hanya untuk loopback |
| `TRUST_PROXY` | 0 | Jumlah reverse proxy tepercaya. 0 = `X-Forwarded-For` diabaikan |
| `ALLOWED_ORIGINS` | kosong | Origin tambahan yang boleh membuka WebSocket |
| `MAX_CONNECTIONS`, `MAX_CONNECTIONS_PER_IP` | 2000, 20 | Batas koneksi |
| `AUTH_RATE_LIMIT` | 20 | Percobaan login/daftar per alamat per menit |
| `ROOM_CAPACITY` | 150 | Pemain per channel |
| `DROP_RATE`, `GOLD_RATE`, `WORLD_BOSS_RESPAWN_SCALE` | 1 | Penyetelan game tanpa ubah kode |
| `RECONNECT_GRACE_MS`, `AUTOSAVE_MS` | 10000, 30000 | Masa tunggu reconnect, interval autosave |
| `APP_ROOT`, `CLIENT_DIR`, `MIGRATIONS_DIR` | otomatis | Lokasi file jika tata letak berbeda |

## Operasional

- **Health:** `GET /api/health` → `{ok, redis}`.
- **Metrics:** `GET /api/metrics` → tick (avg/p95/p99/max), pemain, room, monster, party, pesan dan byte keluar/masuk, jumlah socket.
- **Shutdown:** `SIGTERM`/`SIGINT` menyimpan semua pemain lalu keluar. Beri waktu 30 detik.
- **Backup:** semua state permanen ada di PostgreSQL. Redis boleh hilang.
- **Skala:** satu proses. Kapasitas terukur ada di `docs/M9.md`. Tidak ada sharding antar proses.

## Backup database

Layanan `backup` di `deploy/docker-compose.yml` menjalankan `pg_dump` terkompresi setiap 6 jam
(`BACKUP_EVERY_HOURS`) dan menyimpan 28 file terbaru (`BACKUP_KEEP`, satu minggu) di
`deploy/backups/` pada host. Folder itu tidak masuk git.

Memulihkan satu backup (hentikan dulu layanan `game` agar tidak ada yang menulis):

```
docker compose -f deploy/docker-compose.yml stop game
gunzip -c deploy/backups/aetherion-YYYYmmdd-HHMM.sql.gz | docker compose -f deploy/docker-compose.yml exec -T postgres psql -U aetherion -d aetherion
docker compose -f deploy/docker-compose.yml start game
```

## Pemeriksaan otomatis (CI)

`.github/workflows/ci.yml` berjalan di GitHub Actions pada setiap push dan pull request: typecheck,
tes unit dan integrasi, build klien, dan tes browser, semuanya di dalam image dev yang sama
(`deploy/Dockerfile.dev`). Screenshot tes browser disimpan sebagai artifact.
