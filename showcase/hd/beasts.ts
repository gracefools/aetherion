// Contact sheet: HD monsters (idle, move, attack, death), mounts and pets.
import { getMonsterSheet, HD_M_FRAME, monsterScale, MONSTER_TYPES } from '../../client/src/game/monsters';
import { HD_MOUNT_H, HD_MOUNT_W, HD_PET, hdMountSprite, hdPetSprite } from '../../client/src/game/hdcomp';
import { MOUNTS, PETS } from '../../shared/src/companions';

export function render() {
  const c = document.getElementById('view') as HTMLCanvasElement, g = c.getContext('2d')!;
  c.width = 1150; c.height = 1280; c.style.width = '1150px'; c.style.height = '1280px';
  g.fillStyle = '#8fbf5a'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = false;
  let x = 4, y = 4, rowH = 0;
  const types = ['mossling', 'boar', 'wolf', 'spider', 'sporecap', 'duskwing', 'rootwarden', 'ember_hound', 'cinder_imp', 'snow_stalker', 'ice_wisp', 'rime_yeti', 'bog_lurker', 'mire_serpent', 'drowned_knight', 'gallows_tree', 'void_ray', 'rune_sentinel', 'dragon_whelp', 'frost_knight', 'abyssal_cultist', 'shadow_knight', 'ancient_dragon', 'demon_lord', 'frost_queen'];
  for (const t of types.filter((t) => MONSTER_TYPES.includes(t))) {
    const sh = getMonsterSheet(t, true), F = Math.round(HD_M_FRAME * monsterScale(t)), Z = F > 100 ? 1 : 2;
    if (x + F * Z > c.width) { x = 4; y += rowH + 4; rowH = 0; }
    g.drawImage(sh, 2 * F, 0, F, F, x, y, F * Z, F * Z);
    x += F * Z + 4; rowH = Math.max(rowH, F * Z);
  }
  x = 4; y += rowH + 8;
  for (const id of Object.keys(MOUNTS)) { const s = hdMountSprite(id)!; for (const f of [0, 1]) { g.drawImage(s, f * HD_MOUNT_W, 0, HD_MOUNT_W, HD_MOUNT_H, x, y, HD_MOUNT_W * 2, HD_MOUNT_H * 2); x += HD_MOUNT_W * 2 + 2; } x += 8; if (x > 900) { x = 4; y += HD_MOUNT_H * 2 + 6; } }
  x = 4; y += HD_MOUNT_H * 2 + 8;
  for (const k of Object.keys(PETS)) { const s = hdPetSprite(k)!; for (const f of [0, 1]) { g.drawImage(s, f * HD_PET, 0, HD_PET, HD_PET, x, y, HD_PET * 3, HD_PET * 3); x += HD_PET * 3 + 2; } x += 10; }
  (window as any).__ms = 0; (window as any).__done = true;
}
(window as any).__render = render;
