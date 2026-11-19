// PvP and companions (M15): the Arena Master, duel challenges and the duel in progress, the
// zone's PvP rule, the rankings, and the companions panel (P) for pets and mounts.
import React, { useEffect, useState } from 'react';
import { MOUNTS, PET_MAX_LEVEL, PET_STAGE_NAMES, petBonus, petExpToNext, PETS, petStage } from '../../shared/src/companions';
import { JOB_DEFS } from '../../shared/src/jobs';
import { DEPTH_MONSTER } from '../../shared/src/depths';
import { ZONES } from '../../shared/src/world';
import { mountSprite, MOUNT_H, MOUNT_W, PET_W, petSprite } from './game/companions';
import { HD_MOUNT_H, HD_MOUNT_W, HD_PET, hdMountSprite, hdPetSprite } from './game/hdcomp';
import { settings } from './settings';
import type { Game, Hud } from './game/Game';
import { keyOf } from './game/Game';
import { t, useT, type Key } from './i18n';
import { toRail } from './rail';
import { Icon } from './ui/icons';
import { HONOR_SHOP } from '../../shared/src/pvp';
import { ITEMS, RARITY_COLOR } from '../../shared/src/items';
import { Icon as ItemIcon } from './inventory';
import { PET_SKILLS, petSkillPower } from '../../shared/src/companions';
import { BG, RANKED } from '../../shared/src/matches';
import { toTop } from './rail';

const ZONE_LABEL: Record<Hud['pvpZone'], [Key, Key]> = {
  safe: ['pvp.zone.safe', 'pvp.zone.safeTip'],
  town: ['pvp.zone.town', 'pvp.zone.townTip'],
  duel: ['pvp.zone.duel', 'pvp.zone.duelTip'],
  open: ['pvp.zone.open', 'pvp.zone.openTip'],
  arena: ['pvp.zone.arena', 'pvp.zone.arenaTip'],
};
export function PvpZoneBadge({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!hud.mq) return;
    const id = setInterval(() => tick((x: number) => x + 1), 1000);
    return () => clearInterval(id);
  }, [hud.mq]);
  const waited = hud.mq && hud.mqSince ? Math.max(0, Math.floor((Date.now() - hud.mqSince) / 1000)) : 0;
  if (!hud.self) return null;
  const [label, tip] = ZONE_LABEL[hud.pvpZone];
  return toRail(
    <div className={'hud pvpzone ' + hud.pvpZone} title={t(tip, { n: Math.round((DEPTH_MONSTER.exp - 1) * 100) })} role="status" aria-label={t('pvp.zone.label', { name: t(label) })}>
      {t(label)}
      {hud.arena && !hud.match && <button className="small" onClick={() => game.pvpOp('leave')}>{t('pvp.leaveArena')}</button>}
      {hud.mq && <span className="mq">{t(hud.mq === 'ranked' ? 'mm.inLineRanked' : hud.mq === 'ranked2' ? 'mm.inLineRanked2' : 'mm.inLineBg')} <small className="sub">{t('mm.waiting', { n: hud.mqN || 1, t: `${Math.floor(waited / 60)}:${String(waited % 60).padStart(2, '0')}` })}</small> <button className="small" onClick={() => game.pvpOp('unqueue')}>{t('mm.leaveLine')}</button></span>}
    </div>
  );
}

/** Shown at the entrance of the Depths until the player has agreed once. */
export function DepthAsk({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const v = hud.depthAsk;
  if (!v) return null;
  return (
    <div className="hud inviteask panel depthask" role="alertdialog" aria-label={t('depth.ask.title')}>
      <h3><Icon name="auto" size={14} className="inl" /> {t('depth.ask.title')}</h3>
      <p>{t('depth.ask.body', { name: ZONES[v.zone]?.name ?? '', n: Math.round((DEPTH_MONSTER.exp - 1) * 100) })}</p>
      <div className="actions"><button onClick={() => game.depthAnswer(false)}>{t('depth.ask.stay')}</button><button className="primary" onClick={() => game.depthAnswer(true)}>{t('depth.ask.enter')}</button></div>
    </div>
  );
}

export function DuelInvite({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const v = hud.dinv;
  if (!v) return null;
  return (
    <div className="hud inviteask panel" role="alertdialog" aria-label={t('pvp.challenge')} style={{ top: '58%' }}>
      <p>{t('pvp.challenged', { name: v.from })}</p>
      <div className="actions"><button onClick={() => game.pvpOp('decline')}>{t('common.decline')}</button><button className="primary" onClick={() => game.pvpOp('accept')}>{t('common.accept')}</button></div>
    </div>
  );
}

/** G8: a match was found: accept or decline before the time runs out. */
export function MatchReady({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const f = hud.mfound, [, tick] = useState(0);
  useEffect(() => {
    if (!f) return;
    const id = setInterval(() => tick((x: number) => x + 1), 250);
    return () => clearInterval(id);
  }, [f]);
  if (!f) return null;
  const left = Math.max(0, Math.ceil((f.until - performance.now()) / 1000));
  const name = t(f.mode === 'ranked' ? 'mm.ranked' : f.mode === 'ranked2' ? 'mm.ranked2' : 'mm.bg');
  return (
    <div className="hud inviteask panel" role="alertdialog" aria-label={t('mm.found', { name })} style={{ top: '40%' }}>
      <p><b>{t('mm.found', { name })}</b></p>
      <p className="sub">{f.ok ? t('mm.waitOthers', { n: left }) : t('mm.answerIn', { n: left })}</p>
      {!f.ok && <div className="actions"><button onClick={() => game.pvpOp('mdecline')}>{t('common.decline')}</button><button className="primary" onClick={() => game.pvpOp('maccept')}>{t('common.accept')}</button></div>}
    </div>
  );
}

/** G8: the match in progress: the score, the clock and the shrine (battleground), and the way out. */
export function MatchBar({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const m = hud.match, [, tick] = useState(0);
  useEffect(() => {
    if (!m) return;
    const id = setInterval(() => tick((x: number) => x + 1), 250);
    return () => clearInterval(id);
  }, [m]);
  if (!m) return null;
  const now = Date.now(), starts = Math.ceil((m.startsAt - now) / 1000), left = Math.max(0, Math.ceil((m.endsAt - now) / 1000));
  const mine = m.teams[m.side], theirs = m.teams[1 - m.side];
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    toTop('pvp', <div className="hud duelbar matchbar panel" role="status" aria-label={t(m.mode === 'ranked' ? 'mm.ranked' : m.mode === 'ranked2' ? 'mm.ranked2' : 'mm.bg')}>
      {m.mode === 'bg' && <b className="score"><span className="us" title={mine.names.join(', ')}>{mine.score}</span> : <span className="them" title={theirs.names.join(', ')}>{theirs.score}</span></b>}
      {m.mode === 'ranked' && <b>{t('mm.vs', { name: theirs.names.join(', ') })}</b>}
      {m.mode === 'ranked2' && <b>{t('mm.vs2', { mates: mine.names.join(' & '), name: theirs.names.join(' & ') })}</b>}
      {m.result ? <b className="count">{t(m.result === 'won' ? 'mm.won' : m.result === 'lost' ? 'mm.lost' : 'mm.draw')}</b>
        : starts > 0 ? <b className="count">{t('mm.startsIn', { n: starts })}</b> : <span>{clock}</span>}
      {m.mode === 'bg' && !m.result && <small className="sub">{t(m.shrine < 0 ? 'mm.shrineFree' : m.shrine === m.side ? 'mm.shrineUs' : 'mm.shrineThem')}</small>}
      {!m.result && <button className="small" onClick={() => game.pvpOp('leave')}>{t('mm.leave')}</button>}
      {m.result && m.mode !== 'ranked' && (
        <table className="kd" aria-label={t('mm.scoreboard')}>
          <thead><tr><th>{t('mm.fighter')}</th><th title={t('mm.killsLong')}>{t('mm.kills')}</th><th title={t('mm.deathsLong')}>{t('mm.deaths')}</th></tr></thead>
          <tbody>
            {[m.side, 1 - m.side].flatMap((s) => m.teams[s].names.map((n, i) => (
              <tr key={s + ':' + i} className={s === m.side ? 'us' : 'them'}><td>{n}</td><td>{m.teams[s].kills[i] ?? 0}</td><td>{m.teams[s].deaths[i] ?? 0}</td></tr>
            )))}
          </tbody>
        </table>
      )}
    </div>)
  );
}

export function DuelStatus({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const d = hud.duel, [, tick] = useState(0);
  useEffect(() => {
    if (!d) return;
    const id = setInterval(() => tick((x: number) => x + 1), 250);
    return () => clearInterval(id);
  }, [d]);
  if (!d) return null;
  const now = Date.now(), starts = Math.ceil((d.starts - now) / 1000);
  return (
    toTop('pvp', <div className="hud duelbar panel" role="status" aria-label={t('pvp.duel')}>
      {starts > 0 ? <b className="count">{t('pvp.duelIn', { name: d.with, n: starts })}</b> : <b>{t('pvp.duelLeft', { name: d.with, n: Math.max(0, Math.ceil((d.ends - now) / 1000)) })}</b>}
      <button className="small" onClick={() => game.pvpOp('forfeit')}>{t('pvp.forfeit')}</button>
    </div>)
  );
}

const BY: [string, Key][] = [['rating', 'pvp.by.rating'], ['kills', 'pvp.by.kills'], ['duels_won', 'pvp.by.duels'], ['arena_kills', 'pvp.by.arena'], ['bg_won', 'pvp.by.bg']];
export function Rankings({ hud, game }: { hud: Hud; game: Game }) {
  const [by, setBy] = useState('rating');
  useEffect(() => game.pvpOp('rank', { by }), [by]);
  const r = hud.pvprank;
  return (
    <>
      <div className="tabs" role="tablist" aria-label={t('pvp.rankBy')}>
        {BY.map(([k, l]) => <button key={k} role="tab" aria-selected={by === k} className={by === k ? 'on' : ''} onClick={() => setBy(k)}>{t(l)}</button>)}
      </div>
      {r?.me && <p className="sub">{t('pvp.me', { rating: r.me.rating, kills: r.me.kills, deaths: r.me.deaths, won: r.me.duels_won, lost: r.me.duels_lost, arena: r.me.arena_kills, honor: r.me.honor, bw: r.me.bg_won ?? 0, bl: r.me.bg_lost ?? 0 })}</p>}
      <div className="ahlist" role="table" aria-label={t('pvp.rankings')}>
        {!r && <p className="sub">{t('common.loading')}</p>}
        {r && !r.rows.length && <p className="sub">{t('pvp.noRanks')}</p>}
        {r?.rows.map((x, i) => (
          <div key={x.id} className="ahrow" role="row">
            <b>{i + 1}.</b>
            <span role="cell"><b>{x.name}</b> <small className="sub">{JOB_DEFS[x.job as keyof typeof JOB_DEFS]?.name ?? x.job}</small></span>
            <span role="cell">{by === 'rating' ? x.rating : x[by]}</span>
            <span />
          </div>
        ))}
      </div>
    </>
  );
}

export function ArenaMaster({ hud, game }: { hud: Hud; game: Game }) {
  return (
    <>
      <p>{t('pvp.arenaSay')}</p>
      <div className="actions">
        {hud.arena && !hud.match ? <button className="primary" onClick={() => game.pvpOp('leave')}>{t('pvp.leaveTheArena')}</button> : !hud.match && <button className="primary" onClick={() => game.pvpOp('arena')}>{t('pvp.enterArena')}</button>}
      </div>
      <h3>{t('mm.title')}</h3>
      <p className="sub">{t('mm.about', { n: BG.target, win: BG.winHonor, lose: BG.loseHonor, rw: RANKED.winHonor })}</p>
      <div className="actions">
        {hud.mq ? <button onClick={() => game.pvpOp('unqueue')}>{t('mm.leaveLine')}</button> : !hud.match && <>
          <button className="primary" onClick={() => game.pvpOp('queue', { mode: 'ranked' })}>{t('mm.queueRanked')}</button>
          <button className="primary" onClick={() => game.pvpOp('queue', { mode: 'ranked2' })}>{t('mm.queueRanked2')}</button>
          <button className="primary" onClick={() => game.pvpOp('queue', { mode: 'bg' })}>{t('mm.queueBg')}</button>
        </>}
      </div>
      <h3>{t('honor.shop')}</h3>
      <HonorShop hud={hud} game={game} />
      <h3>{t('pvp.rankingsTitle')}</h3>
      <Rankings hud={hud} game={game} />
    </>
  );
}

/** G8: honour is spent here. What you have is earned honour minus what you have spent. */
function HonorShop({ hud, game }: { hud: Hud; game: Game }) {
  const me = hud.pvprank?.me, have = me ? Number(me.honor) - Number(me.honor_spent ?? 0) : null;
  useEffect(() => { if (!hud.pvprank) game.pvpOp('rank'); }, []);
  return (
    <>
      <p className="sub">{t('honor.have', { n: have ?? 0 })}</p>
      {HONOR_SHOP.map(([base, cost]) => {
        const it = ITEMS[base];
        return (
          <div key={base} className="shoprow">
            <ItemIcon base={base} size={24} />
            <span style={{ color: it.unique ? RARITY_COLOR[it.unique.rar] : undefined }}>{it.name}<small> {it.unique?.set ? t('honor.setPiece') : it.unique?.passive ? t('honor.legendary') : it.desc ?? ''}</small></span>
            <button className="small" disabled={have === null || have < cost} onClick={() => game.pvpOp('buy', { base })} aria-label={t('honor.buy', { name: it.name, n: cost })}>{cost}</button>
          </div>
        );
      })}
    </>
  );
}

/** Pixel art of a companion, on its own canvas, for the panel. */
function Portrait({ sheet, w, h, scale = 3 }: { sheet: HTMLCanvasElement | null; w: number; h: number; scale?: number }) {
  const ref = React.useRef(null as HTMLCanvasElement | null);
  useEffect(() => {
    const c = ref.current, g = c?.getContext('2d');
    if (!c || !g || !sheet) return;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(sheet, 0, 0, w, h, 0, 0, w * scale, h * scale);
  }, [sheet]);
  return <canvas ref={ref} width={w * scale} height={h * scale} className="portrait" aria-hidden="true" />;
}

export function CompanionsPanel({ hud, game, onClose }: { hud: Hud; game: Game; onClose: () => void }) {
  useT();
  const c = hud.comp, [renaming, setRenaming] = useState(''), [name, setName] = useState(''), [releasing, setReleasing] = useState('');
  return (
    <div className="hud qlog panel" role="dialog" aria-label={t('comp.title')}>
      <div className="sheethead"><h2>{t('comp.title')}</h2><button className="link panelx" onClick={onClose} aria-label={t('comp.close')}>{t('common.close')}</button></div>
      <h3>{t('comp.pets')} <small className="sub">{c.pets.length}</small></h3>
      {!c.pets.length && <p className="sub">{t('comp.noPets')}</p>}
      <div className="comps">
        {c.pets.map((p) => {
          const d = PETS[p.kind], out = c.pet === p.uid;
          return (
            <div key={p.uid} className={'comp' + (out ? ' on' : '')}>
              {settings.get().graphics.art === 'hd' ? <Portrait sheet={hdPetSprite(p.kind)} w={HD_PET} h={HD_PET} scale={2} /> : <Portrait sheet={petSprite(p.kind)} w={PET_W} h={PET_W} />}
              <div>
                {renaming === p.uid
                  ? <form onSubmit={(e: any) => { e.preventDefault(); game.compOp('rename', { uid: p.uid, name: name.trim() }); setRenaming(''); }}>
                    <input value={name} onChange={(e: any) => setName(e.target.value)} maxLength={14} aria-label={t('comp.petName')} style={{ width: 110 }} />
                    <button className="small primary" type="submit">{t('common.save')}</button>
                  </form>
                  : <b>{p.name}</b>}
                <div className="sub">{PET_STAGE_NAMES[petStage(p.level)] ? `${PET_STAGE_NAMES[petStage(p.level)]} ` : ''}{d.name} · {t('common.lv', { n: p.level })}{p.level < PET_MAX_LEVEL ? ` · ${t('comp.exp', { a: p.exp, b: petExpToNext(p.level) })}` : ` · ${t('common.max')}`}</div>
                <div className="sub">{t('comp.bonus', { v: `${petBonus(d, p.level)}${d.pct ? '%' : ''}`, stat: t(`comp.stat.${d.stat}` as Key) })}</div>
                {PET_SKILLS[p.kind] && <div className="sub petskill"><b>{t(`pet.skill.${p.kind}` as Key)}</b> ({Math.round(PET_SKILLS[p.kind].cdMs / 1000)}s): {t(`pet.desc.${p.kind}` as Key, { n: Math.round(PET_SKILLS[p.kind].mul * petSkillPower(p.level) * 100) })}</div>}
                <div className="actions">
                  {out ? <button className="small" onClick={() => game.compOp('dismiss')}>{t('comp.dismiss')}</button> : <button className="small primary" onClick={() => game.compOp('summon', { uid: p.uid })}>{t('comp.summon')}</button>}
                  <button className="small" onClick={() => { setRenaming(p.uid); setName(p.name); }}>{t('comp.rename')}</button>
                  {releasing === p.uid
                    ? <span className="confirm" role="alertdialog" aria-label={t('comp.releaseAsk', { name: p.name })}>{t('comp.releaseWarn')} <button className="small danger" onClick={() => { game.compOp('release', { uid: p.uid }); setReleasing(''); }}>{t('comp.release')}</button> <button className="small" onClick={() => setReleasing('')}>{t('comp.keep')}</button></span>
                    : <button className="small link" onClick={() => setReleasing(p.uid)}>{t('comp.release')}</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <h3>{t('comp.mounts')} <small className="sub">{c.mounts.length}</small></h3>
      {!c.mounts.length && <p className="sub">{t('comp.noMounts')}</p>}
      <div className="comps">
        {c.mounts.map((id) => {
          const d = MOUNTS[id], on = c.riding === id, low = (hud.self?.level ?? 0) < d.level;
          return (
            <div key={id} className={'comp' + (on ? ' on' : '')}>
              {settings.get().graphics.art === 'hd' ? <Portrait sheet={hdMountSprite(id)} w={HD_MOUNT_W} h={HD_MOUNT_H} scale={1} /> : <Portrait sheet={mountSprite(id)} w={MOUNT_W} h={MOUNT_H} scale={2} />}
              <div>
                <b>{d.name}</b>
                <div className="sub">{t('comp.speed', { n: Math.round((d.speed - 1) * 100), lv: d.level })}</div>
                <div className="actions">
                  {on ? <button className="small" onClick={() => game.compOp('dismount')}>{t('comp.dismount')}</button>
                    : <button className="small primary" disabled={low} title={low ? t('err.needLevel', { n: d.level }) : undefined} onClick={() => game.compOp('mount', { id })}>{t('comp.ride')} <kbd>{keyOf('mount.toggle')}</kbd></button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="sub">{t('comp.rules', { key: keyOf('panel.companions'), mount: keyOf('mount.toggle') })}</p>
    </div>
  );
}
