// Imported art. If the build shipped /assets/manifest.json (see scripts/import-assets.ts), the
// sheets it lists replace the built-in ones. Every sheet was validated at build time; the checks
// here only guard against a manifest and a file drifting apart.
import { mk } from './art';
import { MONSTER_TYPES, M_COLS, M_FRAME, setMonsterSheet } from './monsters';
import { PROP_KINDS, setPropSprite } from './props';
import { setIcon } from './skillicons';
import { setItemIcon } from './icons';

export const imported: string[] = [];
const load = (src: string) => new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error(`cannot load ${src}`)); i.src = src; });
const toCanvas = (img: HTMLImageElement) => { const c = mk(img.width, img.height); c.getContext('2d')!.drawImage(img, 0, 0); return c; };

export async function loadImportedAssets(base = '/assets'): Promise<string[]> {
  let manifest: { version: number; sheets: any[] };
  try {
    const r = await fetch(`${base}/manifest.json`, { cache: 'no-cache' });
    if (!r.ok) return imported;
    manifest = await r.json();
  } catch {
    return imported; // no imported art: built-in sprites are used
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.sheets)) return imported;
  await Promise.all(manifest.sheets.map(async (e) => {
    try {
      if (e.type === 'monster' && MONSTER_TYPES.includes(e.id)) {
        const img = await load(`${base}/${e.file}`), sc = e.scale ?? 1, f = Math.round(M_FRAME * sc);
        if (img.width !== M_COLS * f || img.height !== 2 * f) throw new Error(`${e.file}: size does not match the manifest`);
        setMonsterSheet(e.id, toCanvas(img), sc);
        imported.push(`monster/${e.id}`);
      } else if (e.type === 'prop' && PROP_KINDS.includes(e.id)) {
        const img = await load(`${base}/${e.file}`);
        if (img.width !== 32 || img.height !== 32) throw new Error(`${e.file}: props are 32x32`);
        setPropSprite(e.id, toCanvas(img));
        imported.push(`prop/${e.id}`);
      } else if (e.type === 'icon') {
        // one manifest entry is all an icon needs: no code names it
        const img = await load(`${base}/${e.file}`);
        if (img.width !== img.height) throw new Error(`${e.file}: icons are square`);
        if (e.kind === 'item') setItemIcon(e.id, toCanvas(img).toDataURL());
        else setIcon(`${e.kind}/${e.id}`, toCanvas(img));
        imported.push(`icon/${e.kind}/${e.id}`);
      }
    } catch (err) {
      console.warn('imported asset skipped:', (err as Error).message);
    }
  }));
  return imported;
}
