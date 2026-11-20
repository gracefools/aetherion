// Two things for a player finding their way:
//  - the opening story: shown once to a brand-new character, before they step into Eldoria;
//  - feature guides: each time a level opens something new (auto hunting, the journal, companions,
//    guilds, dungeons, ascension...), a card says what it is and how to use it, with a button
//    that opens it. A character who is already past a level is not shown that card.
import React, { useEffect, useState } from 'react';
import { ASCENSION_LEVEL } from '../../shared/src/ascension';
import { AWAKEN_LEVEL, FUSION_LEVEL } from '../../shared/src/awakening';
import { GUILD_CREATE_LEVEL } from '../../shared/src/economy';
import type { Action } from '../../shared/src/settings';
import type { Game, Hud } from './game/Game';
import { send } from './gamepad';
import { t, useT, type Key } from './i18n';
import { settings, touchActive } from './settings';
import { TitleBackdrop } from './titleArt';
import { Icon, type IconName } from './ui/icons';

const store = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* a convenience only */ } },
};

/** Automated runs switch the story and the guides off (they would sit over what a script clicks). */
const off = () => store.get('aetherion.guides.off') === '1';

// ---------- the opening story ----------
const PROLOGUE: Key[] = ['pro.1', 'pro.2', 'pro.3', 'pro.4', 'pro.5', 'pro.6'];
/** Shown once to a new character (level 1, nothing earned yet), over the game as it loads behind. */
export function Prologue({ hud }: { hud: Hud }) {
  useT();
  const me = hud.self, key = me ? `aetherion.prologue.${me.id}` : '';
  const fresh = !!me && me.level === 1 && hud.exp === 0 && hud.status === 'playing' && store.get(key) !== '1' && !off();
  const [open, setOpen] = useState(false), [i, setI] = useState(0), [n, setN] = useState(0);
  useEffect(() => { if (fresh) { setOpen(true); setI(0); setN(0); } }, [fresh, key]);
  const line = open ? t(PROLOGUE[i], { name: me?.name ?? '' }) : '';
  useEffect(() => {
    if (!open || n >= line.length) return;
    const id = setTimeout(() => setN((x: number) => Math.min(line.length, x + 2)), 22);
    return () => clearTimeout(id);
  }, [open, line, n]);
  if (!open || !me) return null;
  const done = () => { store.set(key, '1'); setOpen(false); };
  const last = i === PROLOGUE.length - 1, full = n >= line.length;
  const next = () => { if (!full) return setN(line.length); if (last) return done(); setI(i + 1); setN(0); };
  return (
    <div className="prologue" role="dialog" aria-label={t('pro.title')} onClick={next}>
      <TitleBackdrop />
      <div className="prologuebox">
        <small className="sub">{t('pro.title')} · {i + 1}/{PROLOGUE.length}</small>
        <p aria-live="polite">{line.slice(0, n)}{!full && <span className="caret" aria-hidden="true">▌</span>}</p>
        <div className="actions" onClick={(e: any) => e.stopPropagation()}>
          <button className="primary" onClick={next}>{!full ? t('story.skip') : last ? t('pro.begin') : t('story.next')}</button>
          {!last && <button className="link" onClick={done}>{t('pro.skipAll')}</button>}
        </div>
      </div>
    </div>
  );
}

// ---------- feature guides ----------
interface Feature { id: string; level: number; icon: IconName; open?: Action }
/** What opens at which level, in the order it is met. Each has a title and a text: guide.<id>.title / .text. */
export const FEATURES: Feature[] = [
  { id: 'quests', level: 1, icon: 'quests', open: 'panel.quests' },
  { id: 'travel', level: 2, icon: 'map', open: 'panel.map' },
  { id: 'auto', level: 3, icon: 'auto', open: 'panel.auto' },
  { id: 'journal', level: 4, icon: 'journal', open: 'panel.journal' },
  { id: 'companions', level: 5, icon: 'pets', open: 'panel.companions' },
  { id: 'social', level: 5, icon: 'friends', open: 'panel.friends' },
  { id: 'guild', level: GUILD_CREATE_LEVEL, icon: 'guild', open: 'panel.guild' },
  { id: 'dungeon', level: 8, icon: 'castle', open: 'panel.map' },
  { id: 'life', level: 8, icon: 'life', open: 'panel.life' },
  { id: 'party', level: 10, icon: 'finder' },
  { id: 'depths', level: 18, icon: 'skull', open: 'panel.map' },
  { id: 'talents', level: 30, icon: 'skills', open: 'panel.skills' },
  { id: 'ascension', level: ASCENSION_LEVEL, icon: 'ascension', open: 'panel.ascension' },
  { id: 'awaken', level: AWAKEN_LEVEL, icon: 'star', open: 'panel.ascension' },
  { id: 'fusion', level: FUSION_LEVEL, icon: 'burst', open: 'panel.skills' },
];
const seenKey = (id: number) => `aetherion.guides.${id}`;
/** The guides not yet shown to this character at this level (pure: tests use it). */
export function pendingGuides(level: number, seen: Iterable<string>): Feature[] {
  const s = new Set(seen);
  return FEATURES.filter((f) => level >= f.level && !s.has(f.id));
}
/**
 * A character met for the first time by this browser: everything at or below its level counts as
 * known, except for a brand-new character, who is told about the first things.
 */
export function initialSeen(level: number): string[] {
  return level <= 1 ? [] : FEATURES.filter((f) => f.level <= level).map((f) => f.id);
}
export function FeatureGuide({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  void game;
  const me = hud.self, level = me?.level ?? 0;
  const [seen, setSeen] = useState(null as string[] | null);
  useEffect(() => {
    if (!me) return;
    const raw = store.get(seenKey(me.id));
    let list: string[];
    try { list = raw ? (JSON.parse(raw) as string[]) : initialSeen(me.level); } catch { list = initialSeen(me.level); }
    if (!raw) store.set(seenKey(me.id), JSON.stringify(list));
    setSeen(list);
  }, [me?.id]);
  if (!me || !seen || hud.status !== 'playing' || settings.get().tutorial.skipped || off()) return null;
  const next = pendingGuides(level, seen)[0];
  // the opening story comes first
  if (!next || (level === 1 && hud.exp === 0 && store.get(`aetherion.prologue.${me.id}`) !== '1')) return null;
  const done = () => { const list = [...seen, next.id]; store.set(seenKey(me.id), JSON.stringify(list)); setSeen(list); };
  const touch = touchActive(settings.get()), left = pendingGuides(level, seen).length - 1;
  return (
    <div className="hud featurecard panel" role="dialog" aria-label={t('guide.label')}>
      <div className="fchead"><span className="fcicon"><Icon name={next.icon} size={22} /></span>
        <div><small className="sub">{next.level > 1 ? t('guide.newAt', { n: next.level }) : t('guide.start')}</small><b>{t(`guide.${next.id}.title` as Key)}</b></div>
      </div>
      <p>{t(`guide.${next.id}.${touch && next.id === 'travel' ? 'touch' : 'text'}` as Key)}</p>
      <div className="actions">
        {next.open && <button className="primary" onClick={() => { done(); send('keydown', next.open!); send('keyup', next.open!); }}>{t('guide.show')}</button>}
        <button onClick={done}>{t('guide.ok')}</button>
        {left > 0 && <small className="sub">{t('guide.more', { n: left })}</small>}
      </div>
    </div>
  );
}
