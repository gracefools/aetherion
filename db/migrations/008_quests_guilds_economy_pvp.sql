-- M13: quest progress and history, faction reputation. M14: personal bank. M15: pets and mounts.
-- Stored per character as validated JSON documents, like inventory and skills.
ALTER TABLE characters
  ADD COLUMN quests     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN reputation JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN bank       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN companions JSONB NOT NULL DEFAULT '{}'::jsonb;

-- M13: factions are database records. The server loads these at start; a faction added here (with
-- a region whose lorekeeper runs its shop) appears in the game without a code change.
CREATE TABLE factions (
  id      TEXT PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{1,23}$'),
  name    TEXT NOT NULL,
  seat    TEXT NOT NULL,
  region  TEXT NOT NULL,
  creed   TEXT NOT NULL,
  about   TEXT NOT NULL,
  shop    JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [[item id, gold price, reputation level], ...]
  sort    INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true
);

-- M14: guilds.
CREATE TABLE guilds (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  name_lower TEXT NOT NULL UNIQUE,
  tag        TEXT NOT NULL UNIQUE,
  emblem     JSONB NOT NULL,
  leader_id  BIGINT NOT NULL,
  level      INT NOT NULL DEFAULT 1,
  exp        BIGINT NOT NULL DEFAULT 0,
  motd       TEXT NOT NULL DEFAULT '',
  bank_gold  BIGINT NOT NULL DEFAULT 0 CHECK (bank_gold >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE guild_members (
  character_id BIGINT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,  -- one guild per character
  guild_id     BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  rank         INT NOT NULL CHECK (rank BETWEEN 0 AND 3),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guild_members_guild_idx ON guild_members(guild_id);
CREATE TABLE guild_log (
  id       BIGSERIAL PRIMARY KEY,
  guild_id BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  text     TEXT NOT NULL
);
CREATE INDEX guild_log_guild_idx ON guild_log(guild_id, at DESC);

-- M14: auction house. A listed item lives in its row (it has left the seller's bag). Proceeds,
-- expired and cancelled items wait in auction_claims until the owner collects them at a banker.
CREATE TABLE auction_listings (
  id         BIGSERIAL PRIMARY KEY,
  seller_id  BIGINT NOT NULL,
  seller     TEXT NOT NULL,
  item       JSONB NOT NULL,
  base       TEXT NOT NULL,
  category   TEXT NOT NULL,
  rarity     INT NOT NULL,
  price      BIGINT NOT NULL CHECK (price > 0),
  fee        BIGINT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled', 'expired')),
  buyer_id   BIGINT,
  buyer      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  closed_at  TIMESTAMPTZ
);
CREATE INDEX auction_active_idx ON auction_listings(status, category, price) WHERE status = 'active';
CREATE INDEX auction_seller_idx ON auction_listings(seller_id, status);
CREATE INDEX auction_buyer_idx ON auction_listings(buyer_id);
CREATE TABLE auction_claims (
  id           BIGSERIAL PRIMARY KEY,
  character_id BIGINT NOT NULL,
  gold         BIGINT NOT NULL DEFAULT 0,
  item         JSONB,
  reason       TEXT NOT NULL,
  listing_id   BIGINT,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auction_claims_char_idx ON auction_claims(character_id);

-- M14: bank audit log.
CREATE TABLE bank_log (
  id           BIGSERIAL PRIMARY KEY,
  character_id BIGINT NOT NULL,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  op           TEXT NOT NULL,
  detail       JSONB NOT NULL
);
CREATE INDEX bank_log_char_idx ON bank_log(character_id, at DESC);

-- M15: PvP record and ranking.
CREATE TABLE pvp_stats (
  character_id BIGINT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  job          TEXT NOT NULL,
  kills        INT NOT NULL DEFAULT 0,
  deaths       INT NOT NULL DEFAULT 0,
  duels_won    INT NOT NULL DEFAULT 0,
  duels_lost   INT NOT NULL DEFAULT 0,
  arena_kills  INT NOT NULL DEFAULT 0,
  arena_deaths INT NOT NULL DEFAULT 0,
  honor        INT NOT NULL DEFAULT 0,
  rating       INT NOT NULL DEFAULT 1000,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pvp_rating_idx ON pvp_stats(rating DESC);

-- The six factions of the setting, as data.
INSERT INTO factions (id, name, seat, region, creed, about, shop, sort) VALUES
 ('crown', 'The Starfall Crown', 'Eldoria', 'eldoria', 'What fell on us, we will carry.', 'The kingdom founded on the crater of the fallen star. Its knights and clerics hold the roads and pay the old debt: guarding what the star brought with it.',
  '[["hp_potion",16,0],["scroll_fire",220,1],["pet_iron_pup",1800,2],["mount_plains_strider",3000,3]]', 1),
 ('wardens', 'The Mossbound Wardens', 'Mosswatch, Verdant Reach', 'verdant', 'The forest keeps count.', 'Rangers and hermits who bargain with the old forest instead of clearing it. They believe every tree felled without need is repaid somewhere else.',
  '[["mana_potion",20,0],["scroll_wind",220,1],["pet_moss_sprout",1800,2],["mount_plains_strider",2800,3]]', 2),
 ('forge', 'The Cinder Compact', 'Cinderhold, Ashen Highlands', 'ashen', 'Fire is a tool until you forget it.', 'Smiths and berserkers who work the dragon-heated vents. They arm every other faction and trust none of them.',
  '[["upgrade_stone",130,0],["scroll_earth",220,1],["pet_ember_kit",1800,2],["mount_ashen_charger",6000,3]]', 3),
 ('hearth', 'The Hearthsworn', 'Hearthglen, Frostveil', 'frostveil', 'One fire, shared.', 'Survivors of the unending winter. Their law is simple: no door is barred against the cold, and no one eats alone.',
  '[["hp_potion",16,0],["scroll_water",220,1],["pet_frost_owlet",1800,2],["mount_frost_elk",6000,3]]', 4),
 ('lantern', 'The Lantern Vigil', 'Lanternfen, Dreadmoor', 'dreadmoor', 'Name the dead, and they stay dead.', 'Gravewardens who keep the rolls of the drowned battlefield. They fight the risen not from hatred but as a courtesy owed.',
  '[["mana_potion",20,0],["scroll_lightning",220,1],["pet_bog_toad",1800,2],["mount_frost_elk",6000,3]]', 5),
 ('runewrights', 'The Last Runewrights', 'Starfall Camp, Astral Ruins', 'astral', 'The seal holds while someone remembers why.', 'A handful of scholars living in the wreck of their own city. They taught the world rune magic and paid for it first.',
  '[["scroll_random",120,0],["scroll_advanced",500,2],["pet_star_mote",2400,3],["mount_void_skiff",12000,4]]', 6);
