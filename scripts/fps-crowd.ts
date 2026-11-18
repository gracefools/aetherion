// Client frame rate with a crowd on screen: one real browser client among N bots packed around the plaza.
// Headless Chromium renders in software, and the bots, the server and the browser share this machine,
// so the reading is a lower bound for real hardware. Usage: tsx scripts/fps-crowd.ts [bots=100]
import { chromium } from 'playwright-core';
import { createApp } from '../server/src/app';
import { config } from '../server/src/config';
import { Bot, sleep } from './bot';

const N = Number(process.argv[2] ?? 100);
const app = await createApp({ ...config, host: '127.0.0.1', authRateLimit: 1e9, maxConnectionsPerIp: 1e6 });
const base = `http://127.0.0.1:${await app.listen(0)}`;
const run = Date.now().toString(36).slice(-5);
const bots: Bot[] = [];
for (let i = 0; i < N; i += 10) bots.push(...(await Promise.all(Array.from({ length: Math.min(10, N - i) }, (_, k) => Bot.create(base, `fp${run}_${i + k}`, `Fp${run}x${i + k}`)))));
await Promise.all(bots.map((b) => b.connect()));
const timer = setInterval(() => { for (const b of bots) { const r = Math.random(); if (r < 0.7) b.input(Math.floor(Math.random() * 3) - 1, Math.floor(Math.random() * 3) - 1); } }, 50);
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto(base);
  await page.getByText('New here? Create an account').click();
  await page.fill('input[name=username]', `fps_${run}`);
  await page.fill('input[name=password]', 'browser-pass-1');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.waitForSelector('input[name=charname]');
  await page.fill('input[name=charname]', 'Viewer' + run);
  await page.getByRole('button', { name: 'Enter Aetherion', exact: true }).click();
  await page.waitForFunction(() => (window as any).__game?.debug().hud.status === 'playing', null, { timeout: 20000 });
  await sleep(4000);
  const fps: number[] = [], near: number[] = [];
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    const d = await page.evaluate(() => { const h = (window as any).__game.debug().hud; return [h.fps, h.nearby]; });
    fps.push(d[0]);
    near.push(d[1]);
  }
  const m = app.world.metrics();
  console.log(JSON.stringify({ bots: N, entitiesInView: Math.round(near.reduce((a, b) => a + b, 0) / near.length), fpsMin: Math.min(...fps), fpsAvg: +(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1), fpsSamples: fps, serverTickAvgMs: m.tickMs.avg }));
} finally {
  clearInterval(timer);
  await browser.close();
  for (const b of bots) b.close();
  await app.close();
}
