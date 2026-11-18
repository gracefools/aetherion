// Skill effects in 2.5D over HD terrain, frozen mid-animation.
import { buildChunk, CHUNK, CHUNK_PX } from '../../client/src/game/hdart';
import { getHDSheet, HD, HD_COL } from '../../client/src/game/hdchars';
import { getMonsterSheet, HD_M_FRAME, monsterScale } from '../../client/src/game/monsters';
import { drawFx, fxDuration, type Fx } from '../../client/src/game/fx';
import { drawCastCircle, drawFxAir, drawFxGround } from '../../client/src/game/fx25d';
import { ABILITIES } from '../../shared/src/abilities';
import { defaultAppearance } from '../../shared/src/appearance';
import { getZoneMap } from '../../shared/src/world';
import { TILE } from '../../shared/src/protocol';

type Ent = { id: number; x: number; y: number; kind: 'char' | 'mon'; job?: any; mt?: string; col?: number; dir?: number };
export function render(scene = 'a') {
  const map = getZoneMap('verdant'), W = 640, H = 360, cx = map.def.spawn.tx * TILE + 120 - W / 2, cy = map.def.spawn.ty * TILE + 40 - H / 2;
  const view = document.getElementById('view') as HTMLCanvasElement, g = view.getContext('2d')!;
  view.width = W; view.height = H;
  g.imageSmoothingEnabled = false;
  for (let y = Math.floor(cy / CHUNK_PX); y <= Math.floor((cy + H) / CHUNK_PX); y++)
    for (let x = Math.floor(cx / CHUNK_PX); x <= Math.floor((cx + W) / CHUNK_PX); x++)
      if (x >= 0 && y >= 0 && x * CHUNK < map.w && y * CHUNK < map.h) g.drawImage(buildChunk(map, x, y).ground, x * CHUNK_PX - cx, y * CHUNK_PX - cy);
  g.translate(-cx, -cy);
  const X = (dx: number) => cx + W / 2 + dx, Y = (dy: number) => cy + H / 2 + dy;
  const ents: Ent[] = scene === 'a'
    ? [{ id: 1, x: X(-170), y: Y(40), kind: 'char', job: 'mage', col: HD_COL.cast + 2, dir: 2 }, { id: 2, x: X(-60), y: Y(90), kind: 'char', job: 'knight', col: HD_COL.attack + 2, dir: 2 },
       { id: 10, x: X(120), y: Y(-20), kind: 'mon', mt: 'rime_yeti' }, { id: 11, x: X(30), y: Y(100), kind: 'mon', mt: 'wolf' }, { id: 12, x: X(170), y: Y(70), kind: 'mon', mt: 'boar' }, { id: 13, x: X(200), y: Y(-60), kind: 'mon', mt: 'wolf' }]
    : [{ id: 1, x: X(-120), y: Y(30), kind: 'char', job: 'cleric', col: HD_COL.cast + 2, dir: 0 }, { id: 2, x: X(-40), y: Y(-10), kind: 'char', job: 'knight', col: HD_COL.idle, dir: 2 }, { id: 3, x: X(-200), y: Y(-40), kind: 'char', job: 'mage', col: HD_COL.cast + 3, dir: 2 },
       { id: 10, x: X(130), y: Y(20), kind: 'mon', mt: 'ember_hound' }, { id: 11, x: X(60), y: Y(-60), kind: 'mon', mt: 'drowned_knight' }, { id: 12, x: X(170), y: Y(100), kind: 'mon', mt: 'wolf' }];
  const pos = new Map(ents.map((e) => [e.id, e]));
  const posOf = (id: number) => pos.get(id) ?? null, now = 100000;
  const mk = (id: string, src: number, tid: number, t: number, tx?: number, ty?: number): Fx => {
    const def = ABILITIES[id], s = pos.get(src)!, tg = tid ? pos.get(tid)! : { x: tx!, y: ty! };
    return { def, t0: now - t, ms: fxDuration(def), sx: s.x, sy: s.y, tx: tg.x, ty: tg.y, src, tid, key: 0, chain: [] };
  };
  const fxs: Fx[] = scene === 'a'
    ? [mk('meteor_strike', 1, 0, 520, X(150), Y(10)), mk('fireball', 1, 11, 110), mk('cleave', 2, 11, 110)]
    : [mk('sanctuary', 1, 0, 2000, X(-120), Y(30)), mk('smite', 1, 10, 140), mk('guard_stance', 2, 2, 260), mk('arcane_bolt', 3, 11, 90), mk('mana_shield', 3, 3, 300)];
  for (const f of fxs) drawFxGround(g, f, now, posOf);
  for (const f of fxs) if (f.def.fx.t === 'zone' || f.def.fx.t === 'trap') drawFx(g, f, now, posOf);
  for (const e of ents) if (e.kind === 'char' && e.col! >= HD_COL.cast && e.col! < HD_COL.cast + 5) drawCastCircle(g, e.x, e.y, e.job === 'cleric' ? '#fff0a8' : '#7fc8ff', now, e.id);
  for (const e of [...ents].sort((a, b) => a.y - b.y)) {
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(e.x, e.y + 9, 13, 5, 0, 0, 7); g.fill();
    if (e.kind === 'char') g.drawImage(getHDSheet(defaultAppearance(e.job), e.job), e.col! * HD, e.dir! * HD, HD, HD, e.x - 32, e.y - 51, HD, HD);
    else { const sc = monsterScale(e.mt!), F = Math.round(HD_M_FRAME * sc); g.drawImage(getMonsterSheet(e.mt!, true), 0, F, F, F, e.x - F / 2, e.y - Math.round(56 * sc) + 9, F, F); }
  }
  for (const f of fxs) drawFxAir(g, f, now, posOf);
  for (const f of fxs) if (f.def.fx.t !== 'zone' && f.def.fx.t !== 'trap') drawFx(g, f, now, posOf);
  (window as any).__ms = 0; (window as any).__done = true;
}
(window as any).__render = render;
