// HTTP API + static client + WebSocket gateway. `createApp` is used by main.ts and by tests.
import { cleanGameSettings } from '../../shared/src/settings';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import { JOBS } from '../../shared/src/protocol';
import { parseAppearance } from '../../shared/src/appearance';
import { cleanAudioSettings } from '../../shared/src/audio';
import { START_ZONE, ZONES, tileCenter } from '../../shared/src/world';
import { hashPassword, RateLimiter, Sessions } from './auth';
import { Redis } from './cache/resp';
import type { Config } from './config';
import { migrate } from './db/migrate';
import { parseDbUrl, PgError, PgPool } from './db/pgwire';
import { Repo, type CharacterRow } from './db/repo';
import { World, type Player } from './game/World';

const Creds = z.object({
  username: z.string().regex(/^[A-Za-z0-9_]{3,16}$/, 'Username: 3-16 letters, digits or _'),
  password: z.string().min(8, 'Password: at least 8 characters').max(72),
});
const NewChar = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9]{2,13}$/, 'Name: 3-14 letters/digits, starting with a letter'),
  job: z.enum(JOBS),
  appearance: z.unknown(),
});

const unit = z.number().min(0).max(1);
/** PUT /api/settings. Unknown keys are refused, so a typo cannot silently do nothing. */
const SettingsBody = z.object({
  audio: z.object({ master: unit, music: unit, sfx: unit, ambient: unit, muteAll: z.boolean(), musicOn: z.boolean(), sfxOn: z.boolean() }).strict().optional(),
  // M16: key bindings, language, scale, graphics, camera, movement, tutorial, markers (validated by cleanGameSettings)
  game: z.record(z.unknown()).optional(),
}).strict().refine((b) => b.audio || b.game, 'Nothing to save');

/** Largest WebSocket message a client may send; anything bigger ends the connection. */
export const MAX_MESSAGE_BYTES = 4096;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg',
};

/** Sent with every response. The page loads only its own script and talks only to its own server. */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

class HttpError extends Error {
  constructor(readonly status: number, msg: string) {
    super(msg);
  }
}

const publicChar = (c: CharacterRow) => ({ id: c.id, name: c.name, job: c.job, level: c.level, appearance: c.appearance, zone: c.zone_id });

export async function createApp(cfg: Config) {
  const db = new PgPool(parseDbUrl(cfg.databaseUrl));
  const applied = await migrate(db, cfg.migrationsDir);
  if (applied.length) console.log('migrations applied:', applied.join(', '));
  const redis = new Redis(cfg.redisUrl);
  await redis.connect();
  if (!redis.ready) console.warn('redis unavailable - running with in-process fallbacks');
  const repo = new Repo(db);
  const sessions = new Sessions(repo, redis, cfg.sessionTtlSec);
  const limiter = new RateLimiter(redis);
  const world = new World(repo, { ...cfg, auction: { feePct: cfg.auctionFeePct, taxPct: cfg.auctionTaxPct } });
  await world.load();

  const readJson = (req: http.IncomingMessage) =>
    new Promise<unknown>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 8192) {
          // stop reading; the 413 is sent first and the connection closed afterwards
          reject(new HttpError(413, 'Body too large'));
          req.pause();
          req.removeAllListeners('data');
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch {
          reject(new HttpError(400, 'Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  const parse = <S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> => {
    const r = schema.safeParse(body);
    if (!r.success) throw new HttpError(400, r.error.issues[0].message);
    return r.data;
  };
  const bearer = (req: http.IncomingMessage) => (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const requireAccount = async (req: http.IncomingMessage) => {
    const id = await sessions.resolve(bearer(req));
    if (!id) throw new HttpError(401, 'Not authenticated');
    return id;
  };
  /** Client address. X-Forwarded-For is honoured only for the configured number of trusted proxies: the entry that many from the right. */
  const ipOf = (req: http.IncomingMessage) => {
    const sock = req.socket.remoteAddress ?? '?';
    if (cfg.trustProxy > 0) {
      const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const ip = xff[xff.length - cfg.trustProxy];
      if (ip && ip.length <= 45) return ip;
    }
    return sock;
  };
  const loopback = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const sameToken = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  async function api(req: http.IncomingMessage, url: URL): Promise<unknown> {
    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case 'GET /api/health':
        await db.query('SELECT 1');
        return { ok: true, redis: redis.ready };
      case 'GET /api/metrics':
        // Operational data: a token if one is configured, otherwise only from the machine itself.
        if (cfg.metricsToken ? !sameToken(bearer(req), cfg.metricsToken) : !loopback(ipOf(req))) throw new HttpError(403, 'Forbidden');
        return { ...world.metrics(), sockets: wss.clients.size };
      case 'POST /api/register': {
        if (!(await limiter.allow('auth:' + ipOf(req), cfg.authRateLimit, 60))) throw new HttpError(429, 'Too many attempts, try again in a minute');
        const { username, password } = parse(Creds, await readJson(req));
        try {
          const acc = await repo.createAccount(username, await hashPassword(password));
          return { token: await sessions.create(acc.id), username: acc.username };
        } catch (e) {
          if (e instanceof PgError && e.code === '23505') throw new HttpError(409, 'Username already taken');
          throw e;
        }
      }
      case 'POST /api/login': {
        if (!(await limiter.allow('auth:' + ipOf(req), cfg.authRateLimit, 60))) throw new HttpError(429, 'Too many attempts, try again in a minute');
        const { username, password } = parse(Creds.extend({ password: z.string().max(72) }), await readJson(req));
        const acc = await repo.findAccount(username);
        if (!(await sessions.verifyLogin(acc?.password_hash, password)) || !acc) throw new HttpError(401, 'Wrong username or password');
        repo.touchLogin(acc.id).catch(() => {});
        return { token: await sessions.create(acc.id), username: acc.username };
      }
      case 'POST /api/logout':
        await sessions.destroy(bearer(req));
        return { ok: true };
      case 'GET /api/characters':
        return { characters: (await repo.listCharacters(await requireAccount(req))).map(publicChar), max: cfg.maxCharacters };
      case 'POST /api/characters': {
        const accountId = await requireAccount(req);
        const c = parse(NewChar, await readJson(req));
        const ap = parseAppearance(c.appearance, c.job);
        if (typeof ap === 'string') throw new HttpError(400, ap);
        const sp = ZONES[START_ZONE].spawn;
        try {
          const row = await repo.createCharacter(accountId, c.name, c.job, ap, START_ZONE, tileCenter(sp.tx), tileCenter(sp.ty), cfg.maxCharacters);
          if (row === 'limit') throw new HttpError(409, `Character limit reached (${cfg.maxCharacters})`);
          return { character: publicChar(row) };
        } catch (e) {
          if (e instanceof PgError && e.code === '23505') throw new HttpError(409, 'Character name already taken');
          throw e;
        }
      }
      // Client settings, stored per account so they follow the player to any device.
      case 'GET /api/settings': {
        const doc = await repo.getSettings(await requireAccount(req));
        // stored data is cleaned again on the way out: a bad row can never reach a client
        return { audio: cleanAudioSettings(doc?.audio), saved: !!doc?.audio, game: cleanGameSettings(doc?.game), gameSaved: !!doc?.game };
      }
      case 'PUT /api/settings': {
        const accountId = await requireAccount(req);
        if (!(await limiter.allow('settings:' + accountId, 60, 60))) throw new HttpError(429, 'Too many changes, try again in a minute');
        const body = parse(SettingsBody, await readJson(req));
        const out: Record<string, unknown> = { saved: true };
        if (body.audio) await repo.saveSettings(accountId, 'audio', (out.audio = cleanAudioSettings(body.audio)));
        if (body.game) await repo.saveSettings(accountId, 'game', (out.game = cleanGameSettings(body.game)));
        return out;
      }
      case 'GET /api/pvp/rankings': {
        const by = url.searchParams.get('by');
        return { rows: await repo.pvpRankings(by === 'kills' || by === 'duels_won' || by === 'arena_kills' ? by : 'rating') };
      }
      default:
        throw new HttpError(404, 'Not found');
    }
  }

  function serveStatic(url: URL, res: http.ServerResponse) {
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.join(cfg.clientDir, path.normalize(rel));
    if (!file.startsWith(cfg.clientDir)) return void res.writeHead(403).end();
    // Audio is requested as /audio/<file>?v=<content hash> (the hash comes from the audio manifest),
    // so a given URL never changes and the browser may keep it for good. Everything else revalidates.
    const cache = rel.startsWith('/audio/') && url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache';
    fs.readFile(file, (err, data) => {
      if (err) return void res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': cache, ...SECURITY_HEADERS });
      res.end(data);
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith('/api/')) return serveStatic(url, res);
    api(req, url).then(
      (body) => res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...SECURITY_HEADERS }).end(JSON.stringify(body)),
      (e) => {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) console.error('api error', e);
        if (status === 413) res.once('finish', () => req.destroy());
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(status === 413 ? { connection: 'close' } : {}), ...SECURITY_HEADERS }).end(JSON.stringify({ error: status === 500 ? 'Internal error' : e.message }));
      },
    );
  });

  // ---------- WebSocket gateway ----------
  // Browsers always send Origin on a WebSocket handshake. A page on another site must not be able
  // to open a game socket with the player's session, so the origin has to be this server's own
  // (or one explicitly allowed). Clients that send no Origin (the load-test bots) are not browsers.
  const perIp = new Map<string, number>();
  const originOk = (req: http.IncomingMessage) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (cfg.allowedOrigins.includes(origin)) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  };
  const wss = new WebSocketServer({
    // 4 KB: the largest real message is an auto hunting configuration (about 1.8 KB with every skill a character can have)
    server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false,
    verifyClient: (info: { req: http.IncomingMessage }, done: (ok: boolean, code?: number, msg?: string) => void) => {
      if (!originOk(info.req)) return done(false, 403, 'Origin not allowed');
      if (wss.clients.size >= cfg.maxConnections) return done(false, 503, 'Server full');
      if ((perIp.get(ipOf(info.req)) ?? 0) >= cfg.maxConnectionsPerIp) return done(false, 429, 'Too many connections');
      done(true);
    },
  });
  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const ip = ipOf(req);
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    let player: Player | null = null;
    let joining = false;
    let tokens = 60; // message budget: 60 burst, refilled at 40/s (client sends ~21/s)
    let last = Date.now();
    const conn = {
      send: (d: string) => {
        if (ws.readyState === 1 && ws.bufferedAmount < 1_000_000) ws.send(d);
      },
      close: () => ws.close(),
    };
    const kick = (reason: string) => {
      conn.send(JSON.stringify({ t: 'kick', reason }));
      ws.close();
    };
    const joinTimer = setTimeout(() => !player && kick('Join timeout'), 5000);

    ws.on('message', (raw: Buffer, isBinary: boolean) => {
      world.msgsIn++;
      const now = Date.now();
      tokens = Math.min(60, tokens + ((now - last) / 1000) * 40);
      last = now;
      if (--tokens < 0) return kick('Message rate exceeded');
      if (isBinary) return kick('Bad message');
      let m: any;
      try {
        m = JSON.parse(raw.toString('utf8'));
      } catch {
        return kick('Bad message');
      }
      if (!m || typeof m !== 'object') return kick('Bad message');
      if (!player) {
        if (m.t !== 'join' || joining) return;
        joining = true;
        (async () => {
          const accountId = await sessions.resolve(m.token);
          if (!accountId) return kick('Session expired, please log in again.');
          if (!Number.isInteger(m.characterId)) return kick('Bad character');
          const row = await repo.getCharacter(m.characterId, accountId);
          if (!row) return kick('Character not found');
          if (ws.readyState !== 1) return;
          player = world.join(row, conn);
        })().catch((e) => {
          console.error('join failed', e);
          kick('Server error');
        });
        return;
      }
      switch (m.t) {
        case 'in': return world.input(player, m.s, m.x, m.y, m.r);
        case 'act': return world.action(player, m.k);
        case 'tgt': return world.setTarget(player, m.id);
        case 'respawn': return world.requestRespawn(player);
        case 'use': return void world.use(player, m.a, m.tid);
        case 'inv': return void world.inventory(player, m);
        case 'dng': return void world.dungeon(player, m.op, m.id, m.op === 'ready' ? m.yes : m.diff);
        case 'obj': return void world.object(player, m);
        case 'learn': return void world.learn(player, m.id);
        case 'respec': return void world.respec(player);
        case 'rune': return void world.attune(player, m.slot, m.el);
        case 'chat': return world.chat(player, m.text, m.ch, m.to);
        case 'auto': return world.auto(player, m);
        case 'quest': return void world.quest(player, m);
        case 'journal': return void world.journal(player, m);
        case 'mail': return void world.mailOp(player, m);
        case 'friends': return void world.friendOp(player, m);
        case 'depth': return void (m.op === 'enter' && world.depthEnter(player));
        case 'rift': return void world.riftOp(player, m);
        case 'asc': return void world.ascOp(player, m);
        case 'raid': return void world.raidOp(player, m);
        case 'life': return void world.lifeOp(player, m);
        case 'guild': return void world.guild(player, m);
        case 'eco': return void world.eco(player, m);
        case 'pvp': return void world.pvpOp(player, m);
        case 'comp': return void world.companion(player, m);
        case 'trade': return void world.trade(player, m);
        case 'party': return void world.party(player, m.op, m.op === 'loot' ? m.mode : m.id, m.name);
        case 'dbg': return world.setDebug(player, m.on);
        case 'ping': return typeof m.c === 'number' ? conn.send(JSON.stringify({ t: 'pong', c: m.c })) : undefined;
      }
    });
    ws.on('close', () => {
      clearTimeout(joinTimer);
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
      if (player) world.disconnect(player, conn);
    });
    ws.on('error', () => ws.terminate());
  });

  const purge = setInterval(() => repo.purgeSessions().catch(() => {}), 3600_000);
  purge.unref();

  return {
    world, db, repo, server,
    async listen(port = cfg.port): Promise<number> {
      await new Promise<void>((r) => server.listen(port, cfg.host, r));
      world.start();
      return (server.address() as { port: number }).port;
    },
    async close() {
      clearInterval(purge);
      await world.stop();
      for (const c of wss.clients) c.terminate();
      await new Promise((r) => server.close(r));
      redis.close();
      await db.close();
    },
  };
}
