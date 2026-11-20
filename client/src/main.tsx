// React shell: auth -> character select/create -> game HUD. The canvas game never re-renders through React.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ANIM_NAMES, animFrame, AP_LABELS, AP_LIMITS, defaultAppearance, FRAME_H, FRAME_W, randomAppearance,
  type Anim, type ApField, type Appearance,
} from '../../shared/src/appearance';
import { ATTR_NAMES, ATTRS, attrsAt, computeStats, JOB_DEFS, jobTitle, TIER_BONUS, type StatKey, type Stats, type TierBonus } from '../../shared/src/jobs';
import {
  ABILITIES, ELEMENT_COLORS, ELEMENT_NAMES, ELEMENTS, jobActives, learnBlock, RUNE_MAX_LEVEL, runeExpToNext, runeSpells,
  type AbilityDef, type Element,
} from '../../shared/src/abilities';
import { JOBS, MAX_CHAT_LEN, type Job } from '../../shared/src/protocol';
import { COLORS, drawAura, EYE, getCharSheet, HAIR, LAYERS, renderSheet, SKIN, SPRITE_OX, SPRITE_OY } from './game/chars';
import { getHDSheet, HD, hdFrame } from './game/hdchars';
import './game/stylea'; // style A characters
import { Game, keyOf, runeKey, type Hud } from './game/Game';
import { getMonsterSheet, MONSTER_TYPES, monsterScale } from './game/monsters';
import { PROP_KINDS, propSprite } from './game/props';
import { imported, loadImportedAssets } from './game/imported';
import { InventoryPanel, LootFeed, PotionBar } from './inventory';
import { JournalPanel } from './journalUi';
import { MailPanel } from './mailUi';
import { FriendsPanel } from './friendsUi';
import { RiftTracker } from './riftUi';
import { RaidTracker, SiegeTracker } from './conquestUi';
import { AscensionSummary, AscensionPanel } from './ascensionUi';
import { LifePanel } from './lifeUi';
import { FUSIONS, FUSION_LEVEL, FUSION_RUNE_LEVEL, fusionsFor } from '../../shared/src/awakening';
import { ASCENSION_LEVEL, COMBO_LEVEL, COMBO_WINDOW_MS, comboOf, PATH_INDEX, ULT_MAX } from '../../shared/src/ascension';
import { Dock, MENU_OF_ACTION, menuLock } from './dock';
import { Sprite } from './sprite';
import { ChatBox } from './chat';
import { startGamepad } from './gamepad';
import { closeTopWindow, isNarrow, Win } from './windows';
import { Icon, type IconName } from './ui/icons';
import { StatSources } from './statsUi';
import { Banner, BossBar, DungeonTracker, GateDialog, ReadyCheck, WorldEventTracker } from './encounters';
import { InteractHint, NpcDialog } from './npcs';
import { LOOT_MODES, type LootMode } from '../../shared/src/protocol';
import { itemIcon } from './game/icons';
import { audio } from './audio/engine';
import { installUiSounds, sound } from './audio/gameSound';
import { AudioPrompt } from './audio/ui';
import { MenuSettings, SettingsPanel } from './settingsPanel';
import { WorldMap } from './worldmap';
import { TutorialCoach, TutorialPanel } from './tutorialUi';
import { t, tm, tv, useT, type Key } from './i18n';
import { settings, shortcutAllowed } from './settings';
import { actionFor, type Action } from '../../shared/src/settings';
import { markTutorial } from './tutorial';
import { subsOf, type SubSkillDef } from '../../shared/src/subskills';
import { AutoPanel } from './autohunt';
import { QuestLog, QuestTracker, StoryScene } from './quests';
import { attackIcon, iconCanvas, iconManifest, runeIcon, skillIcon, statusIcon } from './game/skillicons';
import { ownsRune } from '../../shared/src/runes';
import { STATUS } from '../../shared/src/combat';
import { TradeInvite, TradePanel } from './trade';
import { GuildInvite, GuildPanel } from './guild';
import { CompanionsPanel, DepthAsk, DuelInvite, DuelStatus, MatchBar, MatchReady, PvpZoneBadge } from './pvp';
import { toRail } from './rail';
import { TraitBadge } from './traitsUi';
import { TalentPicker } from './talentsUi';
import { StatusBar } from './statusUi';
import { FinderPanel } from './finderUi';
import { toTop } from './rail';
import { TipLayer } from './tooltip';
import { tip as tipOn } from './tooltip';
import { hdMountSprite, hdPetSprite } from './game/hdcomp';
import { toDockTop } from './rail';
import { TitleBackdrop } from './titleArt';
import { abilityFacts, SkillFacts } from './skillInfo';
import { CtxMenu } from './ctxmenu';
import { TouchControls } from './touch';

interface Character {
  id: number;
  name: string;
  job: Job;
  level: number;
  appearance: Appearance;
  zone: string;
}

const FIELDS: ApField[] = ['body', 'build', 'height', 'skin', 'face', 'eyes', 'eyeColor', 'hair', 'hairColor', 'clothing', 'color1', 'color2', 'armor', 'armorColor', 'helmet', 'helmetColor', 'weapon', 'cape', 'capeColor', 'accessory', 'accessoryColor', 'aura'];
const fieldTitle = (f: ApField) => t(`ap.${f}` as Key);
const PALETTE: Partial<Record<ApField, string[]>> = {
  skin: SKIN, eyeColor: EYE, hairColor: HAIR, color1: COLORS, color2: COLORS, armorColor: COLORS, helmetColor: COLORS, capeColor: COLORS, accessoryColor: COLORS,
};
const TABS: [Key, ApField[]][] = [
  ['create.tab.body', ['body', 'build', 'height', 'skin']],
  ['create.tab.face', ['face', 'eyes', 'eyeColor', 'hair', 'hairColor']],
  ['create.tab.outfit', ['clothing', 'color1', 'color2', 'cape', 'capeColor']],
  ['create.tab.gear', ['weapon', 'armor', 'armorColor', 'helmet', 'helmetColor', 'accessory', 'accessoryColor', 'aura']],
];
const DIR_NAMES: Key[] = ['create.dir.front', 'create.dir.left', 'create.dir.right', 'create.dir.back'];

async function api<T>(path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ? tm(data.error) : t('err.request')), { status: res.status });
  return data as T;
}

function Auth({ onAuth }: { onAuth: (token: string) => void }) {
  useT();
  const [mode, setMode] = useState('login');
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: any) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ token: string }>(`/api/${mode}`, undefined, { username, password });
      onAuth(r.token);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <form className="panel auth" onSubmit={submit}>
        <h1>Aetherion Online</h1>
        <p className="sub">{mode === 'login' ? t('auth.loginSub') : t('auth.registerSub')}</p>
        <label>{t('auth.username')}<input name="username" value={username} onChange={(e: any) => setU(e.target.value)} autoFocus autoComplete="username" maxLength={16} /></label>
        <label>{t('auth.password')}<input name="password" type="password" value={password} onChange={(e: any) => setP(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} maxLength={72} /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="primary" disabled={busy}>{mode === 'login' ? t('auth.signIn') : t('auth.create')}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }}>
          {mode === 'login' ? t('auth.toRegister') : t('auth.toLogin')}
        </button>
      </form>
    </div>
  );
}

function Field({ field, job, value, onChange }: { field: ApField; job: Job; value: number; onChange: (v: number) => void }) {
  const title = fieldTitle(field);
  const colors = PALETTE[field];
  const labels = field === 'weapon' ? JOB_DEFS[job].weapons.map((w) => w.name) : AP_LABELS[field]?.map(tv);
  return (
    <div className="row">
      <span className="rowlabel">{title}</span>
      <div className="swatches" role="group" aria-label={title}>
        {Array.from({ length: AP_LIMITS[field] }, (_, i) =>
          colors ? (
            <button type="button" key={i} aria-label={`${title} ${i + 1}`} aria-pressed={i === value} className={'swatch' + (i === value ? ' on' : '')} style={{ background: colors[i] }} onClick={() => onChange(i)} />
          ) : (
            <button type="button" key={i} aria-pressed={i === value} className={'opt' + (i === value ? ' on' : '')} onClick={() => onChange(i)}>{labels?.[i] ?? i + 1}</button>
          ),
        )}
      </div>
    </div>
  );
}

function JobCard({ job, level, weapon }: { job: Job; level: number; weapon: number }) {
  const d = JOB_DEFS[job], a = attrsAt(job, level), s = computeStats(job, level, weapon);
  const top = Math.max(...JOBS.map((j) => Math.max(...ATTRS.map((k) => attrsAt(j, level)[k]))));
  return (
    <div className="jobcard">
      <div><strong>{jobTitle(job, level)}</strong> <span className="tag">{d.role}</span></div>
      <p className="sub">{d.identity}</p>
      <div className="attrs">
        {ATTRS.map((k) => (
          <div key={k} className="attr"><span>{tv(ATTR_NAMES[k])}</span><div className="bar"><i style={{ width: `${(a[k] / top) * 100}%` }} /></div><b>{a[k]}</b></div>
        ))}
      </div>
      <StatGrid s={s} resource={d.resource} />
    </div>
  );
}

function StatGrid({ s, resource }: { s: Stats; resource: string }) {
  const rows: [string, string | number][] = [
    [t('stat.hp'), s.maxHp], [resource === 'rage' ? t('stat.rage') : t('stat.mana'), s.maxRes], [t('stat.atk'), s.atk], [t('stat.matk'), s.matk], [t('stat.def'), s.def], [t('stat.mdef'), s.mdef],
    [t('stat.crit'), s.crit + '%'], [t('stat.critDmg'), '×' + s.critDmg], [t('stat.speed'), Math.round(s.moveMul * 100) + '%'], [t('stat.atkTime'), (s.atkIntervalMs / 1000).toFixed(2) + 's'],
    [t('stat.range'), s.range], [t('stat.lifesteal'), s.lifesteal + '%'],
  ];
  return <div className="statgrid">{rows.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>;
}

function Creator({ token, canCancel, onCancel, onDone }: { token: string; canCancel: boolean; onCancel: () => void; onDone: (c: Character) => void }) {
  useT();
  const [name, setName] = useState('');
  const [job, setJobState]: [Job, (j: Job) => void] = useState('knight');
  const [ap, setAp]: [Appearance, (a: Appearance) => void] = useState(() => defaultAppearance('knight'));
  const [tab, setTab] = useState(-1); // -1 = job tab
  const [anim, setAnim]: [Anim, (a: Anim) => void] = useState('idle');
  const [dir, setDir] = useState(0);
  const [err, setErr] = useState('');
  const touched = useRef(new Set<ApField>());
  const setJob = (j: Job) => {
    const next = defaultAppearance(j);
    for (const f of touched.current as Set<ApField>) if (f !== 'weapon') next[f] = ap[f]; // keep what the player already chose
    setJobState(j);
    setAp(next);
  };
  const create = async (e: any) => {
    e.preventDefault();
    setErr('');
    try {
      onDone((await api<{ character: Character }>('/api/characters', token, { name, job, appearance: ap })).character);
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <div className="screen">
      <form className="panel create" onSubmit={create}>
        <h2>{t('create.title')}</h2>
        <div className="createbody">
          <div className="preview">
            <Sprite ap={ap} job={job} scale={5} anim={anim} dir={dir} />
            <div className="jobname">{JOB_DEFS[job].name}</div>
            <div className="mini" role="group" aria-label={t('create.animation')}>
              {ANIM_NAMES.map((a) => <button type="button" key={a} aria-pressed={a === anim} className={'opt' + (a === anim ? ' on' : '')} onClick={() => setAnim(a)}>{tv(a)}</button>)}
            </div>
            <div className="mini" role="group" aria-label={t('create.direction')}>
              {DIR_NAMES.map((d, i) => <button type="button" key={d} aria-pressed={i === dir} className={'opt' + (i === dir ? ' on' : '')} onClick={() => setDir(i)}>{t(d)}</button>)}
            </div>
            <button type="button" onClick={() => { FIELDS.forEach((f) => touched.current.add(f)); setAp(randomAppearance(job)); }}>{t('create.random')}</button>
          </div>
          <div className="opts">
            <label>{t('create.name')}<input name="charname" value={name} onChange={(e: any) => setName(e.target.value)} maxLength={14} autoFocus /></label>
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === -1} className={tab === -1 ? 'on' : ''} onClick={() => setTab(-1)}>{t('create.tab.job')}</button>
              {TABS.map(([k], i) => <button type="button" role="tab" key={k} aria-selected={tab === i} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>{t(k)}</button>)}
            </div>
            <div className="tabbody">
              {tab === -1 ? (
                <>
                  <div className="jobs">{JOBS.map((j) => <button type="button" key={j} aria-pressed={j === job} className={'job' + (j === job ? ' on' : '')} onClick={() => setJob(j)}>{JOB_DEFS[j].name}</button>)}</div>
                  <JobCard job={job} level={1} weapon={ap.weapon} />
                </>
              ) : (
                TABS[tab][1].map((f) => <Field key={f} field={f} job={job} value={ap[f]} onChange={(v) => { touched.current.add(f); setAp({ ...ap, [f]: v }); }} />)
              )}
              {tab === 3 && <p className="sub">{JOB_DEFS[job].weapons[ap.weapon].name}: {JOB_DEFS[job].weapons[ap.weapon].note}.</p>}
            </div>
          </div>
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="actions">
          {canCancel && <button type="button" onClick={onCancel}>{t('common.back')}</button>}
          <button className="primary">{t('create.enter')}</button>
        </div>
      </form>
    </div>
  );
}

function Characters({ token, onPlay, onLogout }: { token: string; onPlay: (c: Character) => void; onLogout: () => void }) {
  useT();
  const [chars, setChars]: [Character[] | null, (c: Character[]) => void] = useState(null);
  const [max, setMax] = useState(4);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<{ characters: Character[]; max: number }>('/api/characters', token).then(
      (r) => { setChars(r.characters); setMax(r.max); setCreating(r.characters.length === 0); },
      (e) => (e.status === 401 ? onLogout() : setErr(e.message)),
    );
  }, [token]);
  if (!chars) return <div className="screen"><div className="panel">{err || t('common.loading')}</div></div>;
  if (creating) return <Creator token={token} canCancel={chars.length > 0} onCancel={() => setCreating(false)} onDone={onPlay} />;
  return (
    <div className="screen">
      <div className="panel select">
        <h2>{t('chars.title')}</h2>
        <div className="charlist">
          {chars.map((c: Character) => (
            <button key={c.id} className="charcard" onClick={() => onPlay(c)}>
              <Sprite ap={c.appearance} job={c.job} scale={3} />
              <strong>{c.name}</strong>
              <span>{t('common.lv', { n: c.level })} {jobTitle(c.job, c.level)}</span>
            </button>
          ))}
          {chars.length < max && <button className="charcard new" onClick={() => setCreating(true)}><span className="plus">+</span><span>{t('chars.new')}</span></button>}
        </div>
        <button className="link" onClick={onLogout}>{t('chars.signOut')}</button>
      </div>
    </div>
  );
}

/** Keeps one broken panel from blanking the whole game: it renders nothing for a moment, logs the error, and tries again. */
const Guard: any = class Guard extends (React.Component as any) {
  state = { failed: false };
  private timer = 0;
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error('interface panel failed', e);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.setState({ failed: false }), 3000);
  }
  componentWillUnmount() {
    clearTimeout(this.timer);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
};

function Play({ token, character, onExit }: { token: string; character: Character; onExit: () => void }) {
  const canvas = useRef(null as HTMLCanvasElement | null);
  const mini = useRef(null as HTMLCanvasElement | null);
  const input = useRef(null as HTMLInputElement | null);
  const [game, setGame] = useState(null as Game | null);
  const [sheet, setSheet] = useState(false);
  const [book, setBook] = useState(false);
  const [bag, setBag] = useState(false);
  const [opts, setOpts] = useState(false);
  const [auto, setAuto] = useState(false);
  const [qlog, setQlog] = useState(false);
  const [guild, setGuild] = useState(false);
  const [comps, setComps] = useState(false);
  const [map, setMap] = useState(false);
  const [tut, setTut] = useState(false);
  const [journal, setJournal] = useState(false);
  const [mail, setMail] = useState(false);
  const [friendsP, setFriendsP] = useState(false);
  const [ascp, setAscp] = useState(false);
  const [lifep, setLifep] = useState(false);
  const [finderP, setFinderP] = useState(false);
  // Wide screens keep several windows open (see windows.tsx); on a phone opening one closes the others.
  const wins: [boolean, (b: boolean) => void][] = [[sheet, setSheet], [book, setBook], [bag, setBag], [opts, setOpts], [qlog, setQlog], [guild, setGuild], [comps, setComps], [map, setMap], [tut, setTut], [journal, setJournal], [mail, setMail], [friendsP, setFriendsP], [ascp, setAscp], [lifep, setLifep], [finderP, setFinderP]];
  const wasOpen = useRef(wins.map((w) => w[0]));
  useEffect(() => {
    const opened = wins.findIndex((w, i) => w[0] && !wasOpen.current[i]);
    const single = isNarrow();
    if (opened >= 0 && single) wins.forEach((w, i) => { if (i !== opened && w[0]) w[1](false); });
    wasOpen.current = wins.map((w, i) => (single && opened >= 0 && i !== opened ? false : w[0]));
  });
  useEffect(() => {
    document.body.classList.add('ingame');
    const g = new Game(canvas.current!, token, character.id);
    (window as any).__game = g;
    (window as any).__icon = itemIcon;
    g.start(mini.current);
    setGame(g);
    const stopPad = startGamepad(() => g.showNotice(t('pad.connected')));
    const toggles: Partial<Record<Action, (f: (b: boolean) => boolean) => void>> = {
      'panel.character': setSheet, 'panel.skills': setBook, 'panel.bag': setBag, 'panel.settings': setOpts, 'panel.auto': setAuto,
      'panel.quests': setQlog, 'panel.guild': setGuild, 'panel.companions': setComps, 'panel.map': setMap, 'panel.tutorial': setTut, 'panel.journal': setJournal, 'panel.mail': setMail, 'panel.friends': setFriendsP, 'panel.ascension': setAscp, 'panel.life': setLifep,
    };
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el === input.current || el?.dataset?.capture) return;
      // typing in a field (chat, a marker name, a price), Ctrl/Alt combinations and pressing a focused button are not shortcuts; Escape still closes everything
      const act = shortcutAllowed(e) ? actionFor(settings.get().keys, e.code) : undefined;
      if (act === 'chat') {
        e.preventDefault();
        input.current?.focus();
      } else if (act === 'auto.toggle' && !e.repeat) {
        e.preventDefault();
        if (menuLock('auto', g.hud)) return g.showNotice(t('dock.locked', { n: menuLock('auto', g.hud) }));
        if (g.hud.auto.on) g.stopAuto();
        else {
          g.startAuto();
          setAuto(true);
        }
      } else if (act && toggles[act]) {
        if (act === 'panel.tutorial') e.preventDefault(); // F1 would open the browser's help
        const menu = MENU_OF_ACTION[act], need = menu ? menuLock(menu, g.hud) : 0;
        if (need) return g.showNotice(t('dock.locked', { n: need }));
        toggles[act]!((s: boolean) => !s);
        if (act === 'panel.bag') markTutorial('inventory');
      } else if (e.code === 'Escape') {
        if (closeTopWindow()) return; // one window at a time, top first
        setSheet(false);
        setBook(false);
        setBag(false);
        setOpts(false);
        setQlog(false);
        setGuild(false);
        setComps(false);
        setMap(false);
        setTut(false);
        setJournal(false);
        setMail(false);
        setFriendsP(false);
        setAscp(false);
        setLifep(false);
        setFinderP(false);
        g.closeTalk();
      }
    };
    // a button clicked with the mouse gives its focus back, so Space and Enter go to the game again
    const onUp = (e: PointerEvent) => {
      const b = (e.target as HTMLElement | null)?.closest?.('button');
      if (b && e.pointerType === 'mouse') setTimeout(() => b === document.activeElement && b.blur(), 0);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', onUp);
      stopPad();
      document.body.classList.remove('ingame');
      g.destroy();
    };
  }, [token, character.id]);
  return (
    <div className="play">
      <canvas ref={canvas} className="world" />
      <div className="winlayer" />
      <div className="hud rail"><canvas ref={mini} width={144} height={144} className="minimap" role="button" tabIndex={0} title={t('map.open')} aria-label={t('map.open')} onClick={() => setMap(true)} onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') setMap(true); }} /></div>
      <div className="topstack">{(['boss', 'target', 'event', 'siege', 'pvp', 'toast', 'banner'] as const).map((s) => <div key={s} className={'slot-' + s} />)}</div>
      {game && <Guard><HudView game={game} onExit={onExit} input={input} sheet={sheet} setSheet={setSheet} book={book} setBook={setBook} bag={bag} setBag={(b) => { setBag(b); if (b) markTutorial('inventory'); }} setOpts={setOpts} auto={auto} setAuto={setAuto} setMap={setMap} /></Guard>}
      {opts && <Win id="settings" title={'settings.title'} width={520} onClose={() => setOpts(false)}><Guard><SettingsPanel onClose={() => setOpts(false)} signedIn inGame /></Guard></Win>}
      {game && map && <Win id="map" title={'map.title'} width={980} onClose={() => setMap(false)}><Guard><WorldMap game={game} onClose={() => setMap(false)} /></Guard></Win>}
      {game && <Guard><TutorialCoach game={game} onOpen={() => setTut(true)} /></Guard>}
      {game && tut && <Win id="help" title={'tut.panel'} onClose={() => setTut(false)}><Guard><TutorialPanel onClose={() => setTut(false)} /></Guard></Win>}
      {game && qlog && <Win id="quests" title={'quest.log'} onClose={() => setQlog(false)}><Guard><QuestLog game={game} onClose={() => setQlog(false)} /></Guard></Win>}
      {game && <Guard><QuestTracker game={game} onOpen={() => setQlog(true)} /></Guard>}
      {game && <Guard><StoryScene game={game} /></Guard>}
      {game && <Guard><RiftTracker game={game} /></Guard>}
      {game && <Guard><RaidTracker game={game} /></Guard>}
      {game && <Guard><SiegeTracker game={game} /></Guard>}
      {game && <Guard><SocialPanels game={game} guild={guild} setGuild={setGuild} comps={comps} setComps={setComps} /></Guard>}
      {game && journal && <Win id="journal" title={'jr.title'} onClose={() => setJournal(false)}><Guard><JournalPanel game={game} onClose={() => setJournal(false)} /></Guard></Win>}
      {game && mail && <Win id="mail" title={'mail.title'} onClose={() => setMail(false)}><Guard><MailPanel game={game} onClose={() => setMail(false)} /></Guard></Win>}
      {game && friendsP && <Win id="friends" title={'fr.title'} onClose={() => setFriendsP(false)}><Guard><FriendsPanel game={game} onClose={() => setFriendsP(false)} whisper={(name) => { const el = input.current; if (el) { el.value = `/w ${name} `; el.dispatchEvent(new Event('input', { bubbles: true })); setTimeout(() => el.focus(), 0); } }} /></Guard></Win>}
      {game && ascp && <Win id="ascension" title={'asc.title'} width={780} onClose={() => setAscp(false)}><Guard><AscensionPanel game={game} onClose={() => setAscp(false)} /></Guard></Win>}
      {game && finderP && <Win id="finder" title="finder.title" width={620} onClose={() => setFinderP(false)}><Guard><FinderPanel game={game} onClose={() => setFinderP(false)} /></Guard></Win>}
      {game && lifep && <Win id="life" title={'life.title'} onClose={() => setLifep(false)}><Guard><LifePanel game={game} onClose={() => setLifep(false)} /></Guard></Win>}
      {game && <DockView game={game} open={{ character: sheet, skills: book, bag, companions: comps, quests: qlog, map, auto, guild, settings: opts, help: tut, journal, mail, friends: friendsP, ascension: ascp, life: lifep, finder: finderP }} act={{
        character: () => setSheet(!sheet), skills: () => setBook(!book), bag: () => { setBag(!bag); if (!bag) markTutorial('inventory'); }, companions: () => setComps(!comps),
        quests: () => setQlog(!qlog), map: () => setMap(!map), auto: () => setAuto(!auto), guild: () => setGuild(!guild),
        settings: () => setOpts(!opts), help: () => setTut(!tut), exit: onExit, journal: () => setJournal(!journal), mail: () => setMail(!mail), friends: () => setFriendsP(!friendsP), ascension: () => setAscp(!ascp), life: () => setLifep(!lifep), finder: () => setFinderP(!finderP),
      }} />}
    </div>
  );
}

/** The controls at a glance: every binding as a key cap, grouped by what it is for. */
function ControlsCard({ onClose }: { onClose: () => void }) {
  useT();
  useSyncExternalStore(settings.subscribe, settings.get);
  const k = (a: Action) => keyOf(a);
  const groups: [Key, [string, string[]][]][] = [
    ['ctl.move', [[t('ctl.moveKeys'), ['move.up', 'move.left', 'move.down', 'move.right'].map((a) => k(a as Action))], [t('act.walk'), [k('walk')]], [t('act.dodge'), [k('dodge')]], [t('act.mount.toggle'), [k('mount.toggle')]]]],
    ['ctl.fight', [[t('ctl.target'), [t('ctl.click'), k('target')]], [t('ctl.attack'), [k('attack')]], [t('ctl.skills'), [`${k('skill.1')}–${k('skill.7')}`]], [t('ctl.runes'), [runeKey(0, 0), runeKey(0, 1), runeKey(0, 2)]], [t('ctl.potions'), [k('potion.hp'), k('potion.mp')]], [t('ctl.interact'), [k('interact')]]]],
    ['ctl.menus', [[t('bag.title'), [k('panel.bag')]], [t('book.title'), [k('panel.skills')]], [t('sheet.title'), [k('panel.character')]], [t('quest.log'), [k('panel.quests')]], [t('map.title'), [k('panel.map')]], [t('comp.title'), [k('panel.companions')]], [t('guild.title'), [k('panel.guild')]], [t('settings.title'), [k('panel.settings')]], [t('tut.panel'), [k('panel.tutorial')]]]],
  ];
  return (
    <div className="hud controls panel" role="dialog" aria-label={t('dock.controls')}>
      <div className="sheethead"><h3>{t('dock.controls')}</h3><button className="link panelx" onClick={onClose} aria-label={t('common.close')}>{t('common.close')}</button></div>
      <div className="ctlgroups">
        {groups.map(([g, rows]) => (
          <section key={g}>
            <h4>{t(g)}</h4>
            {rows.map(([label, keys]) => <div key={label} className="ctlrow"><span>{label}</span><span className="caps">{keys.filter(Boolean).map((x, i) => <kbd key={i}>{x}</kbd>)}</span></div>)}
          </section>
        ))}
      </div>
      <p className="sub">{t('ctl.rebind')}</p>
    </div>
  );
}

function CharacterSheet({ hud, onClose }: { hud: Hud; onClose: () => void }) {
  useT();
  const me = hud.self!, d = JOB_DEFS[me.job], a = attrsAt(me.job, me.level);
  const [tab, setTab] = useState('stats' as 'stats' | 'prog' | 'skills');
  return (
    <div className="hud sheet panel" role="dialog" aria-label={t('sheet.title')}>
      <div className="sheethead">
        <Sprite ap={me.ap} job={me.job} scale={3} />
        <div>
          <h2>{me.name}</h2>
          <div className="sub">{t('common.level', { n: me.level })} {PATH_INDEX[hud.asc.path] && me.level >= ASCENSION_LEVEL ? PATH_INDEX[hud.asc.path].title : jobTitle(me.job, me.level)} · {d.role}</div>
          <div className="sub">{d.weapons[me.ap.weapon].name}: {d.weapons[me.ap.weapon].note}</div>
        </div>
        <button className="link panelx" onClick={onClose} aria-label={t('sheet.close')}>{t('common.close')}</button>
      </div>
      <div className="tabs" role="tablist" aria-label={t('sheet.title')}>
        {([['stats', 'sheet.combat'], ['prog', 'sheet.progression'], ['skills', 'sheet.tree']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(l)}</button>
        ))}
      </div>
      {tab === 'stats' && (
        <div className="sheetcols sheettab">
          <div>
            <h3>{t('sheet.attributes')}</h3>
            <div className="statgrid">{ATTRS.map((k) => <div key={k}><span>{tv(ATTR_NAMES[k])}</span><b>{a[k]}</b></div>)}</div>
          </div>
          <div>
            <h3>{t('sheet.combat')}</h3>
            <p className="sub">{t('src.help')}</p>
            <StatSources hud={hud} />
          </div>
        </div>
      )}
      {tab === 'prog' && (
        <div className="sheettab">
          <h3>{t('asc.title')}</h3>
          <AscensionSummary hud={hud} />
          <h3>{t('sheet.progression')}</h3>
          <div className="tiers">{d.tiers.map((x) => <span key={x.title} className={me.level >= x.level ? 'on' : ''}>{x.title} <small>{t('common.lv', { n: x.level })}</small></span>)}</div>
          <div className="tierbonus" aria-label={t('tier.label')}>
            {d.tiers.slice(1).map((x, i) => (
              <div key={x.title} className={'node' + (me.level >= x.level ? ' on' : '')}>
                <b>{x.title}</b> <small>{me.level >= x.level ? t('tier.reached') : t('tier.at', { n: x.level })}</small>
                <div>{tierText(TIER_BONUS[me.job][i])}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === 'skills' && (
        <div className="sheetcols sheettab">
        <div>
          <h3>{t('sheet.passives')}</h3>
          {d.passives.map((p) => <div key={p.id} className={'node' + (me.level >= p.level ? ' on' : '')}><b>{p.name}</b> <small>{t('common.lv', { n: p.level })}</small><div>{p.desc}</div></div>)}
          <h3>{t('sheet.tree')}</h3>
          {[1, 2, 3].map((tier) => (
            <div key={tier} className="tier">
              {d.skills.filter((s) => s.tier === tier).map((s) => (
                <div key={s.id} className={'node' + (me.level >= s.level ? ' on' : '')} title={s.desc}>
                  <b>{s.name}</b> <small>{s.type === 'passive' ? t('skill.passive') + ' · ' : ''}{t('common.lv', { n: s.level })} · {t('skill.max', { n: s.maxRank })}</small>
                  <div>{s.desc}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}

const abbr = (name: string) => name.split(/[ ']/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const costOf = (def: AbilityDef, s: Stats) => (def.kind === 'rune' ? Math.round(def.cost * s.runeCost) : def.cost);

/** Cooldown sweep. The CSS animation is configured once per cooldown so re-renders do not restart it. */
function CdMask({ at, ms }: { at: number; ms: number }) {
  const [style] = useState(() => ({ animationDuration: `${ms}ms`, animationDelay: `${-(performance.now() - at)}ms` }));
  return <i className="cdmask" style={style} />;
}

/** The skill a combo chain expects next (while the chain is fresh), for the hotbar highlight. */
function comboNext(hud: Hud, job: Job): string {
  const c = comboOf(job);
  if (!c || (hud.self?.level ?? 0) < COMBO_LEVEL) return '';
  if (hud.combo.i > 0 && Date.now() - hud.combo.at <= COMBO_WINDOW_MS) return c.steps[hud.combo.i];
  return '';
}
function Slot({ def: base, hotkey, hud, game, locked, combo, gauge }: { def: AbilityDef; hotkey: string; hud: Hud; game: Game; locked: string; combo?: boolean; gauge?: number }) {
  const def = game.ability(base.id);
  const s = hud.stats!, cost = costOf(def, s), cd = hud.cds[def.id];
  const running = cd && performance.now() - cd[0] < cd[1];
  const rank = hud.build?.skills[def.id] ?? 0;
  const card = () => (
    <div className="tipcard skilltip">
      <div className="tiphead"><img className="skillicon" src={skillIcon(def.id)} alt="" /><div><b className="tipname">{def.name}</b><div className="sub">{def.kind === 'rune' ? t('tip.rune') : rank ? t('tip.rank', { n: rank }) : t('tip.skill')} · {hotkey}</div></div></div>
      <div className="tipstats">
        <span>{def.costAll ? t('skill.allRage') : cost ? t(def.job === 'berserker' ? 'skill.costRage' : 'skill.costMana', { n: cost }) : t('skill.free')}</span>
        <span>{t('skill.cd', { s: def.cdMs / 1000 })}</span>
        {def.castMs ? <span>{t('skill.cast', { s: def.castMs / 1000 })}</span> : null}
        {def.range ? <span>{t('skill.range', { n: def.range })}</span> : null}
      </div>
      <p className="tipdesc">{def.desc}</p>
      <ul className="tipfacts">{abilityFacts(def, hud, game.sigilExtra()).map((f, i) => <li key={i}>{f}</li>)}</ul>
      {locked && <p className="err">{locked}</p>}
    </div>
  );
  return (
    <button className={'slot' + (locked ? ' locked' : '') + (!locked && hud.res < cost ? ' nores' : '') + (combo ? ' combo' : '') + (gauge !== undefined && gauge >= 1 ? ' ultready' : '')} {...tipOn(card)} aria-label={`${def.name} (${hotkey})`} aria-disabled={!!locked} onClick={() => game.useAbility(def.id)}>
      <span className="glyph"><img className="skillicon" src={skillIcon(def.id)} alt="" /></span>
      <span className="key">{hotkey}</span>
      {running && <CdMask key={cd[0]} at={cd[0]} ms={cd[1]} />}
      {gauge !== undefined && gauge < 1 && <i className="ultgauge" style={{ height: `${(1 - gauge) * 100}%` }} />}
    </button>
  );
}

function Hotbar({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  useSyncExternalStore(settings.subscribe, settings.get); // key labels follow the bindings
  const me = hud.self!, b = hud.build!, s = hud.stats!;
  return (
    <div className="hud hotbar" role="toolbar" aria-label={t('hotbar.label')}>
      <div className="slots">
        {jobActives(me.job).map((def, i) => <Slot key={def.id} def={def} hotkey={keyOf(`skill.${i + 1}` as Action)} hud={hud} game={game} locked={b.skills[def.id] > 0 ? '' : t('skill.notLearned')} combo={comboNext(hud, me.job) === def.id} />)}
      </div>
      {me.level >= FUSION_LEVEL && fusionsFor(b.runes.slots).length > 0 && (
        <div className="slots fusion" aria-label={t('fu.label')}>
          {fusionsFor(b.runes.slots).slice(0, 3).map((f, i) => {
            const lv = Math.min(...f.els.map((el) => (b.runes.slots.includes(el) ? (b.runes.lv[el] ?? 1) + s.runeLevel : 0)));
            return <Slot key={f.id} def={f} hotkey={keyOf(`fusion.${i + 1}` as Action)} hud={hud} game={game} locked={lv >= FUSION_RUNE_LEVEL ? '' : t('fu.needLevel', { n: FUSION_RUNE_LEVEL })} />;
          })}
        </div>
      )}
      {PATH_INDEX[hud.asc.path] && me.level >= ASCENSION_LEVEL && (
        <div className="slots ult" aria-label={t('asc.ultimate')}>
          <Slot def={ABILITIES[PATH_INDEX[hud.asc.path].ult]} hotkey={keyOf('ultimate')} hud={hud} game={game} locked={hud.ult >= ULT_MAX ? '' : t('asc.charging', { n: Math.floor(hud.ult) })} gauge={hud.ult / ULT_MAX} />
        </div>
      )}
      {b.runes.slots.map((el, sl) => (
        <div className="slots rune" key={sl} aria-label={t('rune.slot', { n: sl + 1 })}>
          {el ? runeSpells(el).map((def, i) => <Slot key={def.id} def={def} hotkey={runeKey(sl, i)} hud={hud} game={game} locked={(b.runes.lv[el] ?? 1) + s.runeLevel >= def.unlock! ? '' : t('rune.needLevel', { n: def.unlock! })} />)
            : <span className="emptyrune" title={`${t('rune.slot', { n: sl + 1 })} · ${t('rune.empty')}`}><b>+</b><small>{sl + 1}</small></span>}
        </div>
      ))}
      <PotionBar hud={hud} game={game} />
    </div>
  );
}

function SkillBook({ hud, game, onClose }: { hud: Hud; game: Game; onClose: () => void }) {
  useT();
  const me = hud.self!, b = hud.build!, d = JOB_DEFS[me.job], s = hud.stats!;
  const [tab, setTab] = useState('skills');
  return (
    <div className="hud sheet panel" role="dialog" aria-label={t('book.title')}>
      <div className="sheethead">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'skills'} className={tab === 'skills' ? 'on' : ''} onClick={() => setTab('skills')}>{t('book.skills')}</button>
          <button role="tab" aria-selected={tab === 'runes'} className={tab === 'runes' ? 'on' : ''} onClick={() => setTab('runes')}>{t('book.runes')}</button>
          <button role="tab" aria-selected={tab === 'talents'} className={tab === 'talents' ? 'on' : ''} onClick={() => setTab('talents')}>{t('talent.tab')}</button>
        </div>
        <div className="sub" aria-label={t('book.points')}>{t('book.points')}: <b>{hud.points}</b></div>
        <button className="link panelx" onClick={onClose} aria-label={t('book.close')}>{t('common.close')}</button>
      </div>
      {tab === 'talents' ? <TalentPicker hud={hud} game={game} /> : tab === 'skills' ? (
        <>
          {[1, 2, 3].map((tier) => (
            <div key={tier} className="tier">
              <h3>{t('book.tier', { n: tier })}</h3>
              {d.skills.filter((n) => n.tier === tier).map((n, i) => {
                const rank = b.skills[n.id] ?? 0, why = learnBlock(me.job, me.level, b, n.id), base = ABILITIES[n.id], def = base && game.ability(n.id), sig = game.sigilExtra(), extra = sig[n.id] ?? 0;
                return (
                  <React.Fragment key={n.id}>
                  <div className={'node row2' + (rank ? ' on' : '')}>
                    <img className="nodeicon" src={skillIcon(n.id)} alt="" />
                    <div className="grow">
                      <b>{n.name}</b> <small>{n.type === 'passive' ? t('skill.passive') : t('book.key', { k: keyOf(`skill.${jobActives(me.job).indexOf(base) + 1}` as Action) })} · {t('common.lv', { n: n.level })} · {extra ? <b className="better">{t('book.rankSig', { r: rank, m: n.maxRank, x: extra, e: rank + extra })}</b> : t('book.rank', { r: rank, m: n.maxRank })}</small>
                      <div>{n.desc}</div>
                      {def && <SkillFacts def={def} hud={hud} cost={def.cost} rage={d.resource === 'rage'} sigil={sig} />}
                    </div>
                    <button disabled={!!why} title={why ? tm(why) : t('book.spend')} aria-label={t('book.learnName', { name: n.name })} onClick={() => game.learn(n.id)}>{rank ? t('book.addRank') : t('book.learn')}</button>
                  </div>
                  {n.type === 'active' && <SubSkills hud={hud} game={game} parent={n.id} />}
                  </React.Fragment>
                );
              })}
            </div>
          ))}
          <div className="actions"><button onClick={() => game.respec()} title={t('book.resetTip')}>{t('book.reset')}</button></div>
        </>
      ) : (
        <>
          <p className="sub">{t('book.runesHelp')}</p>
          {b.runes.slots.map((cur, sl) => (
            <div key={sl} className="tier">
              <h3>{t('book.slotKeys', { n: sl + 1, keys: [0, 1, 2].map((i) => runeKey(sl, i)).join(' ') })}</h3>
              <div className="swatches" role="group" aria-label={t('rune.slot', { n: sl + 1 })}>
                <button className={'opt' + (!cur ? ' on' : '')} aria-pressed={!cur} onClick={() => game.attune(sl, null)}>{t('rune.emptyOpt')}</button>
                {ELEMENTS.map((el: Element) => (
                  <button key={el} className={'opt runeopt' + (cur === el ? ' on' : '')} aria-pressed={cur === el} disabled={!ownsRune(b, el) || b.runes.slots.some((x, i) => x === el && i !== sl)} title={ownsRune(b, el) ? undefined : t('rune.notOwnedTip')} onClick={() => game.attune(sl, el)}><img src={runeIcon(el, 32)} alt="" />{ELEMENT_NAMES[el]}{ownsRune(b, el) ? '' : ` ${t('rune.notOwned')}`}</button>
                ))}
              </div>
              {cur && (() => {
                const lv = b.runes.lv[cur] ?? 1, xp = b.runes.xp[cur] ?? 0, eff = lv + s.runeLevel;
                return (
                  <>
                    <div className="attr"><span>{t('common.level', { n: lv })}{s.runeLevel ? ` (+${s.runeLevel})` : ''}</span><div className="bar"><i style={{ width: lv >= RUNE_MAX_LEVEL ? '100%' : `${(xp / runeExpToNext(lv)) * 100}%`, background: ELEMENT_COLORS[cur] }} /></div><b>{lv >= RUNE_MAX_LEVEL ? t('common.max') : `${xp}/${runeExpToNext(lv)}`}</b></div>
                    {runeSpells(cur).map((sp, i) => (
                      <div key={sp.id} className={'node spell' + (eff >= sp.unlock! ? ' on' : '')}>
                        <img className="nodeicon" src={skillIcon(sp.id)} alt="" />
                        <b>{sp.name}</b> <small>{t('book.key', { k: runeKey(sl, i) })} · {t('rune.lv', { n: sp.unlock! })} · {t('skill.costMana', { n: costOf(sp, s) })} · {sp.cdMs / 1000}s{sp.castMs ? ` · ${t('skill.cast', { s: sp.castMs / 1000 })}` : ''}</small>
                        <div>{sp.desc}</div>
                        <SkillFacts def={sp} hud={hud} cost={costOf(sp, s)} />
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          ))}
          <FusionList hud={hud} />
        </>
      )}
    </div>
  );
}

/** The rune fusions: locked with what they need before level 90; then every pair of attuned runes, ready or waiting on rune levels. */
function FusionList({ hud }: { hud: Hud }) {
  const me = hud.self!, b = hud.build!, s = hud.stats!, open = me.level >= FUSION_LEVEL, slots = b.runes.slots;
  const keys = (['fusion.1', 'fusion.2', 'fusion.3'] as Action[]).map((a) => keyOf(a)).join(' ');
  const lvOf = (el: Element) => (b.runes.lv[el] ?? 1) + (s.runeLevel ?? 0);
  return (
    <div className={'tier fusions' + (open ? '' : ' locked')}>
      <h3>{t('fu.title')} {!open && <small className="sub"><Icon name="lock" size={11} className="inl" /> {t('common.lv', { n: FUSION_LEVEL })}</small>}</h3>
      <p className="sub">{open ? t('fu.help', { m: FUSION_RUNE_LEVEL }) : t('fu.lockedLevel', { n: FUSION_LEVEL, m: FUSION_RUNE_LEVEL, k: keys })}</p>
      <div className="fusiongrid">
        {FUSIONS.map((f) => {
          const attuned = f.els.every((el) => slots.includes(el)), low = Math.min(lvOf(f.els[0]), lvOf(f.els[1])), ready = open && attuned && low >= FUSION_RUNE_LEVEL;
          return (
            <div key={f.id} className={'node spell fusion' + (ready ? ' on' : '') + (open && attuned ? '' : ' dim')}>
              <img className="nodeicon" src={skillIcon(f.id)} alt="" />
              <b>{f.name}</b> <small>{t('fu.pair', { a: tv(ELEMENT_NAMES[f.els[0]] ?? f.els[0]), b: tv(ELEMENT_NAMES[f.els[1]] ?? f.els[1]) })} · {ready ? t('fu.ready') : !open ? t('common.lv', { n: FUSION_LEVEL }) : !attuned ? t('fu.notAttuned') : t('fu.lowRune', { m: FUSION_RUNE_LEVEL, n: low })}</small>
              <div>{f.desc}</div>
              <SkillFacts def={f} hud={hud} cost={Math.round(f.cost * s.runeCost)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HudView({ game, onExit, input, sheet, setSheet, book, setBook, bag, setBag, setOpts, auto, setAuto, setMap }: { game: Game; onExit: () => void; input: any; sheet: boolean; setSheet: (b: boolean) => void; book: boolean; setBook: (b: boolean) => void; bag: boolean; setBag: (b: boolean) => void; setOpts: (f: (b: boolean) => boolean) => void; auto: boolean; setAuto: (b: boolean) => void; setMap: (f: (b: boolean) => boolean) => void }) {
  const [keysOpen, setKeysOpen] = useState(false);
  const hud: Hud = useSyncExternalStore(game.subscribe, game.getHud);
  useT();
  useSyncExternalStore(settings.subscribe, settings.get);
  const me = hud.self, s = hud.stats;
  return (
    <>
      {me && s && (
        <div className="hud tl panel">
          <button className="portrait" onClick={() => setSheet(!sheet)} aria-label={t('sheet.open')}><Sprite ap={me.ap} job={me.job} scale={2} face /></button>
          <div className="vitals">
            <strong>{me.name}</strong> <span className="sub">{t('common.lv', { n: me.level })} {PATH_INDEX[hud.asc.path] && me.level >= ASCENSION_LEVEL ? PATH_INDEX[hud.asc.path].title : jobTitle(me.job, me.level)}</span>
            <div className="vbar hp" role="meter" aria-label={t('stat.hp')} aria-valuenow={hud.hp} aria-valuemax={s.maxHp}><i style={{ width: `${(hud.hp / s.maxHp) * 100}%` }} /><span>{hud.hp} / {s.maxHp}</span></div>
            <div className={'vbar ' + JOB_DEFS[me.job].resource} role="meter" aria-label={JOB_DEFS[me.job].resource === 'rage' ? t('stat.rage') : t('stat.mana')} aria-valuenow={hud.res} aria-valuemax={s.maxRes}><i style={{ width: `${(hud.res / s.maxRes) * 100}%` }} /><span>{hud.res} / {s.maxRes}</span></div>
            <div className="vbar exp" role="meter" aria-label={t('stat.exp')} aria-valuenow={hud.exp} aria-valuemax={hud.next}><i style={{ width: `${(hud.exp / hud.next) * 100}%` }} /><span>{t('stat.exp')} {hud.exp} / {hud.next}</span></div>
            <div className="sub">{hud.zone}{hud.dungeon ? '' : ` · ${t('hud.channel', { n: hud.channel })}`} · {t('common.lvRange', { a: hud.level[0], b: hud.level[1] })}</div>

          </div>
        </div>
      )}
      {hud.target && toTop('target', (() => {
        // the boss bar already shows the boss's name and health: the target frame then keeps only its statuses
        const isBoss = !!hud.boss && hud.boss.name === hud.target.name && hud.boss.level === hud.target.level;
        if (isBoss && !hud.attacking && !hud.target.statuses.length) return null;
        return (
          <div className={'hud target panel' + (hud.target.elite ? ' elite' : '') + (isBoss ? ' slim' : '')} role="status" aria-label={t('hud.target')}>
            {!isBoss && <div><strong>{hud.target.name}</strong> <span className="sub">{t('common.lv', { n: hud.target.level })}{hud.target.elite ? ` · ${t('hud.elite')}` : ''}{hud.target.player ? ` · ${t('hud.player')}` : ''}{hud.target.fierce ? ` · ${t('hud.fierce')}` : ''}</span></div>}
            {!isBoss && <div className="vbar hp"><i style={{ width: `${(hud.target.hp / hud.target.mhp) * 100}%` }} /><span>{hud.target.hp} / {hud.target.mhp}</span></div>}
            <div className="chips">{hud.attacking && <span className="chip atk">{t('hud.attacking')}</span>}{hud.target.statuses.map((n, i) => <span key={i} className="chip">{n}</span>)}</div>
          </div>
        );
      })())}
      {hud.ally && (
        <div className="hud allyframe panel" role="status" aria-label={t('hud.ally')}>
          <span className="sub">{t('hud.ally')}</span> <strong>{hud.ally.name}</strong>
          <div className="vbar hp"><i style={{ width: `${(hud.ally.hp / hud.ally.mhp) * 100}%` }} /><span>{hud.ally.hp} / {hud.ally.mhp}</span></div>
          {!hud.party?.members.some((m) => m.id === hud.ally!.id) && (!hud.party || hud.party.leader === me?.id) && (
            <button className="small" onClick={() => game.partyOp('invite', hud.ally!.id)}>{t('party.invite')}</button>
          )}
          {!hud.trade && <button className="small" onClick={() => game.tradeOp('invite', { id: hud.ally!.id })}>{t('trade.button')}</button>}
          {!hud.friends.some((f) => f.id === hud.ally!.id) && <button className="small" onClick={() => game.friendOp('add', { id: hud.ally!.id })}>{t('fr.addButton')}</button>}
          {!hud.duel && (hud.pvpZone === 'duel' || hud.pvpZone === 'open') && <button className="small" onClick={() => game.pvpOp('duel', { id: hud.ally!.id })}>{t('pvp.duelButton')}</button>}
          {hud.guild && hud.grank <= 1 && !hud.guild.members.some((m) => m.id === hud.ally!.id) && <button className="small" onClick={() => game.guildOp('invite', { id: hud.ally!.id })}>{t('guild.inviteButton')}</button>}
        </div>
      )}
      {hud.party && me && (
        <div className="hud partyframes" role="group" aria-label={t('party.label')}>
          {hud.party.members.filter((m) => m.id !== me.id).map((m) => (
            <div key={m.id} className={'pframe panel' + (m.on ? '' : ' off') + (m.hp <= 0 ? ' down' : '')}>
              <button className="pmain" onClick={() => game.selectAlly(m.id)} aria-label={t('party.select', { name: m.name })}>
                <span>{hud.party!.leader === m.id && <i className="lead" title={t('party.leader')}><Icon name="star" size={12} /> </i>}<strong>{m.name}</strong> <small>{t('common.lv', { n: m.level })} {JOB_DEFS[m.job].name}</small></span>
                <div className="vbar hp"><i style={{ width: `${(m.hp / m.mhp) * 100}%` }} /><span>{m.on ? (m.hp <= 0 ? t('party.fallen') : `${m.hp} / ${m.mhp}`) : t('party.disconnected')}</span></div>
                {m.zone !== hud.party!.members.find((x) => x.id === me.id)?.zone && <small className="sub">{t('party.elsewhere')}</small>}
              </button>
              {hud.party!.leader === me.id && (
                <span className="pctl">
                  <button className="small" onClick={() => game.partyOp('promote', m.id)} aria-label={t('party.makeLeader', { name: m.name })} title={t('party.makeLeaderTip')}><Icon name="star" size={14} /></button>
                  <button className="small" onClick={() => game.partyOp('kick', m.id)} aria-label={t('party.remove', { name: m.name })} title={t('party.removeTip')}><Icon name="close" size={14} /></button>
                </span>
              )}
            </div>
          ))}
          {hud.party.leader === me.id
            ? <select className="lootmode" aria-label={t('party.loot')} value={hud.party.loot} onChange={(e: any) => game.setLootMode(e.target.value as LootMode)}>{LOOT_MODES.map((m) => <option key={m} value={m}>{t(`loot.${m}` as Key)}</option>)}</select>
            : <small className="sub">{t(`loot.${hud.party.loot}` as Key)}</small>}
          <button className="small" onClick={() => game.partyOp('leave')}>{hud.party.leader === me.id ? '★ ' : ''}{t('party.leave')}</button>
        </div>
      )}
      {hud.invite && (
        <div className="hud inviteask panel" role="alertdialog" aria-label={t('party.inviteTitle')}>
          <p>{t('party.invited', { name: hud.invite.from })}</p>
          <div className="actions"><button onClick={() => game.partyOp('decline')}>{t('common.decline')}</button><button className="primary" onClick={() => game.partyOp('accept')}>{t('common.accept')}</button></div>
        </div>
      )}
      {me && s && hud.build && <Guard><Hotbar hud={hud} game={game} /></Guard>}
      {hud.cast && <div className="hud castbar" role="progressbar" aria-label={t('hud.casting', { name: hud.cast.name })}><i key={hud.cast.at} style={{ animationDuration: `${hud.cast.ms}ms` }} /><span>{hud.cast.name}</span></div>}
      {hud.notice && <div className="hud notice" role="alert">{tm(hud.notice)}</div>}
      {book && me && s && hud.build && <Win id="skills" title={'book.title'} onClose={() => setBook(false)}><Guard><SkillBook hud={hud} game={game} onClose={() => setBook(false)} /></Guard></Win>}
      {me && hud.points > 0 && !book && toDockTop(<button className="hud pointsbtn" onClick={() => setBook(true)}>{t(hud.points > 1 ? 'hud.points' : 'hud.point', { n: hud.points })} · {keyOf('panel.skills')}</button>)}
      {hud.toast && toTop('toast', <div className="hud toast" role="status">{tm(hud.toast)}</div>)}
      {hud.dead > 0 && hud.status === 'playing' && (
        <div className="hud fallen panel" role="alertdialog" aria-label={t('dead.title')}>
          <h2>{t('dead.title')}</h2>
          <p className="sub">{t('dead.text', { zone: hud.zone })}</p>
          <button className="primary" disabled={!hud.canRespawn} onClick={() => game.respawn()}>{t('dead.respawn')}</button>
          <p className="sub">{t('dead.auto', { n: hud.dead })}</p>
        </div>
      )}
      {toRail(<div className="hud stats">{t('hud.nearby', { n: hud.nearby })} · {hud.ping} ms · {hud.fps} fps <button className="small chipbtn" onClick={() => setKeysOpen(!keysOpen)} aria-expanded={keysOpen}><Icon name="settings" size={11} className="inl" /> {t('dock.controls')}</button></div>)}
      {keysOpen && <ControlsCard onClose={() => setKeysOpen(false)} />}
      {sheet && me && s && <Win id="character" title={'sheet.title'} onClose={() => setSheet(false)}><Guard><CharacterSheet hud={hud} onClose={() => setSheet(false)} /></Guard></Win>}
      {bag && me && s && <Win id="bag" title={'bag.title'} width={720} onClose={() => setBag(false)}><Guard><InventoryPanel hud={hud} game={game} onClose={() => setBag(false)} /></Guard></Win>}
      {(auto || hud.auto.on) && me && s && <Guard><AutoPanel hud={hud} game={game} onClose={() => setAuto(false)} /></Guard>}
      {me && <Guard><TradePanel hud={hud} game={game} /></Guard>}
      <Guard><TradeInvite hud={hud} game={game} /></Guard>
      <Guard><GuildInvite hud={hud} game={game} /></Guard>
      <Guard><DuelInvite hud={hud} game={game} /></Guard>
      <Guard><DepthAsk hud={hud} game={game} /></Guard>
      <Guard><DuelStatus hud={hud} game={game} /></Guard>
      <Guard><MatchBar hud={hud} game={game} /></Guard>
      <Guard><MatchReady hud={hud} game={game} /></Guard>
      <TipLayer />
      <Guard><TouchControls hud={hud} game={game} /></Guard>
      <Guard><CtxMenu hud={hud} game={game} whisper={(name) => { const el = input.current; if (el) { el.value = `/w ${name} `; el.dispatchEvent(new Event('input', { bubbles: true })); setTimeout(() => el.focus(), 0); } }} /></Guard>
      <Guard><PvpZoneBadge hud={hud} game={game} /></Guard>
      <Guard><TraitBadge hud={hud} /></Guard>
      <Guard><StatusBar hud={hud} /></Guard>
      <Guard><LootFeed hud={hud} /></Guard>
      <Guard><BossBar hud={hud} /></Guard>
      <Guard><Banner hud={hud} /></Guard>
      <Guard><DungeonTracker hud={hud} game={game} /></Guard>
      {me && <Guard><GateDialog hud={hud} game={game} /></Guard>}
      {me && <Guard><ReadyCheck hud={hud} game={game} /></Guard>}
      {me && <Guard><WorldEventTracker hud={hud} /></Guard>}
      <Guard><InteractHint hud={hud} /></Guard>
      {me && <Guard><NpcDialog hud={hud} game={game} openBag={() => setBag(true)} /></Guard>}
      <Guard><ChatBox hud={hud} game={game} input={input} /></Guard>
      {hud.status !== 'playing' && (
        <div className="overlay">
          <div className="panel">
            {hud.status === 'kicked' ? (<><p>{t('net.kicked', { why: tm(hud.reason) })}</p><button className="primary" onClick={onExit}>{t('net.back')}</button></>)
              : <p>{hud.status === 'connecting' ? t('net.connecting') : t('net.reconnecting')}</p>}
          </div>
        </div>
      )}
    </>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('aetherion.token') ?? '');
  const [character, setCharacter] = useState(null as Character | null);
  const auth = (t: string) => {
    localStorage.setItem('aetherion.token', t);
    setToken(t);
  };
  const logout = () => {
    if (token) api('/api/logout', token, {}).catch(() => {});
    localStorage.removeItem('aetherion.token');
    setToken('');
    setCharacter(null);
  };
  // the account's saved audio settings follow the player; signing out keeps this browser's copy
  useEffect(() => {
    void audio.setAccount(token);
    void settings.setAccount(token);
  }, [token]);
  // outside the world (sign-in, character select, creator) the menu theme plays
  useEffect(() => {
    if (!character) sound.menu();
  }, [character]);
  return (
    <>
      {!character && <TitleBackdrop />}
      {!token ? <Auth onAuth={auth} />
        : !character ? <Characters token={token} onPlay={setCharacter} onLogout={logout} />
          : <Play token={token} character={character} onExit={() => setCharacter(null)} />}
      {!character && <MenuSettings signedIn={!!token} />}
      <AudioPrompt />
    </>
  );
}

// Debug/test hook for the asset pipeline checks (tests/browser.smoke.ts).
(window as any).__art = { iconManifest, iconCanvas, skillIcon, statusIcon, attackIcon, runeIcon, renderSheet, LAYERS, defaultAppearance, randomAppearance, getMonsterSheet, MONSTER_TYPES, monsterScale, propSprite, PROP_KINDS, imported, getHDSheet, itemIcon, hdPetSprite, hdMountSprite };

// Audio: the manifest loads in the background; sound itself waits for the first user interaction.
(window as any).__audio = audio;
(window as any).__settings = settings;
(window as any).__sound = sound;
void audio.init();
// try to start the music at once: browsers that allow it (a site visited often) play the title theme
// straight away; the others wait for the first click or key, as before
try { audio.unlock(); } catch { /* audio waits for a gesture */ }
installUiSounds();

// Imported sheets (if the build shipped any) are in place before the first sprite is drawn.
loadImportedAssets().finally(() => createRoot(document.getElementById('root')!).render(<App />));

/** The menu dock, following the game's state. */
function DockView({ game, open, act }: { game: Game; open: Parameters<typeof Dock>[0]['open']; act: Parameters<typeof Dock>[0]['act'] }) {
  const hud = useSyncExternalStore(game.subscribe, game.getHud);
  if (!hud.self) return null;
  return <Dock hud={hud} open={{ ...open, auto: open.auto || hud.auto.on }} act={act} />;
}

/** The guild (N) and companions (P) panels (opened from the menu dock or their keys). */
function SocialPanels({ game, guild, setGuild, comps, setComps }: { game: Game; guild: boolean; setGuild: (b: boolean) => void; comps: boolean; setComps: (b: boolean) => void }) {
  const hud = useSyncExternalStore(game.subscribe, game.getHud);
  useT();
  if (!hud.self) return null;
  return (
    <>
      {guild && <Win id="guild" title={'guild.title'} onClose={() => setGuild(false)}><GuildPanel hud={hud} game={game} onClose={() => setGuild(false)} /></Win>}
      {comps && <Win id="companions" title={'comp.title'} onClose={() => setComps(false)}><CompanionsPanel hud={hud} game={game} onClose={() => setComps(false)} /></Win>}
    </>
  );
}

/** The two enhancement branches of an active skill, each learned with skill points (up to 3 ranks). */
function SubSkills({ hud, game, parent }: { hud: Hud; game: Game; parent: string }) {
  const me = hud.self!, b = hud.build!;
  return (
    <div className="subskills" role="group" aria-label={t('sub.group', { name: ABILITIES[parent].name })}>
      {subsOf(parent).map((sb) => {
        const r = b.skills[sb.id] ?? 0, why = learnBlock(me.job, me.level, b, sb.id);
        return (
          <div key={sb.id} className={'node row2 sub' + (r ? ' on' : '')}>
            <span className="subicon" aria-hidden="true"><Icon name={SUB_GLYPH[sb.mod.k] ?? 'skills'} size={18} /></span>
            <div className="grow">
              <b>{sb.name}</b> <small>{t('book.rank', { r, m: sb.maxRank })}</small>
              <div>{r ? t('sub.now', { e: subText(sb, r) }) : ''}{r && r < sb.maxRank ? ' · ' : ''}{r < sb.maxRank ? t('sub.next', { e: subText(sb, r + 1) }) : ''}</div>
            </div>
            <button className="small" disabled={!!why} title={why ? tm(why) : t('book.spend')} aria-label={t('book.learnName', { name: sb.name })} onClick={() => game.learn(sb.id)}>{r ? t('book.addRank') : t('book.learn')}</button>
          </div>
        );
      })}
    </div>
  );
}
const SUB_GLYPH: Record<string, IconName> = { dmg: 'sword', cd: 'clock', cost: 'gem', area: 'target', dur: 'hourglass', crit: 'burst', heal: 'heal', range: 'bow', cast: 'bolt', targets: 'fork', apply: 'drop' };
/** What a sub-skill does at a rank, in the player's language. */
function subText(sb: SubSkillDef, rank: number): string {
  const m = sb.mod;
  if (m.k === 'apply') return t('sub.apply', { n: Math.min(100, m.chance * rank), status: tv(STATUS.find((x) => x.id === m.status)?.name ?? m.status) });
  const n = 'pct' in m ? Math.round(m.pct * rank * 100) : m.add * rank;
  return t(`sub.${m.k}` as Key, { n });
}

/** A class progression bonus in words: "+8% HP, +10% Defense". */
const TIER_STAT: Partial<Record<StatKey, Key>> = {
  maxHp: 'stat.hp', maxRes: 'tier.res', atk: 'stat.atk', matk: 'stat.matk', def: 'stat.def', mdef: 'stat.mdef', crit: 'stat.crit', critDmg: 'stat.critDmg',
  moveMul: 'stat.speed', atkIntervalMs: 'stat.atkTime', range: 'stat.range', lifesteal: 'stat.lifesteal', healPower: 'tier.heal', runeCost: 'tier.runeCost', dodge: 'tier.dodge',
};
function tierText(b: TierBonus): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(b.mul ?? {})) {
    const p = Math.round((v! - 1) * 100);
    out.push(`${p > 0 ? '+' : ''}${p}% ${t(TIER_STAT[k as StatKey] ?? ('stat.hp' as Key))}`);
  }
  for (const [k, v] of Object.entries(b.add ?? {})) {
    const pct = k === 'critDmg' ? Math.round(v! * 100) : v!;
    out.push(`+${pct}${k === 'range' ? '' : '%'} ${t(TIER_STAT[k as StatKey] ?? ('stat.hp' as Key))}`);
  }
  return out.join(', ');
}

// U3: installable app. The service worker only serves an offline page; the game always loads fresh.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext)
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
