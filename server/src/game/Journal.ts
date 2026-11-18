// The adventurer's journal on the server: counts what the character does (only events the server
// resolved), grants achievements and titles, fills the monster codex, keeps the daily and weekly
// missions and the login streak, and pays their rewards.
import { SEASON_GAIN } from '../../../shared/src/life';
import { INVENTORY_SIZE, ITEMS } from '../../../shared/src/items';
import {
  ACHIEVEMENT_INDEX, cleanJournal, codexNeed, completedSets, loginGold, LOGIN_REWARDS, MAX_COUNTERS, MISSIONS, missionReward, newAchievements, rollJournal,
  type Counter, type Journal, type MissionKind,
} from '../../../shared/src/journal';
import { award } from './Inventory';
import type { Monster } from './Monster';
import type { Player, World } from './World';

export class Journals {
  constructor(private w: World) {}

  load(p: Player, raw: unknown) {
    p.journal = cleanJournal(raw);
    // achievements reached before the journal existed (level, armament) are recognised on the first login
    this.best(p, 'level', p.level, false);
    this.best(p, 'arm', Math.max(0, ...Object.values(p.gear.arm).map((v) => v ?? 0)), false);
    this.best(p, 'codex', completedSets(p.journal).length, false);
    rollJournal(p.journal, Date.now());
    this.check(p, false);
    p.progDirty = true;
  }
  send(p: Player) {
    this.w.send(p, { t: 'journal', j: p.journal });
  }
  /** Marks the journal changed: saved with the rest of the progress, sent to the client at most once a second. */
  touch(p: Player) {
    p.progDirty = true;
    p.journalDirty = true;
  }
  /** Once a second: day and week roll-over, and pending updates to clients. */
  tick(now: number) {
    for (const p of this.w.online.values()) {
      if (rollJournal(p.journal, now)) this.touch(p);
      if (p.journalDirty) {
        p.journalDirty = false;
        this.send(p);
      }
    }
  }

  // ---------- counting ----------
  add(p: Player, c: Counter, n = 1) {
    if (n <= 0) return;
    if (c in SEASON_GAIN) this.w.life.season(p, c as keyof typeof SEASON_GAIN, n);
    p.journal.c[c] = (p.journal.c[c] ?? 0) + n;
    this.touch(p);
    this.check(p);
  }
  /** Counters that keep the best value reached. */
  best(p: Player, c: Counter, v: number, announce = true) {
    if (!MAX_COUNTERS.includes(c) || v <= (p.journal.c[c] ?? 0)) return;
    p.journal.c[c] = v;
    this.touch(p);
    this.check(p, announce);
  }
  private mission(p: Player, kind: MissionKind, n = 1) {
    for (const period of [p.journal.d, p.journal.w])
      for (const m of period.m) {
        const def = MISSIONS[m[0]];
        if (def.kind === kind && m[1] < def.n) {
          m[1] = Math.min(def.n, m[1] + n);
          this.touch(p);
          if (m[1] === def.n) this.w.send(p, { t: 'sys', text: `Mission complete: ${def.name}. Claim it in the journal.`, cue: 'quest' });
        }
      }
  }
  /** New achievements: recorded, announced, and the stats recomputed when a title might matter. */
  private check(p: Player, announce = true) {
    const got = newAchievements(p.journal);
    if (!got.length) return;
    for (const a of got) {
      p.journal.a.push(a.id);
      if (announce) {
        this.w.send(p, { t: 'sys', text: a.title ? `Achievement: ${a.name}. New title: ${a.title.name}.` : `Achievement: ${a.name}.`, cue: 'rep' });
        if (a.title) this.w.announce(p.room, `${p.name} earned the title "${a.title.name}"!`, 'loot');
      }
    }
    this.touch(p);
  }

  // ---------- events ----------
  onKill(p: Player, m: Monster) {
    if (m.summoner) return;
    const id = m.def.id, before = p.journal.k[id] ?? 0;
    p.journal.k[id] = before + 1;
    this.add(p, 'kill');
    this.mission(p, 'kill');
    if (m.def.elite && !m.def.boss) {
      this.add(p, 'elite');
      this.mission(p, 'elite');
    }
    if (before + 1 === codexNeed(id)) {
      this.w.send(p, { t: 'sys', text: `Codex: ${m.def.name} recorded.`, cue: 'quest' });
      const sets = completedSets(p.journal).length;
      if (sets > (p.journal.c.codex ?? 0)) {
        this.w.send(p, { t: 'sys', text: 'A region of the codex is complete: its lasting bonus is yours.', cue: 'rep' });
        this.best(p, 'codex', sets);
        p.recalc();
      }
    }
  }
  onBoss(p: Player, world: boolean) {
    this.add(p, world ? 'wboss' : 'boss');
    this.mission(p, world ? 'wboss' : 'boss');
  }
  onClear(p: Player, diff: string) {
    this.add(p, 'dungeon');
    if (diff === 'armageddon') this.add(p, 'armageddon');
    this.mission(p, 'dungeon');
  }
  onQuest(p: Player) {
    this.add(p, 'quest');
    this.mission(p, 'quest');
  }
  onGather(p: Player) {
    this.add(p, 'gather');
    this.mission(p, 'gather');
  }

  // ---------- commands ----------
  /** `{op:'title', id}`, `{op:'claim', kind:'daily'|'weekly', i}`, `{op:'login'}`. Returns '' or the reason. */
  op(p: Player, m: any): string {
    if (!m || typeof m !== 'object') return 'Unknown command';
    rollJournal(p.journal, Date.now());
    switch (m.op) {
      case 'title': {
        const id = typeof m.id === 'string' ? m.id : '';
        if (id && (!p.journal.a.includes(id) || !ACHIEVEMENT_INDEX[id]?.title)) return 'You have not earned that title';
        p.journal.ti = id;
        this.touch(p);
        p.recalc();
        p.dirty = true;
        this.w.relook(p);
        return '';
      }
      case 'claim': {
        const period = m.kind === 'weekly' ? p.journal.w : p.journal.d, e = Number.isInteger(m.i) ? period.m[m.i] : undefined;
        if (!e) return 'Unknown mission';
        if (e[2]) return 'Already claimed';
        if (e[1] < MISSIONS[e[0]].n) return 'That mission is not complete yet';
        const r = missionReward(m.kind === 'weekly' ? 'weekly' : 'daily', p.level);
        if (INVENTORY_SIZE - p.inv.length < r.items.length) return 'Make room in your bag first';
        e[2] = true;
        award(this.w, p, r.gold, r.items);
        this.w.grantExp(p, r.exp);
        this.add(p, 'mission');
        const what = r.items.map((i) => `${ITEMS[i.base].name} x${i.qty}`).join(', ');
        this.w.send(p, { t: 'sys', text: `Mission reward: ${r.gold} gold, ${r.exp} EXP and ${what}.` });
        return '';
      }
      case 'login': {
        if (p.journal.l.claimed) return 'Already claimed today';
        const day = Math.max(1, p.journal.l.streak) - 1, rw = LOGIN_REWARDS[day];
        if (INVENTORY_SIZE - p.inv.length < rw.items.length) return 'Make room in your bag first';
        p.journal.l.claimed = true;
        const gold = loginGold(day, p.level);
        award(this.w, p, gold, rw.items.map(([base, qty]) => ({ base, rar: 0, ilvl: 1, aff: [], up: 0, qty })));
        this.touch(p);
        const what = rw.items.map(([b, q]) => `${ITEMS[b].name} x${q}`).join(', ');
        this.w.send(p, { t: 'sys', text: `Day ${day + 1} login reward: ${gold} gold and ${what}.` });
        return '';
      }
      default:
        return 'Unknown command';
    }
  }
}
export type { Journal };
