// The sky over the world: night falls with the clock (a soft light stays around the player and
// the village), and each region has its weather (rain, storms, snow, ash, fog, falling stars).
// Drawn in screen space over the world and under the name plates.
import { darkness, weatherAt, type Weather } from '../../../shared/src/events';
import type { Theme } from '../../../shared/src/world';
import { ambient } from './ambient';

interface Drop { x: number; y: number; v: number; s: number; }
const COUNT: Record<Weather, number> = { clear: 0, rain: 180, storm: 260, snow: 140, ash: 110, fog: 0, stars: 40 };

export class Sky {
  private drops: Drop[] = [];
  private kind: Weather = 'clear';
  private shade: HTMLCanvasElement | null = null;
  private flashAt = 0;
  private last = 0;
  /** What the weather is now (for the HUD). */
  weather: Weather = 'clear';

  draw(g: CanvasRenderingContext2D, W: number, H: number, now: number, serverNow: number, zone: string, theme: Theme, indoors: boolean, light: { x: number; y: number }[], density: number, darkScale = 1) {
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    const w = indoors ? 'clear' : weatherAt(zone, theme, serverNow);
    this.weather = w;
    if (w !== this.kind) {
      this.kind = w;
      this.drops = [];
    }
    // ---- weather particles ----
    const want = Math.round(COUNT[w] * Math.max(0.2, density) * (W * H) / (1280 * 720));
    while (this.drops.length < want) this.drops.push({ x: Math.random() * W, y: Math.random() * H, v: 0.6 + Math.random() * 0.8, s: Math.random() });
    if (this.drops.length > want) this.drops.length = want;
    g.save();
    if (w === 'rain' || w === 'storm') {
      g.strokeStyle = w === 'storm' ? 'rgba(170,190,230,0.55)' : 'rgba(170,200,240,0.4)';
      g.lineWidth = 1;
      g.beginPath();
      const sp = (w === 'storm' ? 900 : 700) * dt, slant = w === 'storm' ? 0.35 : 0.18;
      for (const d of this.drops) {
        d.y += sp * d.v;
        d.x += sp * d.v * slant;
        if (d.y > H) { d.y = -10; d.x = Math.random() * W; }
        if (d.x > W) d.x -= W;
        g.moveTo(d.x, d.y);
        g.lineTo(d.x - 3 * slant * 4, d.y - 12 * d.v);
      }
      g.stroke();
      if (w === 'storm') {
        if (now > this.flashAt + 6000 && Math.random() < dt * 0.12) this.flashAt = now;
        const f = 1 - (now - this.flashAt) / 260;
        if (f > 0) {
          g.fillStyle = `rgba(220,230,255,${0.35 * f})`;
          g.fillRect(0, 0, W, H);
        }
      }
    } else if (w === 'snow' || w === 'ash' || w === 'stars') {
      for (const d of this.drops) {
        const sp = (w === 'stars' ? 160 : 45) * dt;
        d.y += sp * d.v;
        d.x += Math.sin(now / 900 + d.s * 6) * (w === 'stars' ? 0.2 : 0.5) + (w === 'stars' ? sp * 0.6 : 0);
        if (d.y > H) { d.y = -6; d.x = Math.random() * W; }
        if (d.x > W) d.x -= W;
        if (w === 'snow') g.fillStyle = 'rgba(245,250,255,0.85)';
        else if (w === 'ash') g.fillStyle = d.s > 0.8 ? 'rgba(255,150,70,0.8)' : 'rgba(90,85,85,0.7)';
        else g.fillStyle = `rgba(255,240,180,${0.5 + 0.5 * Math.sin(now / 200 + d.s * 9)})`;
        const r = w === 'stars' ? 1.6 : 1 + d.s * 1.6;
        g.fillRect(d.x, d.y, r, w === 'stars' ? r * 4 : r);
      }
    }
    if (w === 'fog') {
      const gr = g.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, 'rgba(200,210,215,0.22)');
      gr.addColorStop(0.5, 'rgba(200,210,215,0.10)');
      gr.addColorStop(1, 'rgba(200,210,215,0.25)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    g.restore();
    // ---- the air of the place: pollen and leaves by day, fireflies at night, dust, embers, spores ----
    if (!indoors) ambient.motes(g, W, H, now, dt, theme, darkness(serverNow), density);
    // ---- night ----
    const dark = (indoors ? 0 : darkness(serverNow) * (w === 'storm' ? 1 : 0.9)) * darkScale; // style B lights the night itself, so less shade
    if (dark > 0.02) {
      const s = (this.shade ??= document.createElement('canvas'));
      if (s.width !== W || s.height !== H) {
        s.width = W;
        s.height = H;
      }
      const sg = s.getContext('2d')!;
      sg.globalCompositeOperation = 'source-over';
      sg.clearRect(0, 0, W, H);
      sg.fillStyle = `rgba(8,12,34,${0.62 * dark})`;
      sg.fillRect(0, 0, W, H);
      // light: cut soft holes around the player and other lights
      sg.globalCompositeOperation = 'destination-out';
      for (const l of light) {
        const r = Math.min(W, H) * 0.32, gr = sg.createRadialGradient(l.x, l.y, r * 0.15, l.x, l.y, r);
        gr.addColorStop(0, 'rgba(0,0,0,0.85)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        sg.fillStyle = gr;
        sg.fillRect(l.x - r, l.y - r, r * 2, r * 2);
      }
      g.drawImage(s, 0, 0);
    }
  }
}
