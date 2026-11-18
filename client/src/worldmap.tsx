// World map (M16, key M): the six regions west to east, which are explored, where the player and
// their party are, and for an explored region its towns, waystones, dungeons, hunting grounds,
// elites, world bosses, exits and the player's own markers. Travel from the map at a waystone.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DUNGEONS } from '../../shared/src/dungeons';
import { DEPTH_BOSSES, MONSTERS, SPAWNS, WORLD_BOSSES } from '../../shared/src/monsters';
import { DEPTH_MONSTER, depthOf } from '../../shared/src/depths';
import { teleportCost, waypointId, zoneObjects } from '../../shared/src/places';
import { MAX_MARKERS, type GameSettings, type MapMarker } from '../../shared/src/settings';
import { EXIT, getZoneMap, REGIONS, tileCenter, ZONES } from '../../shared/src/world';
import { TILE } from '../../shared/src/protocol';
import { miniColors } from './game/art';
import { miniColors as hdMiniColors } from './game/hdart';
import type { Game, Hud } from './game/Game';
import { settings } from './settings';
import { t, useT, type Key } from './i18n';

type Kind = 'you' | 'party' | 'town' | 'waystone' | 'dungeon' | 'hunt' | 'elite' | 'boss' | 'exit' | 'marker' | 'pvp';
interface Pin { kind: Kind; x: number; y: number; label: string; id?: string; r?: number }
const LAYERS: Kind[] = ['you', 'party', 'town', 'waystone', 'dungeon', 'hunt', 'elite', 'boss', 'exit', 'marker', 'pvp'];
const GLYPH: Record<Kind, string> = { you: '◉', party: '●', town: '⌂', waystone: '◈', dungeon: '⛫', hunt: '✕', elite: '✦', boss: '☠', exit: '➜', marker: '⚑', pvp: '⚔' };

/** The region a zone belongs to: a dungeon belongs to the region whose gate leads into it; the arena to Eldoria. */
export function regionOf(zone: string): string {
  if (REGIONS.includes(zone) || ZONES[zone]?.depth) return zone;
  for (const r of REGIONS) if (ZONES[r].gates?.some((g) => DUNGEONS[g.dungeon]?.zone === zone)) return r;
  return 'eldoria';
}
/** A region is explored once its waystone is attuned, or while the player is in it. */
export const explored = (hud: Hud, r: string): boolean => {
  const host = ZONES[r]?.depth?.host; // the Depths are known once the region above them is
  return host ? hud.zoneId === r || explored(hud, host) : hud.disc.includes(waypointId(r)) || regionOf(hud.zoneId) === r;
};
/** Every map in the list: the regions in travel order, each followed by its Depths. */
const MAPS = REGIONS.flatMap((r) => (depthOf(r) ? [r, depthOf(r)!.id] : [r]));
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
/** A Depths boss: alive, or the time until it returns. */
const depthBossLabel = (hud: Hud, zone: string): string => {
  const b = DEPTH_BOSSES.find((x) => x.zone === zone);
  if (!b) return '';
  const at = hud.depthBosses.find((x) => x.zone === zone)?.at ?? 0, d = MONSTERS[b.type];
  return at ? t('map.depthBossBack', { name: d.name, n: d.level, t: clock(at - Date.now()) }) : t('map.depthBossPin', { name: d.name, n: d.level });
};

/** Everything shown on a region's map, in world units of that zone. */
export function regionPins(hud: Hud, r: string, me: { zone: string; x: number; y: number } | null, markers: MapMarker[]): Pin[] {
  const z = ZONES[r], pins: Pin[] = [];
  if (z.sanctuary) pins.push({ kind: 'town', x: z.sanctuary.tx * TILE, y: z.sanctuary.ty * TILE, label: t('map.sanctuaryPin') });
  if (z.town) pins.push({ kind: 'town', x: tileCenter(z.town.tx), y: tileCenter(z.town.ty), label: z.town.name });
  for (const o of zoneObjects(r)) if (o.kind === 'waykeeper') pins.push({ kind: 'waystone', x: o.x, y: o.y, label: t('map.waystoneOf', { name: z.town?.name ?? z.name }) });
  for (const g of z.gates ?? []) {
    const d = DUNGEONS[g.dungeon];
    if (d) pins.push({ kind: 'dungeon', x: tileCenter(g.tx), y: tileCenter(g.ty), label: t('map.dungeonPin', { name: d.name, n: d.level }) });
  }
  for (const s of SPAWNS[r] ?? []) {
    const m = MONSTERS[s.type];
    if (!m || m.boss) continue;
    pins.push({ kind: m.elite ? 'elite' : 'hunt', x: tileCenter(s.tx), y: tileCenter(s.ty), r: s.r * TILE, label: t(m.elite ? 'map.elitePin' : 'map.huntPin', { name: m.name, n: m.level, c: s.count }) });
  }
  for (const b of WORLD_BOSSES) if (b.zone === r) pins.push({ kind: 'boss', x: tileCenter(b.tx), y: tileCenter(b.ty), label: t('map.bossPin', { name: MONSTERS[b.type].name, n: MONSTERS[b.type].level }) });
  for (const b of DEPTH_BOSSES) if (b.zone === r) pins.push({ kind: 'boss', x: tileCenter(b.tx), y: tileCenter(b.ty), label: depthBossLabel(hud, r) });
  for (const p of z.portals) {
    const to = p.to !== EXIT ? ZONES[p.to] : undefined;
    if (to?.depth) pins.push({ kind: 'pvp', x: tileCenter(p.tx), y: tileCenter(p.ty), label: t('map.pvpPin', { name: to.name, n: z.level[0] }) });
    else if (to) pins.push({ kind: 'exit', x: tileCenter(p.tx), y: tileCenter(p.ty), label: t('map.exitTo', { name: to.name }) });
  }
  if (z.depth && hud.zoneId === r) for (const b of hud.bounty) pins.push({ kind: 'pvp', x: b.x, y: b.y, label: t('map.bountyPin', { name: b.name, n: b.n }) });
  for (const m of markers) if (m.zone === r) pins.push({ kind: 'marker', x: m.x, y: m.y, label: m.label || t('map.marker'), id: m.id });
  // party members: only those in a party with the player, and only where the server reported them
  for (const m of hud.party?.members ?? []) if (m.id !== hud.self?.id && m.zone === r) pins.push({ kind: 'party', x: m.x, y: m.y, label: t('map.partyPin', { name: m.name }) });
  if (me && me.zone === r) pins.push({ kind: 'you', x: me.x, y: me.y, label: t('map.you') });
  return pins;
}

/** The region's ground, drawn once per region from the same tiles the game is built from. */
const terrain = new Map<string, HTMLCanvasElement>();
function terrainOf(r: string): HTMLCanvasElement {
  let c = terrain.get(r);
  if (c) return c;
  const map = getZoneMap(r), col = (settings.get().graphics.art === 'hd' ? hdMiniColors : miniColors)(map.def.theme);
  c = document.createElement('canvas');
  c.width = map.w;
  c.height = map.h;
  const g = c.getContext('2d')!;
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      g.fillStyle = col[map.tiles[x + y * map.w]];
      g.fillRect(x, y, 1, 1);
    }
  terrain.set(r, c);
  return c;
}

export function WorldMap({ game, onClose }: { game: Game; onClose: () => void }) {
  useT();
  const hud: Hud = useSyncExternalStore(game.subscribe, game.getHud), s: GameSettings = useSyncExternalStore(settings.subscribe, settings.get);
  const here = regionOf(hud.zoneId);
  const [sel, setSel] = useState(here);
  const [hide, setHide] = useState(new Set<Kind>());
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(null as { x: number; y: number } | null);
  const [label, setLabel] = useState('');
  const [, tick] = useState(0);
  useEffect(() => { // the player and party markers move: redraw twice a second
    const id = setInterval(() => tick((n: number) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const me = game.pos(), z = ZONES[sel], open = explored(hud, sel);
  const atWaystone = hud.near?.kind === 'waykeeper' || (hud.talk ?? '').startsWith('waykeeper:');
  const pins = open ? regionPins(hud, sel, me, s.markers).filter((p) => !hide.has(p.kind)) : [];
  const toggle = (k: Kind) => {
    const n = new Set(hide);
    n.has(k) ? n.delete(k) : n.add(k);
    setHide(n);
  };
  const saveMarker = () => {
    if (!draft) return;
    const m: MapMarker = { id: Date.now().toString(36).slice(-8), zone: sel, x: Math.round(draft.x), y: Math.round(draft.y), label: label.trim().slice(0, 24) };
    settings.set({ markers: [...s.markers, m].slice(-MAX_MARKERS) });
    setDraft(null);
    setLabel('');
    setAdding(false);
  };
  return (
    <div className="hud worldmap panel" role="dialog" aria-label={t('map.title')}>
      <div className="sheethead">
        <h2>{t('map.title')}</h2>
        <button className="link" onClick={onClose} aria-label={t('map.close')}>{t('common.close')}</button>
      </div>
      <ol className="regions" aria-label={t('map.regions')}>
        {MAPS.map((r, i) => {
          const d = ZONES[r], ok = explored(hud, r), party = (hud.party?.members ?? []).filter((m) => m.id !== hud.self?.id && regionOf(m.zone) === r).length;
          return (
            <li key={r}>
              {i > 0 && <span className="road" aria-hidden="true" />}
              <button className={'region ' + (d.depth ? 'depth ' : '') + (ok ? 'open' : 'locked') + (sel === r ? ' on' : '') + (here === r ? ' here' : '')} onClick={() => { setSel(r); setDraft(null); }} aria-pressed={sel === r}
                aria-label={`${d.name}, ${t('common.lvRange', { a: d.level[0], b: d.level[1] })}, ${ok ? t('map.explored') : t('map.unexplored')}${here === r ? `, ${t('map.youAreHere')}` : ''}`}>
                <b>{d.name}</b>
                <small>{t('common.lvRange', { a: d.level[0], b: d.level[1] })}</small>
                <span className="badges">
                  {here === r && <i title={t('map.youAreHere')}>{GLYPH.you}</i>}
                  {party > 0 && <i title={t('map.partyHere', { n: party })}>{GLYPH.party}{party}</i>}
                  {(d.gates?.length ?? 0) > 0 && <i title={t('map.legend.dungeon')}>{GLYPH.dungeon}</i>}
                  {[...WORLD_BOSSES, ...DEPTH_BOSSES].some((b) => b.zone === r) && <i title={t('map.legend.boss')}>{GLYPH.boss}</i>}
                  {d.depth && <i title={t('pvp.zone.open')}>{GLYPH.pvp}</i>}
                  {hud.wevent?.zone === r && <i className="evpin" title={t(`ev.${hud.wevent.kind}` as any)}>✦</i>}
                  {hud.territory.held.filter((x) => x.zone === r).map((x) => <i key="g" className="guildpin" title={t('map.heldBy', { name: x.name })}>🏰{x.tag}</i>)}
                  {hud.territory.factions[r] && <i className="facpin" title={t('map.factionHolds', { name: hud.factions.find((f) => f.id === hud.territory.factions[r])?.name ?? hud.territory.factions[r] })}>⚑</i>}
                  {hud.siege?.zone === r && <i className="siegepin" title={t('siege.label')}>⚔</i>}
                  {!ok && <i title={t('map.unexplored')}>🔒</i>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mapbody">
        <div className="mapinfo">
          <h3>{z.name} <small className="sub">{t('map.recLevel', { a: z.level[0], b: z.level[1] })}</small></h3>
          <p className="sub">{z.blurb}</p>
          {z.depth && <p className="locknote">{t('map.depthNote', { n: Math.round((DEPTH_MONSTER.exp - 1) * 100), lv: ZONES[z.depth.host].level[0] })}<br />{depthBossLabel(hud, sel)}</p>}
          {!open ? <p className="locknote">{t('map.lockedHelp', { town: (z.depth ? ZONES[z.depth.host] : z).town?.name ?? z.name })}</p> : (
            <>
              {here !== hud.zoneId && sel === here && <p className="sub">{t('map.inside', { name: ZONES[hud.zoneId]?.name ?? hud.zoneId })}</p>}
              {sel !== hud.zoneId && atWaystone && hud.disc.includes(waypointId(sel)) && (
                <div className="actions"><button className="primary" disabled={hud.gold < teleportCost(sel)} onClick={() => game.objOp('tp', { to: sel })}>{t('map.travel', { town: z.town?.name ?? z.name, g: teleportCost(sel) })}</button></div>
              )}
              {sel !== hud.zoneId && !atWaystone && hud.disc.includes(waypointId(sel)) && <p className="sub">{t('map.travelHint')}</p>}
              <fieldset className="legend">
                <legend>{t('map.show')}</legend>
                {LAYERS.map((k) => <label key={k} className="switch"><input type="checkbox" checked={!hide.has(k)} onChange={() => toggle(k)} /><span className={'pin ' + k}>{GLYPH[k]}</span>{t(`map.legend.${k}` as Key)}</label>)}
              </fieldset>
              <div className="actions">
                <button className={adding ? 'primary' : ''} aria-pressed={adding} onClick={() => { setAdding(!adding); setDraft(null); }} disabled={!adding && s.markers.length >= MAX_MARKERS}>{adding ? t('map.addingMarker') : t('map.addMarker')}</button>
              </div>
              {draft && (
                <form className="actions" onSubmit={(e: any) => { e.preventDefault(); saveMarker(); }}>
                  <input value={label} onChange={(e: any) => setLabel(e.target.value)} maxLength={24} placeholder={t('map.markerName')} aria-label={t('map.markerName')} autoFocus />
                  <button className="primary small" type="submit">{t('common.save')}</button>
                  <button className="small" type="button" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
                </form>
              )}
              {s.markers.filter((m) => m.zone === sel).length > 0 && (
                <ul className="markerlist" aria-label={t('map.markers')}>
                  {s.markers.filter((m) => m.zone === sel).map((m) => (
                    <li key={m.id}>{GLYPH.marker} {m.label || t('map.marker')} <button className="link" onClick={() => settings.set({ markers: s.markers.filter((x) => x.id !== m.id) })} aria-label={t('map.removeMarker', { name: m.label || t('map.marker') })}>×</button></li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <RegionView region={sel} open={open} pins={pins} adding={adding} onPick={(x, y) => { setDraft({ x, y }); setAdding(false); }} draft={draft} />
      </div>
    </div>
  );
}

/** The region drawn from its tiles, with every pin as a focusable button over it. */
function RegionView({ region, open, pins, adding, onPick, draft }: { region: string; open: boolean; pins: Pin[]; adding: boolean; onPick: (x: number, y: number) => void; draft: { x: number; y: number } | null }) {
  const ref = useRef(null as HTMLCanvasElement | null);
  const z = ZONES[region], W = z.w * TILE, H = z.h * TILE;
  useEffect(() => {
    const c = ref.current, g = c?.getContext('2d');
    if (!c || !g) return;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(terrainOf(region), 0, 0, c.width, c.height);
    if (!open) {
      g.fillStyle = 'rgba(8,10,16,0.72)';
      g.fillRect(0, 0, c.width, c.height);
      return;
    }
    // the Depths: the whole map is open PvP (red), but for the sanctuary (green)
    if (z.depth) {
      const sx = c.width / z.w, sy = c.height / z.h, s = z.sanctuary;
      g.fillStyle = 'rgba(220,50,40,0.14)';
      g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = 'rgba(255,90,70,0.9)';
      g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, c.width - 3, c.height - 3);
      if (s) {
        g.fillStyle = 'rgba(90,220,140,0.3)';
        g.strokeStyle = 'rgba(120,235,160,0.95)';
        g.lineWidth = 2;
        g.beginPath(); g.ellipse(s.tx * sx, s.ty * sy, s.r * sx, s.r * sy, 0, 0, 7); g.fill(); g.stroke();
      }
    }
    // hunting grounds as soft circles under the pins
    for (const p of pins) if (p.r && (p.kind === 'hunt' || p.kind === 'elite')) {
      g.fillStyle = p.kind === 'elite' ? 'rgba(255,170,60,0.22)' : 'rgba(226,82,63,0.18)';
      g.beginPath();
      g.arc((p.x / W) * c.width, (p.y / H) * c.height, (p.r / W) * c.width, 0, 7);
      g.fill();
    }
  }, [region, open, pins.length]);
  const click = (e: React.MouseEvent) => {
    if (!adding) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onPick(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
  };
  return (
    <div className={'regionview' + (adding ? ' adding' : '')} onClick={click} style={{ aspectRatio: `${z.w} / ${z.h}` }} aria-label={t('map.regionMap', { name: z.name })} role="group">
      <canvas ref={ref} width={z.w * 4} height={z.h * 4} aria-hidden="true" />
      {pins.map((p, i) => (
        <span key={i} className={'pin ' + p.kind} style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }} title={p.label} role="img" aria-label={p.label}>{GLYPH[p.kind]}</span>
      ))}
      {draft && <span className="pin marker draft" style={{ left: `${(draft.x / W) * 100}%`, top: `${(draft.y / H) * 100}%` }} aria-hidden="true">{GLYPH.marker}</span>}
      {!open && <span className="lockover">🔒 {t('map.unexplored')}</span>}
    </div>
  );
}
