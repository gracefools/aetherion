// U4: the right-click menu over the world: what can be done with the player, monster, character or
// spot under the cursor.
import React, { useEffect } from 'react';
import type { Game, Hud } from './game/Game';
import { t, type Key } from './i18n';

export function CtxMenu({ hud, game, whisper }: { hud: Hud; game: Game; whisper: (name: string) => void }) {
  const c = hud.ctx;
  useEffect(() => {
    if (!c) return;
    const close = (e: Event) => { if (!(e.target as HTMLElement)?.closest?.('.ctxmenu')) game.closeCtx(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') game.closeCtx(); };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', close, true); window.removeEventListener('keydown', esc, true); };
  }, [c, game]);
  if (!c) return null;
  const items: [Key, () => void][] = [];
  const walk: [Key, () => void] = ['ctx.walk', () => game.ctxAct('walk')];
  if (c.kind === 'monster') items.push(['ctx.attack', () => game.ctxAct('attack')], ['ctx.target', () => game.ctxAct('target')]);
  if (c.kind === 'enemy') items.push(['ctx.attack', () => game.ctxAct('attack')], ['ctx.target', () => game.ctxAct('target')]);
  if (c.kind === 'player' || c.kind === 'enemy') {
    const id = c.id, name = c.name, done = (f: () => void) => () => { game.closeCtx(); f(); };
    if (c.kind === 'player') items.push(['ctx.ally', () => game.ctxAct('ally')]);
    items.push(
      ['ctx.whisper', done(() => whisper(name))],
      ['ctx.invite', done(() => game.partyOp('invite', id, name))],
      ['ctx.trade', done(() => game.tradeOp('invite', { id, name }))],
      ['ctx.duel', done(() => game.pvpOp('duel', { id }))],
      ['ctx.friend', done(() => game.friendOp('add', { name }))],
    );
  }
  if (c.kind === 'npc') items.push(['ctx.talk', () => game.ctxAct('talk')]);
  if (c.kind === 'node') items.push(['ctx.gather', () => game.ctxAct('gather')]);
  items.push(walk);
  const x = Math.min(c.sx, window.innerWidth - 190), y = Math.min(c.sy, window.innerHeight - 34 * items.length - 40);
  return (
    <div className="ctxmenu panel" role="menu" aria-label={c.name || t('ctx.here')} style={{ left: x, top: y }} onContextMenu={(e: any) => e.preventDefault()}>
      <div className="ctxhead">{c.name || t('ctx.here')}</div>
      {items.map(([k, f], i) => <button key={k} role="menuitem" autoFocus={i === 0} onClick={f}>{t(k)}</button>)}
    </div>
  );
}
