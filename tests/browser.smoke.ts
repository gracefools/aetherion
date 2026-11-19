// Real-browser end-to-end test (headless Chromium via playwright-core).
// Drives the actual UI: register -> full character creator -> walk/run -> actions -> second player
// -> chat -> character sheet -> reload/resume, plus sprite-sheet validation in the page.
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright-core';
import { createApp } from '../server/src/app';
import { config } from '../server/src/config';
import { defaultAppearance } from '../shared/src/appearance';
import { fullStats, ITEMS } from '../shared/src/items';
import { give, sendInv } from '../server/src/game/Inventory';
import { sendDisc } from '../server/src/game/Places';
import { buildChanged } from '../server/src/game/Abilities';
import { DEPTH_MONSTER } from '../shared/src/depths';
import { rollSigil } from '../shared/src/gear';
import { navOf, reachableAt } from '../shared/src/nav';
import { blocked } from '../shared/src/world';
const blockedAt = (zone: string, x: number, y: number) => blocked(ZONES[zone] && (getZoneMapB(zone)), x, y);
import { getZoneMap as getZoneMapB } from '../shared/src/world';
import { REGIONS, tileCenter, ZONES } from '../shared/src/world';
import { zoneObjects } from '../shared/src/places';
import { MONSTERS, SPAWNS, WORLD_BOSSES } from '../shared/src/monsters';
import { decodePng, encodePng } from '../scripts/png';
import { AMB, AUDIO_DEFS, BGM, ZONE_AMBIENCE, ZONE_MUSIC } from '../shared/src/audio';
import { TILE } from '../shared/src/protocol';
import { ownsRune, RUNE_SHOP } from '../shared/src/runes';
import { QUESTS } from '../shared/src/quests';
import { MONSTER_LOOK } from '../shared/src/expansion';
import { expToNext } from '../shared/src/combat';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://aetherion:aetherion_dev@127.0.0.1:5432/aetherion_test';
const app = await createApp({ ...config, databaseUrl: dbUrl, host: '127.0.0.1', authRateLimit: 10_000, debugOverlay: true });
(app.world.opts as any).events = false; // events are started on purpose by the checks that need them
const base = `http://127.0.0.1:${await app.listen(0)}`;
const browser = await chromium.launch();
const errors: string[] = [];
const uid = Date.now().toString(36).slice(-6);
const dbg = (p: Page) => p.evaluate(() => (window as any).__game.debug());
const btn = (p: Page, name: string) => p.getByRole('button', { name, exact: true });

async function enter(name: string, customise: (p: Page) => Promise<void>): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(base);
  await page.getByText('New here? Create an account').click();
  await page.fill('input[name=username]', `${name}_${uid}`);
  await page.fill('input[name=password]', 'browser-pass-1');
  await btn(page, 'Create account').click();
  await page.waitForSelector('input[name=charname]');
  await page.fill('input[name=charname]', name + uid);
  await customise(page);
  await btn(page, 'Enter Aetherion').click();
  await page.waitForFunction(() => (window as any).__game?.debug().hud.status === 'playing');
  return page;
}
const tab = (p: Page, name: string) => p.getByRole('tab', { name, exact: true }).click();

try {
  // ---------- creator: every tab, job-specific weapon, animation preview ----------
  const p1 = await enter('Lyra', async (p) => {
    await btn(p, 'Mage').click();
    assert.ok(await p.getByText('Magic DPS').isVisible(), 'job card shows the role');
    await tab(p, 'Body');
    await btn(p, 'Feminine').click();
    await btn(p, 'Tall').click();
    await btn(p, 'Skin 4').click();
    await tab(p, 'Face & hair');
    await btn(p, 'Freckles').click();
    await btn(p, 'Wide').click();
    await btn(p, 'Eye color 3').click();
    await btn(p, 'Ponytail').click();
    await btn(p, 'Hair color 6').click();
    await tab(p, 'Outfit');
    await btn(p, 'Long coat').click();
    await btn(p, 'Primary color 6').click();
    await btn(p, 'Secondary color 5').click();
    await btn(p, 'Long').click();
    await btn(p, 'Cape color 2').click();
    await tab(p, 'Gear');
    await btn(p, 'Magic Orb').click();
    await btn(p, 'Leather').click();
    await btn(p, 'Circlet').click();
    await btn(p, 'Amulet').click();
    await btn(p, 'Frost').click();
    for (const a of ['walk', 'run', 'attack', 'cast', 'hit', 'death']) await btn(p, a).click();
    for (const d of ['Left', 'Right', 'Back', 'Front']) await btn(p, d).click();
  });
  const want = {
    ...defaultAppearance('mage'), body: 1, height: 2, skin: 3, face: 1, eyes: 2, eyeColor: 2, hair: 5, hairColor: 5,
    clothing: 3, color1: 5, color2: 4, cape: 2, capeColor: 1, weapon: 1, armor: 1, helmet: 4, accessory: 4, aura: 3,
  };
  const row = (await app.db.query('SELECT id, job, appearance FROM characters WHERE name=$1', ['Lyra' + uid])).rows[0];
  assert.equal(row.job, 'mage');
  assert.deepEqual(row.appearance, want, 'creator choices saved to PostgreSQL');
  const start = await dbg(p1);
  assert.deepEqual(start.hud.stats, fullStats('mage', 1, 1, start.hud.eq));
  assert.equal(start.hud.eq.weapon.base, 'crystal_orb', 'the starter weapon matches the creator choice');
  assert.equal(start.anim, 'idle');

  // ---------- run, then walk with Shift ----------
  // the HD renderer builds terrain and sprite sheets over the first frames in a zone: measure once it has settled
  await p1.waitForFunction(() => (window as any).__game.debug().warm, null, { timeout: 60000 });
  // speed is measured against the page's own clock, so a slow moment of the test machine does not count as running faster
  await p1.keyboard.down('KeyD');
  const t0 = await p1.evaluate(() => performance.now()); // taken right after the key goes down ...
  await p1.waitForTimeout(500);
  assert.equal((await dbg(p1)).anim, 'run');
  await p1.waitForTimeout(500);
  const t1 = await p1.evaluate(() => performance.now()); // ... and right before it comes up
  await p1.keyboard.up('KeyD');
  await p1.waitForFunction(() => (window as any).__game.debug().pending === 0);
  const ran = await dbg(p1), speed = ((ran.x - start.x) / (t1 - t0)) * 1000;
  assert.ok(speed > 110 && speed < 230, `ran ${ran.x - start.x}px in ${Math.round(t1 - t0)} ms: ${Math.round(speed)} px/s (expected ~160)`);
  await p1.keyboard.down('ShiftLeft');
  await p1.keyboard.down('KeyD');
  await p1.waitForTimeout(500);
  assert.equal((await dbg(p1)).anim, 'walk');
  await p1.waitForTimeout(500);
  await p1.keyboard.up('KeyD');
  await p1.keyboard.up('ShiftLeft');
  await p1.waitForFunction(() => (window as any).__game.debug().pending === 0);
  const walked = await dbg(p1);
  assert.ok(walked.x - ran.x > 70 && walked.x - ran.x < 125, `walked ${walked.x - ran.x}px in ~1s (expected ~96)`);
  assert.equal(walked.x, app.world.online.get(row.id)!.x, 'prediction converged to the authoritative position');
  console.log(`run ${ran.x - start.x}px, walk ${walked.x - ran.x}px, corrections=${walked.corrections}, maxCorrection=${walked.maxCorrection.toFixed(2)}px`);

  // ---------- second player sees appearance + animations ----------
  const p2 = await enter('Bram', async (p) => {
    await btn(p, 'Berserker').click();
    await tab(p, 'Gear');
    await btn(p, 'Dual Axes').click();
  });
  await p2.waitForFunction(() => (window as any).__game.debug().remotes === 1);
  await p2.waitForFunction(() => (window as any).__game.debug().warm, null, { timeout: 60000 }); // the HD art has finished building: short animations are not missed
  const seen = (await dbg(p2)).remoteList[0];
  assert.deepEqual(seen.ap, want, 'other player renders the exact customised appearance');

  // a free swing needs nothing in reach: a wild monster wandering by would turn it into a real attack
  {
    const me = [...app.world.online.values()].find((q) => q.name === 'Lyra' + uid)!;
    for (const mo of me.room.monsters.values()) if (!mo.dead && Math.hypot(mo.x - me.x, mo.y - me.y) < 400) app.world.hurt(mo, 1e9, 0, null);
    await p1.waitForFunction(() => !(window as any).__game.debug().monsters.some((m: any) => m.hp > 0 && Math.hypot(m.x - (window as any).__game.debug().x, m.y - (window as any).__game.debug().y) < 400));
  }
  await p1.keyboard.press('Space');
  assert.equal((await dbg(p1)).anim, 'attack', 'local attack animation plays immediately');
  await p2.waitForFunction(() => (window as any).__game.debug().remoteList[0].anim === 'attack', undefined, { polling: 16 });
  await p1.keyboard.down('KeyA');
  await p2.waitForFunction(() => (window as any).__game.debug().remoteList[0].anim === 'run', undefined, { polling: 16 });
  await p1.keyboard.up('KeyA');

  await p2.keyboard.press('Enter');
  await p2.keyboard.type('hail from the browser');
  await p2.keyboard.press('Enter');
  await p1.waitForSelector(`.chatlog >> text=hail from the browser`);

  // ---------- HUD + character sheet ----------
  const s = fullStats('mage', 1, 1, start.hud.eq);
  assert.equal(await p1.getByRole('meter', { name: 'HP' }).innerText(), `${s.maxHp} / ${s.maxHp}`);
  assert.equal(await p2.getByRole('meter', { name: 'rage' }).innerText(), `0 / 100`);
  await p1.keyboard.press('KeyC');
  const sheet = p1.getByRole('dialog', { name: 'Character' });
  for (const t of ['Arcane Mind', 'Cataclysm', 'Runeweaver', 'Magic Orb', 'Intellect']) assert.ok(await sheet.getByText(t).first().isVisible(), `sheet shows ${t}`);
  await p1.screenshot({ path: '.run/m2-sheet.png' });
  await p1.keyboard.press('Escape');
  await p1.waitForTimeout(1500);
  const fps = (await dbg(p1)).hud.fps;
  await p1.screenshot({ path: '.run/m2-world.png' });

  // ---------- sprite sheet validation (asset pipeline contract) ----------
  await p1.evaluate('window.__name = (f) => f'); // esbuild keep-names helper used by the compiled callback below
  const art = await p1.evaluate(() => {
    const A = (window as any).__art;
    const jobs = ['knight', 'mage', 'ranger', 'assassin', 'cleric', 'berserker'];
    const FW = 48, FH = 48, COLS = 24;
    const problems: string[] = [];
    let sheets = 0;
    const px = (c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const frame = (d: Uint8ClampedArray, col: number, row: number) => {
      const out: number[] = [];
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const i = ((row * FH + y) * COLS * FW + col * FW + x) * 4; out.push(d[i], d[i + 1], d[i + 2], d[i + 3]); }
      return out;
    };
    const opaque = (f: number[]) => { let n = 0; for (let i = 3; i < f.length; i += 4) if (f[i] > 0) n++; return n; };
    const same = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);
    const mirror = (f: number[]) => { const o = new Array(f.length); for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) for (let k = 0; k < 4; k++) o[(y * FW + x) * 4 + k] = f[(y * FW + (FW - 1 - x)) * 4 + k]; return o; };
    for (const job of jobs) {
      const aps = [A.defaultAppearance(job), { ...A.defaultAppearance(job), weapon: 1 }, A.randomAppearance(job), A.randomAppearance(job), A.randomAppearance(job)];
      for (const ap of aps) {
        const sheet = A.renderSheet(ap, job);
        sheets++;
        if (sheet.width !== COLS * FW || sheet.height !== 4 * FH) problems.push(`${job}: sheet size ${sheet.width}x${sheet.height}`);
        const d = px(sheet);
        for (let row = 0; row < 4; row++) for (let col = 0; col < COLS; col++) if (opaque(frame(d, col, row)) < 60) problems.push(`${job}: empty frame col ${col} row ${row}`);
        for (const col of [0, 2, 6, 11]) if (!same(frame(d, col, 1), mirror(frame(d, col, 2)))) problems.push(`${job}: left is not a mirror of right at col ${col}`);
        for (let row = 0; row < 4; row++) {
          const idle = frame(d, 0, row);
          for (const [name, col] of [['walk', 2], ['run', 6], ['attack', 12], ['cast', 16], ['hit', 18], ['death', 22]] as const)
            if (same(idle, frame(d, col, row))) problems.push(`${job}: ${name} frame equals idle (row ${row})`);
          if (same(frame(d, 0, row), frame(d, 0, (row + 1) % 4)) && row !== 1) problems.push(`${job}: directions ${row}/${row + 1} identical`);
        }
        const total = opaque(frame(d, 0, 0));
        for (const layer of ['body', 'clothing', 'weapon']) {
          const n = opaque(frame(px(A.renderSheet(ap, job, layer)), 0, 0));
          if (n === 0 || n >= total) problems.push(`${job}: isolated layer ${layer} has ${n}px of ${total}`);
        }
      }
    }
    return { sheets, problems, layers: A.LAYERS.length };
  });
  assert.deepEqual(art.problems, [], 'sprite sheets valid');
  console.log(`validated ${art.sheets} sheets (${art.sheets * 96} frames): dimensions, non-empty frames, mirroring, 7 animations x 4 directions distinct, ${art.layers} isolatable layers`);

  // ---------- M3: combat through the real UI ----------
  const me1 = app.world.online.get(row.id)!;
  const moss = app.world.spawn(me1.room, 'mossling', me1.x + 70, me1.y + 10);
  await p1.waitForFunction((id) => (window as any).__game.debug().monsters.some((m: any) => m.id === id), moss.id);
  const view = await dbg(p1);
  const mv = view.monsters.find((m: any) => m.id === moss.id);
  await p1.mouse.click((mv.x - view.camX) * view.zoom, (mv.y - 6 - view.camY) * view.zoom);
  const frame = p1.getByRole('status', { name: 'Target' });
  await frame.getByText('Mossling').waitFor();
  assert.equal(me1.target, moss, 'click-to-target reached the server');
  await p1.keyboard.press('Space');
  await frame.getByText('Attacking').waitFor();
  await p1.waitForFunction(() => (window as any).__game.debug().hud.exp > 0, undefined, { timeout: 15000 });
  const afterKill = await dbg(p1);
  assert.equal(afterKill.hud.exp, 12);
  assert.ok(afterKill.dmgSeen >= 2, 'damage events rendered');
  assert.equal(afterKill.hud.target, null, 'target cleared on kill');
  assert.equal(await p1.getByRole('meter', { name: 'EXP' }).innerText(), 'EXP 12 / 40');
  // Tab picks the nearest monster; Escape clears it
  const moss2 = app.world.spawn(me1.room, 'mossling', me1.x - 60, me1.y);
  await p1.waitForFunction((id) => (window as any).__game.debug().monsters.some((m: any) => m.id === id), moss2.id);
  await p1.keyboard.press('Tab');
  await frame.getByText('Mossling').waitFor();
  await p1.keyboard.press('Escape');
  await p1.waitForFunction(() => (window as any).__game.debug().hud.target === null, null, { timeout: 5000 }).catch(async (e) => {
    throw new Error(`target after Escape: client ${JSON.stringify((await dbg(p1)).hud.target)}, server ${me1.target?.id}, focus ${await p1.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))}`, { cause: e });
  });
  me1.room.monsters.delete(moss2.id);
  me1.room.grid.remove(moss2);
  // level up toast
  app.world.grantExp(me1, 40);
  await p1.getByText('Level 2!').waitFor();
  assert.equal((await dbg(p1)).hud.self.level, 2);
  // death dialog and respawn
  app.world.hurt(me1, 99999, 0, null);
  const fallen = p1.getByRole('alertdialog', { name: 'You have fallen' });
  await fallen.waitFor();
  assert.equal((await dbg(p1)).anim, 'death');
  await p1.keyboard.down('KeyD');
  await p1.waitForTimeout(300);
  await p1.keyboard.up('KeyD');
  assert.equal(me1.dead, true);
  await fallen.getByRole('button', { name: 'Respawn' }).click({ timeout: 8000 });
  await fallen.waitFor({ state: 'detached' });
  const alive = await dbg(p1);
  assert.equal(alive.hud.hp, fullStats('mage', 2, 1, alive.hud.eq).maxHp);
  assert.deepEqual(alive.hud.statuses, ['Returning Ward']);
  await p1.screenshot({ path: '.run/m3-after-respawn.png' });

  // ---------- M4: skills and runes through the real UI ----------
  await p1.keyboard.press('KeyK');
  const book = p1.getByRole('dialog', { name: 'Skills and runes' });
  await book.waitFor();
  assert.ok(await book.getByRole('button', { name: 'Learn Cataclysm' }).isDisabled(), 'high-level skill is locked');
  await book.getByRole('button', { name: 'Learn Arcane Bolt' }).click();
  await p1.waitForFunction(() => (window as any).__game.debug().hud.build.skills.arcane_bolt === 1);
  assert.deepEqual(me1.build.skills, { arcane_bolt: 1 }, 'server recorded the skill');
  await book.getByRole('tab', { name: 'Runes' }).click();
  // rune changes are refused in combat; the death above counts, so retry until the server accepts
  for (let i = 0; i < 20 && me1.build.runes.slots[0] !== 'fire'; i++) {
    // runes are collected (M12): this character is given Fire and Water here; buying and scrolls are tested further down
    me1.build.runes.lv.fire = me1.build.runes.lv.water = 1;
    app.world.send(me1, { t: 'build', build: me1.build });
    await p1.waitForFunction(() => (window as any).__game.debug().hud.build.runes.lv.fire === 1);
    await book.getByRole('group', { name: 'Rune slot 1' }).getByRole('button', { name: 'Fire Rune' }).click();
    await p1.waitForTimeout(500);
  }
  await p1.waitForFunction(() => (window as any).__game.debug().hud.build.runes.slots[0] === 'fire');
  await book.getByText('Fireball').first().waitFor();
  await p1.screenshot({ path: '.run/m4-runes.png' });
  await p1.keyboard.press('Escape');
  const dummy = app.world.spawn(me1.room, 'rootwarden', me1.x + 90, me1.y);
  (dummy as any).def = { ...dummy.def, aggro: 0 };
  await p1.waitForFunction((id) => (window as any).__game.debug().monsters.some((m: any) => m.id === id), dummy.id);
  const v2 = await dbg(p1), dv = v2.monsters.find((m: any) => m.id === dummy.id);
  await p1.mouse.click((dv.x - v2.camX) * v2.zoom, (dv.y - 6 - v2.camY) * v2.zoom);
  await frame.getByText('Rootwarden').waitFor();
  const bar = p1.getByRole('toolbar', { name: 'Abilities' });
  assert.ok(await bar.getByRole('button', { name: 'Arcane Bolt (1)' }).isVisible() && await bar.getByRole('button', { name: 'Fireball (Q)' }).isVisible(), 'hotbar shows the learned skill and the rune spell');
  const realRnd = app.world.rnd;
  app.world.rnd = () => 0.5; // no misses or crits while we assert on the two casts
  const mana0 = (await dbg(p1)).hud.res;
  await p1.keyboard.press('Digit1');
  await p1.waitForFunction(() => (window as any).__game.debug().hud.cds.arcane_bolt !== undefined);
  assert.ok(dummy.hp < dummy.maxHp, 'Arcane Bolt damaged the target');
  // the other player sees the cast: the pose is brief on a background page, so its spell effect counts too
  await p2.waitForFunction(() => { const d = (window as any).__game.debug(); return d.remoteList[0].anim === 'cast' || d.fx.includes('arcane_bolt'); }, undefined, { polling: 16 });
  await p1.waitForTimeout(600);
  const hp1 = dummy.hp;
  await p1.keyboard.press('KeyQ');
  await p1.waitForFunction(() => (window as any).__game.debug().hud.cds.fireball !== undefined);
  assert.ok(dummy.hp < hp1, 'Fireball damaged the target');
  const manaNow = (await dbg(p1)).hud.res;
  assert.ok(manaNow >= mana0 - 20 && manaNow <= mana0 - 20 + 15, `mana spent: 6 + 14, less a little regeneration (${mana0} -> ${manaNow})`);
  assert.equal(me1.build.runes.xp.fire, 10, 'rune gained experience');
  app.world.rnd = realRnd;
  await bar.getByRole('button', { name: 'Fireball (Q)' }).click();
  await p1.getByRole('alert').getByText('Not ready').waitFor();
  await p1.screenshot({ path: '.run/m4-cast.png' });
  me1.room.monsters.delete(dummy.id);
  me1.room.grid.remove(dummy);

  // ---------- M5: party through the real UI ----------
  const me2 = [...app.world.online.values()].find((x) => x !== me1)!;
  me2.x = me1.x + 60; me2.y = me1.y + 20; me2.room.grid.update(me2); me2.ver++;
  await p2.keyboard.press('KeyS'); // resync p2's prediction after the server-side move
  await p1.waitForFunction((x) => { const r = (window as any).__game.debug().remoteList[0]; return !!r && Math.abs(r.x - x) < 12; }, me2.x);
  const v3 = await dbg(p1), other = v3.remoteList[0];
  await p1.bringToFront(); // the clicking page renders at full rate
  await p1.mouse.click((other.x - v3.camX) * v3.zoom, (other.y - 10 - v3.camY) * v3.zoom);
  await p1.getByRole('status', { name: 'Ally' }).getByRole('button', { name: 'Invite to party' }).click();
  const ask = p2.getByRole('alertdialog', { name: 'Party invitation' });
  await ask.getByText('invites you to a party').waitFor();
  await ask.getByRole('button', { name: 'Accept' }).click();
  const frames1 = p1.getByRole('group', { name: 'Party' }), frames2 = p2.getByRole('group', { name: 'Party' });
  await frames1.getByText('Bram' + uid).waitFor();
  await frames2.getByText('Lyra' + uid).waitFor();
  assert.equal(app.world.parties.count, 1);
  assert.equal(me1.party!.leader, me1.id);
  assert.ok(await frames2.getByTitle('Party leader').isVisible(), 'leader is marked on the member\'s screen');
  // From the member's health at this moment, not from full health: an area attack the test elite had
  // already wound up before it was removed can still land on both players a moment earlier.
  const hp2 = me2.hp;
  app.world.hurt(me2, 57, 0, null);
  await frames1.getByText(`${hp2 - 57} / ${me2.maxHp}`).waitFor({ timeout: 4000 });
  // party chat and whisper
  await p2.keyboard.press('Enter');
  await p2.keyboard.type('/p ready when you are');
  await p2.keyboard.press('Enter');
  await p1.locator('.chatlog .party').getByText('ready when you are').waitFor();
  await p1.keyboard.press('Enter');
  await p1.keyboard.type(`/w Bram${uid} this is private`);
  await p1.keyboard.press('Enter');
  await p2.locator('.chatlog .whisper').getByText('this is private').waitFor();
  await p1.screenshot({ path: '.run/m5-party.png' });
  // the leader can hand over leadership; leaving disbands a party of two
  await frames1.getByRole('button', { name: `Make Bram${uid} leader` }).click();
  await p1.waitForFunction(() => { const h = (window as any).__game.debug().hud; return h.party && h.party.leader !== h.self.id; });
  await frames2.getByRole('button', { name: 'Leave party' }).click();
  await p1.waitForFunction(() => (window as any).__game.debug().hud.party === null);
  await p2.waitForFunction(() => (window as any).__game.debug().hud.party === null);
  assert.equal(app.world.parties.count, 0);

  // monster sprite sheets
  const mart = await p1.evaluate(() => {
    const A = (window as any).__art, problems: string[] = [];
    for (const type of A.MONSTER_TYPES) {
      const s = A.getMonsterSheet(type) as HTMLCanvasElement, F = s.height / 2;
      if (s.width !== F * 13) problems.push(`${type}: sheet ${s.width}x${s.height}`);
      const d = s.getContext('2d')!.getImageData(0, 0, s.width, s.height).data;
      const frame = (col: number, row: number) => { const o: number[] = []; for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) { const i = ((row * F + y) * s.width + col * F + x) * 4; o.push(d[i], d[i + 1], d[i + 2], d[i + 3]); } return o; };
      const opaque = (f: number[]) => { let n = 0; for (let i = 3; i < f.length; i += 4) if (f[i] > 0) n++; return n; };
      const same = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);
      for (let row = 0; row < 2; row++) for (let col = 0; col < 13; col++) if (opaque(frame(col, row)) < 80) problems.push(`${type}: empty frame ${col}/${row}`);
      const idle = frame(0, 0);
      for (const [name, col] of [['move', 2], ['attack', 7], ['hit', 9], ['death', 11]] as const) if (same(idle, frame(col, 0))) problems.push(`${type}: ${name} equals idle`);
      if (same(frame(0, 0), frame(0, 1))) problems.push(`${type}: left equals right`);
    }
    const sheets = A.MONSTER_TYPES.map((t: string) => A.getMonsterSheet(t).toDataURL());
    if (new Set(sheets).size !== A.MONSTER_TYPES.length) problems.push('two monster types share a sheet');
    return { n: A.MONSTER_TYPES.length, problems };
  });
  assert.deepEqual(mart.problems, [], 'monster sheets valid');
  assert.equal(mart.n, 40 + Object.keys(MONSTER_LOOK).length, 'the 40 drawn monsters and the recoloured monsters of the later regions');
  console.log(`combat UI ok; validated ${mart.n} monster sheets (${mart.n * 26} frames, all distinct)`);

  // ---------- M6: inventory, equipment, shop and potions through the real UI ----------
  {
    const sp = ZONES.eldoria.spawn;
    const pl = [...app.world.online.values()].find((q) => q.name === 'Lyra' + uid)!;
    pl.x = tileCenter(sp.tx); pl.y = tileCenter(sp.ty) + 40; // stand in the plaza (the shop)
    (app.world as any).welcome(pl);
    pl.gold = 500;
    // earlier sections left monsters around: clear them so the upgrade below is not refused as 'in combat'
    for (const mo of [...pl.room.monsters.values()]) if (!mo.dead) app.world.hurt(mo, 1e9, 0, null);
    pl.lastCombat = -1e6;
    give(pl, { base: 'cloth_robe', rar: 2, ilvl: 2, aff: [['maxHp', 12], ['mdef', 3]], up: 0, qty: 1 });
    give(pl, { base: 'cloth_hood', rar: 1, ilvl: 2, aff: [['maxRes', 9]], up: 0, qty: 1 });
    give(pl, { base: 'longsword', rar: 3, ilvl: 2, aff: [['atk', 3], ['def', 2], ['maxHp', 9]], up: 0, qty: 1 });
    give(pl, { base: 'upgrade_stone', rar: 0, ilvl: 1, aff: [], up: 0, qty: 3 });
    sendInv(app.world, pl);
    await p1.waitForFunction(() => (window as any).__game.debug().hud.gold === 500);
    await p1.keyboard.press('KeyI');
    const bagUi = p1.getByRole('dialog', { name: 'Inventory' });
    await bagUi.waitFor();
    const hp0 = (await dbg(p1)).hud.stats.maxHp;
    // inspect, compare and equip the robe; the knight sword is refused with the reason shown
    await bagUi.getByRole('button', { name: 'Epic Longsword and Kite Shield' }).click();
    assert.ok(await bagUi.getByText('Only for Knights').isVisible());
    assert.ok(await bagUi.getByRole('button', { name: 'Equip', exact: true }).isDisabled());
    await bagUi.getByRole('button', { name: 'Rare Woven Robe' }).first().click(); // earlier loot may have dropped another
    await bagUi.getByRole('button', { name: 'Equip', exact: true }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.eq.armor?.base === 'cloth_robe');
    await bagUi.getByRole('button', { name: 'Uncommon Scholar Hood' }).first().dblclick();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.eq.helmet?.base === 'cloth_hood');
    const worn = await dbg(p1);
    assert.deepEqual(worn.hud.stats, fullStats('mage', pl.level, 1, worn.hud.eq), 'the HUD shows server stats including gear');
    assert.ok(worn.hud.stats.maxHp > hp0);
    assert.equal(worn.hud.self.ap.helmet, ITEMS.cloth_hood.look!.helmet, 'my own sprite wears the hood');
    await p2.waitForFunction((n) => (window as any).__game.debug().remoteList.find((r: any) => r.name === n)?.ap.helmet === 2, 'Lyra' + uid);
    // upgrade the equipped robe (first step always succeeds)
    await bagUi.getByRole('button', { name: /Woven Robe/ }).first().click();
    await bagUi.getByRole('button', { name: /^Upgrade to \+1/ }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.eq.armor?.up === 1, null, { timeout: 5000 }).catch(async (e) => { console.log('DEBUG', JSON.stringify((await dbg(p1)).hud.notice), pl.gold, pl.inv.map((i) => i.base + i.qty), pl.eq.armor); await p1.screenshot({ path: '.run/dbg.png' }); throw e; });
    await p1.locator('.chatlog').getByText('Upgrade succeeded').waitFor();
    // shop: buy a mana potion, sell the sword
    const gold0 = (await dbg(p1)).hud.gold;
    await bagUi.getByRole('button', { name: 'Buy Mana Potion for 24 gold' }).click();
    await p1.waitForFunction((g) => (window as any).__game.debug().hud.gold === g - 24, gold0);
    await bagUi.getByRole('button', { name: 'Epic Longsword and Kite Shield' }).click();
    await bagUi.getByRole('button', { name: /^Sell/ }).click();
    await p1.waitForFunction((g) => (window as any).__game.debug().hud.gold > g - 24, gold0);
    await p1.screenshot({ path: '.run/m6-inventory.png' });
    await p1.keyboard.press('Escape');
    await bagUi.waitFor({ state: 'detached' });
    // potions: Z heals and starts the shared cooldown, X is then refused
    app.world.hurt(pl, Math.floor(pl.maxHp / 2), 0, null);
    pl.res = 0;
    const hpBefore = pl.hp, pots = pl.inv.find((i) => i.base === 'hp_potion')!.qty;
    await p1.keyboard.press('KeyZ');
    await p1.waitForFunction(() => (window as any).__game.debug().hud.potionAt > 0);
    assert.ok(pl.hp > hpBefore, 'the potion healed on the server');
    assert.equal(pl.inv.find((i) => i.base === 'hp_potion')!.qty, pots - 1);
    await p1.keyboard.press('KeyX');
    await p1.locator('.notice').getByText('Potions are on cooldown').waitFor();
    // loot notification from a real kill
    app.world.rnd = () => 0.01;
    const prey = app.world.spawn(pl.room, 'mossling', pl.x + 60, pl.y);
    app.world.hurt(prey, 99999, 0, pl);
    app.world.rnd = Math.random;
    await p1.locator('.lootfeed').getByText(/gold/).waitFor();
    await p1.screenshot({ path: '.run/m6-loot.png' });
    console.log('inventory UI ok: equip, compare, upgrade, shop, potions, loot feed');
  }

  // ---------- M7: dungeon and boss through the real UI ----------
  {
    const w = app.world, pl = [...w.online.values()].find((q) => q.name === 'Lyra' + uid)!;
    const gate = ZONES.verdant.gates![0];
    pl.level = 12;
    w.grantExp(pl, 0);
    pl.recalc();
    pl.hp = pl.maxHp;
    w.relocate(pl, w.roomIn('verdant', pl), tileCenter(gate.tx), tileCenter(gate.ty) - 40);
    for (const mo of [...pl.room.monsters.values()]) if (!mo.dead) w.hurt(mo, 1e9, 0, null); // keep the walk-up quiet
    const dlg = p1.getByRole('dialog', { name: 'Dungeon: Ancient Ruins' });
    await dlg.waitFor();
    assert.ok(await dlg.getByText('no entry cost, no limit').isVisible(), 'the dialog states that entry is free and unlimited');
    assert.ok(await dlg.getByText('Ancient Rune Guardian always drops one item for every player').isVisible());
    await p1.screenshot({ path: '.run/m7-gate.png' });
    await dlg.getByRole('radio', { name: /Hard/ }).click();
    await dlg.getByRole('button', { name: 'Enter alone' }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().zone === 'd_ruins');
    const tracker = p1.getByRole('status', { name: 'Dungeon progress' });
    await tracker.getByText('The Outer Vault').waitFor();
    const run = w.dungeons.runs.get(pl.room)!;
    assert.equal(run.diff, 'hard');
    const first = [...run.alive][0];
    w.relocate(pl, pl.room, first.x - 140, first.y);
    await p1.waitForFunction(() => (window as any).__game.debug().monsters.length >= 3);
    await p1.waitForTimeout(600);
    await p1.screenshot({ path: '.run/m7-dungeon.png' });
    for (let st = 0; st < 3; st++) {
      for (const mo of [...run.alive]) w.hurt(mo, 1e9, 0, pl);
      await p1.waitForFunction((n) => (window as any).__game.debug().hud.dungeon?.stage === n, st + 1, { timeout: 8000 });
    }
    const boss = [...run.alive][0];
    (boss as any).def = { ...boss.def, aggro: 0 }; // hold still for the screenshot
    w.relocate(pl, pl.room, boss.x - 170, boss.y + 20);
    const bar = p1.getByRole('status', { name: 'Boss: Ancient Rune Guardian' });
    await bar.waitFor();
    assert.ok(await bar.getByText('Phase 1: Dormant Seals').isVisible());
    w.hurt(boss, Math.ceil(boss.maxHp * 0.45), 0, pl);
    // two players share the machine: bring this one to the front so its frames are not throttled
    await p1.bringToFront();
    // the page polled here is the one in the background: wait on the game state, then on what it shows
    await p1.waitForFunction(() => (window as any).__game.debug().hud.boss?.phase === 1).catch(async (e) => {
      const d = await p1.evaluate(() => { const g = (window as any).__game.debug(); return { boss: g.hud.boss, dead: g.hud.dead, zone: g.hud.zoneId, conn: g.hud.conn, chat: g.hud.chat.slice(-4).map((c: any) => c.text) }; }).catch((x) => String(x));
      throw new Error(`boss phase: client ${JSON.stringify(d)}; server phase ${boss.phase} hp ${boss.hp}/${boss.maxHp} dead ${boss.dead} state ${(boss as any).state}; player hp ${pl.hp} dead ${pl.dead} room ${pl.room.zoneId}; ${e}`);
    });
    await bar.getByText('Phase 2: Seals Unbound').waitFor();
    // the announcement: a banner for a few seconds, and a line that stays in the chat
    await p1.locator('.chatlog').getByText(/seals shatter/).first().waitFor();
    await p1.waitForTimeout(900);
    await p1.screenshot({ path: '.run/m7-boss.png' });
    w.hurt(boss, 1e9, 0, pl);
    await tracker.getByText(/Cleared in/).waitFor();
    await p1.locator('.lootfeed').getByText(/Epic|Legendary|Mythic/).first().waitFor();
    assert.ok(pl.inv.some((i) => i.rar >= 3), 'a boss item is in the bag');
    await p1.screenshot({ path: '.run/m7-cleared.png' });
    await tracker.getByRole('button', { name: 'Leave dungeon' }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().zone === 'verdant');
    await tracker.waitFor({ state: 'detached' });
    assert.equal((await dbg(p1)).hud.boss, null);
    console.log('dungeon UI ok: gate dialog, difficulty, tracker, boss bar and phases, banner, loot, leave');
  }

  // ---------- M8: townsfolk, travel, gathering, lore and all six regions through the real UI ----------
  {
    const w = app.world, pl = [...w.online.values()].find((q) => q.name === 'Lyra' + uid)!;
    const obj = (z: string, kind: string) => zoneObjects(z).find((o) => o.kind === kind)!;
    const quiet = () => { for (const mo of [...pl.room.monsters.values()]) if (!mo.dead && !mo.def.boss) w.hurt(mo, 1e9, 0, null); pl.lastCombat = -1e6; };
    // waystone keeper in Mosswatch: attunes on arrival, then offers travel
    const kv = obj('verdant', 'waykeeper');
    w.relocate(pl, pl.room, kv.x, kv.y + 34);
    quiet();
    await p1.locator('.hint').getByText('Talk to Waykeeper Thorne').waitFor();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.disc.includes('wp:verdant'));
    await p1.keyboard.press('KeyF');
    const way = p1.getByRole('dialog', { name: 'Waykeeper Thorne' });
    await way.waitFor();
    assert.ok(await way.getByText('You are here').isVisible());
    assert.equal(await way.getByText('Not attuned').count(), REGIONS.length - 2, 'every region but these two is not visited yet');
    await p1.screenshot({ path: '.run/m8-waystone.png' });
    pl.gold += 500;
    sendInv(w, pl);
    await way.getByRole('button', { name: /Travel to Eldoria for 5 gold/ }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().zone === 'eldoria');
    await way.waitFor({ state: 'detached' });
    // lorekeeper
    const lk = obj('eldoria', 'lorekeeper');
    w.relocate(pl, pl.room, lk.x + 30, lk.y);
    await p1.locator('.hint').getByText('Talk to Archivist Odalric').waitFor();
    await p1.keyboard.press('KeyF');
    const lore = p1.getByRole('dialog', { name: 'Archivist Odalric' });
    await lore.getByText('Eldoria and the Starfall Crown').waitFor();
    await lore.getByRole('button', { name: 'Go on' }).click();
    await lore.getByText(/They asked for too much/).waitFor();
    assert.ok(await lore.getByText('The Starfall Crown', { exact: true }).isVisible(), 'the local faction is introduced');
    await p1.screenshot({ path: '.run/m8-lore.png' });
    await p1.keyboard.press('Escape');
    await lore.waitFor({ state: 'detached' });
    // merchant: crafting from gathered materials
    const mer = obj('eldoria', 'merchant');
    w.relocate(pl, pl.room, mer.x + 30, mer.y);
    give(pl, { base: 'iron_ore', rar: 0, ilvl: 1, aff: [], up: 0, qty: 4 });
    sendInv(w, pl);
    await p1.locator('.hint').getByText('Talk to Quartermaster Bren').waitFor();
    await p1.keyboard.press('KeyF');
    const shop = p1.getByRole('dialog', { name: 'Quartermaster Bren' });
    await shop.waitFor();
    const stones = pl.inv.reduce((n, i) => n + (i.base === 'upgrade_stone' ? i.qty : 0), 0);
    await shop.getByRole('button', { name: 'Craft Upgrade Stone (stone)' }).click();
    await p1.waitForFunction((n) => (window as any).__game.debug().hud.inv.reduce((t: number, i: any) => t + (i.base === 'upgrade_stone' ? i.qty : 0), 0) === n + 1, stones);
    assert.ok(await shop.getByRole('button', { name: 'Craft Upgrade Stone (stone)' }).isDisabled(), 'out of ore');
    await p1.screenshot({ path: '.run/m8-merchant.png' });
    await p1.keyboard.press('Escape');
    // gathering with F
    const node = obj('eldoria', 'node');
    w.relocate(pl, pl.room, node.x + 6, node.y);
    quiet();
    await p1.locator('.hint').getByText(`Gather ${node.name}`).waitFor();
    await p1.keyboard.press('KeyF');
    await p1.locator('.lootfeed').getByText(ITEMS[node.res!].name).waitFor();
    await p1.locator('.hint').waitFor({ state: 'detached' });
    assert.ok(pl.inv.some((i) => i.base === node.res));
    // every region renders: town and wilderness screenshots, no console errors
    for (const z of REGIONS.slice(1)) {
      const t = ZONES[z].town!;
      w.relocate(pl, w.roomIn(z, pl), tileCenter(t.tx), tileCenter(t.ty) + 48);
      await p1.waitForFunction((zz) => (window as any).__game.debug().zone === zz, z);
      await p1.waitForTimeout(700);
      await p1.screenshot({ path: `.run/m8-${z}-town.png` });
      const gsp = SPAWNS[z][1];
      const mo = [...pl.room.monsters.values()].find((x) => x.def.id === gsp.type)!;
      (mo as any).def = { ...mo.def, aggro: 0 };
      // the camps are larger now: clear the neighbours so nothing kills the visitor while it looks
      for (const o of [...pl.room.monsters.values()]) if (o !== mo && !o.dead && !o.def.boss && Math.hypot(o.x - mo.x, o.y - mo.y) < 900) { o.noRespawn = true; w.hurt(o, 1e9, 0, null); }
      pl.hp = pl.maxHp;
      w.relocate(pl, pl.room, mo.x - 90, mo.y + 30);
      await p1.waitForFunction(() => (window as any).__game.debug().monsters.length > 0, null, { timeout: 10000 }).catch(async (e) => {
        const d = await dbg(p1);
        throw new Error(`${z}: no monster seen near ${mo.def.id} at ${Math.round(mo.x)},${Math.round(mo.y)} (dead ${mo.dead}); player ${Math.round(pl.x)},${Math.round(pl.y)} room ${pl.room.zoneId}; client zone ${d.zone} at ${Math.round(d.x)},${Math.round(d.y)}, ${d.monsters.length} monsters; ${e}`);
      });
      await p1.waitForTimeout(700);
      await p1.screenshot({ path: `.run/m8-${z}-wild.png` });
      assert.equal((await dbg(p1)).hud.zone, ZONES[z].name);
    }
    // world boss in Dreadmoor: visible with its bar from the edge of its clearing
    const wb = WORLD_BOSSES[0], room = w.roomIn(wb.zone, pl), sk = [...room.monsters.values()].find((x) => x.def.id === wb.type)!;
    (sk as any).def = { ...sk.def, aggro: 0 };
    for (const o of [...room.monsters.values()]) if (!o.dead && !o.def.boss && Math.hypot(o.x - sk.x, o.y - sk.y) < 1200) { o.noRespawn = true; w.hurt(o, 1e9, 0, null); }
    pl.hp = pl.maxHp;
    w.relocate(pl, room, sk.x - 190, sk.y + 30);
    await p1.getByRole('status', { name: 'Boss: Shadow Knight' }).waitFor({ timeout: 15000 }).catch(async (e) => {
      const d = await dbg(p1);
      throw new Error(`world boss: server ${sk.def.id} hp ${sk.hp} dead ${sk.dead} at ${Math.round(sk.x)},${Math.round(sk.y)}; player ${pl.room.zoneId} ${Math.round(pl.x)},${Math.round(pl.y)}; client ${d.zone} ${Math.round(d.x)},${Math.round(d.y)} monsters ${JSON.stringify(d.monsters.slice(0, 5))} boss ${JSON.stringify(d.hud.boss)}; ${e}`);
    });
    await p1.waitForTimeout(500);
    await p1.screenshot({ path: '.run/m8-worldboss.png' });
    w.relocate(pl, w.roomIn('eldoria', pl), tileCenter(ZONES.eldoria.spawn.tx), tileCenter(ZONES.eldoria.spawn.ty) + 60);
    await p1.waitForFunction(() => (window as any).__game.debug().zone === 'eldoria');
    console.log(`world UI ok: waystone travel, lore, crafting, gathering, ${REGIONS.length} regions and a world boss rendered`);
  }

  // ---------- monster navigation: the developer overlay, and a monster walking round an obstacle on screen ----------
  {
    const w = app.world, pl = [...w.online.values()].find((q) => q.name === 'Lyra' + uid)!;
    for (const mo of [...pl.room.monsters.values()]) if (!mo.dead && !mo.def.boss) w.hurt(mo, 1e9, 0, null);
    const walker = w.spawn(pl.room, 'mossling', pl.x + 120, pl.y + 40);
    assert.equal((await dbg(p1)).dev, true, 'this test server allows the overlay');
    await p1.keyboard.press('F9');
    await p1.waitForFunction((id) => (window as any).__game.debug().dbgMobs.some((m: any[]) => m[0] === id), walker.id);
    const row = (await dbg(p1)).dbgMobs.find((m: any[]) => m[0] === walker.id);
    assert.ok(['idle', 'patrol'].includes(row[1]) && row[6] > 0, 'state and patrol radius arrive in the page');
    await p1.waitForTimeout(400);
    await p1.screenshot({ path: '.run/nav-debug.png' });
    await p1.keyboard.press('F9');
    await p1.waitForFunction(() => (window as any).__game.debug().dbgOn === false);
    w.hurt(walker, 1e9, 0, null);
    console.log('navigation overlay ok: spawn point, radii, AI state and routes drawn for developers (F9)');
  }

  // ---------- M10: music, sound effects and audio settings through the real page ----------
  let savedAudio: any;
  {
    const w = app.world, pl = [...w.online.values()].find((q) => q.name === 'Lyra' + uid)!;
    const au = () => p1.evaluate(() => (window as any).__audio.debug());
    /** Waits until this track is the one actually sounding (decoded, started and faded in). */
    const playing = (id: string, timeout = 20000) => p1.waitForFunction((want) => {
      const d = (window as any).__audio.debug();
      return d.music.playing === want && d.music.level > 0.5;
    }, id, { timeout }).catch(async () => assert.fail(`expected ${id} to be playing: ${JSON.stringify((await au()).music)}`));
    const heard = (id: string, timeout = 6000) => p1.waitForFunction((want) => (window as any).__audio.log.includes(want), id, { timeout })
      .catch(async () => assert.fail(`expected to hear ${id}; heard ${JSON.stringify((await au()).log.slice(-15))}`));
    const forget = () => p1.evaluate(() => { (window as any).__audio.log.length = 0; });
    // quiet ground for listening to the region themes: monsters are cleared and stay away (they respawn within seconds)
    const quiet = () => { for (const mo of [...pl.room.monsters.values()]) if (!mo.dead && !mo.def.boss) { mo.noRespawn = true; w.hurt(mo, 1e9, 0, null); } pl.lastCombat = -1e6; };
    const go = async (zone: string, x: number, y: number) => {
      w.relocate(pl, w.roomIn(zone, pl), x, y);
      await p1.waitForFunction(([zz, xx]) => { const d = (window as any).__game.debug(); return d.zone === zz && Math.abs(d.x - (xx as number)) < 40; }, [zone, x] as const);
      quiet();
    };
    const tilesFrom = (zone: string, x: number, y: number) => Math.hypot(x / TILE - ZONES[zone].town!.tx, y / TILE - ZONES[zone].town!.ty);
    const target = async (mo: { id: number }) => {
      await p1.waitForFunction((id) => (window as any).__game.debug().monsters.some((m: any) => m.id === id), mo.id);
      const v = await dbg(p1), mv = v.monsters.find((m: any) => m.id === mo.id);
      await p1.mouse.click((mv.x - v.camX) * v.zoom, (mv.y - 6 - v.camY) * v.zoom);
      await p1.waitForFunction((id) => (window as any).__game.debug().targetId === id, mo.id);
    };

    // the engine started on the first interaction and every sound in the build loaded
    let a = await au();
    assert.equal(a.state, 'running', 'the first click unlocked audio');
    assert.equal(a.context, 'running');
    assert.equal(a.assets, AUDIO_DEFS.length, 'the build ships every sound in the catalogue');
    await p1.waitForFunction((n) => (window as any).__audio.debug().effectsReady >= n, AUDIO_DEFS.filter((d) => d.category === 'sfx').length, { timeout: 40000 });
    assert.deepEqual((await au()).failed, [], 'every file fetched and decoded');

    // --- each region has its own theme; the capital also has its own ambience ---
    const sp0 = ZONES.eldoria.spawn;
    await go('eldoria', tileCenter(sp0.tx), tileCenter(sp0.ty) + 60);
    await playing(BGM.CITY);
    assert.equal((await au()).ambience.want, AMB.CITY);
    const themes = new Set<string>([BGM.CITY]);
    for (const z of REGIONS.slice(1)) {
      // somewhere in the wilds: well outside the village and nowhere near a world boss
      // ... and outside the region's open-PvP area, whose fierce monsters would make this a fight
      // ... and away from elites (their camps play the elite theme)
      const fits = (tx: number, ty: number) => tilesFrom(z, tileCenter(tx), tileCenter(ty)) > 20 && WORLD_BOSSES.every((b) => b.zone !== z || Math.hypot(b.tx - tx, b.ty - ty) > 30)
        && SPAWNS[z].every((g) => !MONSTERS[g.type].elite || Math.hypot(g.tx - tx, g.ty - ty) > 16);
      let gsp: { tx: number; ty: number } | undefined = SPAWNS[z].find((g) => fits(g.tx, g.ty));
      // no camp qualifies: any open ground that does
      const zn = navOf(z);
      for (let ty = 4; ty < zn.map.h - 4 && !gsp; ty++) for (let tx = 4; tx < zn.map.w - 4 && !gsp; tx++) if (zn.reach[tx + ty * zn.map.w] && fits(tx, ty)) gsp = { tx, ty };
      await go(z, tileCenter(gsp!.tx), tileCenter(gsp!.ty));
      await playing(ZONE_MUSIC[z]);
      themes.add(ZONE_MUSIC[z]);
      assert.equal((await au()).ambience.want, ZONE_AMBIENCE[z]);
    }
    assert.equal(themes.size, 6, 'six regions, six different tracks');

    // --- a village has its own music, with a soft boundary: stepping just outside does not switch back ---
    const vt = ZONES.verdant.town!;
    await go('verdant', tileCenter(vt.tx), tileCenter(vt.ty) + 48);
    await playing(BGM.VILLAGE);
    const starts0 = (await au()).music.starts;
    await go('verdant', tileCenter(vt.tx + 12), tileCenter(vt.ty)); // between the inner (10) and outer (14) boundary
    await p1.waitForTimeout(900);
    a = await au();
    assert.equal(a.music.playing, BGM.VILLAGE, 'still the village theme just outside the village');
    assert.equal(a.music.starts, starts0, 'crossing the inner boundary did not restart or switch the music');
    await go('verdant', tileCenter(vt.tx + 12), tileCenter(vt.ty + 13)); // 17.7 tiles away
    await playing(BGM.FOREST);

    // --- combat: real attacks switch to combat music, with weapon and hit sounds; afterwards the region theme resumes ---
    await go('eldoria', tileCenter(sp0.tx), tileCenter(sp0.ty) + 60);
    await playing(BGM.CITY);
    await p1.waitForTimeout(1500);
    const city0 = (await au()).music;
    await forget();
    const moss3 = w.spawn(pl.room, 'mossling', pl.x + 70, pl.y + 10);
    await target(moss3);
    await p1.keyboard.press('Space');
    await heard('combat.staff_attack'); // Lyra carries a Magic Orb
    await heard('combat.monster_hit');
    await heard('game.battle_start'); // the hit that opens the fight
    await playing(BGM.COMBAT);
    w.hurt(moss3, 1e9, 0, pl);
    await heard('combat.monster_death');
    await playing(BGM.CITY, 25000); // after the 5 s combat timeout and the 3 s linger
    a = await au();
    const cityLen = 40, ahead = (a.music.position - city0.position + cityLen) % cityLen;
    if (city0.position < cityLen - 12) assert.ok(ahead < 10, `the city theme resumed where it stopped (was at ${city0.position}s, now ${a.music.position}s)`);

    // --- rune spells: fire and water sound different, and a fireball is heard leaving and landing ---
    await p1.evaluate(() => (window as any).__game.attune(1, 'water'));
    await p1.waitForFunction(() => (window as any).__game.debug().hud.build.runes.slots[1] === 'water');
    const dummy2 = w.spawn(pl.room, 'mossling', pl.x + 90, pl.y);
    dummy2.hp = dummy2.maxHp = 50000; // a harmless target that survives both spells
    await target(dummy2);
    await forget();
    await p1.keyboard.press('KeyQ');
    await heard('rune.fireball_cast');
    await heard('rune.fireball_impact');
    await p1.waitForTimeout(700); // global cooldown
    await p1.keyboard.press('KeyT');
    await heard('rune.water_bolt');
    assert.ok(!(await au()).log.includes('rune.thunder_strike'), 'no lightning sound for fire or water');

    // --- an elite turns the fight music up; a boss has its own; its death plays the victory theme ---
    w.hurt(dummy2, 1e9, 0, pl);
    const elite = w.spawn(pl.room, 'rootwarden', pl.x + 110, pl.y - 20);
    (elite as any).def = { ...elite.def, aggro: 0, atk: 0 }; // it may fight back, but cannot kill the test's player
    w.hurt(elite, 10, 0, pl);
    await playing(BGM.ELITE);
    w.hurt(elite, 1e9, 0, pl);
    await forget();
    const boss = w.spawn(pl.room, 'rune_guardian', pl.x + 160, pl.y + 20);
    (boss as any).def = { ...boss.def, aggro: 0 };
    await heard('game.boss_spawn');
    await playing(BGM.DUNGEON_BOSS);
    boss.noRespawn = true; // as in a dungeon run: it stays dead
    w.hurt(boss, 1e9, 0, pl);
    assert.ok(boss.dead, 'the boss fell');
    await heard('game.boss_defeat');
    await playing(BGM.VICTORY);
    quiet();
    await playing(BGM.CITY, 30000); // the fanfare ends, the fight is over: back to the city

    // --- world boss: its own track, and the marsh's ambience ---
    const wb = WORLD_BOSSES[0], sk = [...w.roomIn(wb.zone, pl).monsters.values()].find((x) => x.def.id === wb.type)!;
    await go(wb.zone, sk.x - 190, sk.y + 30);
    await playing(BGM.WORLD_BOSS);
    assert.equal((await au()).ambience.want, AMB.WATER);

    // --- death: the defeat theme and the death sound; respawning brings the region back ---
    await go('eldoria', tileCenter(sp0.tx), tileCenter(sp0.ty) + 60);
    await playing(BGM.CITY);
    await forget();
    w.hurt(pl, 99999, 0, null);
    await heard('combat.player_death');
    await playing(BGM.DEFEAT);
    await p1.waitForFunction(() => (window as any).__game.debug().hud.canRespawn, null, { timeout: 8000 });
    await p1.getByRole('button', { name: 'Respawn', exact: true }).click();
    await heard('ui.click');
    await playing(BGM.CITY);

    // --- settings panel: sliders and switches act at once and are saved to the account ---
    await p1.keyboard.press('KeyO');
    const panel = p1.getByRole('dialog', { name: 'Settings' });
    await panel.waitFor();
    assert.equal(await panel.getByText('Temporary placeholder audio').count(), 0, 'the audio is recorded, so no placeholder notice is shown');
    // moves a slider the way a drag does: the browser's own value setter, then the input event React listens for
    const slide = (name: string, value: number) => panel.locator(`input[name=${name}]`).evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    await slide('music', 30);
    await slide('sfx', 50);
    await slide('ambient', 20);
    await slide('master', 90);
    await panel.getByText('30%').waitFor();
    a = await au();
    assert.deepEqual([a.settings.master, a.settings.music, a.settings.sfx, a.settings.ambient], [0.9, 0.3, 0.5, 0.2]);
    assert.ok(Math.abs(a.gains.music - 0.09) < 1e-9, 'the music bus follows the slider');
    await panel.getByLabel('Mute all').check();
    a = await au();
    assert.equal(a.gains.master, 0, 'mute all silences everything');
    await forget();
    await p1.getByRole('button', { name: 'Close Settings', exact: true }).click(); // the window's title-bar close
    await p1.waitForTimeout(200);
    assert.deepEqual((await au()).log, [], 'no effect is even started while muted');
    await p1.keyboard.press('KeyO');
    await panel.getByLabel('Mute all').uncheck();
    await panel.getByLabel('Music', { exact: true }).uncheck();
    a = await au();
    assert.equal(a.gains.music, 0, 'music off');
    assert.ok(a.gains.sfx > 0 && a.gains.master > 0, 'effects stay on when only music is off');
    await panel.getByLabel('Sound effects', { exact: true }).uncheck();
    assert.deepEqual([(await au()).gains.sfx, (await au()).gains.ambient], [0, 0], 'sound effects off also silences ambience');
    await panel.getByLabel('Sound effects', { exact: true }).check();
    await p1.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    savedAudio = (await au()).settings;
    assert.deepEqual(savedAudio, { master: 0.9, music: 0.3, sfx: 0.5, ambient: 0.2, muteAll: false, musicOn: false, sfxOn: true });
    // ... and reaches PostgreSQL
    const stored = async () => (await app.db.query<{ settings: any }>('SELECT s.settings FROM account_settings s JOIN accounts a ON a.id = s.account_id WHERE a.username = $1', [`Lyra_${uid}`])).rows[0]?.settings?.audio;
    for (let i = 0; i < 40 && JSON.stringify(await stored()) !== JSON.stringify(savedAudio); i++) await p1.waitForTimeout(100);
    assert.deepEqual(await stored(), savedAudio, 'audio settings are stored on the account in PostgreSQL');

    // --- cost: decoded audio held in memory, decode times, voices ---
    a = await au();
    const mb = (n: number) => (n / 1048576).toFixed(1);
    assert.ok(a.memory.music <= 64 * 1048576 + 20 * 1048576, `decoded music stays within the cache budget (${mb(a.memory.music)} MB)`);
    assert.ok(a.voices <= 24, 'voice cap respected');
    console.log(`audio ok: 6 region themes, village boundary, combat/elite/boss/world boss/victory/defeat music, weapon + rune + UI sounds, settings saved to the account`);
    console.log(`audio cost: decoded music ${mb(a.memory.music)} MB, effects ${mb(a.memory.sfx)} MB; ${a.stats.decodes} decodes, avg ${(a.stats.decodeMs / a.stats.decodes).toFixed(0)} ms, max ${a.stats.maxDecodeMs.toFixed(0)} ms; ${mb(a.stats.fetchedBytes)} MB downloaded; ` +
      `${a.stats.played} effects played, ${a.stats.throttled} throttled, ${a.stats.dropped} dropped by the voice cap, ${a.stats.evicted} tracks evicted; fps ${(await dbg(p1)).hud.fps}`);
  }

  // ---------- M11: auto hunting, bulk sale, sorting and trading through the real UI ----------
  {
    const w = app.world, pl = [...w.online.values()].find((q) => q.name === 'Lyra' + uid)!, other = [...w.online.values()].find((q) => q.name === 'Bram' + uid)!;
    const sp0 = ZONES.eldoria.spawn, ax = tileCenter(sp0.tx), ay = tileCenter(sp0.ty) + 70;
    w.relocate(pl, w.roomIn('eldoria', pl), ax, ay);
    await p1.waitForFunction((x) => Math.abs((window as any).__game.debug().x - x) < 30 && (window as any).__game.debug().zone === 'eldoria', ax);
    // a quiet area: wild monsters are cleared and stay away (they now respawn within seconds)
    for (const mo of [...pl.room.monsters.values()]) if (!mo.dead && !mo.def.boss) { mo.noRespawn = true; w.hurt(mo, 1e9, 0, null); }
    pl.lastCombat = -1e6;
    pl.hp = pl.maxHp;
    give(pl, { base: 'hp_potion', rar: 0, ilvl: 1, aff: [], up: 0, qty: 5 });
    sendInv(w, pl);
    const potions = () => pl.inv.reduce((n, i) => n + (i.base === 'hp_potion' ? i.qty : 0), 0);
    const auto = () => p1.evaluate(() => (window as any).__game.debug().auto);

    // the panel: open it, change a threshold, start
    await p1.keyboard.press('KeyV');
    const panel = p1.getByRole('region', { name: 'Auto hunting' });
    await panel.waitFor();
    assert.equal(await panel.getByRole('status', { name: 'Auto hunting status' }).textContent(), 'Off');
    await panel.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 10000 }).catch(async (e) => {
      await p1.screenshot({ path: '.run/fail-auto.png' });
      const box = await panel.boundingBox(), html = await panel.evaluate((el) => el.outerHTML.slice(0, 600));
      throw new Error(`auto panel settings: box ${JSON.stringify(box)} ${html}; ${e}`);
    });
    await panel.getByLabel('HP potion threshold').fill('80');
    await panel.getByLabel('Hunting radius').fill('9');
    await p1.waitForFunction(() => (window as any).__game.debug().hud.auto.cfg.hpPct === 80 && (window as any).__game.debug().hud.auto.cfg.radius === 9);
    assert.ok(await panel.getByLabel('Use Fireball automatically').isChecked(), 'the attuned rune spell is offered and on by default');
    await panel.getByRole('button', { name: 'Hide settings' }).click();
    const prey = [w.spawn(pl.room, 'mossling', ax + 150, ay + 10), w.spawn(pl.room, 'mossling', ax - 200, ay - 190), w.spawn(pl.room, 'mossling', ax + 30, ay + 150)]; // the second is beyond every spell of a mage (267 px from the start, Arcane Bolt reaches 260) but inside the 9-tile hunting area: it has to be walked to
    // the far one stays where it is (no wandering into range), so the hunter must really walk to it
    (prey[1] as any).def = { ...prey[1].def, aggro: 0, speed: 0 };
    const outside = w.spawn(pl.room, 'mossling', ax + 9 * TILE + 130, ay); // beyond the hunting radius: must be left alone
    await p1.waitForFunction((n) => (window as any).__game.debug().monsters.length >= n, prey.length);
    const kills0 = 0, exp0 = pl.exp + pl.level * 1e6;
    // how far the hunter goes is sampled from the moment it starts (it may walk to the far monster first)
    let farEarly = 0;
    const sampler = setInterval(() => { farEarly = Math.max(farEarly, Math.hypot(pl.x - ax, pl.y - ay)); }, 50);
    await panel.getByRole('button', { name: 'Start Auto Hunting' }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().auto.on === true);
    assert.equal(await panel.getByRole('status', { name: 'Auto hunting status' }).textContent(), 'Running');
    await p1.waitForFunction(() => /Moving to|Fighting/.test((window as any).__game.debug().auto.status), null, { timeout: 8000 }).catch(async (e) => {
      throw new Error(`hunter never started: ${JSON.stringify(await auto())}, target ${JSON.stringify((await dbg(p1)).hud.target)}, prey ${prey.map((m) => `${m.dead}:${Math.round(m.x - ax)},${Math.round(m.y - ay)}`)}`, { cause: e });
    });
    assert.equal(pl.autoOn, true, 'the server has a session');
    let far = 0, farDeath = `before the hunt: dead ${prey[1].dead} hp ${prey[1].hp} at ${Math.round(prey[1].x - ax)},${Math.round(prey[1].y - ay)} blocked ${blocked(pl.room.map, prey[1].x, prey[1].y)} reachable ${reachableAt(navOf('eldoria'), prey[1].x, prey[1].y)}; `;
    for (let i = 0; i < 400 && prey.some((m) => !m.dead); i++) {
      await p1.waitForTimeout(150);
      far = Math.max(far, Math.hypot(pl.x - ax, pl.y - ay));
      if (prey[1].dead && !farDeath.includes('died')) farDeath += `far one died with the player at ${Math.round(pl.x - ax)},${Math.round(pl.y - ay)}, ${Math.round(Math.hypot(prey[1].x - pl.x, prey[1].y - pl.y))} px from it, it at ${Math.round(prey[1].x - ax)},${Math.round(prey[1].y - ay)}; status ${(await auto()).status}`;
      assert.ok(Math.hypot(pl.x - ax, pl.y - ay) <= 9 * TILE + 40, 'the hunter stays inside its hunting area');
    }
    assert.ok(prey.every((m) => m.dead), 'every monster in the area was hunted down by real attacks');
    assert.equal(outside.dead, false, 'the monster outside the hunting radius was not touched');
    assert.equal(outside.hp, outside.maxHp);
    clearInterval(sampler);
    far = Math.max(far, farEarly);
    assert.ok(far > 30, `it walked to its targets (${Math.round(far)} px from the start; ${farDeath})`);
    assert.ok(pl.autoStats.kills - kills0 >= 3 && pl.exp + pl.level * 1e6 > exp0, 'kills and EXP were counted by the server');
    await panel.getByText(String(pl.autoStats.kills), { exact: true }).first().waitFor();
    const hunted = pl.autoStats.kills;
    // with nothing left it walks back to the hunting spot and waits
    await p1.waitForFunction(() => /Looking for a target|No monsters within|outside the 9-tile hunting area/.test((window as any).__game.debug().auto.status), null, { timeout: 15000 });
    assert.ok(Math.hypot(pl.x - ax, pl.y - ay) < 60, 'back at the hunting spot');
    // auto potion: at the threshold, one potion, validated by the server
    const before = potions();
    w.hurt(pl, Math.floor(pl.maxHp * 0.4), 0, null);
    await p1.waitForFunction(() => true);
    for (let i = 0; i < 130 && potions() === before; i++) await p1.waitForTimeout(100); // up to the potion cooldown, in case one was drunk during the hunt
    assert.equal(potions(), before - 1, 'one Health Potion was drunk below the 80% threshold');
    await p1.waitForTimeout(600);
    assert.equal(potions(), before - 1, `and no second one while the cooldown runs (before ${before}, now ${potions()}, inventory ${JSON.stringify(pl.inv.map((i) => [i.base, i.qty]))}, loot ${pl.autoStats.items})`);
    // Stop is immediate
    await panel.getByRole('button', { name: 'Stop Auto Hunting' }).click();
    assert.equal((await auto()).on, false);
    await p1.waitForFunction(() => true);
    for (let i = 0; i < 20 && pl.autoOn; i++) await p1.waitForTimeout(50);
    assert.equal(pl.autoOn, false, 'the server session ended');
    const lone = w.spawn(pl.room, 'mossling', ax + 120, ay);
    await p1.waitForTimeout(1200);
    assert.equal(lone.hp, lone.maxHp, 'nothing is attacked after Stop');
    // moving steers for a moment and does not stop it; the hotkey starts and stops it
    await panel.getByRole('button', { name: 'Start Auto Hunting' }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().auto.on === true);
    await p1.keyboard.down('KeyA');
    await p1.waitForFunction(() => /steering/.test((window as any).__game.debug().auto.status));
    await p1.keyboard.up('KeyA');
    assert.equal((await auto()).on, true, 'moving does not stop auto hunting');
    await p1.keyboard.press('Backquote');
    await p1.waitForFunction(() => (window as any).__game.debug().auto.on === false);
    await p1.keyboard.press('Backquote');
    await p1.waitForFunction(() => (window as any).__game.debug().auto.on === true);
    // the session may end by itself at any moment (nothing left to hunt): only stop it if it is still running
    if ((await auto()).on) await p1.keyboard.press('Backquote');
    await p1.waitForFunction(() => (window as any).__game.debug().auto.on === false).catch(async () => { await p1.keyboard.press('Backquote'); await p1.waitForFunction(() => (window as any).__game.debug().auto.on === false); });
    await p1.screenshot({ path: '.run/m11-auto.png' });
    w.hurt(lone, 1e9, 0, null);
    w.hurt(outside, 1e9, 0, null);
    await panel.getByRole('button', { name: 'Close auto hunting' }).click();
    console.log(`auto hunting ok: ${hunted} monsters hunted through the real client, stayed in its area, auto potion at the threshold, Stop and the hotkey immediate, steering keeps it running`);

    // --- sort and bulk sale ---
    w.relocate(pl, pl.room, ax, ay - 20);
    await p1.waitForFunction((y) => Math.abs((window as any).__game.debug().y - y) < 30, ay - 20);
    pl.inv.length = 0;
    for (const [base, rar, ilvl] of [['longsword', 0, 3], ['cloth_hood', 1, 4], ['greatsword', 2, 6], ['cloth_robe', 0, 2], ['leather_jerkin', 0, 5]] as const) give(pl, { base, rar, ilvl, aff: [], up: 0, qty: 1 });
    give(pl, { base: 'upgrade_stone', rar: 0, ilvl: 1, aff: [], up: 0, qty: 4 });
    sendInv(w, pl);
    await p1.keyboard.press('KeyI');
    const bag = p1.getByRole('dialog', { name: 'Inventory' });
    await bag.waitFor();
    await bag.getByLabel('Sort inventory').selectOption('rarity');
    await p1.waitForFunction(() => (window as any).__game.debug().hud.inv[0].base === 'greatsword');
    assert.deepEqual(pl.inv.map((i) => i.rar), [2, 1, 0, 0, 0, 0], 'the server sorted the bag by rarity');
    const common = pl.inv.filter((i) => ITEMS[i.base].kind === 'equip' && i.rar === 0), worth = common.reduce((n, i) => n + (pl.gold - pl.gold) + 0, 0);
    const gold0 = pl.gold;
    await bag.getByRole('button', { name: 'Bulk sell…' }).click();
    await bag.getByRole('button', { name: 'Common gear', exact: true }).click();
    await bag.getByText(`${common.length}`, { exact: true }).first().waitFor();
    await bag.getByRole('button', { name: 'Sell marked items' }).click();
    await bag.getByRole('button', { name: /^Confirm: sell 3 for/ }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.inv.length === 3);
    assert.ok(pl.gold > gold0 + worth, 'gold was paid');
    assert.deepEqual(pl.inv.map((i) => i.base).sort(), ['cloth_hood', 'greatsword', 'upgrade_stone'], 'only the marked items were sold');
    await p1.keyboard.press('Escape');

    // --- trade: Lyra gives a sword, Bram gives gold ---
    w.relocate(other, pl.room, pl.x + 50, pl.y);
    other.gold = 90;
    sendInv(w, other);
    await p1.waitForFunction(() => (window as any).__game.debug().remotes >= 1);
    await p1.keyboard.press('Enter');
    await p1.keyboard.type(`/trade Bram${uid}`);
    await p1.keyboard.press('Enter');
    const ask2 = p2.getByRole('alertdialog', { name: 'Trade request' });
    await ask2.getByText('wants to trade with you').waitFor();
    await ask2.getByRole('button', { name: 'Trade', exact: true }).click();
    const t1 = p1.getByRole('dialog', { name: `Trade with Bram${uid}` }), t2 = p2.getByRole('dialog', { name: `Trade with Lyra${uid}` });
    await t1.waitFor();
    await t2.waitFor();
    await t1.getByRole('button', { name: 'Offer Greatsword', exact: true }).click();
    await t2.getByText('Greatsword').first().waitFor();
    await t2.getByLabel('Gold to give').fill('60');
    await t2.getByRole('button', { name: 'Set gold' }).click();
    await t1.getByText('60 gold').waitFor();
    await t2.getByRole('button', { name: 'Confirm trade' }).click();
    await t1.getByText('Confirmed', { exact: true }).waitFor();
    // Bram changes the offer after confirming: his confirmation must be gone on both screens
    await t2.getByRole('button', { name: 'Change my offer' }).click();
    await t2.getByLabel('Gold to give').fill('75');
    await t2.getByRole('button', { name: 'Set gold' }).click();
    await t1.getByText('75 gold').waitFor();
    assert.equal(await t1.getByText('Confirmed', { exact: true }).count(), 0, 'a changed offer is no longer confirmed');
    const g1 = pl.gold;
    await t1.getByRole('button', { name: 'Confirm trade' }).click();
    await t2.getByRole('button', { name: 'Confirm trade' }).click();
    await t1.waitFor({ state: 'detached' });
    await t2.waitFor({ state: 'detached' });
    assert.equal(pl.gold, g1 + 75);
    assert.equal(other.gold, 15);
    assert.ok(other.inv.some((i) => i.base === 'greatsword' && i.rar === 2) && !pl.inv.some((i) => i.base === 'greatsword'), 'the sword changed hands exactly once');
    for (let i = 0; i < 30; i++) {
      if ((await app.db.query('SELECT 1 FROM trade_log WHERE a_name=$1', [`Lyra${uid}`])).rows.length) break;
      await p1.waitForTimeout(100);
    }
    assert.equal((await app.db.query<any>('SELECT b_gave FROM trade_log WHERE a_name=$1', [`Lyra${uid}`])).rows[0].b_gave.gold, 75, 'the trade is in the audit log');
    console.log('inventory ok: server-side sort, bulk sale with confirmation, player trade with re-confirmation and audit log');
  }

  // ---------- M12: skill icons, the Rune Merchant and Rune Scrolls through the real UI ----------
  {
    const w = app.world, pl = [...w.online.values()].find((q) => q.name === 'Lyra' + uid)!;
    // every icon is a 64x64 picture of its own; the hotbar shows pictures, not letters
    const ic = await p1.evaluate(() => {
      const A = (window as any).__art, m = A.iconManifest();
      const sig = (c: HTMLCanvasElement) => { const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 3) h = (Math.imul(h, 31) + d[i]) >>> 0; return `${h}:${d[3]}:${c.width}x${c.height}`; };
      const sigs = m.map((e: any) => sig(A.iconCanvas(e.id)));
      return { n: m.length, distinct: new Set(sigs).size, ok: sigs.every((s: string) => s.endsWith(':0:64x64')), small: A.skillIcon('fireball', 32).length > 200 };
    });
    assert.ok(ic.n >= 100 && ic.distinct === ic.n, `${ic.n} icons, all different (${ic.distinct} distinct)`);
    assert.ok(ic.ok && ic.small, 'each is 64x64 with a transparent corner, and a smaller UI size is generated');
    const bar = await p1.locator('.hotbar .slot img.skillicon').evaluateAll((els) => els.map((e) => [(e as HTMLImageElement).naturalWidth, (e as HTMLImageElement).src.startsWith('data:image/png')]));
    assert.ok(bar.length >= 6 && bar.every(([wd, png]) => wd === 64 && png), 'every hotbar slot shows its icon');
    assert.equal(new Set(await p1.locator('.hotbar .slot img.skillicon').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src))).size, bar.length, 'no two slots share an icon');
    assert.equal((await p1.locator('.hotbar .slot .glyph').allTextContents()).join(''), '', 'no letter placeholders are left');

    // the Rune Merchant: browse a category, see the rune, buy it with confirmation
    const npc = zoneObjects('eldoria').find((o) => o.kind === 'runesmith')!;
    while (pl.level < RUNE_SHOP.wind.level) w.grantExp(pl, 5000);
    pl.gold = 3000;
    sendInv(w, pl);
    w.relocate(pl, pl.room, npc.x - 30, npc.y + 24);
    await p1.locator('.hint').getByText(`Talk to ${npc.name}`).waitFor();
    await p1.keyboard.press('KeyF');
    const dlg = p1.getByRole('dialog', { name: npc.name });
    await dlg.waitFor();
    assert.equal(await dlg.getByRole('tab').count(), 5, 'five rune categories');
    await dlg.getByRole('tab', { name: /^Wind/ }).click();
    await dlg.getByText('Wind Slash').waitFor();
    await dlg.getByText(/requires level 3/).waitFor();
    await dlg.getByText('Not owned').waitFor();
    assert.equal(ownsRune(pl.build, 'wind'), false);
    await dlg.getByRole('button', { name: `Buy · ${RUNE_SHOP.wind.price}g` }).click();
    assert.equal(ownsRune(pl.build, 'wind'), false, 'nothing is bought before the confirmation');
    await dlg.getByRole('alertdialog', { name: 'Buy Wind Rune?' }).getByRole('button', { name: 'Confirm purchase' }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.build.runes.lv.wind === 1);
    assert.equal(pl.gold, 3000 - RUNE_SHOP.wind.price);
    await dlg.getByText(/Owned \(level 1\)/).waitFor();
    await p1.locator('.toast').getByText('New rune: Wind Rune').waitFor();
    assert.deepEqual(pl.build.runes.slots.includes('wind'), false, 'owning a rune does not equip it');
    await p1.screenshot({ path: '.run/m12-runeshop.png' });
    // a scroll: bought here, kept in the bag, read with a confirmation, consumed by the server
    await dlg.getByRole('button', { name: `Buy Random Rune Scroll for ${ITEMS.scroll_random.price} gold` }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.inv.some((i: any) => i.base === 'scroll_random'));
    await p1.keyboard.press('Escape');
    await p1.keyboard.press('KeyI');
    const bag = p1.getByRole('dialog', { name: 'Inventory' });
    await bag.getByRole('button', { name: 'Random Rune Scroll', exact: true }).click();
    const buildBefore = JSON.stringify(pl.build.runes);
    await bag.getByRole('button', { name: 'Read scroll' }).click();
    assert.equal(pl.inv.some((i) => i.base === 'scroll_random'), true, 'still there until confirmed');
    await bag.getByRole('alertdialog', { name: 'Read Random Rune Scroll?' }).getByRole('button', { name: 'Read it' }).click();
    await p1.waitForFunction(() => !(window as any).__game.debug().hud.inv.some((i: any) => i.base === 'scroll_random'));
    assert.equal(pl.inv.some((i) => i.base === 'scroll_random'), false, 'the scroll was consumed');
    assert.notEqual(JSON.stringify(pl.build.runes), buildBefore, 'and it gave a rune or rune experience');
    await p1.keyboard.press('Escape');
    // equipping is a separate step: the new rune goes into the third slot and its spells appear with their icons
    await p1.keyboard.press('KeyK');
    const book = p1.getByRole('dialog', { name: 'Skills and runes' });
    await book.getByRole('tab', { name: 'Runes' }).click();
    pl.lastCombat = -1e6;
    await book.getByRole('group', { name: 'Rune slot 3' }).getByRole('button', { name: /^Wind Rune/ }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.build.runes.slots[2] === 'wind');
    await p1.keyboard.press('Escape');
    await p1.getByRole('toolbar', { name: 'Abilities' }).getByRole('button', { name: 'Wind Slash (G)' }).waitFor();
    console.log(`icons and runes ok: ${ic.n} distinct icons, rune bought with confirmation, scroll read and consumed, rune attuned separately`);
  }

  // ---------- M13: a quest from the lorekeeper, the tracker, turning in, reputation ----------
  {
    const w = app.world, pl = [...w.online.values()].find((q) => q.name === 'Lyra' + uid)!;
    const lk = zoneObjects('eldoria').find((o) => o.kind === 'lorekeeper')!;
    await p1.keyboard.press('Escape');
    w.relocate(pl, w.roomIn('eldoria', pl), lk.x + 22, lk.y);
    await p1.waitForFunction((x) => Math.abs((window as any).__game.debug().x - x) < 30, lk.x + 22);
    pl.inv = pl.inv.filter((i) => ITEMS[i.base].kind !== 'equip'); // room in the bag for the reward
    sendInv(w, pl);
    await p1.locator('.hint').getByText(`Talk to ${lk.name}`).waitFor();
    await p1.keyboard.press('KeyF');
    const dlg = p1.getByRole('dialog', { name: lk.name });
    await dlg.getByRole('heading', { name: 'Quests' }).waitFor();
    await dlg.getByRole('button', { name: 'Accept The Crater Watch' }).click();
    await p1.waitForFunction(() => !!(window as any).__game.debug().hud.quests.active.main_eldoria);
    assert.ok(pl.quests.active.main_eldoria, 'the server holds the quest');
    const tracker = p1.getByRole('region', { name: 'Quest tracker' });
    await tracker.getByText('Defeat 6 Mosslings: 0/6').waitFor();
    for (const type of ['mossling', 'mossling', 'mossling', 'mossling', 'mossling', 'mossling', 'old_tusk']) {
      const m = w.spawn(pl.room, type, pl.x + 40, pl.y + 20);
      m.noRespawn = true;
      w.hurt(m, 1e9, 0, pl);
    }
    await tracker.getByText('Complete: return to Eldoria').waitFor();
    await p1.evaluate(() => { (window as any).__audio.log.length = 0; });
    const gold0 = pl.gold;
    await dlg.getByRole('button', { name: 'Turn in The Crater Watch' }).click();
    await p1.waitForFunction(() => !(window as any).__game.debug().hud.quests.active.main_eldoria);
    assert.equal(pl.gold, gold0 + QUESTS.main_eldoria.reward.gold);
    assert.equal(pl.rep.crown, 250);
    await p1.waitForFunction(() => (window as any).__audio.log.includes('game.quest_complete'), null, { timeout: 4000 });
    await tracker.waitFor({ state: 'detached' });
    await p1.keyboard.press('Escape');
    await p1.keyboard.press('KeyL');
    const log = p1.getByRole('dialog', { name: 'Quest log' });
    await log.getByRole('tab', { name: 'History' }).click();
    await log.getByText('The Crater Watch').waitFor();
    await log.getByRole('tab', { name: 'Factions' }).click();
    await log.getByLabel('The Starfall Crown: Neutral').waitFor();
    await p1.screenshot({ path: '.run/m13-quests.png' });
    await p1.keyboard.press('Escape');
    console.log('quests ok: accepted at the lorekeeper, tracker progress from server kills, turned in for gold and reputation, history and factions in the log');
  }

  // ---------- M14: found a guild, invite, guild chat and bank; the bank; the auction house ----------
  {
    const w = app.world, L = [...w.online.values()].find((q) => q.name === 'Lyra' + uid)!, B = [...w.online.values()].find((q) => q.name === 'Bram' + uid)!;
    await p1.keyboard.press('Escape');
    await p2.keyboard.press('Escape');
    for (const pl of [L, B]) {
      while (pl.level < 12) w.grantExp(pl, expToNext(pl.level));
      pl.gold = 5000;
      sendInv(w, pl);
    }
    await p1.waitForFunction(() => (window as any).__game.debug().hud.self.level >= 12);
    // letters only, unique per run
    const gname = 'Wardens ' + uid.replace(/[^a-z]/g, '').padEnd(3, 'x').slice(0, 6).replace(/^./, (c) => c.toUpperCase());
    const gtag = uid.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    await p1.keyboard.press('KeyN');
    const gp = p1.getByRole('dialog', { name: 'Guild' });
    await gp.getByLabel('Guild name').fill(gname);
    await gp.getByLabel('Guild tag').fill(gtag);
    await gp.getByRole('button', { name: 'Shape star' }).click();
    await gp.getByRole('button', { name: /^Found the guild/ }).click();
    await p1.waitForFunction(() => !!(window as any).__game.debug().hud.guild);
    assert.equal(L.gold, 4000, 'the founding cost was paid');
    assert.equal(L.gtag, gtag, 'the tag is part of the character\'s look');
    await gp.getByRole('heading', { name: new RegExp(gname) }).waitFor();
    // invitation and acceptance
    await gp.getByLabel('Player to invite').fill('Bram' + uid);
    await gp.getByRole('button', { name: 'Invite', exact: true }).click();
    const ginv = p2.getByRole('alertdialog', { name: 'Guild invitation' });
    await ginv.getByText(gname).waitFor();
    await ginv.getByRole('button', { name: 'Join' }).click();
    await gp.getByRole('row').filter({ hasText: 'Bram' + uid }).getByText('Recruit').waitFor();
    // the other player sees the tag on the name plate
    await p2.waitForFunction((t) => (window as any).__game.debug().hud.guild?.tag === t, gtag);
    await p1.waitForFunction(([n, t]) => [...(window as any).__game.remotes.values()].some((r: any) => r.meta.name === n && r.meta.gt === t), ['Bram' + uid, gtag]);
    // promote, guild chat, message of the day, guild bank
    await gp.getByRole('button', { name: `Promote Bram${uid}` }).click();
    await gp.getByRole('row').filter({ hasText: 'Bram' + uid }).getByText('Member').waitFor();
    await p2.keyboard.press('Enter');
    await p2.keyboard.type('/g for the guild');
    await p2.keyboard.press('Enter');
    await p1.locator('.chatlog .guild').getByText('for the guild').waitFor();
    await gp.getByRole('button', { name: 'Edit' }).click();
    await gp.getByLabel('Message of the day').fill('Meet at the crater at dusk');
    await gp.getByRole('button', { name: 'Save', exact: true }).click();
    await p2.waitForFunction(() => (window as any).__game.debug().hud.guild?.motd === 'Meet at the crater at dusk');
    await gp.getByRole('tab', { name: 'Guild bank' }).click();
    await gp.getByLabel('Gold amount').fill('300');
    await gp.getByRole('button', { name: 'Deposit', exact: true }).click();
    await gp.getByText('300 gold').first().waitFor();
    assert.equal(w.guilds.guildOf(L)!.bank, 300);
    await gp.getByRole('tab', { name: 'Log' }).click();
    await gp.getByText(`Lyra${uid} deposited 300 gold.`).waitFor();
    await p1.screenshot({ path: '.run/m14-guild.png' });
    await p1.keyboard.press('Escape');

    // the bank, at Eldoria's banker
    const bk = zoneObjects('eldoria').find((o) => o.kind === 'banker')!;
    for (const pl of [L, B]) {
      w.relocate(pl, w.roomIn('eldoria', pl), bk.x + (pl === L ? 22 : -22), bk.y);
      pl.lastCombat = -1e6;
    }
    give(L, { base: 'moonleaf', rar: 0, ilvl: 1, aff: [], up: 0, qty: 8 });
    give(L, { base: 'star_shard', rar: 0, ilvl: 1, aff: [], up: 0, qty: 3 });
    sendInv(w, L);
    await p1.waitForFunction((x) => Math.abs((window as any).__game.debug().x - x) < 30, bk.x + 22);
    await p1.locator('.hint').getByText(`Talk to ${bk.name}`).waitFor();
    await p1.keyboard.press('KeyF');
    const bd = p1.getByRole('dialog', { name: bk.name });
    await bd.getByLabel('Amount to move').fill('5');
    await bd.getByRole('button', { name: 'Deposit Moonleaf ×8' }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.bank.items.some((i: any) => i.base === 'moonleaf' && i.qty === 5));
    await bd.getByLabel('Amount to move').fill('');
    await bd.getByLabel('Gold amount').fill('1000');
    await bd.getByRole('button', { name: 'Deposit gold' }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.bank.gold === 1000);
    assert.deepEqual([L.bank.gold, L.gold], [1000, 2700]); // 5000 - 1000 founding - 300 guild bank - 1000 bank
    await bd.getByRole('button', { name: 'Withdraw Moonleaf ×5' }).click();
    await p1.waitForFunction(() => !(window as any).__game.debug().hud.bank.items.length);
    await bd.getByRole('button', { name: 'History' }).click();
    await bd.getByLabel('Bank history').getByText('Deposited gold: 1,000 gold').waitFor();

    // the auction house: Lyra lists, Bram buys, Lyra collects
    await bd.getByRole('tab', { name: 'Auction House' }).click();
    await bd.getByRole('tab', { name: 'Sell' }).click();
    await bd.getByRole('button', { name: 'Sell Star Shard ×3' }).click();
    await bd.getByLabel('Amount to sell').fill('2');
    await bd.getByLabel('Price in gold').fill('400');
    await bd.getByText('Fee 20g').waitFor(); // 5% for 24 hours
    await bd.getByRole('button', { name: 'List for sale' }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.ah?.list.some((l: any) => l.mine && l.price === 400));
    assert.equal(L.gold, 2680, 'the listing fee');
    await bd.getByRole('tab', { name: 'My listings' }).click();
    await bd.getByRole('button', { name: 'Cancel listing of Star Shard ×2' }).waitFor();
    await p2.waitForFunction((x) => Math.abs((window as any).__game.debug().x - x) < 30, bk.x - 22);
    await p2.keyboard.press('KeyF');
    const bd2 = p2.getByRole('dialog', { name: bk.name });
    await bd2.getByRole('tab', { name: 'Auction House' }).click();
    await bd2.getByLabel('Search by name').fill('star');
    await bd2.getByRole('button', { name: 'Search', exact: true }).click();
    await bd2.getByRole('button', { name: 'Buy Star Shard ×2 for 400 gold' }).click();
    await bd2.getByRole('alertdialog', { name: 'Buy Star Shard ×2 for 400 gold?' }).getByRole('button', { name: 'Pay 400g' }).click();
    await p2.waitForFunction(() => (window as any).__game.debug().hud.inv.some((i: any) => i.base === 'star_shard' && i.qty === 2));
    await bd2.getByText('Nothing matches.').waitFor(); // the list on screen was refreshed by the server
    assert.equal(B.gold, 4600);
    await bd.getByRole('tab', { name: 'Browse' }).click();
    await bd.getByRole('status').getByText('360 gold').waitFor(); // 400 less 10% tax waits with the banker
    await bd.getByRole('button', { name: 'Collect' }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.gold === 3040);
    await bd.getByRole('tab', { name: 'History' }).click();
    await bd.getByText(`sold to Bram${uid}`).waitFor();
    await p1.screenshot({ path: '.run/m14-auction.png' });
    await p1.keyboard.press('Escape');
    await p2.keyboard.press('Escape');
    console.log('guilds, bank and auction house ok: founded with an emblem, invitation, ranks, guild chat, message, guild bank and log; bank items and gold with history; listed, bought, taxed, collected');
  }

  // ---------- M15: pets and mounts, a duel, the arena and its rankings ----------
  {
    const w = app.world, L = [...w.online.values()].find((q) => q.name === 'Lyra' + uid)!, B = [...w.online.values()].find((q) => q.name === 'Bram' + uid)!;
    give(L, { base: 'pet_ember_kit', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 });
    give(L, { base: 'mount_plains_strider', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 });
    sendInv(w, L);
    await p1.keyboard.press('KeyI');
    const bag = p1.getByRole('dialog', { name: 'Inventory' });
    for (const n of ['Ember Kit Whistle', 'Plains Strider Reins']) {
      await bag.getByRole('button', { name: n, exact: true }).click();
      await bag.getByRole('button', { name: 'Use', exact: true }).click();
      await bag.getByRole('button', { name: n, exact: true }).waitFor({ state: 'detached' });
    }
    await p1.keyboard.press('Escape');
    await p1.keyboard.press('KeyP');
    const cp = p1.getByRole('dialog', { name: 'Companions' });
    await cp.getByText('+3% attack while summoned').waitFor();
    await cp.getByRole('button', { name: 'Summon' }).click();
    await p2.waitForFunction((n) => [...(window as any).__game.remotes.values()].some((r: any) => r.meta.name === n && r.meta.pet?.[0] === 'ember_kit'), 'Lyra' + uid);
    const mul0 = L.stats.moveMul;
    await cp.getByRole('button', { name: 'Ride' }).click();
    await p1.waitForFunction((m) => (window as any).__game.debug().hud.stats.moveMul > m, mul0);
    assert.equal(L.comp.riding, 'plains_strider');
    await p2.waitForFunction((n) => [...(window as any).__game.remotes.values()].some((r: any) => r.meta.name === n && r.meta.mnt === 'plains_strider'), 'Lyra' + uid);
    await p1.keyboard.press('Escape');
    await p1.screenshot({ path: '.run/m15-companions.png' });
    // riding is faster, through the same movement code
    {
      const x0 = (await dbg(p1)).x;
      await p1.keyboard.down('KeyD');
      await p1.waitForTimeout(700);
      await p1.keyboard.up('KeyD');
      const ridden = (await dbg(p1)).x - x0;
      assert.ok(ridden > 0, 'moved while riding');
    }
    await p1.keyboard.press('KeyP');
    await cp.getByRole('button', { name: 'Dismount' }).click();
    await p1.waitForFunction((m) => Math.abs((window as any).__game.debug().hud.stats.moveMul - m) < 1e-6, mul0);
    await p1.keyboard.press('Escape');

    // a duel in the Ashen Wastes
    const ash = ZONES.ashen.spawn, ax = tileCenter(ash.tx), ay = tileCenter(ash.ty);
    w.relocate(L, w.roomIn('ashen', L), ax, ay);
    await p1.waitForFunction(() => (window as any).__game.debug().hud.zoneId === 'ashen');
    w.relocate(B, L.room, ax + 40, ay);
    await p2.waitForFunction(() => (window as any).__game.debug().hud.zoneId === 'ashen');
    await p1.getByRole('status', { name: 'PvP: Free zone' }).waitFor();
    await p1.waitForFunction((n) => [...(window as any).__game.remotes.values()].some((r: any) => r.meta.name === n), 'Bram' + uid);
    await p1.keyboard.press('Enter');
    await p1.keyboard.type(`/duel Bram${uid}`);
    await p1.keyboard.press('Enter');
    const dinv = p2.getByRole('alertdialog', { name: 'Duel challenge' });
    await dinv.getByRole('button', { name: 'Accept' }).click();
    await p1.getByRole('status', { name: 'Duel', exact: true }).getByText(/Duel/).first().waitFor();
    await p2.getByRole('status', { name: 'Duel', exact: true }).getByRole('button', { name: 'Forfeit' }).click();
    await p1.locator('.chatlog').getByText(/You won the duel/).waitFor();
    await p1.getByRole('status', { name: 'Duel', exact: true }).waitFor({ state: 'detached' });

    // the arena, entered at the Arena Master in Eldoria
    const am = zoneObjects('eldoria').find((o) => o.kind === 'arenamaster')!;
    w.relocate(L, w.roomIn('eldoria', L), am.x + 22, am.y);
    await p1.waitForFunction(() => (window as any).__game.debug().hud.zoneId === 'eldoria');
    await p1.waitForFunction((x) => Math.abs((window as any).__game.debug().x - x) < 30, am.x + 22);
    await p1.locator('.hint').getByText(`Talk to ${am.name}`).waitFor();
    await p1.keyboard.press('KeyF');
    const ad = p1.getByRole('dialog', { name: am.name });
    await ad.getByRole('table', { name: 'PvP rankings' }).waitFor();
    await ad.getByRole('button', { name: 'Enter the arena' }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.arena === true);
    assert.ok(w.pvp.isArena(L.room));
    await p1.getByRole('status', { name: 'PvP: Arena' }).getByRole('button', { name: 'Leave arena' }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.zoneId === 'eldoria' && !(window as any).__game.debug().hud.arena);
    await p1.screenshot({ path: '.run/m15-arena.png' });
    console.log('pets, mounts and PvP ok: whistle and reins used from the bag, pet summoned and seen by others, riding faster and seen by others, a duel challenged, accepted and forfeited, the arena entered and left');
  }

  // ---------- M16: world map, key binding, language, interface scale, tutorial ----------
  {
    const w = app.world, L = [...w.online.values()].find((q) => q.name === 'Lyra' + uid)!;
    const gs = () => p1.evaluate(() => (window as any).__settings.get());
    L.disc.add('wp:verdant'); // Verdant Reach attuned, so its details are on the map
    L.disc.delete('wp:astral'); // and the Astral Ruins not, to see an unexplored region
    sendDisc(w, L);
    await p1.waitForFunction(() => !(window as any).__game.debug().hud.disc.includes('wp:astral'));
    // the world map
    await p1.keyboard.press('KeyM');
    const map = p1.getByRole('dialog', { name: 'World map' });
    await map.getByRole('button', { name: /^Eldoria, Lv\.1-5, explored, you are here/ }).waitFor();
    await map.getByRole('img', { name: 'You' }).waitFor();
    await map.getByRole('img', { name: 'Waystone of Eldoria' }).waitFor();
    await map.getByRole('img', { name: new RegExp(`^Mossling, level \\d+ \\(${SPAWNS.eldoria.find((g) => g.type === 'mossling')!.count}\\)$`) }).first().waitFor();
    await map.getByRole('img', { name: /^Elite: Old Tusk/ }).waitFor();
    await map.getByRole('img', { name: 'Road to Verdant Reach' }).waitFor();
    // a region never attuned stays hidden; its recommended level is still shown
    await map.getByRole('button', { name: /^Astral Ruins, Lv\.34-45, Unexplored/ }).click();
    await map.getByText(/Unexplored\. Travel here and attune the waystone in Starfall Camp/).waitFor();
    assert.equal(await map.getByRole('img').count(), 0, 'no details of an unexplored region');
    // Verdant Reach (attuned earlier in this test): its dungeon is on the map
    await map.getByRole('button', { name: /^Verdant Reach, Lv\.4-10, explored/ }).click();
    await map.getByRole('img', { name: /^Dungeon: Ancient Ruins, level 8\+/ }).waitFor();
    // a marker of one's own, kept with the account
    await map.getByRole('button', { name: 'Add a marker' }).click();
    const view = map.getByRole('group', { name: 'Map of Verdant Reach' }), box = (await view.boundingBox())!;
    await p1.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.25);
    await map.getByLabel('Marker name').fill('Moonleaf patch');
    await map.getByRole('button', { name: 'Save', exact: true }).click();
    await map.getByRole('img', { name: 'Moonleaf patch' }).waitFor();
    const mk = (await gs()).markers[0];
    assert.equal(mk.zone, 'verdant');
    assert.ok(Math.abs(mk.y / (ZONES.verdant.h * 32) - 0.25) < 0.05, `the marker sits where it was clicked (${mk.y})`);
    // layers can be hidden
    await map.getByRole('checkbox', { name: 'Your markers' }).uncheck();
    await map.getByRole('img', { name: 'Moonleaf patch' }).waitFor({ state: 'detached' });
    await map.getByRole('checkbox', { name: 'Your markers' }).check();
    await p1.screenshot({ path: '.run/m16-map.png' });
    await p1.keyboard.press('Escape');

    // key binding: a conflict is shown, not resolved silently; the new key works in the game
    await p1.keyboard.press('KeyO');
    const set = p1.getByRole('dialog', { name: 'Settings' });
    await set.getByRole('tab', { name: 'Controls' }).click();
    await set.getByRole('button', { name: 'Attack, key 1: Space. Change' }).click();
    await p1.keyboard.press('KeyQ');
    const clash = set.getByRole('alertdialog', { name: 'Key already in use' });
    await clash.getByText('Q is already used for Rune slot 1, spell 1.').waitFor();
    assert.deepEqual((await gs()).keys.attack, ['Space'], 'nothing changed before the player decides');
    await clash.getByRole('button', { name: 'Use it here instead' }).click();
    await p1.waitForFunction(() => (window as any).__settings.get().keys.attack[0] === 'KeyQ');
    assert.deepEqual((await gs()).keys['rune.1.1'], [], 'the key moved, it is not used twice');
    await p1.getByRole('button', { name: 'Close Settings', exact: true }).click();
    await p1.waitForFunction(() => /Q attack/.test(document.querySelector('.hud.keys')?.textContent ?? ''));
    // the rebound key attacks: the server starts an auto-attack on a monster next to the player
    const dummy = w.spawn(L.room, 'mossling', L.x + 30, L.y);
    dummy.noRespawn = true;
    dummy.maxHp = dummy.hp = 1e7; // a level 12 mage kills a mossling with one hit: this one lasts
    await p1.waitForFunction((id) => (window as any).__game.debug().monsters.some((m: any) => m.id === id), dummy.id);
    await p1.keyboard.press('KeyQ');
    await p1.waitForFunction(() => (window as any).__game.debug().hud.attacking === true, null, { timeout: 4000 }).catch(async (e) => {
      const d = await dbg(p1);
      throw new Error(`Q did not attack: server attacking=${L.attacking} target=${L.target?.id} pvp=${L.pvpTarget?.name} dead=${L.dead} dist=${Math.round(Math.hypot(dummy.x - L.x, dummy.y - L.y))} range=${L.stats.range}; client status=${d.hud.status} keys=${JSON.stringify((await gs()).keys.attack)} focus=${await p1.evaluate(() => document.activeElement?.outerHTML.slice(0, 100))}`, { cause: e });
    });
    assert.equal(L.target, dummy, 'Q now attacks');
    w.hurt(dummy, 1e9, 0, null);
    // the saved bindings are the account's
    await p1.waitForFunction(async () => (await (await fetch('/api/settings', { headers: { authorization: 'Bearer ' + localStorage.getItem('aetherion.token') } })).json()).game.keys.attack[0] === 'KeyQ', null, { timeout: 5000, polling: 300 });
    await p1.keyboard.press('KeyO');
    await set.getByRole('tab', { name: 'Controls' }).click();
    await set.getByRole('button', { name: 'Restore default keys' }).click();
    await set.getByRole('alertdialog', { name: 'Restore every key to its default?' }).getByRole('button', { name: 'Restore defaults' }).click();
    await p1.waitForFunction(() => (window as any).__settings.get().keys.attack[0] === 'Space' && (window as any).__settings.get().keys['rune.1.1'][0] === 'KeyQ');

    // tab navigation with the keyboard
    await set.getByRole('tab', { name: 'Controls' }).focus();
    await p1.keyboard.press('ArrowRight');
    await set.getByRole('tab', { name: 'Graphics', selected: true }).waitFor();
    await set.getByLabel('Effects quality').selectOption('low');
    await p1.keyboard.press('ArrowRight');
    await set.getByRole('tab', { name: 'Interface', selected: true }).waitFor();
    // interface scale
    await set.getByLabel('Interface scale').selectOption('1.25');
    assert.equal(await p1.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui').trim()), '1.25');
    await set.getByLabel('Interface scale').selectOption('1');
    // language: the whole interface, and run-time messages from the game, in Indonesian
    await set.getByLabel('Language').selectOption('id');
    const atur = p1.getByRole('dialog', { name: 'Pengaturan' });
    await atur.getByRole('tab', { name: 'Antarmuka', selected: true }).waitFor();
    assert.equal(await p1.evaluate(() => document.documentElement.lang), 'id');
    await p1.getByRole('button', { name: 'Tutup Pengaturan', exact: true }).click();
    await p1.getByRole('button', { name: 'Buka inventaris' }).waitFor();
    await p1.getByRole('toolbar', { name: 'Kemampuan' }).waitFor();
    await p1.keyboard.press('Enter');
    await p1.keyboard.type('/nosuchcommand');
    await p1.keyboard.press('Enter');
    await p1.locator('.chatlog').getByText(/^Perintah \/nosuchcommand tidak dikenal\./).waitFor();
    await p1.screenshot({ path: '.run/m16-indonesian.png' });
    await p1.keyboard.press('KeyO');
    await atur.getByRole('tab', { name: 'Antarmuka' }).click();
    await atur.getByLabel('Bahasa').selectOption('en');
    await set.getByRole('tab', { name: 'Graphics' }).click();
    await set.getByLabel('Effects quality').selectOption('high');
    await p1.getByRole('button', { name: 'Close Settings', exact: true }).click();

    // the tutorial: steps already done in this session are ticked; skip, read again, resume
    await p1.keyboard.press('F1');
    const tut = p1.getByRole('dialog', { name: 'Tutorial' });
    await tut.getByRole('button', { name: /Moving \(done\)/ }).waitFor();
    await tut.getByRole('button', { name: /Inventory \(done\)/ }).waitFor();
    await tut.getByRole('button', { name: /Quests \(done\)/ }).waitFor();
    const done = (await gs()).tutorial.done as string[];
    assert.ok(['move', 'attack', 'inventory', 'equip', 'quest', 'potion', 'party', 'dungeon', 'auto', 'scroll'].every((s) => done.includes(s)), `steps the player did are done: ${done}`);
    await tut.getByRole('button', { name: /Rune Scrolls/ }).click();
    await tut.getByText('Rune Scrolls drop from monsters.', { exact: false }).waitFor();
    await tut.getByRole('button', { name: 'Start over' }).click();
    await p1.getByRole('region', { name: 'Tutorial' }).getByText('Moving').waitFor();
    await p1.getByRole('region', { name: 'Tutorial' }).getByText('Walk with W A S D', { exact: false }).waitFor();
    await tut.getByRole('button', { name: 'Skip tutorial' }).click();
    await p1.getByRole('region', { name: 'Tutorial' }).waitFor({ state: 'detached' });
    await tut.getByRole('button', { name: 'Resume tutorial' }).click();
    await p1.getByRole('region', { name: 'Tutorial' }).waitFor();
    await p1.keyboard.down('KeyD'); // held for a few game steps, like a player walking
    await p1.waitForFunction(() => (window as any).__settings.get().tutorial.done.includes('move'), null, { timeout: 5000 });
    await p1.keyboard.up('KeyD');
    await tut.getByRole('button', { name: /Moving \(done\)/ }).waitFor();
    await p1.keyboard.press('Escape');
    console.log('world map, settings and tutorial ok: regions with locked ones hidden, pins, a marker saved; rebinding with a conflict, the new key in use, defaults restored; keyboard tab navigation; interface scale; Indonesian interface and game messages; tutorial progress, read again, start over, skip and resume');
  }

  // ---------- sub-skills: an enhancement branch learned in the skill book, used by the server ----------
  {
    const L = [...app.world.online.values()].find((q) => q.name === 'Lyra' + uid)!;
    if (!(L.build.skills.arcane_bolt > 0)) L.build.skills.arcane_bolt = 1;
    buildChanged(app.world, L);
    await p1.keyboard.press('KeyK');
    const book = p1.getByRole('dialog', { name: 'Skills and runes' });
    const branch = book.getByRole('group', { name: 'Enhancements of Arcane Bolt' });
    await branch.getByText('Next rank: +8% damage').waitFor();
    await branch.getByRole('button', { name: 'Learn Focused Bolt' }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.build.skills['arcane_bolt.a'] === 1);
    assert.equal(L.build.skills['arcane_bolt.a'], 1, 'the server holds the rank');
    await branch.getByText('Now: +8% damage · Next rank: +16% damage').waitFor();
    await branch.getByRole('button', { name: 'Learn Lucid Flow' }).click();
    await branch.getByText('Now: -12% cost', { exact: false }).waitFor();
    // the hotbar shows the cheaper bolt (6 mana -> 5)
    const tip = await p1.getByRole('toolbar', { name: 'Abilities' }).getByRole('button', { name: /^Arcane Bolt/ }).getAttribute('title');
    assert.match(tip ?? '', /5 mana/);
    await p1.screenshot({ path: '.run/subskills.png' });
    await p1.keyboard.press('Escape');
    console.log('sub-skills ok: branches shown under each active skill, learned with skill points, numbers follow the ranks');
  }

  // ---------- PvP areas, auto hunting shortcut and minimised panel, guild chat, settings button, combat text ----------
  {
    const w = app.world, L = [...w.online.values()].find((q) => q.name === 'Lyra' + uid)!;
    // the settings button beside the minimap
    await p1.getByRole('button', { name: 'Open settings' }).first().click();
    await p1.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Interface' }).click();
    await p1.getByRole('dialog', { name: 'Settings' }).getByLabel('Interface scale').waitFor();
    await p1.keyboard.press('Escape');
    // guild chat from the channel list
    await p1.getByLabel('Chat channel').selectOption('guild');
    await p1.locator('input[name=chat]').fill('guild hello from the list');
    await p1.locator('input[name=chat]').press('Enter');
    await p2.locator('.chatlog .guild').getByText('guild hello from the list').waitFor();
    await p1.getByLabel('Chat channel').selectOption('zone');
    // the Depths: the sanctuary is safe, the ground beyond is open PvP and is announced; then back to the capital
    {
      const deep = 'x_frostveil', dz = ZONES[deep], back = { x: L.x, y: L.y }, dnav = navOf(deep);
      w.relocate(L, w.roomIn(deep, L), tileCenter(dz.spawn.tx), tileCenter(dz.spawn.ty));
      await p1.waitForFunction((id) => (window as any).__game.debug().zone === id, deep);
      await p1.getByRole('status', { name: 'PvP: Safe zone' }).waitFor();
      let open: [number, number] | null = null;
      for (let tx = dz.sanctuary!.tx + dz.sanctuary!.r + 3; tx < dz.sanctuary!.tx + dz.sanctuary!.r + 12 && !open; tx++) for (let dy = -6; dy <= 6 && !open; dy++) {
        const x = tileCenter(tx), y = tileCenter(dz.spawn.ty + dy);
        if (reachableAt(dnav, x, y) && !blockedAt(deep, x, y)) open = [x, y];
      }
      w.relocate(L, L.room, open![0], open![1]);
      await p1.getByRole('status', { name: 'PvP: Open PvP' }).waitFor();
      await p1.locator('.chatlog').getByText(/You are on open ground in the Depths/).first().waitFor();
      w.relocate(L, w.roomIn('eldoria', L), back.x, back.y);
      await p1.waitForFunction(() => (window as any).__game.debug().zone === 'eldoria');
      await p1.getByRole('status', { name: /PvP: (Free zone|Town)/ }).waitFor();
    }
    // this room's wild monsters were cleared for good by the auto hunting section: a fierce monster (as in the Depths) is placed here
    const fz = w.spawn(L.room, 'boar', L.x + 60, L.y, { ...DEPTH_MONSTER, fierce: true });
    fz.noRespawn = true;
    fz.maxHp = fz.hp = 20000; // a long fight: the hit numbers must still be on screen when the test looks
    await p1.waitForFunction(() => [...(window as any).__game.remotes.values()].some((r: any) => r.meta.fz === 1));
    // the auto hunting shortcut starts and stops it; the panel can be minimised to one bar
    await p1.keyboard.press('Backquote');
    await p1.waitForFunction(() => (window as any).__game.debug().auto.on === true);
    const panel = p1.getByRole('region', { name: 'Auto hunting' });
    await panel.getByRole('button', { name: 'Minimise auto hunting' }).click();
    await panel.getByRole('button', { name: 'Expand auto hunting' }).waitFor();
    assert.ok((await panel.boundingBox())!.height < 60, 'the minimised panel is one bar');
    // combat text: the player's own hits are shown in the large style
    await p1.waitForFunction(() => ((window as any).__game.floaters as any[]).some((f) => f.kind === 'dealt' || f.kind === 'crit'), null, { timeout: 15000 }).catch(async (e) => {
      throw new Error(`no hit text: hunter ${JSON.stringify(await p1.evaluate(() => (window as any).__game.debug().auto))}, boar hp ${fz.hp}/${fz.maxHp} dead ${fz.dead} at ${Math.round(fz.x - L.x)},${Math.round(fz.y - L.y)}; floaters ${JSON.stringify(await p1.evaluate(() => (window as any).__game.floaters.map((f: any) => f.kind + ':' + f.text)))}`, { cause: e });
    });
    await p1.screenshot({ path: '.run/pvp-area-auto.png' });
    await p1.keyboard.press('Backquote');
    await p1.waitForFunction(() => (window as any).__game.debug().auto.on === false);
    await panel.getByRole('button', { name: 'Expand auto hunting' }).click();
    await panel.getByLabel('Fight bosses').waitFor({ state: 'attached' }).catch(() => {});
    await panel.getByRole('button', { name: 'Close auto hunting' }).click();
    w.hurt(fz, 1e9, 0, null); // the long fight is over
    L.lastCombat = -1e6;
    w.relocate(L, w.roomIn('eldoria', L), tileCenter(ZONES.eldoria.spawn.tx), tileCenter(ZONES.eldoria.spawn.ty));
    await p1.waitForFunction((x) => Math.abs((window as any).__game.debug().x - x) < 2, tileCenter(ZONES.eldoria.spawn.tx));
    console.log('PvP areas, auto hunting shortcut and minimised bar, guild chat channel, settings button and combat text ok');
  }

  // ---------- armament (level 30) and sigils (level 50) in the inventory; main and sub-stats on the item card ----------
  {
    const w = app.world, L = [...w.online.values()].find((q) => q.name === 'Lyra' + uid)!;
    w.grantExp(L, 1e8);
    L.lastCombat = -1e6;
    L.gold = 1e6;
    L.build.skills.arcane_bolt = Math.max(1, L.build.skills.arcane_bolt ?? 0);
    give(L, { base: 'arm_shard', rar: 0, ilvl: 1, aff: [], up: 0, qty: 20 });
    give(L, { ...rollSigil(Math.random, 1, 1, 0), sks: undefined, st: undefined, sk: ['arcane_bolt', 2] });
    give(L, { ...rollSigil(Math.random, 1, 1, 1), sks: undefined, st: undefined, sk: ['shield_bash', 3] });
    buildChanged(w, L);
    sendInv(w, L);
    await p1.waitForFunction(() => (window as any).__game.debug().hud.self.level >= 50);
    await p1.keyboard.press('KeyI');
    const bag = p1.getByRole('dialog', { name: 'Inventory' });
    // the item card: main stats and sub-stats, each sub-stat with its range
    await bag.getByRole('tab', { name: 'Bag' }).click();
    await bag.locator('.eqrow .cell').first().click();
    await bag.getByRole('heading', { name: 'Main stats' }).waitFor();
    await bag.getByRole('heading', { name: /^Sub-stats \(\d+ \/ \d+\)$/ }).waitFor();
    // armament: six safe enhancements of the weapon armament, the white glow at +6
    await bag.getByRole('tab', { name: 'Armament' }).click();
    const wa = bag.getByRole('group', { name: 'Weapon armament' });
    for (let i = 1; i <= 6; i++) {
      await wa.getByRole('button', { name: `Enhance the Weapon armament to +${i}` }).click();
      await p1.waitForFunction((n) => (window as any).__game.debug().hud.gear.arm.weapon === n, i, { timeout: 8000 }).catch(async (e) => {
        const d = await p1.evaluate(() => { const h = (window as any).__game.debug().hud; return { arm: h.gear?.arm, chat: h.chat.slice(-5).map((c: any) => c.text), toast: h.toast, gold: h.gold, focus: document.activeElement?.outerHTML.slice(0, 120) }; });
        throw new Error(`armament +${i}: ${JSON.stringify(d)} server ${JSON.stringify(L.gear.arm)}; ${e}`);
      });
    }
    assert.equal(L.gear.arm.weapon, 6, 'the server holds +6');
    await wa.getByText('white glow').waitFor();
    await wa.getByText(/90% chance/).waitFor();
    // the other player (left in the Ashen Highlands by the duel) comes over to look
    const B = [...w.online.values()].find((q) => q.name === 'Bram' + uid)!;
    w.relocate(B, L.room, L.x + 50, L.y);
    await p2.waitForFunction((n) => [...(window as any).__game.remotes.values()].some((r: any) => r.meta.name === n && r.meta.wa === 1), 'Lyra' + uid);
    // sigils: two Bright Ember sigils give its first set bonus; a knight's skill does nothing for a mage
    await bag.getByRole('tab', { name: 'Sigils' }).click();
    await bag.getByRole('button', { name: 'Equip Bright Ember Sigil (Circle)' }).click();
    await bag.getByRole('button', { name: 'Equip Bright Ember Sigil (Triangle)' }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.gear.sig.filter(Boolean).length === 2);
    await bag.getByText('(2) +9% damage, +10% critical damage').waitFor();
    await bag.getByText('another class: no effect').first().waitFor();
    await bag.getByText('+2 Arcane Bolt').first().waitFor();
    await p1.screenshot({ path: '.run/gear.png' });
    await p1.keyboard.press('Escape');
    await p1.screenshot({ path: '.run/weapon-glow.png' });
    console.log('armament and sigils ok: item card with main and sub-stats, weapon armament to +6 with its glow (seen by others), two sigils with their set bonus and skill rank');
  }

  // ---------- journal (missions, login reward, titles, codex) and mail ----------
  {
    const w = app.world, L = [...w.online.values()].find((q) => q.name === 'Lyra' + uid)!;
    const sp = ZONES.eldoria.spawn;
    w.relocate(L, w.roomIn('eldoria', L), tileCenter(sp.tx), tileCenter(sp.ty) + 40);
    await p1.waitForFunction(() => (window as any).__game.debug().zone === 'eldoria');
    L.journal.l.claimed = false;
    w.journals.send(L);
    await p1.getByRole('button', { name: 'Open journal' }).click();
    const jr = p1.getByRole('dialog', { name: 'Journal' });
    await jr.getByRole('heading', { name: /Daily missions/ }).waitFor();
    const gold0 = L.gold;
    await jr.getByRole('button', { name: /^Claim day \d$/ }).click();
    await jr.getByRole('button', { name: 'Claimed today: come back tomorrow' }).waitFor();
    assert.ok(L.gold > gold0, 'the login reward reached the server');
    // a title: earned, worn, and drawn above the name for the other player too
    L.journal.a.push('kill_1k');
    w.journals.send(L);
    await jr.getByRole('tab', { name: 'Titles' }).click();
    await jr.getByRole('radio', { name: /« the Hunter »/ }).click();
    await p1.waitForFunction(() => (window as any).__game.debug().hud.journal.ti === 'kill_1k');
    assert.equal(L.meta().ti, 'kill_1k');
    await jr.getByRole('tab', { name: 'Codex' }).click();
    await jr.getByRole('region', { name: 'Eldoria' }).waitFor();
    await p1.screenshot({ path: '.run/journal.png' });
    await p1.keyboard.press('Escape');
    // mail: a letter from the post with gold, taken in the village
    await app.repo.systemMail(L.id, 'Welcome gift', 'From the Aetherion Post.', [], 250);
    await p1.getByRole('button', { name: 'Open mail' }).click();
    const mb = p1.getByRole('dialog', { name: 'Mail' });
    await mb.getByRole('button', { name: /Welcome gift/ }).click();
    const g1 = L.gold;
    await mb.getByRole('button', { name: 'Take the contents' }).click();
    await mb.getByRole('button', { name: 'Taken' }).waitFor();
    assert.equal(L.gold, g1 + 250);
    await p1.screenshot({ path: '.run/mail.png' });
    await p1.keyboard.press('Escape');
    console.log('journal and mail ok: login reward claimed, a title worn and seen, the codex, a letter with gold taken');
    // a world event: the banner tells everyone; night and weather draw without errors
    w.events.start(Date.now(), 'goblin', 'eldoria');
    const evb = p1.getByRole('status', { name: 'World event' });
    await evb.getByText('Treasure Goblin').waitFor();
    await evb.getByText('Catch the goblin', { exact: false }).waitFor();
    await p1.screenshot({ path: '.run/world-event.png' });
    for (const mo of [...w.events.cur!.mobs]) w.hurt(mo, 1e9, 0, L);
    await evb.getByText(/Victory!/).waitFor();
    console.log('world event ok: the goblin event announced, tracked and won through the HUD');
    // ascension: a path at 70, the ultimate on the hotbar, charged and unleashed with its key
    while (L.level < 70) w.grantExp(L, 1e12);
    await p1.waitForFunction(() => (window as any).__game.debug().hud.self.level >= 70);
    await p1.getByRole('button', { name: 'Open ascension' }).click();
    const asc = p1.getByRole('dialog', { name: 'Ascension' });
    await asc.getByRole('button', { name: 'Walk this path' }).first().click();
    await p1.waitForFunction(() => !!(window as any).__game.debug().hud.asc.path);
    assert.ok(L.asc.path === 'archmage' || L.asc.path === 'chronomancer');
    await p1.screenshot({ path: '.run/ascension.png' });
    await p1.keyboard.press('Escape');
    const ultBar = p1.getByRole('toolbar', { name: 'Abilities' }).locator('.slots.ult');
    await ultBar.waitFor();
    L.ult = 100;
    w.send(L, { t: 'ult', v: 100 });
    await ultBar.locator('.slot.ultready').waitFor();
    // nothing else around: the ultimate's area must not kill (and loot) anything before the reload check below
    for (const o of [...L.room.monsters.values()]) if (!o.def.boss?.world) w.removeMonster(o);
    const mo = w.spawn(L.room, 'rootwarden', L.x + 60, L.y);
    (mo as any).def = { ...mo.def, aggro: 0 };
    w.setTarget(L, mo.id);
    await p1.waitForFunction((id) => (window as any).__game.debug().monsters.some((m: any) => m.id === id), mo.id);
    await p1.evaluate((id) => (window as any).__game.setTarget(id), mo.id);
    await p1.keyboard.press('Digit8');
    await p1.waitForFunction(() => (window as any).__game.debug().hud.ult < 100, null, { timeout: 8000 });
    w.removeMonster(mo); // gone without loot: the reload check below compares the bag
    await p1.waitForTimeout(500);
    console.log('ascension ok: a path chosen at 70, the ultimate charged and unleashed from the hotbar');
  }

  // ---------- reload: token survives, resume in place ----------
  const before = await dbg(p1);
  // this browser forgets its audio settings: after the reload they can only come from the account
  await p1.evaluate(() => localStorage.removeItem('aetherion.audio'));
  await p1.reload();
  // No interaction yet on the fresh page: audio must not have started, and the page says so.
  await p1.locator('.charcard').first().waitFor();
  await p1.waitForFunction(() => (window as any).__audio.debug().state === 'locked');
  assert.equal(await p1.evaluate(() => (window as any).__audio.debug().context), 'none', 'no audio context exists before the first interaction');
  await p1.getByText('Sound is off until you click or press a key.').waitFor();
  await p1.waitForFunction((want) => JSON.stringify((window as any).__audio.debug().settings) === want, JSON.stringify(savedAudio));
  // pressing the button is the interaction: audio unlocks on mouse-down and the prompt is gone before the button comes back up
  await p1.getByRole('button', { name: 'Enable sound' }).hover();
  await p1.mouse.down();
  await p1.mouse.up();
  await p1.waitForFunction(() => (window as any).__audio.debug().state === 'running');
  await p1.getByText('Sound is off until you click or press a key.').waitFor({ state: 'detached' });
  assert.equal(await p1.evaluate(() => (window as any).__audio.debug().music.want), BGM.MENU, 'the menu theme is selected on the character screen');
  await p1.locator('.charcard').first().click();
  await p1.waitForFunction(() => (window as any).__game?.debug().hud.status === 'playing');
  const resumed = await dbg(p1);
  assert.equal(resumed.x, before.x);
  assert.equal(resumed.y, before.y);
  assert.deepEqual(resumed.hud.eq, before.hud.eq, 'equipment survives a reload');
  assert.deepEqual(resumed.hud.inv, before.hud.inv);
  assert.equal(resumed.hud.gold, before.hud.gold);

  // ---------- M8: imported art replaces a built-in sheet after passing validation ----------
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aeth-import-'));
    fs.mkdirSync(path.join(tmp, 'monsters'));
    const img = decodePng(fs.readFileSync('assets/templates/monsters/mossling.png'));
    for (let i = 0; i < img.data.length; i += 4) { const r = img.data[i]; img.data[i] = img.data[i + 1]; img.data[i + 1] = img.data[i + 2]; img.data[i + 2] = r; } // repaint: rotate the colour channels
    fs.writeFileSync(path.join(tmp, 'monsters/mossling.png'), encodePng(img));
    fs.writeFileSync(path.join(tmp, 'monsters/boar.png'), encodePng({ w: 10, h: 10, data: new Uint8Array(400) })); // wrong size: must be rejected
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({ version: 1, sheets: [{ type: 'monster', id: 'mossling', file: 'monsters/mossling.png', scale: 1 }, { type: 'monster', id: 'boar', file: 'monsters/boar.png' }] }));
    // M12: an icon needs nothing but its file and one manifest entry
    const iconSrc = decodePng(fs.readFileSync('assets/templates/icons/skill/fireball.png'));
    for (let i = 0; i < iconSrc.data.length; i += 4) { const r0 = iconSrc.data[i]; iconSrc.data[i] = iconSrc.data[i + 2]; iconSrc.data[i + 2] = r0; } // repaint: swap red and blue
    fs.mkdirSync(path.join(tmp, 'icons/skill'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'icons/skill/fireball.png'), encodePng(iconSrc));
    const mfPath = path.join(tmp, 'manifest.json'), mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
    mf.sheets.push({ type: 'icon', kind: 'skill', id: 'fireball', file: 'icons/skill/fireball.png', source: 'browser test', license: 'test only' });
    fs.writeFileSync(mfPath, JSON.stringify(mf));
    const r = spawnSync('node_modules/.bin/tsx', ['scripts/import-assets.ts', tmp, path.join(config.clientDir, 'assets')], { encoding: 'utf8' });
    assert.match(r.stdout, /imported 2 of 3 sheets/);
    try {
      await p1.reload();
      await p1.waitForFunction(() => (window as any).__art?.imported.length === 2);
      await p1.evaluate('window.__name = (f) => f');
      const res = await p1.evaluate(() => {
        const A = (window as any).__art, px = (c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data];
        return { imported: [...A.imported].sort(), moss: px(A.getMonsterSheet('mossling')), boarW: A.getMonsterSheet('boar').width, icon: px(A.iconCanvas('skill/fireball')) };
      });
      assert.deepEqual(res.imported, ['icon/skill/fireball', 'monster/mossling']);
      assert.deepEqual(res.icon, [...iconSrc.data], 'the imported icon replaced the built-in one, pixel for pixel, with no code change');
      assert.deepEqual(res.moss, [...img.data], 'the game draws the imported sheet, pixel for pixel');
      assert.equal(res.boarW, 13 * 48, 'the rejected sheet was not loaded: the built-in boar is still used');
    } finally {
      spawnSync('node_modules/.bin/tsx', ['scripts/import-assets.ts', path.join(tmp, 'none'), path.join(config.clientDir, 'assets')]); // back to built-in art
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    console.log('asset import ok: validated sheet replaces built-in art; invalid sheet rejected');
  }

  assert.deepEqual(errors, [], 'no console errors');
  console.log(`browser test passed (headless software-rendered fps reading: ${fps})`);
} finally {
  await browser.close();
  await app.close();
}
