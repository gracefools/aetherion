// Style B: buildings as 3D blocks. On the flat map a building is a run of Roof tiles (its top, seen
// from above) over a run of Wall tiles (its front face). In the stage's oblique view a block of height
// H shows its top shifted up by H, so each column of a building becomes a box H = (wall rows) tiles
// high whose top covers exactly the roof tiles and whose front covers exactly the wall tiles: the
// picture is the one players know, and now it casts a shadow and takes the light.
import * as THREE from 'three';
import { TILE } from '../../../shared/src/protocol';
import { T, tileAt, type ZoneMap } from '../../../shared/src/world';
import { paintBuilding } from './hdart';

export interface Buildings {
  meshes: THREE.Mesh[];
  /** Where each building's door light goes at night (map pixels, in front of the wall). */
  doors: { x: number; y: number }[];
}

const isB = (t: number) => t === T.Wall || t === T.Roof;

export function buildBuildings(map: ZoneMap): Buildings {
  const W = map.w, H = map.h, seen = new Uint8Array(W * H), meshes: THREE.Mesh[] = [], doors: Buildings['doors'] = [];
  for (let y0 = 0; y0 < H; y0++) for (let x0 = 0; x0 < W; x0++) {
    if (seen[y0 * W + x0] || !isB(tileAt(map, x0, y0))) continue;
    // flood fill one building (4-connected Roof/Wall tiles)
    const stack = [x0, y0], cells: number[] = [];
    seen[y0 * W + x0] = 1;
    let tx0 = x0, ty0 = y0, tx1 = x0, ty1 = y0;
    while (stack.length) {
      const y = stack.pop()!, x = stack.pop()!;
      cells.push(x, y);
      tx0 = Math.min(tx0, x); tx1 = Math.max(tx1, x); ty0 = Math.min(ty0, y); ty1 = Math.max(ty1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx] || !isB(tileAt(map, nx, ny))) continue;
        seen[ny * W + nx] = 1;
        stack.push(nx, ny);
      }
    }
    const canvas = paintBuilding(map, tx0, ty0, tx1, ty1), CW = canvas.width, CH = canvas.height;
    const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
    const quad = (p: number[][], u: number[][], n: number[]) => {
      const b = pos.length / 3;
      for (let i = 0; i < 4; i++) { pos.push(...p[i]); uv.push(u[i][0] / CW, 1 - u[i][1] / CH); nor.push(...n); }
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    };
    let front = 0;
    for (let x = tx0; x <= tx1; x++) {
      // contiguous runs of the building in this column: roof rows on top, wall rows below
      let y = ty0;
      while (y <= ty1) {
        if (!isB(tileAt(map, x, y))) { y++; continue; }
        const top = y;
        while (y <= ty1 && isB(tileAt(map, x, y))) y++;
        const end = y; // one past the last row
        let walls = 0;
        while (walls < end - top && tileAt(map, x, end - 1 - walls) === T.Wall) walls++;
        const h = walls * TILE, X0 = x * TILE, X1 = X0 + TILE, lu0 = (x - tx0) * TILE, lu1 = lu0 + TILE;
        const zFront = end * TILE, zRoof = (end - walls) * TILE; // map rows where the roof ends / the wall ends
        if (walls > 0) // the front face: wall rows, standing up from the ground
          quad([[X0, h, zFront], [X1, h, zFront], [X0, 0, zFront], [X1, 0, zFront]],
            [[lu0, zRoof - ty0 * TILE], [lu1, zRoof - ty0 * TILE], [lu0, zFront - ty0 * TILE], [lu1, zFront - ty0 * TILE]], [0, 0, 1]);
        if (zRoof > top * TILE) // the top: roof rows, lifted by the wall height
          quad([[X0, h, top * TILE + h], [X1, h, top * TILE + h], [X0, h, zFront], [X1, h, zFront]],
            [[lu0, (top - ty0) * TILE], [lu1, (top - ty0) * TILE], [lu0, zRoof - ty0 * TILE], [lu1, zRoof - ty0 * TILE]], [0, 1, 0]);
        front = Math.max(front, zFront);
      }
    }
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.5 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    meshes.push(mesh);
    if (cells.length >= 8) doors.push({ x: ((tx0 + tx1 + 1) / 2) * TILE, y: front + 14 });
  }
  return { meshes, doors };
}
