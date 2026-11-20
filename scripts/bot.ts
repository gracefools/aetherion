// Headless protocol client used by integration tests and the load generator.
import type { DungeonState } from '../shared/src/dungeons';
import type { Equipment, Item } from '../shared/src/items';
import WebSocket from 'ws';
import type { EntityMeta, Job, PartyState, SelfState, ServerMsg, WelcomeMsg } from '../shared/src/protocol';
import { defaultAppearance, type Appearance } from '../shared/src/appearance';
import type { Build } from '../shared/src/abilities';

export async function http(base: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Bot {
  ws: WebSocket | null = null;
  welcome: WelcomeMsg | null = null;
  welcomes = 0;
  x = 0;
  y = 0;
  ack = 0;
  seq = 0;
  snaps = 0;
  bytesIn = 0;
  /** T3: bytes read off the wire (after permessage-deflate compression), including frame headers. */
  get wireIn(): number {
    return (this.ws as any)?._socket?.bytesRead ?? 0;
  }
  remotes = new Map<number, EntityMeta & { m?: number }>();
  events: number[][] = [];
  dmg: [number, number, number, number][] = [];
  me: SelfState | null = null;
  level = 0;
  xp = 0;
  build: Build | null = null;
  inv: Item[] = [];
  eq: Equipment = {};
  gold = 0;
  anns: string[] = [];
  disc: string[] = [];
  nodes: [string, number][] = [];
  dungeon: DungeonState | null = null;
  /** The last dungeon ready check (id '' once it ended). */
  ready: { id: string; diff: string; from: string } | null = null;
  zone = '';
  loots: { gold: number; items: { base: string; rar: number; qty: number }[] }[] = [];
  nos: { a: string; why: string }[] = [];
  chats: { from?: string; text: string; ch?: string; to?: string }[] = [];
  party: PartyState | null = null;
  invites: { from: string; id: number }[] = [];
  kicked: string | null = null;
  closed = false;
  private waiters: (() => void)[] = [];

  constructor(readonly base: string, public token: string, readonly characterId: number, readonly name: string) {}

  /** Registers an account and one character, returns a bot ready to connect. */
  static async create(base: string, username: string, charName: string, job: Job = 'knight', appearance: Appearance = defaultAppearance(job)): Promise<Bot> {
    let r = await http(base, '/api/register', { username, password: 'bot-password-1' });
    if (r.status === 409) r = await http(base, '/api/login', { username, password: 'bot-password-1' });
    if (r.status !== 200) throw new Error(`auth failed for ${username}: ${r.status} ${JSON.stringify(r.body)}`);
    const token = r.body.token as string;
    const list = await http(base, '/api/characters', undefined, token);
    let ch = list.body.characters.find((c: any) => c.name === charName);
    if (!ch) {
      const c = await http(base, '/api/characters', { name: charName, job, appearance }, token);
      if (c.status !== 200) throw new Error(`character create failed: ${c.status} ${JSON.stringify(c.body)}`);
      ch = c.body.character;
    }
    return new Bot(base, token, ch.id, charName);
  }

  /** Opens the socket and resolves once the server has sent `welcome` (or rejects on kick/close). */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(this.base.replace('http', 'ws') + '/ws'));
      this.closed = false;
      this.kicked = null;
      this.seq = 0;
      this.remotes.clear();
      const before = this.welcomes;
      ws.on('open', () => ws.send(JSON.stringify({ t: 'join', token: this.token, characterId: this.characterId })));
      ws.on('message', (d) => {
        this.bytesIn += d.length;
        this.onMsg(JSON.parse(d.toString()) as ServerMsg);
        if (this.welcomes > before) resolve();
      });
      ws.on('close', () => {
        this.closed = true;
        this.notify();
        reject(new Error('closed: ' + (this.kicked ?? 'no reason')));
      });
      ws.on('error', () => {});
    });
  }
  private onMsg(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.welcome = m;
        this.build = m.build;
        this.zone = m.zone;
        this.disc = m.disc;
        this.inv = m.inv; this.eq = m.eq; this.gold = m.gold;
        this.level = m.self.level;
        this.welcomes++;
        this.x = m.x;
        this.y = m.y;
        this.remotes.clear();
        break;
      case 'snap':
        this.snaps++;
        this.x = m.x;
        this.y = m.y;
        this.ack = m.a;
        if (m.rm) for (const id of m.rm) this.remotes.delete(id);
        if (m.add) for (const e of m.add) this.remotes.set(e.id, e);
        if (m.mv)
          for (const [id, x, y, d, mv] of m.mv) {
            const r = this.remotes.get(id);
            if (r) (r.x = x), (r.y = y), (r.d = d), (r.m = mv);
          }
        if (m.ev) this.events.push(...m.ev);
        if (m.dm) this.dmg.push(...m.dm);
        if (m.hp)
          for (const [id, hp, mhp, st] of m.hp) {
            const r = this.remotes.get(id);
            if (r) (r.hp = hp), (r.mhp = mhp), (r.st = st);
          }
        if (m.me) {
          this.me = m.me;
          this.xp += m.me.xp ?? 0;
        }
        break;
      case 'stats': this.level = m.level; break;
      case 'build': this.build = m.build; break;
      case 'inv': this.inv = m.inv; this.eq = m.eq; this.gold = m.gold; break;
      case 'loot': this.loots.push(m); break;
      case 'ann': this.anns.push(m.text); break;
      case 'disc': this.disc = m.list; break;
      case 'nodes': this.nodes.push(...m.cd); break;
      case 'dng': this.dungeon = m.run; break;
      case 'dready': this.ready = m.id ? { id: m.id, diff: m.diff, from: m.from } : null; break;
      case 'no': this.nos.push({ a: m.a, why: m.why }); break;
      case 'chat': this.chats.push({ from: m.from, text: m.text, ch: m.ch, to: m.to }); break;
      case 'party': this.party = m.party; break;
      case 'pinv': this.invites.push({ from: m.from, id: m.id }); break;
      case 'sys': this.chats.push({ text: m.text }); break;
      case 'kick': this.kicked = m.reason; break;
    }
    this.notify();
  }
  private notify() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }
  /** Resolves when `cond` holds; rejects after `ms`. Re-checked on every inbound message. */
  async until(cond: () => boolean, ms = 3000, what = 'condition'): Promise<void> {
    const deadline = Date.now() + ms;
    while (!cond()) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout waiting for ${what}`);
      await Promise.race([new Promise<void>((r) => this.waiters.push(r)), sleep(Math.min(left, 50))]);
    }
  }
  raw(m: object) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  input(ix: number, iy: number, run = 1) {
    this.raw({ t: 'in', s: ++this.seq, x: ix, y: iy, r: run });
  }
  /** Sends `steps` inputs paced at the simulation rate. */
  async walk(ix: number, iy: number, steps: number, run = 1) {
    for (let i = 0; i < steps; i++) {
      this.input(ix, iy, run);
      await sleep(50);
    }
    const s = this.seq;
    await this.until(() => this.ack >= s, 3000, 'input ack');
  }
  close() {
    this.ws?.close();
  }
}
