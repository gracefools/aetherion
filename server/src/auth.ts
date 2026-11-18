import crypto from 'node:crypto';
import type { Redis } from './cache/resp';
import type { Repo } from './db/repo';

const N = 16384, R = 8, P = 1, KEYLEN = 32;

export function hashPassword(pw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(pw, salt, KEYLEN, { N, r: R, p: P }, (e, key) =>
      e ? reject(e) : resolve(`scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`),
    );
  });
}
export function verifyPassword(pw: string, stored: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [alg, n, r, p, salt, hash] = stored.split('$');
    if (alg !== 'scrypt' || !hash) return resolve(false);
    const want = Buffer.from(hash, 'base64');
    crypto.scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: +n, r: +r, p: +p }, (e, key) =>
      resolve(!e && crypto.timingSafeEqual(key, want)),
    );
  });
}
// Burned on unknown usernames so login timing does not reveal whether an account exists.
const DUMMY = hashPassword('aetherion-dummy');

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export class Sessions {
  constructor(private repo: Repo, private redis: Redis, private ttl: number) {}
  async create(accountId: number): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    const h = sha(token);
    await this.repo.createSession(h, accountId, this.ttl);
    this.redis.cmd('SET', 'sess:' + h, accountId, 'EX', 300).catch(() => {});
    return token;
  }
  /** Redis is a read-through cache; Postgres is the source of truth. */
  async resolve(token: unknown): Promise<number | undefined> {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return undefined;
    const h = sha(token);
    const hit = await this.redis.cmd('GET', 'sess:' + h).catch(() => null);
    if (hit) return Number(hit);
    const id = await this.repo.findSession(h);
    if (id) this.redis.cmd('SET', 'sess:' + h, id, 'EX', 300).catch(() => {});
    return id;
  }
  async destroy(token: string) {
    const h = sha(token);
    await this.repo.deleteSession(h);
    await this.redis.cmd('DEL', 'sess:' + h).catch(() => {});
  }
  async verifyLogin(stored: string | undefined, pw: string) {
    return verifyPassword(pw, stored ?? (await DUMMY)).then((ok) => ok && !!stored);
  }
}

/** Fixed-window limiter: Redis when available, in-process fallback otherwise. */
export class RateLimiter {
  private mem = new Map<string, { n: number; exp: number }>();
  constructor(private redis: Redis) {}
  async allow(key: string, limit: number, windowSec: number): Promise<boolean> {
    try {
      const n = await this.redis.cmd('INCR', 'rl:' + key);
      if (n === 1) await this.redis.cmd('EXPIRE', 'rl:' + key, windowSec);
      return n <= limit;
    } catch {
      const now = Date.now();
      let e = this.mem.get(key);
      if (!e || e.exp < now) {
        if (this.mem.size > 10_000) this.mem.clear();
        this.mem.set(key, (e = { n: 0, exp: now + windowSec * 1000 }));
      }
      return ++e.n <= limit;
    }
  }
}
