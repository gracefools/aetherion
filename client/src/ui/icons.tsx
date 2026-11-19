// The interface icon set (U2): one family of line icons on a 24px grid, drawn with the current text
// colour, so they follow hover, active and disabled states and every UI scale. Replaces the emoji and
// font symbols the menus used before, which looked different on every system.
//
// Each icon is a list of shapes: an SVG path string, or a circle written "c cx cy r" (outline) or
// "C cx cy r" (filled).
import React from 'react';

const ICONS = {
  hero: ['c 12 8 3.6', 'M4.5 20.5c0-4.1 3.4-7.2 7.5-7.2s7.5 3.1 7.5 7.2'],
  skills: ['M12 2.8l2.1 6.9 6.9 2.3-6.9 2.3L12 21.2l-2.1-6.9L3 12l6.9-2.3z'],
  ascension: ['M3.8 17.5l1.6-10 4.6 4.2L12 5.2l2 6.5 4.6-4.2 1.6 10z', 'M5 20.5h14'],
  bag: ['M5.5 8.5h13l1.2 12H4.3z', 'M9 8.5V6.8a3 3 0 0 1 6 0v1.7', 'M9.5 13h5'],
  pets: ['M8.3 16c0-2.2 1.7-3.9 3.7-3.9s3.7 1.7 3.7 3.9c0 1.9-1.6 3.2-3.7 3.2s-3.7-1.3-3.7-3.2z', 'C 5.6 11 1.7', 'C 9.4 6.9 1.7', 'C 14.6 6.9 1.7', 'C 18.4 11 1.7'],
  quests: ['M8 3.8h11v13.4a3 3 0 0 1-3 3H6.2a2.2 2.2 0 0 1-2.2-2.2v-1.8h12', 'M8 3.8a2 2 0 0 0-2 2V16', 'M10.5 8h5.5M10.5 11.5h5.5'],
  life: ['M5 19.5C5 11 10 5 19.5 4.5 19.5 14 13.5 19.5 5 19.5z', 'M5 19.5l8.5-8.5'],
  journal: ['M7.5 3.8h9v5.4a4.5 4.5 0 0 1-9 0z', 'M7.5 5.8H4.5a3.2 3.2 0 0 0 3.4 4.2M16.5 5.8h3a3.2 3.2 0 0 1-3.4 4.2', 'M12 13.8v3.4M8 20.5h8M9.8 17.2h4.4'],
  map: ['M3 6.2l6-2.2 6 2.2 6-2.2v13.6l-6 2.2-6-2.2-6 2.2z', 'M9 4v13.6M15 6.2v13.6'],
  auto: ['M4 4l9.5 9.5M20 4l-9.5 9.5', 'M6.3 15.3l2.4 2.4M17.7 15.3l-2.4 2.4', 'M5 20l2.5-2.5M19 20l-2.5-2.5'],
  guild: ['M12 3l7.5 3v5.2c0 4.8-3.2 8.2-7.5 9.8-4.3-1.6-7.5-5-7.5-9.8V6z', 'M12 8v7.5M8.8 11.5h6.4'],
  friends: ['c 9 8 3.2', 'M2.8 19.8c0-3.5 2.8-6.2 6.2-6.2s6.2 2.7 6.2 6.2', 'c 17 9 2.5', 'M16.4 13.5c2.7.2 4.8 2.6 4.8 5.6'],
  mail: ['M3.5 6h17v12h-17z', 'M3.8 6.6L12 12.6l8.2-6'],
  settings: ['c 12 12 3', 'M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8', 'c 12 12 6.6'],
  help: ['c 12 12 9', 'M9.4 9.4a2.7 2.7 0 1 1 3.8 2.5c-.7.3-1.2 1-1.2 1.8v.5', 'C 12 17.1 1'],
  exit: ['M12 3v8.5', 'M7 6.4a7.5 7.5 0 1 0 10 0'],
  close: ['M6.5 6.5l11 11M17.5 6.5l-11 11'],
  lock: ['M6 11h12v9.5H6z', 'M8.5 11V8.2a3.5 3.5 0 0 1 7 0V11', 'M12 14.5v2.5'],
  minimize: ['M6 17.5h12'],
  expand: ['M5.5 5.5h13v13h-13z'],
  up: ['M6 15l6-6 6 6'],
  down: ['M6 9l6 6 6-6'],
  left: ['M15 6l-6 6 6 6'],
  right: ['M9 6l6 6-6 6'],
  star: ['M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8z'],
  check: ['M5 12.8l4.5 4.4L19 7.2'],
  box: ['M4 8l8-4 8 4v8.5l-8 4-8-4z', 'M4 8l8 4 8-4M12 12v8.5'],
  sword: ['M20 4v4.2L9.8 18.4l-4.2-4.2L15.8 4z', 'M4.2 13l6.8 6.8', 'M6.6 17.4L4 20'],
  clock: ['c 12 12 8.8', 'M12 7.2V12l3.2 2.2'],
  gem: ['M12 3l7 9-7 9-7-9z', 'M5 12h14'],
  target: ['c 12 12 8.8', 'c 12 12 5', 'C 12 12 1.5'],
  hourglass: ['M6.5 3.5h11M6.5 20.5h11', 'M8 3.5v3.2l4 5.3-4 5.3v3.2M16 3.5v3.2L12 12l4 5.3v3.2'],
  burst: ['M12 2.5l1.9 5.6 5.6-1.9-3.4 4.8 4.9 3.2-5.9.6.9 5.8L12 16.4l-4 4.2.9-5.8-5.9-.6 4.9-3.2-3.4-4.8 5.6 1.9z'],
  heal: ['M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z'],
  bow: ['M4.5 19.5l15-15', 'M13.5 4.5h6v6', 'M4.5 19.5l.8-3.8M4.5 19.5l3.8-.8'],
  bolt: ['M13.5 2.5L5 14h6.5l-1 7.5L19 10h-6.5z'],
  fork: ['M12 21v-8M12 13L6.5 4M12 13l5.5-9M12 13V3.5'],
  drop: ['M12 3c3.2 4.6 6 7.8 6 11.2a6 6 0 0 1-12 0C6 10.8 8.8 7.6 12 3z', 'C 10 15 1.2'],
  castle: ['M4 20.5V9h3v3h2.5V9h5v3H17V9h3v11.5z', 'M10 20.5v-4.2h4v4.2'],
  flag: ['M5.5 21V4M5.5 4.5h11.5l-2.2 4 2.2 4H5.5'],
  skull: ['M5 11a7 7 0 1 1 14 0v4h-3v3.5H8V15H5z', 'C 9.3 11.3 1.6', 'C 14.7 11.3 1.6'],
  coin: ['c 12 12 8.5', 'c 12 12 5'],
  pot: ['M4 10h16v2.5a6.5 6.5 0 0 1-6.5 6.5h-3A6.5 6.5 0 0 1 4 12.5z', 'M8.5 7c0-1.2 1-1.8 1-3M12.5 7c0-1.2 1-1.8 1-3', 'M7 21h10'],
  sprout: ['M12 20.5v-8.5', 'M12 12c0-4-3.2-6.2-7.2-6.2 0 4 3.2 6.2 7.2 6.2z', 'M12 10.2c0-3.2 2.6-5.4 6.2-5.4 0 3.6-2.6 5.4-6.2 5.4z'],
  chat: ['M4 5h16v11H9.5L5 19.5V16H4z'],
  gamepad: ['M7 8h10a4 4 0 0 1 4 4.5l-.6 3.3a2.6 2.6 0 0 1-4.6 1.1L14.2 15H9.8l-1.6 1.9a2.6 2.6 0 0 1-4.6-1.1L3 12.5A4 4 0 0 1 7 8z', 'M7.5 10.8v3M6 12.3h3', 'C 15.5 11.3 1', 'C 17.5 13.3 1'],
  finder: ['c 10.5 10.5 6.5', 'M15.5 15.5l5 5', 'M8 10.5h5M10.5 8v5'],
  grip: ['C 9 7 1.2', 'C 15 7 1.2', 'C 9 12 1.2', 'C 15 12 1.2', 'C 9 17 1.2', 'C 15 17 1.2'],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

function shape(s: string, i: number) {
  if (s[0] === 'c' || s[0] === 'C') {
    const [cx, cy, r] = s.slice(2).split(' ').map(Number);
    return <circle key={i} cx={cx} cy={cy} r={r} fill={s[0] === 'C' ? 'currentColor' : 'none'} stroke={s[0] === 'C' ? 'none' : undefined} />;
  }
  return <path key={i} d={s} />;
}

/** An icon from the set. Decorative unless given a `label`, which becomes its accessible name. */
export function Icon({ name, size = 20, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  return (
    <svg className={'ico' + (className ? ' ' + className : '')} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label} focusable="false">
      {ICONS[name].map(shape)}
    </svg>
  );
}
