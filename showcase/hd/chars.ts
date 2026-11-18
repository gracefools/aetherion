// Contact sheet of HD characters: every job plus random looks, directions and a few animation frames.
import { defaultAppearance, randomAppearance } from '../../shared/src/appearance';
import type { Job } from '../../shared/src/protocol';
import { HD, HD_COL, getHDSheet } from '../../client/src/game/hdchars';

export function render() {
  const jobs: Job[] = ['knight', 'mage', 'ranger', 'assassin', 'cleric', 'berserker'];
  let s = 9; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const list = [...jobs.map((j) => [defaultAppearance(j), j] as const), ...jobs.slice(0, 4).map((j) => [randomAppearance(j, rnd), j] as const)];
  const cols: [number, number][] = [[HD_COL.idle, 0], [HD_COL.idle, 1], [HD_COL.idle, 2], [HD_COL.idle, 3], [HD_COL.walk + 1, 0], [HD_COL.walk + 2, 2], [HD_COL.attack + 2, 2], [HD_COL.cast + 2, 0], [HD_COL.death + 4, 2]];
  const Z = 2, c = document.getElementById('view') as HTMLCanvasElement;
  c.width = cols.length * HD * Z; c.height = list.length * HD * Z;
  c.style.width = c.width + 'px'; c.style.height = c.height + 'px';
  const g = c.getContext('2d')!;
  g.fillStyle = '#8fbf5a'; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = false;
  const t0 = performance.now();
  list.forEach(([ap, job], r) => {
    const sh = getHDSheet(ap, job);
    cols.forEach(([col, row], k) => g.drawImage(sh, col * HD, row * HD, HD, HD, k * HD * Z, r * HD * Z, HD * Z, HD * Z));
  });
  (window as any).__ms = performance.now() - t0;
  (window as any).__done = true;
}
(window as any).__render = render;
