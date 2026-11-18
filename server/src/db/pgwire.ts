// Minimal PostgreSQL wire-protocol client (extended query protocol, SCRAM-SHA-256 auth, pooling).
// Exists because no Postgres driver / Prisma engine is installable in the build sandbox.
// The rest of the server only depends on the `Db` interface, so swapping in Prisma or `pg`
// later touches only this file and repo.ts.
import net from 'node:net';
import crypto from 'node:crypto';

export interface QueryResult<R = any> {
  rows: R[];
  rowCount: number;
}
export type Queryer = <R = any>(text: string, params?: unknown[]) => Promise<QueryResult<R>>;
export interface Db {
  query: Queryer;
  tx<T>(fn: (q: Queryer) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export class PgError extends Error {
  code = '';
  detail?: string;
  constraint?: string;
}

interface Job {
  text: string;
  params?: unknown[];
  simple: boolean;
  resolve: (r: QueryResult) => void;
  reject: (e: Error) => void;
  fields: { name: string; oid: number }[];
  rows: any[];
  rowCount: number;
  err: PgError | null;
}

interface ConnOpts {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function parseDbUrl(url: string): ConnOpts {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
  };
}

function msg(type: string, body: Buffer): Buffer {
  const b = Buffer.allocUnsafe(5 + body.length);
  b.write(type, 0, 'latin1');
  b.writeInt32BE(body.length + 4, 1);
  body.copy(b, 5);
  return b;
}
const cstr = (s: string) => Buffer.from(s + '\0', 'utf8');

function encodeParam(v: unknown): Buffer | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return Buffer.from(v ? 'true' : 'false');
  if (v instanceof Date) return Buffer.from(v.toISOString());
  if (typeof v === 'object') return Buffer.from(JSON.stringify(v));
  return Buffer.from(String(v));
}

function decode(oid: number, s: string): unknown {
  switch (oid) {
    case 16: return s === 't';
    case 20: case 21: case 23: case 26: case 700: case 701: case 1700: return Number(s);
    case 114: case 3802: return JSON.parse(s);
    case 1114: case 1184: return new Date(s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
    default: return s;
  }
}

class PgConn {
  private sock!: net.Socket;
  private buf: Buffer = Buffer.alloc(0);
  private queue: Job[] = [];
  private cur: Job | null = null;
  dead = false;
  private startup!: { resolve: () => void; reject: (e: Error) => void };
  private scram: { nonce: string; bare: string; serverSig?: Buffer } | null = null;
  private authed = false;

  constructor(private o: ConnOpts) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.startup = { resolve, reject };
      this.sock = net.connect(this.o.port, this.o.host);
      this.sock.setNoDelay(true);
      this.sock.on('connect', () => {
        const body = Buffer.concat([
          Buffer.from([0, 3, 0, 0]),
          cstr('user'), cstr(this.o.user), cstr('database'), cstr(this.o.database),
          cstr('client_encoding'), cstr('UTF8'), Buffer.from([0]),
        ]);
        const len = Buffer.allocUnsafe(4);
        len.writeInt32BE(body.length + 4);
        this.sock.write(Buffer.concat([len, body]));
      });
      this.sock.on('data', (d: Buffer) => this.onData(d));
      const fail = (e?: Error) => {
        if (this.dead) return;
        this.dead = true;
        const err = e ?? new Error('postgres connection closed');
        if (!this.authed) reject(err);
        if (this.cur) this.cur.reject(err);
        for (const j of this.queue) j.reject(err);
        this.cur = null;
        this.queue = [];
      };
      this.sock.on('error', fail);
      this.sock.on('close', () => fail());
    });
  }

  private onData(d: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    let off = 0;
    while (this.buf.length - off >= 5) {
      const len = this.buf.readInt32BE(off + 1);
      if (this.buf.length - off < len + 1) break;
      this.onMsg(this.buf[off], this.buf.subarray(off + 5, off + 1 + len));
      off += len + 1;
    }
    this.buf = off === this.buf.length ? Buffer.alloc(0) : this.buf.subarray(off);
  }

  private onMsg(type: number, b: Buffer) {
    switch (String.fromCharCode(type)) {
      case 'R': return this.onAuth(b);
      case 'Z':
        if (!this.authed) {
          this.authed = true;
          this.startup.resolve();
        } else if (this.cur) {
          const j = this.cur;
          this.cur = null;
          if (j.err) j.reject(j.err);
          else j.resolve({ rows: j.rows, rowCount: j.rowCount });
        }
        return this.pump();
      case 'T': {
        const j = this.cur!;
        const n = b.readInt16BE(0);
        let p = 2;
        j.fields = [];
        j.rows = [];
        for (let i = 0; i < n; i++) {
          const e = b.indexOf(0, p);
          const name = b.toString('utf8', p, e);
          j.fields.push({ name, oid: b.readInt32BE(e + 7) });
          p = e + 19;
        }
        return;
      }
      case 'D': {
        const j = this.cur!;
        const n = b.readInt16BE(0);
        let p = 2;
        const row: any = {};
        for (let i = 0; i < n; i++) {
          const len = b.readInt32BE(p);
          p += 4;
          if (len < 0) row[j.fields[i].name] = null;
          else {
            row[j.fields[i].name] = decode(j.fields[i].oid, b.toString('utf8', p, p + len));
            p += len;
          }
        }
        j.rows.push(row);
        return;
      }
      case 'C': {
        const tag = b.toString('utf8', 0, b.length - 1).split(' ');
        const n = Number(tag[tag.length - 1]);
        if (this.cur) this.cur.rowCount = Number.isFinite(n) ? n : 0;
        return;
      }
      case 'E': {
        const err = new PgError('postgres error');
        let p = 0;
        while (b[p] !== 0) {
          const code = String.fromCharCode(b[p]);
          const e = b.indexOf(0, p + 1);
          const val = b.toString('utf8', p + 1, e);
          if (code === 'M') err.message = val;
          else if (code === 'C') err.code = val;
          else if (code === 'D') err.detail = val;
          else if (code === 'n') err.constraint = val;
          p = e + 1;
        }
        if (!this.authed) {
          this.startup.reject(err);
          this.sock.destroy();
        } else if (this.cur) this.cur.err = err;
        return;
      }
      default: return; // ParseComplete, BindComplete, NoData, ParameterStatus, Notice, BackendKeyData...
    }
  }

  private onAuth(b: Buffer) {
    const code = b.readInt32BE(0);
    if (code === 0) return;
    if (code === 3) {
      this.sock.write(msg('p', cstr(this.o.password)));
    } else if (code === 10) {
      const nonce = crypto.randomBytes(18).toString('base64');
      const bare = `n=,r=${nonce}`;
      this.scram = { nonce, bare };
      const first = Buffer.from('n,,' + bare);
      const len = Buffer.allocUnsafe(4);
      len.writeInt32BE(first.length);
      this.sock.write(msg('p', Buffer.concat([cstr('SCRAM-SHA-256'), len, first])));
    } else if (code === 11 && this.scram) {
      const serverFirst = b.toString('utf8', 4);
      const kv = Object.fromEntries(serverFirst.split(',').map((s) => [s[0], s.slice(2)]));
      if (!kv.r.startsWith(this.scram.nonce)) throw new Error('scram: bad server nonce');
      const salted = crypto.pbkdf2Sync(this.o.password.normalize('NFKC'), Buffer.from(kv.s, 'base64'), Number(kv.i), 32, 'sha256');
      const hmac = (k: Buffer, d: string) => crypto.createHmac('sha256', k).update(d).digest();
      const clientKey = hmac(salted, 'Client Key');
      const storedKey = crypto.createHash('sha256').update(clientKey).digest();
      const noProof = `c=biws,r=${kv.r}`;
      const authMsg = `${this.scram.bare},${serverFirst},${noProof}`;
      const sig = hmac(storedKey, authMsg);
      const proof = Buffer.alloc(32);
      for (let i = 0; i < 32; i++) proof[i] = clientKey[i] ^ sig[i];
      this.scram.serverSig = hmac(hmac(salted, 'Server Key'), authMsg);
      this.sock.write(msg('p', Buffer.from(`${noProof},p=${proof.toString('base64')}`)));
    } else if (code === 12 && this.scram) {
      const v = b.toString('utf8', 4).slice(2);
      if (v !== this.scram.serverSig!.toString('base64')) {
        this.startup.reject(new Error('scram: server signature mismatch'));
        this.sock.destroy();
      }
    } else {
      this.startup.reject(new Error('unsupported postgres auth method ' + code));
      this.sock.destroy();
    }
  }

  private pump() {
    if (this.cur || !this.queue.length || this.dead) return;
    const j = (this.cur = this.queue.shift()!);
    if (j.simple) {
      this.sock.write(msg('Q', cstr(j.text)));
      return;
    }
    const params = (j.params ?? []).map(encodeParam);
    const parts: Buffer[] = [Buffer.from([0, 0, 0, 0])]; // portal "", stmt "", 0 format codes
    const n = Buffer.allocUnsafe(2);
    n.writeInt16BE(params.length);
    parts.push(n);
    for (const p of params) {
      const l = Buffer.allocUnsafe(4);
      l.writeInt32BE(p ? p.length : -1);
      parts.push(l);
      if (p) parts.push(p);
    }
    parts.push(Buffer.from([0, 0]));
    this.sock.write(
      Buffer.concat([
        msg('P', Buffer.concat([Buffer.from([0]), cstr(j.text), Buffer.from([0, 0])])),
        msg('B', Buffer.concat(parts)),
        msg('D', Buffer.from([0x50, 0])),
        msg('E', Buffer.from([0, 0, 0, 0, 0])),
        msg('S', Buffer.alloc(0)),
      ]),
    );
  }

  run(text: string, params: unknown[] | undefined, simple: boolean): Promise<QueryResult> {
    return new Promise((resolve, reject) => {
      if (this.dead) return reject(new Error('postgres connection closed'));
      this.queue.push({ text, params, simple, resolve, reject, fields: [], rows: [], rowCount: 0, err: null });
      this.pump();
    });
  }
  end() {
    this.dead = true;
    this.sock.destroy();
  }
}

export class PgPool implements Db {
  private idle: PgConn[] = [];
  private total = 0;
  private waiters: ((c: PgConn) => void)[] = [];
  private closed = false;
  constructor(private opts: ConnOpts, private size = 6) {}

  private async acquire(): Promise<PgConn> {
    for (;;) {
      const c = this.idle.pop();
      if (!c) break;
      if (!c.dead) return c;
      this.total--;
    }
    if (this.total < this.size) {
      this.total++;
      const c = new PgConn(this.opts);
      try {
        await c.connect();
      } catch (e) {
        this.total--;
        throw e;
      }
      return c;
    }
    return new Promise((r) => this.waiters.push(r));
  }
  private release(c: PgConn) {
    if (c.dead || this.closed) {
      this.total--;
      c.end();
      // A waiter may be starved by a dead connection; let it open a fresh one.
      const w = this.waiters.shift();
      if (w && !this.closed) this.acquire().then(w, () => {});
      return;
    }
    const w = this.waiters.shift();
    if (w) w(c);
    else this.idle.push(c);
  }

  query: Queryer = async (text, params) => {
    const c = await this.acquire();
    try {
      return await c.run(text, params, false);
    } finally {
      this.release(c);
    }
  };
  async tx<T>(fn: (q: Queryer) => Promise<T>): Promise<T> {
    const c = await this.acquire();
    try {
      await c.run('BEGIN', undefined, true);
      try {
        const out = await fn((t, p) => c.run(t, p, false));
        await c.run('COMMIT', undefined, true);
        return out;
      } catch (e) {
        if (!c.dead) await c.run('ROLLBACK', undefined, true).catch(() => {});
        throw e;
      }
    } finally {
      this.release(c);
    }
  }
  async exec(sql: string) {
    const c = await this.acquire();
    try {
      await c.run(sql, undefined, true);
    } finally {
      this.release(c);
    }
  }
  async close() {
    this.closed = true;
    for (const c of this.idle) c.end();
    this.idle = [];
  }
}
