// The mailbox: letters received (with items and gold to take), and writing a letter. Opening and
// sending need a village; the server checks that and everything else.
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ITEMS, RARITY_COLOR } from '../../shared/src/items';
import { MAIL_BODY_MAX, MAIL_MAX_ITEMS, MAIL_SUBJECT_MAX, mailPostage } from '../../shared/src/mail';
import type { Game, Hud } from './game/Game';
import { t, useT } from './i18n';
import { Icon } from './ui/icons';

export function MailPanel({ game, onClose }: { game: Game; onClose: () => void }) {
  useT();
  const hud = useSyncExternalStore(game.subscribe, game.getHud) as Hud;
  const [view, setView] = useState('inbox' as 'inbox' | 'write') as ['inbox' | 'write', (v: 'inbox' | 'write') => void];
  const [open, setOpen] = useState(0);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [gold, setGold] = useState(0);
  const [items, setItems] = useState([] as string[]) as [string[], (v: string[]) => void];
  useEffect(() => game.mailOp('list'), []);
  const list = hud.mail ?? [], cur = list.find((m) => m.id === open);
  const send = (e: any) => {
    e.preventDefault();
    game.mailOp('send', { to, subject, body, items, gold });
    setItems([]);
    setGold(0);
    setSubject('');
    setBody('');
    setView('inbox');
    setTimeout(() => game.mailOp('list'), 400);
  };
  const toggleItem = (uid: string) => setItems(items.includes(uid) ? items.filter((u) => u !== uid) : items.length < MAIL_MAX_ITEMS ? [...items, uid] : items);
  return (
    <div className="hud mailbox panel" role="dialog" aria-label={t('mail.title')}>
      <div className="sheethead">
        <h2>{t('mail.title')} {hud.mailUnread > 0 && <small className="dockbadge inline">{hud.mailUnread}</small>}</h2>
        <button className="link panelx" onClick={onClose} aria-label={t('mail.close')}>{t('common.close')}</button>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={view === 'inbox'} className={view === 'inbox' ? 'on' : ''} onClick={() => setView('inbox')}>{t('mail.inbox')}</button>
        <button role="tab" aria-selected={view === 'write'} className={view === 'write' ? 'on' : ''} onClick={() => setView('write')}>{t('mail.write')}</button>
      </div>
      {view === 'inbox' && (
        <div className="mailcols">
          <ul className="maillist" aria-label={t('mail.inbox')}>
            {!list.length && <li className="sub">{t('mail.empty')}</li>}
            {list.map((m) => (
              <li key={m.id}>
                <button className={(m.id === open ? 'on ' : '') + (m.read ? '' : 'unread')} onClick={() => { setOpen(m.id); if (!m.read) game.mailOp('read', { id: m.id }); }}>
                  <b>{m.subject}</b> <small>{m.from} · {new Date(m.at).toLocaleDateString()}{(m.items.length || m.gold) && !m.claimed ? <> · <Icon name="box" size={13} className="inl" label={t('mail.hasItems')} /></> : ''}</small>
                </button>
              </li>
            ))}
          </ul>
          {cur ? (
            <article className="letter">
              <h3>{cur.subject}</h3>
              <p className="sub">{t('mail.from', { name: cur.from })} · {new Date(cur.at).toLocaleString()}</p>
              {cur.body && <p className="letterbody">{cur.body}</p>}
              {(cur.items.length > 0 || cur.gold > 0) && (
                <div className="attach">
                  {cur.gold > 0 && <span className="gold">{cur.gold.toLocaleString()}g</span>}
                  {cur.items.map((i, k) => <span key={k} style={{ color: RARITY_COLOR[i.rar] }}>{ITEMS[i.base].name}{i.qty > 1 ? ` ×${i.qty}` : ''}</span>)}
                </div>
              )}
              <div className="actions">
                {(cur.items.length > 0 || cur.gold > 0) && <button className="primary" disabled={cur.claimed} onClick={() => game.mailOp('claim', { id: cur.id })}>{cur.claimed ? t('mail.taken') : t('mail.take')}</button>}
                <button onClick={() => { game.mailOp('delete', { id: cur.id }); setOpen(0); }} disabled={(cur.items.length > 0 || cur.gold > 0) && !cur.claimed}>{t('mail.delete')}</button>
              </div>
            </article>
          ) : <p className="sub">{t('mail.pick')}</p>}
        </div>
      )}
      {view === 'write' && (
        <form className="mailwrite" onSubmit={send}>
          <label>{t('mail.to')} <input value={to} onChange={(e: any) => setTo(e.target.value)} maxLength={20} required /></label>
          <label>{t('mail.subject')} <input value={subject} onChange={(e: any) => setSubject(e.target.value)} maxLength={MAIL_SUBJECT_MAX} required /></label>
          <label>{t('mail.body')} <textarea value={body} onChange={(e: any) => setBody(e.target.value)} maxLength={MAIL_BODY_MAX} rows={4} /></label>
          <label>{t('mail.gold')} <input type="number" min={0} value={gold} onChange={(e: any) => setGold(Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></label>
          <div className="sub">{t('mail.attach', { n: items.length, max: MAIL_MAX_ITEMS })}</div>
          <div className="mailitems">
            {hud.inv.filter((i) => !i.bd).map((i) => (
              <button type="button" key={i.uid} className={items.includes(i.uid) ? 'on' : ''} onClick={() => toggleItem(i.uid)} style={{ color: RARITY_COLOR[i.rar] }} aria-pressed={items.includes(i.uid)}>
                {ITEMS[i.base].name}{i.qty > 1 ? ` ×${i.qty}` : ''}
              </button>
            ))}
          </div>
          <div className="actions">
            <span className="sub">{t('mail.postage', { n: mailPostage(items.length) })}</span>
            <button className="primary" type="submit">{t('mail.send')}</button>
          </div>
        </form>
      )}
    </div>
  );
}
