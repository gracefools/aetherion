# Talenta (G2) dan irama bermain (G5)

## Talenta

Tiga tingkat talenta terbuka di level 20, 40 dan 60 (`shared/src/talents.ts`). Di tiap tingkat pemain memilih tepat satu dari tiga. Talenta tidak memakai poin skill, bisa diganti di luar pertempuran, dan dihapus oleh respec. Disimpan di peta skill build sebagai `talent.<tingkat>` = pilihan (1–3).

| Tingkat | Talenta | Efek |
|---|---|---|
| Way of Striking (20) | Momentum | Tiap pukulan ke target yang sama +4% damage, maks 5 tumpuk; ganti target = mulai lagi. |
| | Opportunist | +40% damage ke target di atas 90% HP. |
| | Executioner's Eye | +30% damage ke target di bawah 35% HP. |
| Way of Enduring (40) | Bloodthirst | Tiap kill memulihkan 6% HP maksimum. |
| | Arcane Flow | Tiap kill memulihkan 8% mana/rage dan memotong 1 detik semua cooldown skill. |
| | Bulwark | Saat HP turun melewati 50%, barrier 15% HP maksimum (sekali tiap 20 detik). |
| Way of Mastery (60) | Echo | Pukulan skill 20% menyerang lagi dengan 50% damage. |
| | Overload | Kritikal skill memotong 0,5 detik semua cooldown. |
| | Cleaving Blows | Serangan dasar juga mengenai sampai 2 musuh di samping target (40%). |

Gema dan tebasan tambahan tidak memicu talenta lagi. Server mengirim `cdcut` agar pengatur waktu cooldown di klien ikut berkurang.

## Bermain aktif mengalahkan idle

- **Battle Rhythm**: kill buatan tangan dalam 12 detik dari kill sebelumnya menambah tumpukan (maks 10), +3% EXP per tumpukan (maks +30%). Ditampilkan di atas hotbar.
- **Auto hunting**: 80% EXP. Setelah satu jam berburu otomatis tanpa jeda, 50% ("Weary") sampai berhenti 10 menit. Kill auto hunting tidak menambah Battle Rhythm. Panel auto hunting menampilkan persentasenya.
