// A character sprite drawn from its sheet: the HUD portrait, the creator preview and story portraits.
import React, { useEffect, useRef } from 'react';
import { animFrame, FRAME_H, FRAME_W, type Anim, type Appearance } from '../../shared/src/appearance';
import type { Job } from '../../shared/src/protocol';
import { drawAura, getCharSheet, SPRITE_OX, SPRITE_OY } from './game/chars';
import { getHDSheet, HD, hdFrame } from './game/hdchars';
import { settings } from './settings';

/** Draws one sprite; animates only when `anim` is given (creator preview). */
export function Sprite({ ap, job, scale = 3, anim, dir = 0 }: { ap: Appearance; job: Job; scale?: number; anim?: Anim; dir?: number }) {
  const ref = useRef(null as HTMLCanvasElement | null);
  useEffect(() => {
    const g = ref.current!.getContext('2d')!;
    const hd = settings.get().graphics.art === 'hd';
    const sheet = hd ? getHDSheet(ap, job) : getCharSheet(ap, job);
    const t0 = performance.now();
    const draw = () => {
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, FRAME_W * scale, FRAME_H * scale);
      // one-shot animations replay with a short pause so they can be inspected
      const t = anim ? (performance.now() - t0) % 1400 : 0;
      // HD frames are 64px: a 40px window around the (style A) figure fills the same canvas
      if (hd) g.drawImage(sheet, hdFrame(anim ?? 'idle', t) * HD + 12, dir * HD + 21, 40, 40, 0, 0, FRAME_W * scale, FRAME_H * scale);
      else g.drawImage(sheet, animFrame(anim ?? 'idle', t) * FRAME_W, dir * FRAME_H, FRAME_W, FRAME_H, 0, 0, FRAME_W * scale, FRAME_H * scale);
      if (anim && ap.aura) {
        g.save();
        g.scale(scale, scale);
        drawAura(g, ap.aura, SPRITE_OX, SPRITE_OY, performance.now(), 1);
        g.restore();
      }
    };
    draw();
    if (!anim) return;
    const id = setInterval(draw, 50);
    return () => clearInterval(id);
  }, [JSON.stringify(ap), job, scale, anim, dir]);
  return <canvas ref={ref} width={FRAME_W * scale} height={FRAME_H * scale} className="sprite" />;
}

