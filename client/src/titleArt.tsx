// The title backdrop behind sign-in and character select: Aetherion at dusk. A violet sky with the
// fallen star still burning in it, three ridges of mountains, a lit castle on its hill, and the six
// classes standing on the near meadow, drawn from the game's own character sheets. Animated gently
// (the star's trail, drifting motes, twinkling stars, the heroes breathing); painted in code.
import React, { useEffect, useRef } from 'react';
import { defaultAppearance } from '../../shared/src/appearance';
import { JOBS } from '../../shared/src/protocol';
import { getHDSheet, HD, hdFrame } from './game/hdchars';

/** A ridge line across the screen: smooth hills with a little noise, the same on every frame. */
function ridge(w: number, base: number, amp: number, seed: number): number[] {
  const pts: number[] = [];
  for (let x = 0; x <= w; x += 8) pts.push(base - amp * (0.55 * Math.sin(x / 190 + seed) + 0.3 * Math.sin(x / 73 + seed * 2.1) + 0.15 * Math.sin(x / 31 + seed * 3.7)));
  return pts;
}

export function TitleBackdrop() {
  const ref = useRef(null as HTMLCanvasElement | null);
  useEffect(() => {
    const c = ref.current!, g = c.getContext('2d')!;
    let raf = 0, W = 0, H = 0, ridges: number[][] = [];
    const stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random() * 0.62, s: Math.random() }));
    const motes = Array.from({ length: 46 }, () => ({ x: Math.random(), y: 0.55 + Math.random() * 0.45, s: Math.random() }));
    const heroes = JOBS.map((j) => getHDSheet(defaultAppearance(j), j));
    const resize = () => {
      W = c.width = window.innerWidth;
      H = c.height = window.innerHeight;
      ridges = [ridge(W, H * 0.6, H * 0.09, 1.3), ridge(W, H * 0.68, H * 0.07, 4.1), ridge(W, H * 0.78, H * 0.05, 7.7)];
    };
    resize();
    window.addEventListener('resize', resize);
    const fill = (pts: number[], color: string) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, H);
      pts.forEach((y, i) => g.lineTo(i * 8, y));
      g.lineTo(W, H);
      g.closePath();
      g.fill();
    };
    const draw = (now: number) => {
      // the sky at dusk
      const sky = g.createLinearGradient(0, 0, 0, H * 0.75);
      sky.addColorStop(0, '#0b0e24'); sky.addColorStop(0.45, '#2a1f4e'); sky.addColorStop(0.8, '#7a3f5e'); sky.addColorStop(1, '#d08458');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      for (const s of stars) {
        g.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(now / 900 + s.s * 40)) * (1 - s.y);
        g.fillStyle = '#ffffff';
        g.fillRect(s.x * W, s.y * H, s.s > 0.92 ? 2 : 1, s.s > 0.92 ? 2 : 1);
      }
      g.globalAlpha = 1;
      // the fallen star of Aetherion, its trail still burning across the sky
      const sx = W * 0.72, sy = H * 0.2, pulse = 0.5 + 0.5 * Math.sin(now / 700);
      const trail = g.createLinearGradient(sx - W * 0.34, sy - H * 0.16, sx, sy);
      trail.addColorStop(0, 'rgba(255,220,160,0)'); trail.addColorStop(1, 'rgba(255,230,180,0.55)');
      g.strokeStyle = trail; g.lineWidth = 3;
      g.beginPath(); g.moveTo(sx - W * 0.34, sy - H * 0.16); g.lineTo(sx, sy); g.stroke();
      const halo = g.createRadialGradient(sx, sy, 0, sx, sy, 90 + pulse * 20);
      halo.addColorStop(0, 'rgba(255,250,230,0.95)'); halo.addColorStop(0.12, 'rgba(255,214,140,0.7)'); halo.addColorStop(0.4, 'rgba(200,140,255,0.22)'); halo.addColorStop(1, 'rgba(120,80,200,0)');
      g.fillStyle = halo;
      g.fillRect(sx - 120, sy - 120, 240, 240);
      // three ridges, the far ones paler, drifting very slowly
      g.save(); g.translate(Math.sin(now / 9000) * 6, 0); fill(ridges[0], '#3a2c55'); g.restore();
      g.save(); g.translate(Math.sin(now / 7000) * 10, 0); fill(ridges[1], '#2a2242'); g.restore();
      // the castle on its hill, its windows lit
      const cx = W * 0.24, cy = ridges[1][Math.round(cx / 8)] ?? H * 0.66;
      g.fillStyle = '#1d1830';
      g.fillRect(cx - 70, cy - 60, 140, 60);
      for (const [dx, h, w] of [[-70, 96, 26], [44, 110, 26], [-12, 140, 30]] as const) {
        g.fillRect(cx + dx, cy - h, w, h);
        g.beginPath(); g.moveTo(cx + dx - 4, cy - h); g.lineTo(cx + dx + w / 2, cy - h - 26); g.lineTo(cx + dx + w + 4, cy - h); g.closePath(); g.fill();
      }
      for (const [dx, dy] of [[-60, 70], [52, 82], [0, 112], [-30, 34], [20, 40], [-4, 76]]) {
        g.fillStyle = `rgba(255,200,110,${0.7 + 0.3 * Math.sin(now / 300 + dx)})`;
        g.fillRect(cx + dx, cy - dy, 5, 8);
      }
      fill(ridges[2], '#171427');
      // the near meadow
      const meadow = g.createLinearGradient(0, H * 0.8, 0, H);
      meadow.addColorStop(0, '#24402c'); meadow.addColorStop(1, '#0f1c14');
      g.fillStyle = meadow;
      g.beginPath(); g.moveTo(0, H); g.lineTo(0, H * 0.86); g.quadraticCurveTo(W * 0.5, H * 0.78, W, H * 0.86); g.lineTo(W, H); g.closePath(); g.fill();
      // the six heroes, breathing (idle frames, facing the viewer), lit warm by the star
      const scale = Math.max(2, Math.min(5, Math.floor(H / 190))), step = Math.min(W / 7.5, HD * scale * 0.95), x0 = W / 2 - (step * (heroes.length - 1)) / 2;
      g.imageSmoothingEnabled = false;
      heroes.forEach((sh, i) => {
        const x = x0 + i * step, foot = H * 0.93 - Math.abs(i - 2.5) * 6;
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.beginPath(); g.ellipse(x, foot - 2, 18 * scale / 3, 5 * scale / 3, 0, 0, Math.PI * 2); g.fill();
        g.drawImage(sh, hdFrame('idle', now + i * 170) * HD, 0, HD, HD, x - (HD * scale) / 2, foot - 60 * scale, HD * scale, HD * scale);
      });
      // motes of light rising from the meadow
      for (const m of motes) {
        const y = ((m.y * H - now / (30 + m.s * 40)) % (H * 0.5)) + H * 0.5, x = m.x * W + Math.sin(now / 1100 + m.s * 20) * 14;
        g.globalAlpha = 0.25 + 0.75 * Math.abs(Math.sin(now / 500 + m.s * 30));
        g.fillStyle = m.s > 0.5 ? '#ffe9a0' : '#b8ffcc';
        g.fillRect(x, y, 2, 2);
      }
      g.globalAlpha = 1;
      // a soft vignette so the sign-in panel reads clearly
      const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} className="titleart" aria-hidden="true" />;
}
