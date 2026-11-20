// The chat box (U8): tabs that filter the log by channel, each with a count of lines that arrived
// while another tab was showing. Choosing the party or guild tab also sends to that channel.
import React, { useEffect, useRef, useState } from 'react';
import { MAX_CHAT_LEN } from '../../shared/src/protocol';
import { keyOf, type Game, type Hud } from './game/Game';
import { t, tm, type Key } from './i18n';
import { useTouch } from './touch';
import { Icon } from './ui/icons';

type Line = Hud['chat'][number];
const TABS = ['all', 'zone', 'world', 'lfg', 'party', 'guild', 'whisper', 'sys'] as const;
type Tab = (typeof TABS)[number];
const inTab = (c: Line, tab: Tab) =>
  tab === 'all' ? true : tab === 'sys' ? !c.from : !!c.from && (tab === 'zone' ? !c.ch || c.ch === 'zone' : c.ch === tab);

export function ChatBox({ hud, game, input }: { hud: Hud; game: Game; input: { current: HTMLInputElement | null } }) {
  const touch = useTouch();
  const [shut, setShut] = useState(true); // U3: in touch mode the chat is a button until opened
  const [text, setText] = useState('');
  const [ch, setCh] = useState('zone');
  const [tab, setTab] = useState('all' as Tab);
  const lastId = hud.chat.length ? hud.chat[hud.chat.length - 1].id : 0;
  // the newest line each tab has shown: anything after it counts as unread on that tab
  const [seen, setSeen] = useState(() => Object.fromEntries(TABS.map((k) => [k, lastId])) as Record<Tab, number>);
  const log = useRef(null as HTMLDivElement | null);
  const me = hud.self;
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
    // the All tab shows every line, so nothing is left unread anywhere
    if (tab === 'all') { if (TABS.some((k) => seen[k] !== lastId)) setSeen(Object.fromEntries(TABS.map((k) => [k, lastId])) as Record<Tab, number>); }
    else if (seen[tab] !== lastId) setSeen((s: Record<Tab, number>) => ({ ...s, [tab]: lastId }));
  }, [hud.chat, tab]);
  const pick = (k: Tab) => {
    setTab(k);
    if (k === 'party' && hud.party) setCh('party');
    else if (k === 'guild' && hud.guild) setCh('guild');
    else if (k === 'zone' || k === 'world' || k === 'lfg') setCh(k);
  };
  const send = (e: any) => {
    e.preventDefault();
    if (text.trim()) game.sendChat(text, ch === 'party' && hud.party ? 'party' : ch === 'guild' && hud.guild ? 'guild' : ch === 'world' || ch === 'lfg' ? ch : 'zone');
    setText('');
    input.current?.blur();
  };
  const shown = hud.chat.filter((c) => inTab(c, tab));
  if (touch && shut) {
    const unread = hud.chat.filter((c) => c.id > seen.all && !!c.from).length;
    return <button className="hud chatfab" aria-label={t('touch.chat')} onClick={() => setShut(false)}><Icon name="chat" size={22} />{unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}</button>;
  }
  return (
    <div className={'hud bl panel chat' + (touch ? ' touchchat' : '')}>
      {touch && <button className="link chatfold" onClick={() => { setShut(true); setSeen(Object.fromEntries(TABS.map((k) => [k, lastId])) as Record<Tab, number>); }}>{t('touch.chatClose')}</button>}
      <div className="chattabs" role="tablist" aria-label={t('chat.tabs')}>
        {TABS.map((k) => {
          if ((k === 'party' && !hud.party) || (k === 'guild' && !hud.guild)) return null;
          const unread = k === tab ? 0 : hud.chat.filter((c) => c.id > seen[k] && inTab(c, k)).length;
          return (
            <button key={k} role="tab" aria-selected={tab === k} className={'chattab ' + k + (tab === k ? ' on' : '')} onClick={() => pick(k)}>
              {t(`chat.tab.${k}` as Key)}{unread > 0 && <i className="unread" aria-label={t('chat.unread', { n: unread })}>{unread > 99 ? '99+' : unread}</i>}
            </button>
          );
        })}
      </div>
      <div className="chatlog" ref={log} aria-live="polite">
        {shown.map((c) => (
          <div key={c.id} className={c.from ? c.ch ?? '' : 'sys'}>
            {c.ch === 'party' && <i>[{t('chat.party')}] </i>}
            {c.ch === 'guild' && <i>[{t('chat.guild')}] </i>}
            {c.ch === 'world' && <i>[{t('chat.tab.world')}] </i>}
            {c.ch === 'lfg' && <i>[{t('chat.tab.lfg')}] </i>}
            {c.ch === 'whisper' && <i>{c.from === me?.name ? `[${t('chat.to', { name: c.to ?? '' })}] ` : `[${t('chat.whisper')}] `}</i>}
            {c.from && !(c.ch === 'whisper' && c.from === me?.name) && <b>{c.from}: </b>}{c.from ? c.text : tm(c.text)}
          </div>
        ))}
        {!shown.length && <div className="sys empty">{t('chat.emptyTab')}</div>}
      </div>
      <form onSubmit={send}>
        <select aria-label={t('chat.channel')} value={ch} onChange={(e: any) => setCh(e.target.value)}><option value="zone">{t('chat.zone')}</option><option value="world">{t('chat.tab.world')}</option><option value="lfg">{t('chat.tab.lfg')}</option><option value="party" disabled={!hud.party}>{t('chat.party')}</option><option value="guild" disabled={!hud.guild}>{t('chat.guild')}</option></select>
        <input ref={input} name="chat" value={text} onChange={(e: any) => setText(e.target.value)} maxLength={MAX_CHAT_LEN} placeholder={t('chat.placeholder', { key: keyOf('chat') })} autoComplete="off" />
      </form>
    </div>
  );
}
