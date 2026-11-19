# Talenta (G2)

Enam tingkat talenta terbuka di level 30, 60, 90, 120, 160 dan 200 (`shared/src/talents.ts`). Di tiap tingkat pemain memilih tepat satu dari tiga. Talenta tidak memakai poin skill, bisa diganti di luar pertempuran, dan dihapus oleh respec.

| Tingkat | Pilihan |
|---|---|
| 30 Way of Striking | Momentum · Opportunist · Executioner's Eye |
| 60 Way of Enduring | Bloodthirst · Arcane Flow · Bulwark |
| 90 Way of Mastery | Echo · Overload · Cleaving Blows |
| 120 Way of the Hunt | Predator (+25% ke elite/boss) · Swiftness (kill: +30% kecepatan 4 detik) · Second Wind (pukulan mematikan menyisakan 1 HP, sekali tiap 90 detik) |
| 160 Way of Power | Glass Cannon (+20% damage, +15% diterima) · Iron Skin (−15% diterima, −10% damage) · Precision (+10% kritikal, kritikal +20%) |
| 200 Way of Legend | Avatar (tiap pukulan ke-15: gelombang kejut 150%) · Vampiric Mastery (5% damage menjadi HP) · Storm Caller (pukulan skill 15%: petir 100% ke musuh lain) |

Awakening sekarang memakai **10 poin skill** (disimpan di build sebagai `awake.<skill>`); respec mengembalikan poinnya dan menghapus awakening.

(Fitur G5 Battle Rhythm dan penalti EXP auto hunting sudah dihapus atas permintaan.)
