// The friends list: who is online and where, requests to answer, and what to do with a friend
// (whisper, invite to the party, remove). The list refreshes while the window is open.
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { FRIENDS_MAX } from '../../shared/src/friends';
import { JOB_DEFS } from '../../shared/src/jobs';
import type { Game, Hud } from './game/Game';
import { t, useT } from './i18n';

export function FriendsPanel({ game, onClose, whisper }: { game: Game; onClose: () => void; whisper: (name: string) => void }) {
  useT();
  const hud = useSyncExternalStore(game.subscribe, game.getHud) as Hud;
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(0);
  useEffect(() => {
    game.friendOp('list');
    const id = setInterval(() => game.friendOp('list'), 8000); // places change as friends travel
    return () => clearInterval(id);
  }, []);
  const list = hud.friends, asks = list.filter((f) => f.state === 'in'), friends = list.filter((f) => f.state === 'friend'), sent = list.filter((f) => f.state === 'out');
  const me = hud.self, leader = !hud.party || hud.party.leader === me?.id;
  const jobName = (j: string) => JOB_DEFS[j as keyof typeof JOB_DEFS]?.name ?? j;
  const add = (e: any) => {
    e.preventDefault();
    if (name.trim()) game.friendOp('add', { name: name.trim() });
    setName('');
  };
  return (
    <div className="hud mailbox friends panel" role="dialog" aria-label={t('fr.title')}>
      <div className="sheethead">
        <h2>{t('fr.title')} <small className="sub">{t('fr.count', { n: friends.length, on: friends.filter((f) => f.online).length, max: FRIENDS_MAX })}</small></h2>
        <button className="link panelx" onClick={onClose} aria-label={t('fr.close')}>{t('common.close')}</button>
      </div>
      <form className="actions" onSubmit={add}>
        <input value={name} onChange={(e: any) => setName(e.target.value)} placeholder={t('fr.addPlaceholder')} maxLength={20} aria-label={t('fr.addLabel')} />
        <button className="primary small" type="submit">{t('fr.add')}</button>
      </form>
      {asks.length > 0 && (
        <>
          <h3>{t('fr.requests', { n: asks.length })}</h3>
          <div className="ahlist" role="list" aria-label={t('fr.requests', { n: asks.length })}>
            {asks.map((f) => (
              <div key={f.id} className="ahrow" role="listitem">
                <span className={'dot ' + (f.online ? 'on' : '')} />
                <span><b>{f.name}</b> <small className="sub">{jobName(f.job)} · {t('common.lv', { n: f.level })}</small></span>
                <span className="memberacts">
                  <button className="small primary" onClick={() => game.friendOp('accept', { id: f.id })} aria-label={t('fr.acceptName', { name: f.name })}>{t('common.accept')}</button>
                  <button className="small" onClick={() => game.friendOp('decline', { id: f.id })} aria-label={t('fr.declineName', { name: f.name })}>{t('common.decline')}</button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <h3>{t('fr.friends')}</h3>
      {friends.length === 0 && <p className="sub">{t('fr.none')}</p>}
      <div className="ahlist" role="list" aria-label={t('fr.friends')}>
        {friends.map((f) => (
          <div key={f.id} className={'ahrow' + (f.online ? '' : ' offline')} role="listitem">
            <span className={'dot ' + (f.online ? 'on' : '')} title={f.online ? t('guild.online') : t('guild.offline')} />
            <span><b>{f.name}</b> <small className="sub">{jobName(f.job)} · {t('common.lv', { n: f.level })}</small>
              <div className="sub">{f.online ? t('fr.at', { zone: f.zone }) : t('guild.offline')}</div></span>
            <span className="memberacts">
              {f.online && <button className="small" onClick={() => { whisper(f.name); onClose(); }} aria-label={t('fr.whisperName', { name: f.name })}>{t('fr.whisper')}</button>}
              {f.online && leader && !hud.party?.members.some((m) => m.id === f.id) && <button className="small" disabled={f.party} title={f.party ? t('fr.inParty') : ''} onClick={() => game.partyOp('invite', f.id)} aria-label={t('fr.inviteName', { name: f.name })}>{t('party.invite')}</button>}
              {confirm === f.id
                ? <button className="small danger" onClick={() => { game.friendOp('remove', { id: f.id }); setConfirm(0); }} aria-label={t('fr.removeName', { name: f.name })}>{t('fr.removeSure')}</button>
                : <button className="small" onClick={() => setConfirm(f.id)} aria-label={t('fr.removeAsk', { name: f.name })}>{t('fr.remove')}</button>}
            </span>
          </div>
        ))}
      </div>
      {sent.length > 0 && (
        <>
          <h3>{t('fr.sent', { n: sent.length })}</h3>
          <div className="ahlist" role="list" aria-label={t('fr.sent', { n: sent.length })}>
            {sent.map((f) => (
              <div key={f.id} className="ahrow" role="listitem">
                <span className="dot" />
                <span><b>{f.name}</b> <small className="sub">{t('fr.waiting')}</small></span>
                <span className="memberacts"><button className="small" onClick={() => game.friendOp('remove', { id: f.id })} aria-label={t('fr.cancelName', { name: f.name })}>{t('common.cancel')}</button></span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
