// Guild panel (M14, key N): found a guild, its members and ranks, the message of the day, the
// guild bank, its log, and the invitation prompt. The server checks every permission.
import React, { useState } from 'react';
import {
  can, GUILD_CREATE_COST, GUILD_CREATE_LEVEL, GUILD_EMBLEM_COLORS, GUILD_EMBLEM_SHAPES, GUILD_MOTD_MAX, GUILD_NAME, GUILD_RANKS, GUILD_TAG, type Emblem, GUILD_BUILDINGS, GUILD_BUILDING_INFO, GUILD_BUILDING_MAX, GUILD_POINTS_PER_LEVEL } from '../../shared/src/economy';
import { JOB_DEFS } from '../../shared/src/jobs';
import type { Game, Hud } from './game/Game';
import { t, tm, tv, useT } from './i18n';
import { Icon } from './ui/icons';

const GLYPH: Record<string, string> = { shield: '⛨', star: '★', flame: '♨', drop: '◆', bolt: 'ϟ', wing: '❦', crown: '♛', tree: '♣' };
const rankName = (r: number) => tv(GUILD_RANKS[r]);
export function EmblemBadge({ e, size = 28 }: { e: Emblem; size?: number }) {
  return (
    <span className="emblem" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.62, background: GUILD_EMBLEM_COLORS[e.bg], color: GUILD_EMBLEM_COLORS[e.color] }}>
      {GLYPH[GUILD_EMBLEM_SHAPES[e.shape]]}
    </span>
  );
}

export function GuildInvite({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const v = hud.ginv;
  if (!v) return null;
  return (
    <div className="hud inviteask panel" role="alertdialog" aria-label={t('guild.inviteTitle')} style={{ top: '46%' }}>
      <p>{t('guild.invited', { from: v.from, guild: v.guild, tag: v.tag })}</p>
      <div className="actions"><button onClick={() => game.guildOp('decline')}>{t('common.decline')}</button><button className="primary" onClick={() => game.guildOp('accept')}>{t('guild.join')}</button></div>
    </div>
  );
}

export function GuildPanel({ hud, game, onClose }: { hud: Hud; game: Game; onClose: () => void }) {
  useT();
  const g = hud.guild;
  return (
    <div className="hud qlog panel" role="dialog" aria-label={t('guild.title')}>
      <div className="sheethead">
        <h2>{g ? <><EmblemBadge e={g.emblem} /> {g.name} <small className="sub">[{g.tag}]</small></> : t('guild.title')}</h2>
        <button className="link panelx" onClick={onClose} aria-label={t('guild.close')}>{t('common.close')}</button>
      </div>
      {g ? <GuildView hud={hud} game={game} /> : <Found hud={hud} game={game} />}
    </div>
  );
}

function Found({ hud, game }: { hud: Hud; game: Game }) {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [e, setE] = useState(({ shape: 0, color: 0, bg: 7 }) as Emblem);
  const lv = hud.self?.level ?? 0;
  const why = lv < GUILD_CREATE_LEVEL ? t('err.needLevel', { n: GUILD_CREATE_LEVEL })
    : hud.gold < GUILD_CREATE_COST ? t('guild.costs', { g: GUILD_CREATE_COST })
      : !GUILD_NAME.test(name.trim()) ? t('guild.nameRule')
        : !GUILD_TAG.test(tag.trim().toUpperCase()) ? t('guild.tagRule')
          : e.color === e.bg ? t('guild.colorRule') : '';
  return (
    <>
      <p className="sub">{t('guild.none', { g: GUILD_CREATE_COST, n: GUILD_CREATE_LEVEL })}</p>
      <form className="ahsell" onSubmit={(ev: any) => { ev.preventDefault(); if (!why) game.guildOp('create', { name: name.trim(), tag: tag.trim().toUpperCase(), emblem: e }); }}>
        <label>{t('guild.name')} <input value={name} onChange={(ev: any) => setName(ev.target.value)} maxLength={24} aria-label={t('guild.nameLabel')} /></label>
        <label>{t('guild.tag')} <input value={tag} onChange={(ev: any) => setTag(ev.target.value.toUpperCase())} maxLength={4} style={{ width: 60 }} aria-label={t('guild.tagLabel')} /></label>
        <div className="emblempick" aria-label={t('guild.emblem')}>
          <EmblemBadge e={e} size={40} />
          <div>
            <div className="tabs">{GUILD_EMBLEM_SHAPES.map((s, i) => <button type="button" key={s} className={e.shape === i ? 'on' : ''} onClick={() => setE({ ...e, shape: i })} aria-label={t('guild.shape', { s })}>{GLYPH[s]}</button>)}</div>
            <div className="swatches">{t('guild.symbol')} {GUILD_EMBLEM_COLORS.map((c, i) => <button type="button" key={c} className={'swatch' + (e.color === i ? ' on' : '')} style={{ background: c }} onClick={() => setE({ ...e, color: i })} aria-label={t('guild.symbolColor', { n: i + 1 })} />)}</div>
            <div className="swatches">{t('guild.field')} {GUILD_EMBLEM_COLORS.map((c, i) => <button type="button" key={c} className={'swatch' + (e.bg === i ? ' on' : '')} style={{ background: c }} onClick={() => setE({ ...e, bg: i })} aria-label={t('guild.fieldColor', { n: i + 1 })} />)}</div>
          </div>
        </div>
        <button className="primary" type="submit" disabled={!!why}>{t('guild.found', { g: GUILD_CREATE_COST })}</button>
        {why && <span className="err">{why}</span>}
      </form>
    </>
  );
}

function GuildView({ hud, game }: { hud: Hud; game: Game }) {
  const g = hud.guild!, me = hud.self!, rank = hud.grank;
  const [tab, setTab] = useState('members');
  const [invite, setInvite] = useState('');
  const [motd, setMotd] = useState((null) as string | null);
  const [gold, setGold] = useState('');
  const [confirm, setConfirm] = useState((null) as string | null);
  const n = Math.floor(Number(gold));
  const members = [...g.members].sort((a, b) => a.rank - b.rank || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return (
    <>
      <p className="sub">{t('guild.summary', { lv: g.level, n: g.members.length, cap: g.capacity, exp: g.exp, next: g.next })} <b>{rankName(rank)}</b></p>
      <div className="motd">
        {motd === null
          ? <><b>{t('guild.motd')}</b> {g.motd || <span className="sub">{t('guild.motdNone')}</span>} {can(rank, 'motd') && <button className="link" onClick={() => setMotd(g.motd)}>{t('common.edit')}</button>}</>
          : <form onSubmit={(ev: any) => { ev.preventDefault(); game.guildOp('motd', { text: motd }); setMotd(null); }}>
            <input value={motd} maxLength={GUILD_MOTD_MAX} onChange={(ev: any) => setMotd(ev.target.value)} style={{ width: '70%' }} aria-label={t('guild.motdLabel')} />
            <button className="primary small" type="submit">{t('common.save')}</button> <button className="small" type="button" onClick={() => setMotd(null)}>{t('common.cancel')}</button>
          </form>}
      </div>
      <div className="tabs" role="tablist">
        {[['members', t('guild.members')], ['buildings', t('guild.buildings')], ['bank', t('guild.bank')], ['log', t('guild.log')]].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'buildings' && (
        <>
          <p role="status"><b>{t('guild.points', { n: g.points })}</b></p>
          <p className="sub">{t('guild.pointsHelp', { n: GUILD_POINTS_PER_LEVEL })}</p>
          {GUILD_BUILDINGS.map((k) => {
            const info = GUILD_BUILDING_INFO[k], lv = g.buildings[k], full = lv >= GUILD_BUILDING_MAX;
            return (
              <div key={k} className="shoprow">
                <span className="bicon" aria-hidden="true"><Icon name={({ barracks: 'auto', treasury: 'coin', weaponry: 'sword', kitchen: 'pot', fortress: 'guild' } as const)[k as 'barracks'] ?? 'guild'} size={20} /></span>
                <span><b>{info.name}</b> <small>{t('guild.bLevel', { n: lv, max: GUILD_BUILDING_MAX })}</small>
                  <div className="bar"><i style={{ width: `${(lv / GUILD_BUILDING_MAX) * 100}%` }} /></div>
                  <small>{t('guild.bNow', { pct: Math.round(info.pct * lv * 10) / 10, what: info.what })}{full ? '' : ` → +${Math.round(info.pct * (lv + 1) * 10) / 10}%`}</small></span>
                {can(rank, 'motd') && <button className="small primary" disabled={full || g.points < 1} onClick={() => game.guildOp('build', { b: k })} aria-label={t('guild.bUpName', { name: info.name })}>{full ? t('guild.bMax') : t('guild.bUp')}</button>}
              </div>
            );
          })}
        </>
      )}
      {tab === 'members' && (
        <>
          {can(rank, 'invite') && (
            <form className="actions" onSubmit={(ev: any) => { ev.preventDefault(); if (invite.trim()) game.guildOp('invite', { name: invite.trim() }); setInvite(''); }}>
              <input value={invite} onChange={(ev: any) => setInvite(ev.target.value)} placeholder={t('guild.playerName')} maxLength={16} aria-label={t('guild.inviteLabel')} />
              <button className="primary small" type="submit">{t('guild.invite')}</button>
            </form>
          )}
          <div className="ahlist" role="table" aria-label={t('guild.members')}>
            {members.map((m) => (
              <div key={m.id} className="ahrow" role="row">
                <span className={'dot ' + (m.online ? 'on' : '')} title={m.online ? t('guild.online') : t('guild.offline')} />
                <span role="cell"><b>{m.name}</b> <small className="sub">{JOB_DEFS[m.job as keyof typeof JOB_DEFS]?.name ?? m.job} · {t('common.lv', { n: m.level })}</small></span>
                <span role="cell">{rankName(m.rank)}</span>
                <span className="memberacts">
                  {m.id !== me.id && rank === 0 && m.rank > 1 && <button className="small" onClick={() => game.guildOp('rank', { id: m.id, rank: m.rank - 1 })} aria-label={t('guild.promote', { name: m.name })}>{t('guild.promoteShort')}</button>}
                  {m.id !== me.id && rank === 0 && m.rank > 0 && m.rank < GUILD_RANKS.length - 1 && <button className="small" onClick={() => game.guildOp('rank', { id: m.id, rank: m.rank + 1 })} aria-label={t('guild.demote', { name: m.name })}>{t('guild.demoteShort')}</button>}
                  {m.id !== me.id && can(rank, 'kick') && m.rank > rank && <button className="small danger" onClick={() => game.guildOp('kick', { id: m.id })} aria-label={t('guild.kick', { name: m.name })}>{t('guild.kickShort')}</button>}
                  {m.id !== me.id && rank === 0 && <button className="small" onClick={() => game.guildOp('transfer', { id: m.id })} aria-label={t('guild.makeLeader', { name: m.name })}>{t('guild.makeLeaderShort')}</button>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'bank' && (
        <>
          <p>{t('guild.bankHolds')} <b className="gold">{t('common.gold', { n: g.bank })}</b>. {t('guild.bankRules')}</p>
          <div className="actions">
            <input type="number" min={1} value={gold} onChange={(ev: any) => setGold(ev.target.value)} style={{ width: 110 }} aria-label={t('bank.goldLabel')} />
            <button disabled={!(n > 0) || n > hud.gold} onClick={() => { game.guildOp('deposit', { gold: n }); setGold(''); }}>{t('guild.deposit')}</button>
            {can(rank, 'bank') && <button disabled={!(n > 0) || n > g.bank} onClick={() => { game.guildOp('withdraw', { gold: n }); setGold(''); }}>{t('guild.withdraw')}</button>}
          </div>
        </>
      )}
      {tab === 'log' && (
        <div className="ahlist" aria-label={t('guild.logLabel')}>
          {!g.log.length && <p className="sub">{t('common.nothingYet')}</p>}
          {g.log.map((l, i) => <div key={i} className="shoprow"><span /><span>{tm(l.text)}</span><small>{new Date(l.at).toLocaleString()}</small></div>)}
        </div>
      )}
      <div className="actions" style={{ marginTop: 12 }}>
        {rank !== 0 && <button className="danger" onClick={() => game.guildOp('leave')}>{t('guild.leave')}</button>}
        {rank === 0 && g.members.length > 1 && <span className="sub">{t('guild.leaderLeave')}</span>}
        {rank === 0 && (confirm === null
          ? <button className="danger" onClick={() => setConfirm('')}>{t('guild.disband')}</button>
          : <form className="confirm" role="alertdialog" aria-label={t('guild.disbandAsk')} onSubmit={(ev: any) => { ev.preventDefault(); game.guildOp('disband', { confirm }); setConfirm(null); }}>
            {t('guild.disbandType', { name: g.name })} <input value={confirm} onChange={(ev: any) => setConfirm(ev.target.value)} aria-label={t('guild.disbandLabel')} />
            <button className="danger small" type="submit" disabled={confirm !== g.name}>{t('guild.disbandYes')}</button> <button className="small" type="button" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
          </form>)}
      </div>
    </>
  );
}
