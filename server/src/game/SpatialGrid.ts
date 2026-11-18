// Uniform grid for interest management. O(1) move, rect query touches only overlapping cells.
export interface GridItem {
  x: number;
  y: number;
  cell: number;
}

export class SpatialGrid<E extends GridItem> {
  private cells = new Map<number, E[]>();
  constructor(readonly cellSize = 256) {}

  private key(x: number, y: number) {
    return Math.floor(x / this.cellSize) + Math.floor(y / this.cellSize) * 4096;
  }
  insert(e: E) {
    e.cell = this.key(e.x, e.y);
    const c = this.cells.get(e.cell);
    if (c) c.push(e);
    else this.cells.set(e.cell, [e]);
  }
  remove(e: E) {
    const c = this.cells.get(e.cell);
    if (!c) return;
    const i = c.indexOf(e);
    if (i >= 0) {
      c[i] = c[c.length - 1];
      c.pop();
    }
    if (!c.length) this.cells.delete(e.cell);
  }
  /** Call after e.x / e.y changed. */
  update(e: E) {
    const k = this.key(e.x, e.y);
    if (k === e.cell) return;
    this.remove(e);
    e.cell = k;
    const c = this.cells.get(k);
    if (c) c.push(e);
    else this.cells.set(k, [e]);
  }
  /** Appends every item inside the rect to `out` (caller owns and reuses the array). */
  queryRect(x0: number, y0: number, x1: number, y1: number, out: E[]) {
    const cs = this.cellSize;
    const cx0 = Math.floor(x0 / cs), cx1 = Math.floor(x1 / cs);
    const cy0 = Math.floor(y0 / cs), cy1 = Math.floor(y1 / cs);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this.cells.get(cx + cy * 4096);
        if (!c) continue;
        for (let i = 0; i < c.length; i++) {
          const e = c[i];
          if (e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1) out.push(e);
        }
      }
    }
  }
}
