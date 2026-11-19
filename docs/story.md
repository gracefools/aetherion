# Cerita utama: "The First Sentence" (G3)

Data cerita ada di `shared/src/story.ts`; quest-nya dibangun di `shared/src/quests.ts` (`storyQuests`).

## Garis besar

Para Runewright pernah meminta segalanya sekaligus kepada bintang Aetherion, dan bintang itu jatuh. Kata-kata permintaan itu (**First Sentence**) tercerai-berai di tiap region. Sebuah kultus, **the Askers**, mengumpulkannya untuk meminta sekali lagi. **Sera Vale**, kartografer Starfall Crown, mengikuti jejak mereka di sepanjang **Starpath**, dan pemain berjalan bersamanya.

| Region | Bab | Inti |
|---|---|---|
| Eldoria | The Crater Rim | Peta Sera dirampas; tanda tangan tangan terbuka di bawah bintang. |
| Verdant Reach | What the Forest Counts | Seed-letter Runewright: potongan pertama kalimat. Vault dibersihkan. |
| Ashen Highlands | The Borrowed Fire | Askers meminta kata *Fire* dari mimpi Vharzul. |
| Frostveil | The Winter That Stayed | Ratu Ysolde menolak meminjamkan kata *Frost*. |
| Dreadmoor | Names in the Mud | Sumpah Maldrec; daftar kata Askers ditemukan. |
| Astral Ruins | The Falling City | Segel tidak dihancurkan, tapi *disunting*. |
| Emberwaste … Stormspire | delapan bab | Kunci bertuliskan nama bintang, kalender di kulit pohon, saksi, takhta, hitungan tahun, jawaban "ya". |
| Voidreach | The First Sentence | Di Heart of Aetherion kalimat itu diselesaikan dengan cara lain: "Remember yourself." |

## Struktur tiap bab

1. **Langkah 1** (lorekeeper): bicara dengan seorang warga kota (merchant, waykeeper, banker, atau runesmith) dan pergi ke sebuah tempat (gerbang dungeon, atau jalan ke timur).
2. **Langkah 2** (warga kota tadi): merebut barang cerita dari monster region (peluang 45% per kill).
3. **Langkah 3** (lorekeeper): mengalahkan elite region, atau membersihkan dungeon-nya (Verdant, Riftlands, Voidreach).

Langkah 1 butuh quest `main_<region>`; setiap langkah butuh langkah sebelumnya. Rantai `main_*` lama tidak berubah, jadi karakter lama tidak terhalang.

## Jenis sasaran baru

| Jenis | Dihitung oleh |
|---|---|
| `talk` | Klien mengirim `quest talk` saat percakapan dibuka; server memeriksa jarak ke warga itu. |
| `visit` | Server memeriksa posisi pemain sekitar sekali per detik (hanya pemain dengan quest cerita aktif). |
| `loot` | Server, saat monster bernama itu mati dan pemain mendapat kreditnya. |

## Antarmuka

- Tombol **Listen** pada quest cerita memutar dialog: potret pembicara (sprite warga, atau Sera), teks yang diketik, lalu **Accept**.
- Saat langkah cerita diserahkan, dialog penutupnya diputar otomatis.
- Penanda: `!` di atas siapa pun yang menawarkan quest, `?` untuk penyerahan, `…` untuk orang yang harus diajak bicara, cincin emas di minimap untuk tempat tujuan.

# Sifat region (G4)

Mulai level 45, tiap region punya satu mekanik khas yang dipakai semua monsternya (`shared/src/traits.ts`, server di `server/src/game/Traits.ts`). Bahaya yang tertunda (tanah terbakar, ledakan, petir) selalu diawali lingkaran peringatan.

| Region | Sifat | Efek |
|---|---|---|
| Emberwaste | Ember Trail | Monster yang mati meninggalkan tanah terbakar (3 denyut, status Burning). |
| Thornwild | Thornbound | Pukulan monster 20% mengakar (root) pemain. |
| Glacierdeep | Deep Chill | Pukulan monster 35% memperlambat pemain. |
| Hollowfen | Restless Dead | 35% monster bangkit sekali lagi dengan 33% HP. |
| Riftlands | Phase Step | Monster berteleportasi ke samping target yang menjaga jarak. |
| Crownfall | Banner Line | Monster dengan dua kawan di dekatnya mendapat Rallying Cry (pertahanan +30%). |
| Cinderdeep | Volatile | Monster meledak saat mati (setelah peringatan 0,9 detik). |
| Elderwood | Regrowth | Monster yang bertarung menyembuhkan kawan di dekatnya 5% tiap 3 detik. |
| Stormspire | Static | Petir menandai tanah di bawah target lalu menyambar; pukulan bisa menyambar ke pemain lain di dekatnya. |
| Voidreach | Null Field | Monster sesekali "Phased Out" selama 1,8 detik dan kebal. |

Klien menampilkan lencana sifat di kolom kanan HUD, baris obrolan saat masuk region, dan penanda di peta dunia.
