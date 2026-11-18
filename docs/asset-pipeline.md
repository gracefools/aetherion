# Pipeline aset: dari gambar sampai siap dipakai game

Semua seni bawaan dibuat dari kode. Pipeline ini adalah jalan resmi untuk menggantinya dengan karya seniman, satu sheet setiap kali, tanpa mengubah renderer.

```
assets/templates/   sheet bawaan diekspor sebagai PNG (titik awal untuk dilukis ulang)
assets/game/        PNG buatan seniman + manifest.json   <- yang Anda isi
        |
        |  scripts/validate-assets.ts   (cek saja)
        |  scripts/import-assets.ts     (cek, lalu salin yang lulus; dijalankan otomatis oleh build klien)
        v
client/dist/assets/ hanya sheet yang lulus + manifest berisi sheet yang lulus
        |
        v
klien memuat /assets/manifest.json saat start dan mengganti sprite bawaan
```

## Perintah

```bash
npx tsx scripts/export-assets.ts            # ekspor 89 sheet bawaan ke assets/templates
npx tsx scripts/validate-assets.ts          # validasi assets/game (exit code 1 jika ada error)
npx tsx scripts/validate-assets.ts <dir>    # validasi folder lain
node scripts/build-client.mjs               # build klien; menjalankan impor
```

## manifest.json

```json
{ "version": 1, "sheets": [
  { "type": "monster",   "id": "wolf",  "file": "monsters/wolf.png", "scale": 1 },
  { "type": "prop",      "id": "cache", "file": "props/cache.png" },
  { "type": "character", "layer": "hair", "item": "ponytail", "file": "hair/ponytail.png" }
] }
```

## Aturan validasi

| Aturan | Yang dicek | Contoh pesan |
|---|---|---|
| **Penamaan** | `lower_snake_case`; folder sesuai tipe (`monsters/`, `props/`, atau nama layer); nama file = id; id monster/prop harus ada di data game | `"Wolf" must be lower_snake_case` |
| **Dimensi** | Monster: 13 kolom × 2 baris, frame 48 px × `scale`. Karakter: 24 kolom × 4 baris, frame 48×48 (1152×192). Prop: 32×32 | `sheet is 100x100, expected 624x96` |
| **Transparansi** | Latar harus transparan (bukan warna rata); sudut sheet transparan; alpha hanya 0 atau 255 (tanpa anti-aliasing), kecuali frame death yang boleh memudar dan busur ayunan senjata | `no transparent pixels: the background must be transparent` |
| **Frame** | Tidak ada frame kosong; tiap animasi berbeda dari idle; frame dalam satu animasi tidak semuanya sama | `row 0: the attack animation is identical to the idle frame` |
| **Arah** | Monster: baris 0 hadap kanan, baris 1 hadap kiri, tidak boleh identik. Karakter: baris 0 bawah, 1 kiri, 2 kanan, 3 atas; kiri dan kanan tidak boleh identik | `row 1 (facing left) is identical to row 0` |
| **Keselarasan layer** | Layer `body`: kaki di baris 44 dan badan di tengah kolom 24, supaya semua layer menumpuk pas. Layer lain harus berada di grid yang sama. Monster: piksel terbawah frame idle di garis tanah (baris 42 × scale) | `feet are on row 39, they must be on row 44 so layers stack` |
| **Manifest** | JSON valid; tiap entri punya tipe dan file; file ada; tidak ganda; path tidak boleh keluar dari folder aset; PNG yang tidak terdaftar diberi peringatan | `file paths must stay inside the asset folder` |
| **Format** | PNG 8-bit, tidak interlaced (RGBA, RGB, grayscale, atau palet) | `not a PNG file` |

Error membuat sheet **ditolak** (tidak disalin ke build). Warning hanya ditampilkan.

## Layout sheet

**Monster** — 13 kolom: idle 2, move 4, attack 3, hit 1, death 3.

**Karakter** — 24 kolom, dari `ANIMS` di `shared/src/appearance.ts`:

| Animasi | Kolom | Frame | ms/frame | Loop |
|---|---|---|---|---|
| idle | 0–1 | 2 | 480 | ya |
| walk | 2–5 | 4 | 130 | ya |
| run | 6–9 | 4 | 95 | ya |
| attack | 10–13 | 4 | 85 | tidak |
| cast | 14–17 | 4 | 120 | tidak |
| hit | 18–19 | 2 | 110 | tidak |
| death | 20–23 | 4 | 160 | tidak |

Layer karakter: `body, clothing, armor, face, hair, helmet, accessory, cape, weapon`.

Gaya: outline gelap 1 px (#231A2B), ramp tiga nada dengan cahaya dari kiri-atas, tanpa anti-aliasing.

## Concept art vs siap-game

Concept art tidak pernah dimuat game. Hanya sheet yang lulus validasi yang "siap-game". Lukisan konsep perlu dikonversi dulu: potong ke grid, selaraskan kaki ke garis dasar, pisahkan layer.

## Status jujur

- **Bekerja penuh dan teruji:** ekspor template, validasi semua tipe, impor ke build, dan penggantian sprite **monster** dan **prop** saat runtime (uji browser memverifikasi piksel demi piksel).
- **Divalidasi tetapi belum dipakai klien:** sheet **layer karakter**. Klien masih menyusun karakter dari kode; impor layer karakter butuh perubahan compositor yang belum dikerjakan.
- **Belum ada:** impor tileset dunia (tanah, pohon, bangunan) dan ikon item.
- Validator diuji terhadap seni bawaan dan sheet rusak buatan tes, **belum** terhadap file dari seniman atau alat gambar sungguhan (Aseprite, Photoshop, dsb.).
- Tidak ada gambar yang dihasilkan AI atau diambil dari luar di repositori ini. Brief menyebut "Fable art pipeline": di sesi ini tidak ada alat pembuat gambar yang tersedia, jadi seni tetap prosedural dan pipeline impor ini disiapkan sebagai jalur masuknya.
