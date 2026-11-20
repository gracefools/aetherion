// All SQL lives here. Game code never builds queries.
import type { Appearance, Job } from '../../../shared/src/protocol';
import type { Db, Queryer } from './pgwire';
import type { AccountMod } from '../game/Moderation';

/** A character's gold, bag, equipment and bank as stored together (an atomic inventory snapshot). */
export interface Snapshot {
  id: number;
  gold: number;
  inventory: unknown;
  equipment: unknown;
  bank: unknown;
  /** Armament levels and equipped sigils (omitted: left as stored). */
  gear?: unknown;
  name?: string;
}
export const writeSnapshot = (q: Queryer, s: Snapshot) =>
  q('UPDATE characters SET gold=$2, inventory=$3::jsonb, equipment=$4::jsonb, bank=$5::jsonb, gear=COALESCE($6::jsonb, gear) WHERE id=$1',
    [s.id, s.gold, JSON.stringify(s.inventory), JSON.stringify(s.equipment), JSON.stringify(s.bank), s.gear === undefined ? null : JSON.stringify(s.gear)]);
const AUCTION_MAX = 20;

export interface Account {
  id: number;
  username: string;
  password_hash: string;
  /** T4 */
  banned_until?: Date | null;
  ban_reason?: string;
}
export interface CharacterRow {
  id: number;
  account_id: number;
  name: string;
  job: Job;
  level: number;
  exp: number;
  appearance: Appearance;
  zone_id: string;
  pos_x: number;
  pos_y: number;
  skills?: unknown;
  runes?: unknown;
  gold?: number;
  inventory?: unknown;
  equipment?: unknown;
  discoveries?: unknown;
  auto_hunt?: unknown;
  quests?: unknown;
  journal?: unknown;
  reputation?: unknown;
  bank?: unknown;
  companions?: unknown;
  gear?: unknown;
}
const CHAR_COLS = 'id, account_id, name, job, level, exp, appearance, zone_id, pos_x, pos_y, skills, runes, gold, inventory, equipment, discoveries, auto_hunt, quests, reputation, bank, companions, gear, journal, ascension, life';

export class Repo {
  constructor(private db: Db) {}

  async createAccount(username: string, passwordHash: string): Promise<Account> {
    const r = await this.db.query<Account>(
      'INSERT INTO accounts(username, username_lower, password_hash) VALUES ($1,$2,$3) RETURNING id, username, password_hash',
      [username, username.toLowerCase(), passwordHash],
    );
    return r.rows[0];
  }
  async findAccount(username: string): Promise<Account | undefined> {
    const r = await this.db.query<Account>('SELECT id, username, password_hash, banned_until, ban_reason FROM accounts WHERE username_lower=$1', [
      username.toLowerCase(),
    ]);
    return r.rows[0];
  }
  // ---------- T4: moderation ----------
  async accountMod(accountId: number): Promise<AccountMod | undefined> {
    return (await this.db.query<AccountMod>('SELECT username, is_admin, banned_until, ban_reason, muted_until FROM accounts WHERE id=$1', [accountId])).rows[0];
  }
  async accountOfCharacter(name: string): Promise<{ account_id: number; name: string } | undefined> {
    return (await this.db.query<{ account_id: number; name: string }>('SELECT account_id, name FROM characters WHERE name_lower=$1', [name.toLowerCase()])).rows[0];
  }
  /** Bans (or with null lifts the ban on) an account; a ban also ends its sessions. */
  async setBan(accountId: number, until: Date | null, reason: string) {
    await this.db.query('UPDATE accounts SET banned_until=$2, ban_reason=$3 WHERE id=$1', [accountId, until, until ? reason : '']);
    if (until) await this.db.query('DELETE FROM sessions WHERE account_id=$1', [accountId]);
  }
  setMute(accountId: number, until: Date | null) {
    return this.db.query('UPDATE accounts SET muted_until=$2 WHERE id=$1', [accountId, until]);
  }
  modLog(admin: string, action: string, target: string, detail: string) {
    return this.db.query('INSERT INTO mod_log(admin, action, target, detail) VALUES ($1,$2,$3,$4)', [admin, action, target, detail]);
  }
  async modLogs(target: string, limit = 20) {
    return (await this.db.query<{ at: Date; admin: string; action: string; detail: string }>('SELECT at, admin, action, detail FROM mod_log WHERE lower(target)=$1 ORDER BY at DESC LIMIT $2', [target.toLowerCase(), limit])).rows;
  }
  /** A character's stored gold and items, with its ten latest trades and bank entries. */
  async auditCharacter(name: string) {
    const c = (await this.db.query<{ id: number; name: string; level: number; gold: number; bag: number; bank_items: number; bank_gold: number }>(
      `SELECT id, name, level, gold, jsonb_array_length(CASE WHEN jsonb_typeof(inventory)='array' THEN inventory ELSE '[]'::jsonb END) AS bag,
              jsonb_array_length(CASE WHEN jsonb_typeof(bank->'items')='array' THEN bank->'items' ELSE '[]'::jsonb END) AS bank_items,
              COALESCE((bank->>'gold')::bigint, 0) AS bank_gold
         FROM characters WHERE name_lower=$1`, [name.toLowerCase()])).rows[0];
    if (!c) return undefined;
    const id = Number(c.id);
    const trades = (await this.db.query<{ at: Date; a_id: number; b_id: number; a_name: string; b_name: string; a_gave: any; b_gave: any }>(
      'SELECT at, a_id, b_id, a_name, b_name, a_gave, b_gave FROM trade_log WHERE a_id=$1 OR b_id=$1 ORDER BY at DESC LIMIT 10', [id])).rows.map((t) => ({ ...t, a_id: Number(t.a_id), b_id: Number(t.b_id) }));
    const bank = (await this.db.query<{ at: Date; op: string; detail: unknown }>('SELECT at, op, detail FROM bank_log WHERE character_id=$1 ORDER BY at DESC LIMIT 10', [id])).rows;
    return { ...c, id, gold: Number(c.gold), bag: Number(c.bag), bank_items: Number(c.bank_items), bank_gold: Number(c.bank_gold), trades, bank };
  }
  touchLogin(id: number) {
    return this.db.query('UPDATE accounts SET last_login_at=now() WHERE id=$1', [id]);
  }

  createSession(tokenHash: string, accountId: number, ttlSec: number) {
    return this.db.query(
      "INSERT INTO sessions(token_hash, account_id, expires_at) VALUES ($1,$2, now() + ($3 || ' seconds')::interval)",
      [tokenHash, accountId, ttlSec],
    );
  }
  async findSession(tokenHash: string): Promise<number | undefined> {
    const r = await this.db.query<{ account_id: number }>(
      'SELECT account_id FROM sessions WHERE token_hash=$1 AND expires_at > now()',
      [tokenHash],
    );
    return r.rows[0]?.account_id;
  }
  deleteSession(tokenHash: string) {
    return this.db.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash]);
  }
  purgeSessions() {
    return this.db.query('DELETE FROM sessions WHERE expires_at <= now()');
  }

  async listCharacters(accountId: number): Promise<CharacterRow[]> {
    return (await this.db.query<CharacterRow>(`SELECT ${CHAR_COLS} FROM characters WHERE account_id=$1 ORDER BY id`, [accountId])).rows;
  }
  async getCharacter(id: number, accountId: number): Promise<CharacterRow | undefined> {
    return (await this.db.query<CharacterRow>(`SELECT ${CHAR_COLS} FROM characters WHERE id=$1 AND account_id=$2`, [id, accountId])).rows[0];
  }
  /** Count + insert under a row lock on the account so parallel requests cannot exceed the cap. */
  createCharacter(accountId: number, name: string, job: Job, ap: Appearance, zone: string, x: number, y: number, max: number) {
    return this.db.tx(async (q) => {
      await q('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [accountId]);
      const n = (await q<{ n: number }>('SELECT count(*)::int AS n FROM characters WHERE account_id=$1', [accountId])).rows[0].n;
      if (n >= max) return 'limit' as const;
      const r = await q<CharacterRow>(
        `INSERT INTO characters(account_id, name, name_lower, job, appearance, zone_id, pos_x, pos_y)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${CHAR_COLS}`,
        [accountId, name, name.toLowerCase(), job, ap, zone, x, y],
      );
      return r.rows[0];
    });
  }
  /** Skill ranks and rune progress. Written only for characters whose build changed. */
  saveBuild(id: number, skills: unknown, runes: unknown) {
    return this.db.query('UPDATE characters SET skills=$2, runes=$3 WHERE id=$1', [id, skills, runes]);
  }
  saveDiscoveries(id: number, list: string[]) {
    return this.db.query('UPDATE characters SET discoveries=$2::jsonb WHERE id=$1', [id, JSON.stringify(list)]);
  }
  saveAuto(id: number, cfg: unknown) {
    return this.db.query('UPDATE characters SET auto_hunt=$2::jsonb WHERE id=$1', [id, JSON.stringify(cfg)]);
  }
  /**
   * A completed trade: both characters' gold and inventories and the audit row, in one
   * transaction. Either all of it is stored or none of it.
   */
  saveTrade(a: Snapshot, b: Snapshot, log: { zone: string; a: { id: number; name: string; gold: number; items: unknown[] }; b: { id: number; name: string; gold: number; items: unknown[] } }) {
    return this.db.tx(async (q) => {
      for (const c of [a, b]) await writeSnapshot(q, c);
      await q('INSERT INTO trade_log(a_id, b_id, a_name, b_name, zone_id, a_gave, b_gave) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',
        [log.a.id, log.b.id, log.a.name, log.b.name, log.zone, JSON.stringify({ gold: log.a.gold, items: log.a.items }), JSON.stringify({ gold: log.b.gold, items: log.b.items })]);
    });
  }
  /** Gold, inventory and equipment as one atomic snapshot. */
  saveItems(s: Snapshot) {
    return writeSnapshot((t, p) => this.db.query(t, p), s);
  }
  /** The account's settings document (a section per feature), or undefined if nothing was ever saved. */
  async getSettings(accountId: number): Promise<Record<string, unknown> | undefined> {
    const r = await this.db.query<{ settings: unknown }>('SELECT settings FROM account_settings WHERE account_id=$1', [accountId]);
    const s = r.rows[0]?.settings;
    return s && typeof s === 'object' ? (s as Record<string, unknown>) : undefined;
  }
  /** Replaces one section of the settings document and leaves the others alone. */
  saveSettings(accountId: number, section: string, value: unknown) {
    return this.db.query(
      `INSERT INTO account_settings(account_id, settings) VALUES ($1, jsonb_build_object($2::text, $3::jsonb))
       ON CONFLICT (account_id) DO UPDATE SET settings = account_settings.settings || jsonb_build_object($2::text, $3::jsonb), updated_at = now()`,
      [accountId, section, JSON.stringify(value)],
    );
  }
  /** One statement for any number of characters (autosave batch): position, zone, level and EXP. */
  saveState(rows: { id: number; zone: string; x: number; y: number; level: number; exp: number }[]) {
    if (!rows.length) return Promise.resolve();
    const arr = (v: (string | number)[]) => '{' + v.join(',') + '}';
    return this.db.query(
      `UPDATE characters c SET zone_id=v.zone, pos_x=v.x, pos_y=v.y, level=v.level, exp=v.exp, updated_at=now()
       FROM (SELECT unnest($1::bigint[]) AS id, unnest($2::text[]) AS zone, unnest($3::real[]) AS x, unnest($4::real[]) AS y,
                    unnest($5::int[]) AS level, unnest($6::bigint[]) AS exp) v
       WHERE c.id=v.id`,
      [arr(rows.map((r) => r.id)), arr(rows.map((r) => r.zone)), arr(rows.map((r) => r.x)), arr(rows.map((r) => r.y)), arr(rows.map((r) => r.level)), arr(rows.map((r) => r.exp))],
    );
  }

  // ======================================================================================
  // M13-M15
  // ======================================================================================
  /** Quest state, reputation and companions: written for characters whose progress changed. */
  saveProgress(id: number, quests: unknown, reputation: unknown, companions: unknown, journal: unknown = undefined, ascension: unknown = undefined, life: unknown = undefined) {
    if (life !== undefined) return this.db.query('UPDATE characters SET quests=$2::jsonb, reputation=$3::jsonb, companions=$4::jsonb, journal=$5::jsonb, ascension=$6::jsonb, life=$7::jsonb WHERE id=$1', [id, JSON.stringify(quests), JSON.stringify(reputation), JSON.stringify(companions), JSON.stringify(journal), JSON.stringify(ascension), JSON.stringify(life)]);
    if (ascension !== undefined) return this.db.query('UPDATE characters SET quests=$2::jsonb, reputation=$3::jsonb, companions=$4::jsonb, journal=$5::jsonb, ascension=$6::jsonb WHERE id=$1', [id, JSON.stringify(quests), JSON.stringify(reputation), JSON.stringify(companions), JSON.stringify(journal), JSON.stringify(ascension)]);
    if (journal === undefined) return this.db.query('UPDATE characters SET quests=$2::jsonb, reputation=$3::jsonb, companions=$4::jsonb WHERE id=$1', [id, JSON.stringify(quests), JSON.stringify(reputation), JSON.stringify(companions)]);
    return this.db.query('UPDATE characters SET quests=$2::jsonb, reputation=$3::jsonb, companions=$4::jsonb, journal=$5::jsonb WHERE id=$1', [id, JSON.stringify(quests), JSON.stringify(reputation), JSON.stringify(companions), JSON.stringify(journal)]);
  }
  async loadFactions(): Promise<{ id: string; name: string; seat: string; region: string; creed: string; about: string; shop: unknown }[]> {
    return (await this.db.query<any>('SELECT id, name, seat, region, creed, about, shop FROM factions WHERE enabled ORDER BY sort, id')).rows;
  }

  // ---------- territories and faction conquest ----------
  async loadTerritories(): Promise<{ zone: string; guild_id: number }[]> {
    return (await this.db.query<any>('SELECT zone, guild_id FROM territories')).rows.map((r: any) => ({ zone: r.zone, guild_id: Number(r.guild_id) }));
  }
  saveTerritory(zone: string, guild: number) {
    return this.db.query('INSERT INTO territories(zone, guild_id) VALUES ($1,$2) ON CONFLICT (zone) DO UPDATE SET guild_id=$2, since=now()', [zone, guild]);
  }
  async loadFactionPoints(week: number): Promise<{ zone: string; faction: string; points: number }[]> {
    return (await this.db.query<any>('SELECT zone, faction, points FROM faction_points WHERE week=$1', [week])).rows.map((r: any) => ({ zone: r.zone, faction: r.faction, points: Number(r.points) }));
  }
  saveFactionPoints(week: number, zone: string, faction: string, points: number) {
    return this.db.query('INSERT INTO faction_points(week, zone, faction, points) VALUES ($1,$2,$3,$4) ON CONFLICT (week, zone, faction) DO UPDATE SET points=$4', [week, zone, faction, points]);
  }

  // ---------- the Endless Rift ----------
  saveRiftScore(week: number, characterId: number, name: string, job: string, floor: number, secs: number, party: number) {
    return this.db.query('INSERT INTO rift_scores(week, character_id, name, job, floor, secs, party) VALUES ($1,$2,$3,$4,$5,$6,$7)', [week, characterId, name, job, floor, secs, party]);
  }
  /** Each character's best climb of the week, highest floor first (faster first on the same floor). */
  async riftTop(week: number, limit: number): Promise<{ name: string; job: string; floor: number; secs: number; party: number }[]> {
    const r = await this.db.query<any>(`SELECT name, job, floor, secs, party FROM (SELECT DISTINCT ON (character_id) name, job, floor, secs, party FROM rift_scores WHERE week=$1 ORDER BY character_id, floor DESC, secs ASC) b ORDER BY floor DESC, secs ASC LIMIT $2`, [week, limit]);
    return r.rows.map((x: any) => ({ name: x.name, job: x.job, floor: Number(x.floor), secs: Number(x.secs), party: Number(x.party) }));
  }

  // ---------- friends ----------
  /** Every link of a character, with the other side's name, class and level. */
  async friendsOf(id: number): Promise<{ a: number; id: number; name: string; job: string; level: number; accepted: boolean }[]> {
    return (await this.db.query<any>('SELECT f.a, f.accepted, c.id, c.name, c.job, c.level FROM friends f JOIN characters c ON c.id = CASE WHEN f.a = $1 THEN f.b ELSE f.a END WHERE f.a = $1 OR f.b = $1', [id])).rows;
  }
  async characterInfo(id: number): Promise<{ job: string; level: number } | undefined> {
    return (await this.db.query<any>('SELECT job, level FROM characters WHERE id=$1', [id])).rows[0];
  }
  addFriend(a: number, b: number) {
    return this.db.query('INSERT INTO friends(a, b) VALUES ($1,$2) ON CONFLICT DO NOTHING', [a, b]);
  }
  acceptFriend(a: number, b: number) {
    return this.db.query('UPDATE friends SET accepted=true WHERE a=$1 AND b=$2', [a, b]);
  }
  removeFriend(x: number, y: number) {
    return this.db.query('DELETE FROM friends WHERE (a=$1 AND b=$2) OR (a=$2 AND b=$1)', [x, y]);
  }

  // ---------- mail ----------
  async characterByName(name: string): Promise<{ id: number; name: string } | undefined> {
    return (await this.db.query<{ id: number; name: string }>('SELECT id, name FROM characters WHERE name_lower=$1', [name.toLowerCase()])).rows[0];
  }
  /** Sends a letter: the letter and the sender's bag and gold without what it carries, together. */
  sendMail(m: { to: number; from: number; fromName: string; subject: string; body: string; items: unknown[]; gold: number }, snap: Snapshot): Promise<number> {
    return this.db.tx(async (q) => {
      const id = Number((await q<{ id: number }>('INSERT INTO mail(to_id, from_id, from_name, subject, body, items, gold) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id',
        [m.to, m.from, m.fromName, m.subject, m.body, JSON.stringify(m.items), m.gold])).rows[0].id);
      await writeSnapshot(q, snap);
      return id;
    });
  }
  /** A system letter (rewards, returns): nothing leaves anyone's bag. */
  systemMail(to: number, subject: string, body: string, items: unknown[], gold: number) {
    return this.db.query('INSERT INTO mail(to_id, from_name, subject, body, items, gold) VALUES ($1,$2,$3,$4,$5::jsonb,$6)', [to, 'Aetherion Post', subject, body, JSON.stringify(items), gold]);
  }
  async listMail(to: number, limit: number) {
    return (await this.db.query<any>('SELECT id, from_name, subject, body, items, gold, sent_at, read, claimed FROM mail WHERE to_id=$1 ORDER BY sent_at DESC, id DESC LIMIT $2', [to, limit])).rows;
  }
  async unreadMail(to: number): Promise<number> {
    return (await this.db.query<{ n: number }>('SELECT count(*)::int AS n FROM mail WHERE to_id=$1 AND NOT read', [to])).rows[0].n;
  }
  markMailRead(id: number, to: number) {
    return this.db.query('UPDATE mail SET read=true WHERE id=$1 AND to_id=$2', [id, to]);
  }
  /** Deletes a letter whose contents were taken (or that never carried anything). */
  async deleteMail(id: number, to: number): Promise<boolean> {
    return (await this.db.query("DELETE FROM mail WHERE id=$1 AND to_id=$2 AND (claimed OR (gold = 0 AND items = '[]'::jsonb))", [id, to])).rowCount! > 0;
  }
  /**
   * Takes what a letter carries. The letter is claimed with a conditional update, so it can be
   * taken only once; `apply` puts the contents in the bag and returns the snapshot to store.
   */
  claimMail(id: number, to: number, apply: (m: { items: any[]; gold: number }) => Snapshot): Promise<{ items: number; gold: number }> {
    return this.db.tx(async (q) => {
      const r = await q<any>("UPDATE mail SET claimed=true, read=true WHERE id=$1 AND to_id=$2 AND NOT claimed AND (gold > 0 OR items <> '[]'::jsonb) RETURNING items, gold", [id, to]);
      if (!r.rows.length) throw new Error('not available');
      const m = { items: r.rows[0].items as any[], gold: Number(r.rows[0].gold) };
      await writeSnapshot(q, apply(m));
      return { items: m.items.length, gold: m.gold };
    });
  }

  // ---------- guilds ----------
  async loadGuilds() {
    const guilds = (await this.db.query<any>('SELECT id, name, tag, emblem, leader_id, level, exp, motd, bank_gold, buildings, goals FROM guilds ORDER BY id')).rows;
    const members = (await this.db.query<any>('SELECT m.guild_id, m.character_id, m.rank, c.name, c.job, c.level FROM guild_members m JOIN characters c ON c.id = m.character_id')).rows;
    return { guilds, members };
  }
  /** Creates a guild with its leader, and stores the leader's gold after paying the fee: all or nothing. */
  createGuild(g: { name: string; tag: string; emblem: unknown; leader: number }, snap: Snapshot): Promise<number> {
    return this.db.tx(async (q) => {
      const id = Number((await q<{ id: number }>('INSERT INTO guilds(name, name_lower, tag, emblem, leader_id) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id', [g.name, g.name.toLowerCase(), g.tag, JSON.stringify(g.emblem), g.leader])).rows[0].id);
      await q('INSERT INTO guild_members(character_id, guild_id, rank) VALUES ($1,$2,0)', [g.leader, id]);
      await q('INSERT INTO guild_log(guild_id, text) VALUES ($1, $2)', [id, `Guild founded by ${snap.name ?? 'its leader'}.`]);
      await writeSnapshot(q, snap);
      return id;
    });
  }
  addGuildMember(guildId: number, characterId: number, rank: number) {
    return this.db.query('INSERT INTO guild_members(character_id, guild_id, rank) VALUES ($1,$2,$3)', [characterId, guildId, rank]);
  }
  removeGuildMember(characterId: number) {
    return this.db.query('DELETE FROM guild_members WHERE character_id=$1', [characterId]);
  }
  setGuildRank(characterId: number, rank: number) {
    return this.db.query('UPDATE guild_members SET rank=$2 WHERE character_id=$1', [characterId, rank]);
  }
  /** Leadership moves in one step: the new leader up, the old one to officer. */
  transferGuild(guildId: number, from: number, to: number) {
    return this.db.tx(async (q) => {
      await q('UPDATE guild_members SET rank=1 WHERE character_id=$1 AND guild_id=$2', [from, guildId]);
      await q('UPDATE guild_members SET rank=0 WHERE character_id=$1 AND guild_id=$2', [to, guildId]);
      await q('UPDATE guilds SET leader_id=$2 WHERE id=$1', [guildId, to]);
    });
  }
  setGuildMotd(guildId: number, motd: string) {
    return this.db.query('UPDATE guilds SET motd=$2 WHERE id=$1', [guildId, motd]);
  }
  setGuildBuildings(guildId: number, buildings: unknown) {
    return this.db.query('UPDATE guilds SET buildings=$2::jsonb WHERE id=$1', [guildId, JSON.stringify(buildings)]);
  }
  setGuildGoals(guildId: number, goals: unknown) {
    return this.db.query('UPDATE guilds SET goals=$2::jsonb WHERE id=$1', [guildId, JSON.stringify(goals)]);
  }
  setGuildProgress(guildId: number, level: number, exp: number) {
    return this.db.query('UPDATE guilds SET level=$2, exp=$3 WHERE id=$1', [guildId, level, exp]);
  }
  /** Gold into or out of the guild bank, with the member's own gold, in one transaction. Fails if the bank would go negative. */
  guildBank(guildId: number, delta: number, snap: Snapshot): Promise<number> {
    return this.db.tx(async (q) => {
      const r = await q<{ bank_gold: number }>('UPDATE guilds SET bank_gold = bank_gold + $2 WHERE id=$1 AND bank_gold + $2 >= 0 RETURNING bank_gold', [guildId, delta]);
      if (!r.rows.length) throw new Error('guild bank has too little gold');
      await writeSnapshot(q, snap);
      return Number(r.rows[0].bank_gold);
    });
  }
  deleteGuild(guildId: number) {
    return this.db.query('DELETE FROM guilds WHERE id=$1', [guildId]);
  }
  guildLog(guildId: number, text: string) {
    return this.db.query('INSERT INTO guild_log(guild_id, text) VALUES ($1,$2)', [guildId, text]);
  }
  async guildLogs(guildId: number, limit = 30): Promise<{ at: Date; text: string }[]> {
    return (await this.db.query<any>('SELECT at, text FROM guild_log WHERE guild_id=$1 ORDER BY at DESC, id DESC LIMIT $2', [guildId, limit])).rows;
  }

  // ---------- auction house ----------
  /** Lists an item: the listing row and the seller's bag without the item (and minus the fee), together. */
  createListing(l: { seller: number; name: string; item: unknown; base: string; category: string; rarity: number; price: number; fee: number; hours: number }, snap: Snapshot): Promise<number> {
    return this.db.tx(async (q) => {
      const active = (await q<{ n: number }>("SELECT count(*)::int AS n FROM auction_listings WHERE seller_id=$1 AND status='active'", [l.seller])).rows[0].n;
      if (active >= AUCTION_MAX) throw new Error('listing limit');
      const id = Number((await q<{ id: number }>(
        "INSERT INTO auction_listings(seller_id, seller, item, base, category, rarity, price, fee, expires_at) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8, now() + ($9 || ' hours')::interval) RETURNING id",
        [l.seller, l.name, JSON.stringify(l.item), l.base, l.category, l.rarity, l.price, l.fee, l.hours],
      )).rows[0].id);
      await writeSnapshot(q, snap);
      return id;
    });
  }
  /**
   * Buys a listing. The row is claimed with a conditional update, so of two buyers racing for the
   * same item exactly one succeeds. `apply` changes the buyer in memory and returns the snapshot to
   * store; if anything fails the transaction is rolled back and the caller restores memory.
   */
  buyListing(id: number, buyer: number, buyerName: string, taxPct: number, apply: (l: { item: any; price: number; seller_id: number }) => Snapshot): Promise<{ item: any; price: number; seller_id: number }> {
    return this.db.tx(async (q) => {
      const r = await q<any>("UPDATE auction_listings SET status='sold', buyer_id=$2, buyer=$3, closed_at=now() WHERE id=$1 AND status='active' AND expires_at > now() AND seller_id <> $2 RETURNING item, price, seller_id", [id, buyer, buyerName]);
      if (!r.rows.length) throw new Error('not available');
      const l = { item: r.rows[0].item, price: Number(r.rows[0].price), seller_id: Number(r.rows[0].seller_id) };
      await q("INSERT INTO auction_claims(character_id, gold, reason, listing_id) VALUES ($1,$2,'sold',$3)", [l.seller_id, l.price - Math.floor((l.price * taxPct) / 100), id]);
      await writeSnapshot(q, apply(l));
      return l;
    });
  }
  /** Takes back an active listing of one's own. `apply` puts the item in the bag (or returns null to send it to claims). */
  cancelListing(id: number, seller: number, apply: (item: any) => Snapshot | null): Promise<any> {
    return this.db.tx(async (q) => {
      const r = await q<any>("UPDATE auction_listings SET status='cancelled', closed_at=now() WHERE id=$1 AND seller_id=$2 AND status='active' RETURNING item", [id, seller]);
      if (!r.rows.length) throw new Error('not available');
      const item = r.rows[0].item, snap = apply(item);
      if (snap) await writeSnapshot(q, snap);
      else await q("INSERT INTO auction_claims(character_id, item, reason, listing_id) VALUES ($1,$2::jsonb,'cancelled',$3)", [seller, JSON.stringify(item), id]);
      return item;
    });
  }
  /** Expired listings: their items are returned to their sellers' claims. */
  async expireListings(): Promise<number> {
    const r = await this.db.query<{ n: number }>(`WITH x AS (UPDATE auction_listings SET status='expired', closed_at=now() WHERE status='active' AND expires_at <= now() RETURNING id, seller_id, item)
      , c AS (INSERT INTO auction_claims(character_id, item, reason, listing_id) SELECT seller_id, item, 'expired', id FROM x RETURNING 1) SELECT count(*)::int AS n FROM c`);
    return r.rows[0]?.n ?? 0;
  }
  async claimsOf(characterId: number): Promise<{ gold: number; items: number }> {
    const r = (await this.db.query<any>('SELECT coalesce(sum(gold),0)::bigint AS gold, count(item)::int AS items FROM auction_claims WHERE character_id=$1', [characterId])).rows[0];
    return { gold: Number(r.gold), items: r.items };
  }
  /** Collects claims: `apply` receives all of them, keeps what fits, and returns the snapshot plus the ids it could not take. */
  collectClaims(characterId: number, apply: (rows: { id: number; gold: number; item: any }[]) => { snap: Snapshot; keep: number[] }): Promise<{ gold: number; items: number }> {
    return this.db.tx(async (q) => {
      const rows = (await q<any>('SELECT id, gold, item FROM auction_claims WHERE character_id=$1 ORDER BY id FOR UPDATE', [characterId])).rows.map((x) => ({ id: Number(x.id), gold: Number(x.gold), item: x.item }));
      const { snap, keep } = apply(rows), taken = rows.filter((x) => !keep.includes(x.id));
      if (taken.length) await q(`DELETE FROM auction_claims WHERE id = ANY($1::bigint[])`, [`{${taken.map((x) => x.id).join(',')}}`]);
      await writeSnapshot(q, snap);
      return { gold: taken.reduce((n, x) => n + x.gold, 0), items: taken.filter((x) => x.item).length };
    });
  }
  async searchListings(o: { bases?: string[]; cat?: string; minRar?: number; sort: string; offset: number; limit: number; seller?: number }) {
    const where = ["status='active'", 'expires_at > now()'], args: unknown[] = [];
    const arg = (v: unknown) => (args.push(v), `$${args.length}`);
    if (o.seller) where.push(`seller_id = ${arg(o.seller)}`);
    if (o.cat) where.push(`category = ${arg(o.cat)}`);
    if (o.minRar) where.push(`rarity >= ${arg(o.minRar)}`);
    if (o.bases) where.push(`base = ANY(${arg(`{${o.bases.join(',')}}`)}::text[])`);
    const order = ({ price_asc: 'price ASC, id', price_desc: 'price DESC, id', newest: 'id DESC', ending: 'expires_at ASC, id' } as Record<string, string>)[o.sort] ?? 'price ASC, id';
    const rows = (await this.db.query<any>(`SELECT id, seller_id, seller, item, price, expires_at FROM auction_listings WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${arg(o.limit)} OFFSET ${arg(o.offset)}`, args)).rows;
    const total = (await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM auction_listings WHERE ${where.join(' AND ')}`, args.slice(0, args.length - 2))).rows[0].n;
    return { rows, total };
  }
  async auctionHistory(characterId: number) {
    return (await this.db.query<any>(`SELECT id, seller_id, seller, buyer_id, buyer, item, price, status, closed_at, created_at FROM auction_listings
      WHERE (seller_id=$1 OR buyer_id=$1) AND status <> 'active' ORDER BY coalesce(closed_at, created_at) DESC LIMIT 30`, [characterId])).rows;
  }

  // ---------- bank ----------
  bankLog(characterId: number, op: string, detail: unknown) {
    return this.db.query('INSERT INTO bank_log(character_id, op, detail) VALUES ($1,$2,$3::jsonb)', [characterId, op, JSON.stringify(detail)]);
  }
  async bankLogs(characterId: number) {
    return (await this.db.query<any>('SELECT at, op, detail FROM bank_log WHERE character_id=$1 ORDER BY at DESC, id DESC LIMIT 30', [characterId])).rows;
  }

  // ---------- PvP ----------
  /** Adds to a character's PvP record (creating it on first use). */
  /** G7 ladders: add to a score, or keep the better of two. */
  seasonScore(season: string, ladder: string, c: { id: number; name: string; job: string }, score: number, mode: 'max' | 'add') {
    const upd = mode === 'max' ? 'GREATEST(season_scores.score, EXCLUDED.score)' : 'season_scores.score + EXCLUDED.score';
    return this.db.query(`INSERT INTO season_scores(season, ladder, character_id, name, job, score) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (season, ladder, character_id) DO UPDATE SET score = ${upd}, name = EXCLUDED.name, updated_at = now()`, [season, ladder, c.id, c.name, c.job, score]);
  }
  async seasonTop(season: string, ladder: string, limit: number) {
    return (await this.db.query<any>('SELECT character_id AS id, name, job, score FROM season_scores WHERE season=$1 AND ladder=$2 ORDER BY score DESC, updated_at, character_id LIMIT $3', [season, ladder, limit])).rows.map((r) => ({ id: Number(r.id), name: r.name, job: r.job, score: Number(r.score) }));
  }
  async seasonMine(season: string, ladder: string, id: number) {
    const r = (await this.db.query<any>(`SELECT score, (SELECT COUNT(*) FROM season_scores o WHERE o.season=$1 AND o.ladder=$2 AND o.score > s.score) + 1 AS rank
       FROM season_scores s WHERE season=$1 AND ladder=$2 AND character_id=$3`, [season, ladder, id])).rows[0];
    return r ? { score: Number(r.score), rank: Number(r.rank) } : null;
  }
  /** Marks a season's ladder as paid; false when it already was (so it is paid exactly once). */
  async seasonClaim(season: string, ladder: string): Promise<boolean> {
    return ((await this.db.query('INSERT INTO season_paid(season, ladder) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING season', [season, ladder])).rows.length) > 0;
  }
  /** Spends honour if there is enough: the new spendable amount, or null when there is not. */
  async pvpSpend(id: number, n: number): Promise<number | null> {
    const r = await this.db.query<{ left: number }>('UPDATE pvp_stats SET honor_spent = honor_spent + $2 WHERE character_id = $1 AND honor - honor_spent >= $2 RETURNING honor - honor_spent AS left', [id, n]);
    return r.rows[0] ? Number(r.rows[0].left) : null;
  }
  pvpAdd(c: { id: number; name: string; job: string }, d: Partial<Record<'kills' | 'deaths' | 'duels_won' | 'duels_lost' | 'arena_kills' | 'arena_deaths' | 'honor' | 'rating' | 'bg_won' | 'bg_lost', number>>) {
    const cols = Object.keys(d), vals = Object.values(d);
    return this.db.query(
      `INSERT INTO pvp_stats(character_id, name, job, ${cols.join(', ')}) VALUES ($1,$2,$3, ${cols.map((k, i) => (k === 'rating' ? `1000 + $${i + 4}` : `$${i + 4}`)).join(', ')})
       ON CONFLICT (character_id) DO UPDATE SET name=$2, ${cols.map((k, i) => `${k} = pvp_stats.${k} + $${i + 4}`).join(', ')}, updated_at=now()`,
      [c.id, c.name, c.job, ...vals],
    );
  }
  async pvpStats(ids: number[]) {
    if (!ids.length) return [];
    return (await this.db.query<any>('SELECT * FROM pvp_stats WHERE character_id = ANY($1::bigint[])', [`{${ids.join(',')}}`])).rows;
  }
  async pvpRankings(by: 'rating' | 'kills' | 'duels_won' | 'arena_kills' | 'bg_won', limit = 20) {
    return (await this.db.query<any>(`SELECT character_id AS id, name, job, kills, deaths, duels_won, duels_lost, arena_kills, arena_deaths, bg_won, bg_lost, honor, rating FROM pvp_stats ORDER BY ${by} DESC, character_id LIMIT $1`, [limit])).rows;
  }
}
