// TEMPORARY placeholder sound effects and ambience, synthesised from noise and oscillators.
// Original by construction (no samples, no recordings). Each effect is built so that it cannot
// be mistaken for another: fire crackles and roars, water chirps and splashes, lightning is a
// crack and a buzz, earth is low and grinding, wind is airy and high, healing is bells.
import { AMB } from '../../shared/src/audio';
import {
  ad, bp, bump, crossLoop, expo, finalize, hp, lp, mixMono, mono, noise, reverb, rng, room, shape, SR, stereo, tone, toStereo,
  type Stereo, type Wave,
} from './dsp';

const TAU = Math.PI * 2;
type M = Float32Array;
/** Attack/decay shorthand. */
const E = (x: M, a: number, d: number) => shape(x, ad(a, d));
const mul = (a: M, b: M) => a.map((v, i) => v * (b[i] ?? 0));
/** Struck metal or stone: decaying partials at inharmonic ratios. */
function metal(sec: number, base: number, ratios: number[], tau: number): M {
  const out = mono(sec);
  ratios.forEach((r, k) => {
    const p = E(tone(sec, base * r), 0.0008, tau / (1 + k * 0.6));
    for (let i = 0; i < out.length; i++) out[i] += p[i] / (k + 1);
  });
  return out;
}
/** A small bell tone. */
const ding = (f: number, tau: number, sec = tau * 5) =>
  mixMono(sec, [E(tone(sec, f), 0.002, tau), 1], [E(tone(sec, f * 2.01), 0.002, tau * 0.5), 0.35], [E(tone(sec, f * 3.02), 0.001, tau * 0.3), 0.15]);
/** Random grains: an envelope of sudden peaks that die away (crackle, crunch, rain). */
function grains(sec: number, seed: number, perSec: number, tau: number): M {
  const out = mono(sec), r = rng(seed), k = Math.exp(-1 / (tau * SR));
  let e = 0;
  for (let i = 0; i < out.length; i++) {
    if (r() < perSec / SR) e = 0.4 + 0.6 * r();
    out[i] = e;
    e *= k;
  }
  return out;
}
const seq = (len: number, ...parts: [M, number, number?][]) => mixMono(len, ...parts);
const thud = (f0: number, f1: number, sec = 0.16, tau = 0.05) => E(tone(sec, expo(f0, f1, sec * 0.75)), 0.001, tau);
/** Notes of an arpeggio as bells. */
const arpeggio = (freqs: number[], step: number, tau: number, lastTau = tau) =>
  seq(step * freqs.length + lastTau * 5, ...freqs.map((f, k) => [ding(f, k === freqs.length - 1 ? lastTau : tau), 1, k * step] as [M, number, number]));
const sawNote = (f: number, sec: number, cut: number, a = 0.02, d = 0.3, wave: Wave = 'saw') => E(lp(tone(sec, f, wave), cut), a, d);

// ---------------------------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------------------------
const stepGrass = () => seq(0.18,
  [E(bp(noise(0.12, 11), expo(2600, 1200, 0.1), 0.9), 0.004, 0.03), 1],
  [E(bp(noise(0.1, 12, 'pink'), 3200, 0.8), 0.006, 0.035), 0.6, 0.045],
  [thud(110, 60, 0.1, 0.03), 0.5]);
const stepStone = () => seq(0.14,
  [E(bp(noise(0.06, 13), 2800, 3), 0.001, 0.012), 1],
  [E(tone(0.08, expo(240, 150, 0.05)), 0.001, 0.022), 0.9],
  [E(hp(noise(0.08, 14), 4000), 0.01, 0.025), 0.25, 0.02]);
const stepWood = () => seq(0.2, [metal(0.16, 170, [1, 1.52, 2.6, 3.9], 0.05), 1], [E(bp(noise(0.03, 15), 1800, 2), 0.001, 0.006), 0.5]);
const stepSnow = () => shape(bp(mul(noise(0.2, 16), grains(0.2, 116, 900, 0.004)), 2200, 0.8), bump(0.19, 0.3, 1));
const stepWater = () => seq(0.3,
  [E(lp(noise(0.25, 17), expo(5000, 700, 0.2)), 0.005, 0.07), 1],
  [E(tone(0.08, expo(380, 950, 0.06)), 0.004, 0.025), 0.5, 0.05],
  [thud(200, 90, 0.1, 0.03), 0.6]);
const run = () => shape(hp(noise(0.14, 18, 'pink'), 2500), bump(0.14, 0.35, 1.5));

// ---------------------------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------------------------
const swordSwing = () => seq(0.28,
  [shape(bp(noise(0.26, 21), (t) => 500 + 2600 * bump(0.26, 0.45)(t), 1.6), bump(0.26, 0.45, 1.6)), 1],
  [shape(tone(0.2, expo(1800, 3200, 0.18)), bump(0.2, 0.5, 2)), 0.06, 0.03]);
const swordImpact = () => seq(0.55,
  [metal(0.5, 620, [1, 2.76, 5.4, 8.93, 11.3], 0.16), 1],
  [E(hp(noise(0.05, 22), 3000), 0.0005, 0.012), 0.8],
  [thud(200, 90, 0.08, 0.025), 0.5]);
const shieldBlock = () => seq(0.35,
  [thud(180, 95, 0.15, 0.04), 1],
  [metal(0.3, 410, [1, 1.9, 3.3, 4.7], 0.07), 0.6],
  [E(lp(noise(0.06, 23), 1800), 0.0005, 0.015), 0.7]);
const greatswordImpact = () => room(seq(0.85,
  [metal(0.8, 290, [1, 2.3, 3.9, 6.1, 8.2], 0.28), 1],
  [thud(120, 45, 0.2, 0.07), 1],
  [E(noise(0.08, 24), 0.0005, 0.02), 0.6]), 0.15, 0.4, 0.3);
const daggerAttack = () => seq(0.13,
  [shape(hp(noise(0.11, 25), (t) => 3000 + 5000 * bump(0.11, 0.4)(t)), bump(0.11, 0.35, 2)), 1],
  [E(tone(0.09, 5200), 0.001, 0.02), 0.12, 0.02]);
const bowRelease = () => seq(0.34,
  [shape(lp(tone(0.3, (t) => 190 * (1 + 0.6 * Math.exp(-t / 0.02)), 'tri'), 1800), ad(0.001, 0.07)), 1],
  [shape(bp(noise(0.18, 26), expo(1200, 3500, 0.15), 1.2), bump(0.18, 0.3, 1.5)), 0.5, 0.01]);
const arrowImpact = () => seq(0.2,
  [E(tone(0.1, expo(420, 240, 0.05), 'tri'), 0.0005, 0.02), 1],
  [E(bp(noise(0.05, 27), 1500, 1.5), 0.0005, 0.012), 0.8],
  [E(tone(0.15, 95), 0.001, 0.04), 0.3]);
const staffAttack = () => seq(0.34,
  [shape(tone(0.3, (t) => 880 * Math.pow(0.35, t / 0.3) * (1 + 0.03 * Math.sin(TAU * 30 * t))), ad(0.004, 0.1)), 1],
  [E(hp(noise(0.2, 28), 6000), 0.005, 0.05), 0.2],
  [E(tone(0.2, expo(1760, 700, 0.2)), 0.004, 0.06), 0.3]);
const physicalHit = () => seq(0.2, [thud(170, 55, 0.16, 0.05), 1], [E(lp(noise(0.08, 29), 1300), 0.0005, 0.022), 0.9]);
const criticalHit = () => seq(0.5,
  [thud(180, 50, 0.2, 0.06), 1],
  [E(lp(noise(0.1, 129), 2400), 0.0005, 0.03), 1],
  [ding(1900, 0.12), 0.4],
  [ding(2850, 0.09), 0.3, 0.01],
  [E(tone(0.3, expo(90, 35, 0.25)), 0.002, 0.1), 0.8]);
const monsterHit = () => seq(0.22,
  [E(lp(noise(0.1, 30, 'pink'), 900), 0.001, 0.03), 1],
  [shape(lp(tone(0.16, expo(150, 90, 0.16), 'saw'), 700), ad(0.01, 0.05)), 0.7],
  [thud(130, 60, 0.12, 0.04), 0.6]);
const monsterDeath = () => seq(0.85,
  [shape(lp(tone(0.7, (t) => 170 * Math.pow(0.28, t / 0.7) * (1 + 0.04 * Math.sin(TAU * 23 * t)), 'saw'), expo(1400, 250, 0.7)), bump(0.7, 0.15, 1)), 1],
  [shape(bp(noise(0.6, 31, 'pink'), expo(1200, 300, 0.6)), bump(0.6, 0.2)), 0.5],
  [thud(110, 45, 0.2, 0.07), 0.8, 0.45]);
const playerDamage = () => seq(0.26,
  [thud(150, 60, 0.14, 0.045), 1],
  [shape(bp(tone(0.2, expo(165, 110, 0.2), 'saw'), 650, 4), ad(0.015, 0.06)), 0.5, 0.01],
  [shape(bp(tone(0.2, expo(165, 110, 0.2), 'saw'), 1100, 4), ad(0.015, 0.05)), 0.25, 0.01],
  [E(lp(noise(0.06, 32), 1500), 0.0005, 0.018), 0.6]);
const playerDeath = () => room(seq(1.2,
  [sawNote(440, 0.5, 900, 0.03, 0.2), 1],
  [sawNote(349.2, 0.5, 800, 0.03, 0.2), 1, 0.22],
  [sawNote(293.7, 0.7, 700, 0.03, 0.32), 1, 0.44],
  [thud(100, 40, 0.25, 0.09), 1, 0.72]), 0.3, 0.7, 0.6);

// ---------------------------------------------------------------------------------------------
// Rune magic
// ---------------------------------------------------------------------------------------------
const flutter = (hz: number, depth = 0.25) => (t: number) => 1 - depth + depth * Math.sin(TAU * hz * t);
const fireballCast = () => seq(0.42,
  [shape(bp(noise(0.4, 41), expo(350, 1900, 0.35), 1.1), (t) => bump(0.4, 0.6, 1.2)(t) * flutter(34)(t)), 1],
  [E(tone(0.2, expo(140, 70, 0.15)), 0.01, 0.06), 0.6]);
const fireballImpact = () => room(seq(0.75,
  [E(tone(0.6, expo(110, 38, 0.4)), 0.002, 0.16), 1],
  [E(lp(noise(0.7, 42), expo(4500, 300, 0.6)), 0.003, 0.2), 0.9],
  [shape(mul(hp(noise(0.6, 142), 1500), grains(0.6, 143, 70, 0.006)), ad(0.01, 0.2)), 0.3]), 0.15, 0.5, 0.3);
const flameBurst = () => seq(0.95,
  [shape(lp(noise(0.9, 43), (t) => 300 + 3800 * bump(0.9, 0.25)(t)), (t) => bump(0.9, 0.2, 0.8)(t) * flutter(27, 0.2)(t)), 1],
  [E(tone(0.5, expo(95, 45, 0.4)), 0.02, 0.18), 0.7],
  [shape(mul(hp(noise(0.8, 144), 2000), grains(0.8, 145, 90, 0.005)), bump(0.8, 0.3)), 0.25]);
const meteorCast = () => seq(1.15,
  [shape(tone(1.15, expo(1700, 260, 1.15)), (t) => bump(1.15, 0.85, 1.5)(t)), 0.45],
  [shape(lp(noise(1.15, 44, 'brown'), expo(120, 700, 1.15)), (t) => (t / 1.15) ** 2), 1],
  [shape(bp(noise(1.15, 146), expo(600, 2400, 1.15), 1), (t) => (t / 1.15) ** 2 * flutter(31)(t)), 0.5]);
const meteorImpact = () => room(seq(1.5,
  [E(tone(1.4, expo(75, 28, 0.9)), 0.002, 0.4), 1],
  [E(lp(noise(1.4, 45), expo(6000, 180, 1.2)), 0.002, 0.38), 1],
  [shape(mul(bp(noise(1.2, 147), 900, 0.8), grains(1.2, 148, 60, 0.012)), ad(0.02, 0.4)), 0.5, 0.15]), 0.25, 0.75, 0.7);
const waterBolt = () => seq(0.32,
  [shape(tone(0.22, expo(320, 1300, 0.12)), ad(0.004, 0.06)), 1],
  [shape(bp(noise(0.28, 46), expo(2800, 900, 0.25), 1.2), bump(0.28, 0.25, 1.3)), 0.6],
  [E(tone(0.07, expo(500, 1100, 0.05)), 0.004, 0.02), 0.5, 0.1]);
const healingRain = () => room(seq(1.5,
  [shape(mul(hp(noise(1.5, 47), 5000), grains(1.5, 149, 260, 0.003)), bump(1.5, 0.3)), 0.35],
  [ding(1046.5, 0.5), 0.5],
  [ding(1318.5, 0.5), 0.5, 0.18],
  [ding(1568, 0.6), 0.5, 0.36],
  [ding(2093, 0.7), 0.45, 0.54],
  [shape(tone(1.4, 523.25), bump(1.4, 0.4)), 0.15]), 0.3, 0.7, 0.6);
const iceSpear = () => seq(0.55,
  [E(hp(noise(0.04, 48), 5000), 0.0005, 0.008), 1],
  [metal(0.5, 2900, [1, 1.34, 1.87, 2.41, 3.12], 0.12), 0.6],
  [shape(hp(noise(0.3, 49), expo(2500, 7000, 0.25)), bump(0.3, 0.3, 1.5)), 0.5],
  [thud(260, 140, 0.08, 0.02), 0.3]);
const thunderStrike = () => seq(1.2,
  [E(hp(noise(0.08, 50), 1800), 0.0005, 0.02), 1],
  [shape(tone(0.1, expo(2400, 300, 0.1), 'saw'), ad(0.001, 0.03)), 0.4],
  [shape(lp(noise(1.1, 51, 'brown'), expo(500, 90, 1)), ad(0.02, 0.35)), 1.2, 0.03]);
const chainLightning = () => seq(0.55,
  ...[0, 0.09, 0.17, 0.27].flatMap((at, k) => [
    [shape(hp(tone(0.07, 110 + k * 25, 'square'), 900), ad(0.001, 0.02)), 0.8, at],
    [E(hp(noise(0.06, 52 + k), 4000), 0.0005, 0.012), 0.8, at],
  ] as [M, number, number][]),
  [shape(mul(hp(noise(0.5, 150), 6000), grains(0.5, 151, 120, 0.004)), bump(0.5, 0.4)), 0.4]);
const stoneShield = () => seq(0.6,
  [shape(mul(bp(noise(0.4, 56, 'brown'), 320, 1.2), grains(0.4, 152, 140, 0.01)), bump(0.4, 0.5)), 1.4],
  ...[0.08, 0.19, 0.28].map((at, k) => [E(bp(noise(0.03, 57 + k), 900 + k * 200, 3), 0.0005, 0.01), 0.7, at] as [M, number, number]),
  [thud(150, 80, 0.2, 0.06), 1, 0.34]);
const earthquake = () => seq(1.75,
  [shape(lp(noise(1.7, 60, 'brown'), 140), (t) => bump(1.7, 0.25, 0.8)(t) * flutter(7.5, 0.3)(t)), 1.5],
  [shape(tone(1.7, 38), bump(1.7, 0.3)), 1],
  [shape(mul(bp(noise(1.6, 153), 600, 0.8), grains(1.6, 154, 45, 0.02)), bump(1.6, 0.35)), 0.25]);
const windSlash = () => seq(0.22,
  [shape(hp(noise(0.2, 61), (t) => 1800 + 6000 * bump(0.2, 0.35)(t)), bump(0.2, 0.3, 2)), 1],
  [shape(tone(0.18, expo(2400, 4200, 0.15)), bump(0.18, 0.4, 2)), 0.12]);
const tornado = () => seq(1.65,
  [shape(bp(noise(1.6, 62, 'pink'), (t) => 900 + 600 * Math.sin(TAU * 2.6 * t), 1.4), bump(1.6, 0.35, 0.8)), 1],
  [shape(lp(noise(1.6, 63, 'brown'), 200), bump(1.6, 0.4)), 0.6],
  [shape(tone(1.6, (t) => 1500 + 300 * Math.sin(TAU * 2.6 * t)), bump(1.6, 0.4)), 0.05]);

// ---------------------------------------------------------------------------------------------
// Job skills (shared by effect type)
// ---------------------------------------------------------------------------------------------
const shout = () => seq(0.5,
  [shape(bp(tone(0.45, expo(210, 170, 0.45), 'saw'), 700, 5), ad(0.03, 0.16)), 1],
  [shape(bp(tone(0.45, expo(210, 170, 0.45), 'saw'), 1150, 5), ad(0.03, 0.14)), 0.6],
  [shape(bp(noise(0.4, 64, 'pink'), 1500, 1), ad(0.03, 0.12)), 0.25]);
const buff = () => seq(0.9, [arpeggio([440, 554.4, 659.3, 880, 1108.7], 0.07, 0.12, 0.22), 1], [E(hp(noise(0.5, 65), 7000), 0.1, 0.15), 0.1]);
const heal = () => room(seq(1, [ding(659.3, 0.35), 1], [ding(784, 0.35), 1, 0.1], [ding(1046.5, 0.5), 1, 0.2], [shape(tone(0.9, 523.25), bump(0.9, 0.4)), 0.2]), 0.3, 0.6, 0.5);
const shield = () => room(seq(0.5,
  [shape(tone(0.45, expo(260, 620, 0.3)), bump(0.45, 0.3)), 1],
  [shape(tone(0.45, expo(390, 930, 0.3)), bump(0.45, 0.3)), 0.4],
  [E(hp(noise(0.3, 66), 6000), 0.05, 0.08), 0.12]), 0.25, 0.5, 0.4);
const dash = () => shape(bp(noise(0.16, 70), expo(700, 3200, 0.14), 1.3), bump(0.16, 0.4, 1.5));
const smoke = () => shape(lp(noise(0.45, 71, 'pink'), expo(2500, 400, 0.4)), ad(0.02, 0.14));
const trapSet = () => seq(0.25,
  [E(bp(noise(0.02, 72), 2500, 4), 0.0005, 0.005), 1],
  [E(bp(noise(0.02, 172), 1900, 4), 0.0005, 0.005), 1, 0.09],
  [metal(0.12, 900, [1, 2.3, 3.7], 0.03), 0.4, 0.09]);
const trapFire = () => seq(0.32,
  [E(hp(noise(0.04, 73), 2000), 0.0005, 0.01), 1],
  [shape(tone(0.25, (t) => 600 * (1 + 0.5 * Math.exp(-t / 0.03)) * (1 + 0.08 * Math.sin(TAU * 45 * t)), 'tri'), ad(0.001, 0.07)), 0.6],
  [metal(0.2, 1300, [1, 2.1, 3.4], 0.05), 0.4]);
const arcane = () => seq(0.5,
  [shape(tone(0.25, (t) => 700 + 900 * bump(0.25, 0.3)(t) + 120 * Math.sin(TAU * 60 * t)), ad(0.004, 0.08)), 1],
  [ding(1800, 0.1), 0.3]);
const holy = () => room(seq(0.7, [ding(1046.5, 0.3), 1], [ding(1568, 0.3), 0.7], [shape(hp(noise(0.3, 74), 5000), bump(0.3, 0.3)), 0.2]), 0.3, 0.6, 0.5);
const volley = () => seq(0.5,
  [shape(lp(tone(0.2, (t) => 200 * (1 + 0.5 * Math.exp(-t / 0.02)), 'tri'), 1600), ad(0.001, 0.05)), 0.7],
  ...[0, 0.07, 0.15, 0.22, 0.31].map((at, k) => [shape(hp(noise(0.1, 75 + k), expo(2000, 6000, 0.1)), bump(0.1, 0.4, 2)), 0.8, at] as [M, number, number]));

// ---------------------------------------------------------------------------------------------
// Items and gameplay
// ---------------------------------------------------------------------------------------------
const potion = () => seq(0.4,
  [E(tone(0.05, expo(900, 400, 0.04)), 0.001, 0.012), 1],
  ...[0.08, 0.17, 0.25].map((at, k) => [E(tone(0.07, expo(300 + k * 120, 700 + k * 200, 0.06)), 0.005, 0.02), 0.8, at] as [M, number, number]),
  [thud(160, 100, 0.08, 0.025), 0.4, 0.3]);
const pickup = () => seq(0.7, [ding(659.3, 0.08), 1], [ding(880, 0.12), 1, 0.07]);
const gold = () => seq(0.4, [metal(0.25, 3100, [1, 1.5, 2.2, 2.9], 0.06), 1], [metal(0.25, 3700, [1, 1.5, 2.2, 2.9], 0.06), 0.8, 0.06]);
const equip = () => seq(0.25, [shape(bp(noise(0.15, 80, 'pink'), 1200, 0.8), bump(0.15, 0.4)), 0.6], [metal(0.08, 1500, [1, 2.7], 0.02), 1, 0.12]);
const upgradeOk = () => room(seq(1.3, [metal(0.6, 880, [1, 2.76, 5.4, 8.9], 0.2), 1], [arpeggio([1318.5, 1568, 2093, 2637], 0.08, 0.14, 0.3), 0.6, 0.15]), 0.25, 0.6, 0.4);
const upgradeFail = () => seq(0.5, [metal(0.25, 330, [1, 1.7, 2.9], 0.06), 1], [shape(tone(0.35, expo(330, 150, 0.35), 'tri'), ad(0.01, 0.12)), 0.5, 0.08]);
const dropRare = () => room(arpeggio([880, 1108.7, 1318.5], 0.09, 0.2, 0.35), 0.25, 0.6, 0.4);
const dropLegendary = () => room(seq(2,
  [arpeggio([587.3, 740, 880, 1174.7, 1480], 0.09, 0.22, 0.5), 1],
  [shape(tone(1.2, 587.3), bump(1.2, 0.3)), 0.15, 0.4],
  [shape(tone(1.2, 880), bump(1.2, 0.3)), 0.12, 0.4],
  [E(hp(noise(0.8, 81), 7000), 0.2, 0.25), 0.08, 0.3]), 0.3, 0.75, 0.6);
const dropMythic = () => room(seq(2.8,
  [metal(2, 110, [1, 2.01, 2.83, 3.9, 5.1], 0.9), 0.9],
  [arpeggio([659.3, 830.6, 987.8, 1318.5, 1661.2, 1975.5], 0.1, 0.25, 0.7), 0.8, 0.15],
  [shape(lp(tone(1.8, 329.6, 'saw'), 1400), bump(1.8, 0.3)), 0.2, 0.6],
  [shape(lp(tone(1.8, 493.9, 'saw'), 1400), bump(1.8, 0.3)), 0.16, 0.6],
  [shape(lp(tone(1.8, 659.3, 'saw'), 1600), bump(1.8, 0.3)), 0.14, 0.6],
  [E(hp(noise(1.2, 82), 7000), 0.3, 0.35), 0.08, 0.5]), 0.35, 0.85, 0.9);
const levelUp = () => room(seq(1.6,
  [arpeggio([523.25, 659.25, 784, 1046.5], 0.1, 0.2, 0.5), 1],
  ...[523.25, 659.25, 784, 1046.5].map((f, k) => [sawNote(f, k === 3 ? 0.7 : 0.14, 2600, 0.01, k === 3 ? 0.3 : 0.08), 0.35, k * 0.1] as [M, number, number]),
  [E(hp(noise(0.6, 83), 7000), 0.15, 0.2), 0.08, 0.3]), 0.3, 0.7, 0.6);
const questAccept = () => seq(1, [shape(hp(noise(0.2, 90, 'pink'), 1800), bump(0.2, 0.3)), 0.4], [ding(784, 0.18), 1, 0.12], [ding(1046.5, 0.3), 1, 0.26]);
const questComplete = () => room(arpeggio([784, 1046.5, 1318.5, 1568, 2093], 0.12, 0.2, 0.5), 0.3, 0.7, 0.5);
const dungeonEnter = () => room(seq(2.4,
  [shape(mul(lp(noise(1.6, 91, 'brown'), 160), grains(1.6, 191, 200, 0.02)), bump(1.6, 0.3)), 1.5],
  [metal(1.8, 82, [1, 2.02, 2.9, 4.1], 0.8), 0.8, 0.5],
  [thud(90, 40, 0.3, 0.1), 1, 0.5]), 0.35, 0.9, 0.9);
const bossSpawn = () => room(seq(1.4,
  [shape(bp(tone(1.3, (t) => 95 * (1 + 0.25 * bump(1.3, 0.3)(t)) * (1 + 0.03 * Math.sin(TAU * 31 * t)), 'saw'), (t) => 500 + 900 * bump(1.3, 0.35)(t), 3), bump(1.3, 0.25, 0.8)), 1],
  [shape(bp(tone(1.3, (t) => 95 * (1 + 0.25 * bump(1.3, 0.3)(t)), 'saw'), (t) => 1100 + 1300 * bump(1.3, 0.35)(t), 4), bump(1.3, 0.25, 0.8)), 0.5],
  [shape(bp(noise(1.2, 92, 'pink'), 1800, 0.8), bump(1.2, 0.25)), 0.25],
  [shape(tone(1.3, 47), bump(1.3, 0.3)), 0.7]), 0.3, 0.8, 0.7);
const bossDefeat = () => room(seq(2,
  [E(tone(1.2, expo(80, 30, 0.8)), 0.002, 0.35), 1],
  [E(lp(noise(1.2, 93), expo(5000, 200, 1)), 0.002, 0.3), 0.8],
  ...[261.6, 392, 523.25, 659.25].map((f) => [sawNote(f, 1.4, 2500, 0.01, 0.5), 0.3, 0.25] as [M, number, number])), 0.3, 0.8, 0.8);
const worldBossAnnounce = () => room(seq(2.4,
  [shape(lp(tone(1, 110, 'saw'), (t) => 300 + 900 * bump(1, 0.5)(t)), bump(1, 0.3, 0.7)), 1],
  [shape(lp(tone(1.3, 164.8, 'saw'), (t) => 300 + 1200 * bump(1.3, 0.4)(t)), bump(1.3, 0.25, 0.7)), 1, 0.9],
  [shape(tone(2.2, 55), bump(2.2, 0.4)), 0.4]), 0.35, 0.9, 1);
/** The hit that opens a fight: war drum, low brass stab and a cymbal, under the first bar of the combat music. */
const battleStart = () => room(seq(1.3,
  [thud(120, 38, 0.5, 0.2), 1],
  [E(lp(noise(0.25, 98), 2200), 0.0005, 0.06), 0.7],
  [E(hp(noise(1.1, 99), 3800), 0.002, 0.32), 0.45],
  ...[110, 164.8, 220].map((f) => [sawNote(f, 0.5, 1800, 0.008, 0.16), 0.35, 0] as [M, number, number])), 0.25, 0.7, 0.6);
const uiClick = () => seq(0.04, [E(tone(0.03, 1700), 0.0005, 0.008), 1], [E(bp(noise(0.01, 95), 3000, 2), 0.0003, 0.003), 0.5]);
const uiNotify = () => seq(1, [ding(880, 0.12), 1], [ding(1174.7, 0.18), 1, 0.1]);
const uiError = () => seq(0.2, [E(lp(tone(0.08, 150, 'square'), 900), 0.002, 0.03), 1], [E(lp(tone(0.08, 140, 'square'), 900), 0.002, 0.03), 1, 0.1]);
const portal = () => room(seq(1.3,
  [shape(bp(noise(0.8, 96, 'pink'), expo(400, 3000, 0.7), 1.5), bump(0.8, 0.6)), 0.6],
  [shape(tone(0.8, expo(220, 880, 0.7)), bump(0.8, 0.7)), 0.4],
  [arpeggio([1760, 2217.5, 2637], 0.06, 0.12, 0.25), 0.4, 0.6]), 0.3, 0.7, 0.6);
const gather = () => seq(0.4,
  [shape(bp(noise(0.15, 97), 1600, 1.5), bump(0.15, 0.5)), 0.6],
  [metal(0.14, 210, [1, 1.6, 2.7], 0.04), 1, 0.15],
  [shape(hp(noise(0.12, 197, 'pink'), 3000), bump(0.12, 0.4)), 0.4, 0.22]);
const cacheOpen = () => room(seq(1.3,
  [shape(lp(tone(0.35, (t) => 320 + 80 * Math.sin(TAU * 9 * t) + 120 * t, 'saw'), 1500), bump(0.35, 0.5)), 0.4],
  [metal(0.08, 1400, [1, 2.6], 0.02), 0.7, 0.3],
  [ding(1318.5, 0.25), 1, 0.35],
  [ding(1760, 0.3), 1, 0.45]), 0.25, 0.6, 0.5);

/** Effect id -> mono renderer. */
export const SFX: Record<string, () => Float32Array> = {
  'move.step_grass': stepGrass, 'move.step_stone': stepStone, 'move.step_wood': stepWood, 'move.step_snow': stepSnow, 'move.step_water': stepWater, 'move.run': run,
  'combat.sword_swing': swordSwing, 'combat.sword_impact': swordImpact, 'combat.shield_block': shieldBlock, 'combat.greatsword_impact': greatswordImpact,
  'combat.dagger_attack': daggerAttack, 'combat.bow_release': bowRelease, 'combat.arrow_impact': arrowImpact, 'combat.staff_attack': staffAttack,
  'combat.physical_hit': physicalHit, 'combat.critical_hit': criticalHit, 'combat.monster_hit': monsterHit, 'combat.monster_death': monsterDeath,
  'combat.player_damage': playerDamage, 'combat.player_death': playerDeath,
  'rune.fireball_cast': fireballCast, 'rune.fireball_impact': fireballImpact, 'rune.flame_burst': flameBurst, 'rune.meteor_cast': meteorCast, 'rune.meteor_impact': meteorImpact,
  'rune.water_bolt': waterBolt, 'rune.healing_rain': healingRain, 'rune.ice_spear': iceSpear, 'rune.thunder_strike': thunderStrike, 'rune.chain_lightning': chainLightning,
  'rune.stone_shield': stoneShield, 'rune.earthquake': earthquake, 'rune.wind_slash': windSlash, 'rune.tornado': tornado,
  'skill.shout': shout, 'skill.buff': buff, 'skill.heal': heal, 'skill.shield': shield, 'skill.dash': dash, 'skill.smoke': smoke,
  'skill.trap_set': trapSet, 'skill.trap_fire': trapFire, 'skill.arcane': arcane, 'skill.holy': holy, 'skill.volley': volley,
  'item.potion': potion, 'item.pickup': pickup, 'item.gold': gold, 'item.equip': equip, 'item.upgrade_ok': upgradeOk, 'item.upgrade_fail': upgradeFail,
  'item.drop_rare': dropRare, 'item.drop_legendary': dropLegendary, 'item.drop_mythic': dropMythic,
  'game.level_up': levelUp, 'game.quest_accept': questAccept, 'game.quest_complete': questComplete, 'game.dungeon_enter': dungeonEnter,
  'game.boss_spawn': bossSpawn, 'game.boss_defeat': bossDefeat, 'game.world_boss_announce': worldBossAnnounce,
  'game.battle_start': battleStart, 'ui.click': uiClick, 'ui.notify': uiNotify, 'ui.error': uiError, 'env.portal': portal, 'env.gather': gather, 'env.cache_open': cacheOpen,
};
/**
 * Volume normalisation: every effect is rendered to the same peak, then played at this gain so
 * that a footstep is not as loud as an explosion. Recorded in the manifest as `gain`.
 */
export const SFX_GAIN: Record<string, number> = {
  'move.step_grass': 0.22, 'move.step_stone': 0.24, 'move.step_wood': 0.26, 'move.step_snow': 0.3, 'move.step_water': 0.3, 'move.run': 0.1,
  'combat.sword_swing': 0.45, 'combat.sword_impact': 0.5, 'combat.shield_block': 0.6, 'combat.greatsword_impact': 0.6, 'combat.dagger_attack': 0.4,
  'combat.bow_release': 0.5, 'combat.arrow_impact': 0.5, 'combat.staff_attack': 0.4, 'combat.physical_hit': 0.55, 'combat.critical_hit': 0.75,
  'combat.monster_hit': 0.5, 'combat.monster_death': 0.6, 'combat.player_damage': 0.65, 'combat.player_death': 0.8,
  'rune.fireball_cast': 0.55, 'rune.fireball_impact': 0.75, 'rune.flame_burst': 0.75, 'rune.meteor_cast': 0.7, 'rune.meteor_impact': 0.95,
  'rune.water_bolt': 0.55, 'rune.healing_rain': 0.6, 'rune.ice_spear': 0.6, 'rune.thunder_strike': 0.85, 'rune.chain_lightning': 0.7,
  'rune.stone_shield': 0.65, 'rune.earthquake': 0.9, 'rune.wind_slash': 0.5, 'rune.tornado': 0.7,
  'skill.shout': 0.55, 'skill.buff': 0.45, 'skill.heal': 0.5, 'skill.shield': 0.5, 'skill.dash': 0.45, 'skill.smoke': 0.45,
  'skill.trap_set': 0.45, 'skill.trap_fire': 0.6, 'skill.arcane': 0.5, 'skill.holy': 0.5, 'skill.volley': 0.55,
  'item.potion': 0.55, 'item.pickup': 0.45, 'item.gold': 0.4, 'item.equip': 0.5, 'item.upgrade_ok': 0.65, 'item.upgrade_fail': 0.6,
  'item.drop_rare': 0.6, 'item.drop_legendary': 0.75, 'item.drop_mythic': 0.9,
  'game.level_up': 0.8, 'game.quest_accept': 0.6, 'game.quest_complete': 0.7, 'game.dungeon_enter': 0.85,
  'game.boss_spawn': 0.9, 'game.boss_defeat': 0.9, 'game.world_boss_announce': 0.85,
  'game.battle_start': 0.8, 'ui.click': 0.3, 'ui.notify': 0.45, 'ui.error': 0.4, 'env.portal': 0.6, 'env.gather': 0.5, 'env.cache_open': 0.6,
};
export const renderSfx = (id: string): Stereo => toStereo(SFX[id](), -3);

// ---------------------------------------------------------------------------------------------
// Ambience (stereo loops)
// ---------------------------------------------------------------------------------------------
const LOOP = 22, XF = 1.5;
function place(st: Stereo, x: M, at: number, gain: number, pan: number) {
  const o = Math.round(at * SR), gl = Math.cos(((pan + 1) * Math.PI) / 4) * gain, gr = Math.sin(((pan + 1) * Math.PI) / 4) * gain;
  for (let i = 0; i < x.length && o + i < st.l.length; i++) {
    st.l[o + i] += x[i] * gl;
    st.r[o + i] += x[i] * gr;
  }
}
/** A wide noise bed: two differently seeded signals, one per ear. */
function bed(st: Stereo, make: (seed: number) => M, gain: number, seed: number) {
  const a = make(seed), b = make(seed + 1);
  for (let i = 0; i < st.l.length && i < a.length; i++) {
    st.l[i] += a[i] * gain;
    st.r[i] += b[i] * gain;
  }
}
const finish = (st: Stereo) => finalize(crossLoop(st, LOOP, XF), -24, true);
const LEN = LOOP + XF + 0.5;

function ambCity(): Stereo {
  const st = stereo(LEN), r = rng(201);
  bed(st, (s) => lp(noise(LEN, s, 'brown'), 260), 0.9, 210);
  // the murmur of a busy street: band-limited noise that swells and ebbs
  bed(st, (s) => shape(bp(noise(LEN, s, 'pink'), 520, 0.7), (t) => 0.55 + 0.45 * Math.sin(TAU * t / 5.3 + s)), 0.5, 212);
  for (let t = 1; t < LOOP; t += 1.6 + r() * 2.6) {
    // a smith somewhere: two or three hammer strokes
    const strokes = 2 + Math.floor(r() * 2), pan = r() * 1.6 - 0.8, f = 1150 + r() * 500;
    for (let k = 0; k < strokes; k++) place(st, metal(0.3, f, [1, 2.76, 5.4], 0.07), t + k * 0.42, 0.1 + r() * 0.05, pan);
  }
  for (const t of [3.2, 6.4, 14.5, 17.7]) place(st, ding(392, 1.1), t, 0.12, -0.3); // a distant bell
  for (let t = 0.5; t < LOOP; t += 0.9 + r() * 1.7) place(st, thud(160 + r() * 60, 90, 0.1, 0.03), t, 0.08, r() * 2 - 1); // cart wheels, doors, crates
  reverb(st, 0.6, 0.5, 0.25);
  return finish(st);
}
function ambForest(): Stereo {
  const st = stereo(LEN), r = rng(202);
  bed(st, (s) => shape(bp(noise(LEN, s, 'pink'), 3500, 0.6), (t) => 0.5 + 0.5 * Math.sin(TAU * t / 6.7 + s * 2)), 0.5, 220);
  bed(st, (s) => lp(noise(LEN, s, 'brown'), 180), 0.5, 222);
  for (let t = 0.6; t < LOOP; t += 1.1 + r() * 2.2) {
    const pan = r() * 1.8 - 0.9, n = 2 + Math.floor(r() * 4), f = 2600 + r() * 2200, up = r() < 0.5, gain = 0.1 + r() * 0.1;
    for (let k = 0; k < n; k++) place(st, shape(tone(0.08, expo(up ? f : f * 1.4, up ? f * 1.4 : f, 0.07)), bump(0.08, 0.3, 1.5)), t + k * (0.1 + r() * 0.04), gain, pan);
  }
  for (const t of [4.1, 12.6, 19.2]) {
    place(st, shape(tone(0.28, 700), bump(0.28, 0.3)), t, 0.1, 0.5);
    place(st, shape(tone(0.4, 560), bump(0.4, 0.3)), t + 0.32, 0.1, 0.5);
  }
  reverb(st, 0.7, 0.5, 0.3);
  return finish(st);
}
function ambDungeon(): Stereo {
  const st = stereo(LEN), r = rng(203);
  bed(st, (s) => lp(noise(LEN, s, 'brown'), 240), 0.7, 230);
  for (const [f, pan] of [[55, -0.4], [55.4, 0.4], [82.6, 0]] as const) place(st, shape(tone(LEN, f), () => 1), 0, 0.22, pan);
  for (let t = 0.8; t < LOOP; t += 1.5 + r() * 2.8) {
    const f = 1400 + r() * 1200;
    place(st, E(tone(0.12, expo(f * 1.25, f, 0.03)), 0.002, 0.03), t, 0.25 + r() * 0.15, r() * 1.6 - 0.8);
  }
  for (const t of [7.5, 16.2]) place(st, shape(bp(noise(2.5, 233, 'pink'), expo(300, 700, 2.5), 2), bump(2.5, 0.5)), t, 0.25, 0); // a draught through the halls
  reverb(st, 0.92, 0.3, 0.5);
  return finish(st);
}
function ambWind(): Stereo {
  const st = stereo(LEN);
  bed(st, (s) => shape(bp(noise(LEN, s, 'pink'), (t) => 520 + 330 * Math.sin(TAU * t / 11 + s) + 120 * Math.sin(TAU * t / 3.7), 1), (t) => 0.45 + 0.4 * Math.sin(TAU * t / 7.3 + s * 3) + 0.15 * Math.sin(TAU * t / 2.9)), 1, 240);
  bed(st, (s) => shape(bp(noise(LEN, s), (t) => 2200 + 500 * Math.sin(TAU * t / 5.1 + s), 6), (t) => Math.max(0, Math.sin(TAU * t / 7.3 + s * 3)) ** 2), 0.12, 242);
  bed(st, (s) => lp(noise(LEN, s, 'brown'), 150), 0.5, 244);
  return finish(st);
}
function ambWater(): Stereo {
  const st = stereo(LEN), r = rng(205);
  bed(st, (s) => shape(lp(noise(LEN, s, 'brown'), 420), (t) => 0.6 + 0.4 * Math.sin(TAU * t / 3.1 + s)), 0.9, 250);
  for (let t = 0.4; t < LOOP; t += 0.7 + r() * 1.6) place(st, E(tone(0.09, expo(280 + r() * 200, 650 + r() * 300, 0.07)), 0.006, 0.025), t, 0.12 + r() * 0.1, r() * 1.8 - 0.9); // bubbles
  for (let t = 1.5; t < LOOP; t += 2.2 + r() * 2.4) {
    // crickets: a high tone chopped fast
    const len = 0.5 + r() * 0.5, pan = r() * 1.6 - 0.8;
    place(st, shape(tone(len, 4300 + r() * 500), (x) => bump(len, 0.5, 0.5)(x) * (Math.sin(TAU * 14 * x) > 0 ? 1 : 0.05)), t, 0.05, pan);
  }
  for (const t of [2.6, 9.8, 15.1, 20.2]) {
    // a frog, sometimes answered
    const croak = () => shape(lp(tone(0.26, 150, 'saw'), 700), (x) => bump(0.26, 0.3)(x) * (0.5 + 0.5 * Math.sin(TAU * 28 * x)));
    place(st, croak(), t, 0.14, -0.5);
    if (t > 5) place(st, croak(), t + 0.45, 0.1, 0.6);
  }
  reverb(st, 0.5, 0.6, 0.2);
  return finish(st);
}
export const AMBIENCE: Record<string, () => Stereo> = {
  [AMB.CITY]: ambCity, [AMB.FOREST]: ambForest, [AMB.DUNGEON]: ambDungeon, [AMB.WIND]: ambWind, [AMB.WATER]: ambWater,
};
