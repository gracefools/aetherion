// Rich hover tooltips (items, skills): one floating card for the whole interface, filled by whatever
// the pointer rests on and kept inside the window. Anything gets one with {...tip(() => <Card />)}.
// Keyboard focus shows it too, so it is not a mouse-only feature.
import React, { useLayoutEffect, useRef, useState } from 'react';

type Render = () => React.ReactNode;
let setTip: ((s: { render: Render; x: number; y: number } | null) => void) | null = null;
let shown: Render | null = null;

/** Props that give an element a rich tooltip. */
export function tip(render: Render) {
  const at = (x: number, y: number) => { shown = render; setTip?.({ render, x, y }); };
  return {
    onMouseEnter: (e: React.MouseEvent) => at(e.clientX, e.clientY),
    onMouseMove: (e: React.MouseEvent) => at(e.clientX, e.clientY),
    onMouseLeave: () => hideTip(),
    onFocus: (e: React.FocusEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); at(r.right, r.top); },
    onBlur: () => hideTip(),
  };
}
export function hideTip() {
  shown = null;
  setTip?.(null);
}

/** The single floating card, mounted once. */
export function TipLayer() {
  const [s, set] = useState(null as { render: Render; x: number; y: number } | null);
  const ref = useRef(null as HTMLDivElement | null), [pos, setPos] = useState({ left: -9999, top: -9999 });
  setTip = set;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!s || !el) return;
    // beside the pointer, flipped to the other side when it would leave the window
    const w = el.offsetWidth, h = el.offsetHeight, pad = 8, gap = 16;
    let left = s.x + gap, top = s.y + gap;
    if (left + w > innerWidth - pad) left = Math.max(pad, s.x - gap - w);
    if (top + h > innerHeight - pad) top = Math.max(pad, innerHeight - pad - h);
    setPos({ left, top });
  }, [s]);
  if (!s || shown !== s.render) return null;
  return <div ref={ref} className="richtip" role="tooltip" style={pos}>{s.render()}</div>;
}
