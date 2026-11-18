import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;
/** Project root: APP_ROOT if set, else found from this file (source tree or dist/ bundle), else the working directory. */
function findRoot(): string {
  if (env.APP_ROOT) return env.APP_ROOT;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const up of ['..', '../..', '.']) {
    const dir = path.resolve(here, up);
    if (fs.existsSync(path.join(dir, 'db', 'migrations'))) return dir;
  }
  return process.cwd();
}
const ROOT = findRoot();
const num = (k: string, d: number) => (env[k] ? Number(env[k]) : d);

export const config = {
  port: num('PORT', 8080),
  host: env.HOST ?? '0.0.0.0',
  databaseUrl: env.DATABASE_URL ?? 'postgres://aetherion:aetherion_dev@127.0.0.1:5432/aetherion',
  redisUrl: env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  sessionTtlSec: num('SESSION_TTL_SEC', 7 * 24 * 3600),
  maxCharacters: num('MAX_CHARACTERS', 4),
  roomCapacity: num('ROOM_CAPACITY', 150),
  reconnectGraceMs: num('RECONNECT_GRACE_MS', 10_000),
  autosaveMs: num('AUTOSAVE_MS', 30_000),
  // Auth attempts per IP per minute. Load tests raise this via env.
  authRateLimit: num('AUTH_RATE_LIMIT', 20),
  // Loot tuning without a code change: multipliers on every drop chance and on gold.
  dropRate: num('DROP_RATE', 1),
  goldRate: num('GOLD_RATE', 1),
  bossRespawnScale: num('WORLD_BOSS_RESPAWN_SCALE', 1),
  // ---- security ----
  /** Bearer token for /api/metrics. Without one, metrics are served to loopback clients only. */
  metricsToken: env.METRICS_TOKEN ?? '',
  /** Number of reverse proxies in front of the server whose X-Forwarded-For entry is trusted (0 = none). */
  trustProxy: num('TRUST_PROXY', 0),
  /** Extra origins allowed to open the game socket (comma separated). The page's own origin is always allowed. */
  allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  maxConnections: num('MAX_CONNECTIONS', 2000),
  maxConnectionsPerIp: num('MAX_CONNECTIONS_PER_IP', 20),
  /** Developer overlay (monster spawns, patrol/aggro/leash radii, AI state, routes). Off unless DEBUG_OVERLAY=1; never enable on a public server. */
  debugOverlay: env.DEBUG_OVERLAY === '1',
  /** Auction house: listing fee (per day listed) and sales tax, in percent. */
  auctionFeePct: num('AUCTION_FEE_PCT', 5),
  auctionTaxPct: num('AUCTION_TAX_PCT', 10),
  clientDir: env.CLIENT_DIR ?? path.join(ROOT, 'client', 'dist'),
  migrationsDir: env.MIGRATIONS_DIR ?? path.join(ROOT, 'db', 'migrations'),
};
export type Config = typeof config;
