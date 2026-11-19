// Style B (HD-2D) stage: the world drawn by WebGL under the 2D interface layer.
//
// The camera is an oblique orthographic projection that keeps the game's world-to-screen mapping
// exactly: a point at map position (x, y) and height h appears at screen (x, y - h) * zoom, as the
// 2D renderer always drew it. Name plates, clicks, effects and everything else measured in screen
// space therefore stay where they were, while the world gains what a 2D canvas cannot do:
//   - sprites stand up as billboards and cast real shadows from the sun onto the ground,
//   - the ground is lit (warm sun, cool sky, darker at night),
//   - bloom makes bright things glow, a tilt-shift blur keeps the hero sharp and softens the top and
//     bottom of the screen, and a colour grade gives each time of day its tone.
// Three.js world axes: X = map x, Y = height, Z = map y.
//
// The game hands the stage, every frame: the terrain chunks in view, the sprites (any sub-rectangle
// of a sprite sheet, at a foot position), a canvas of ground effects (drawn under the sprites) and a
// canvas of air effects (drawn over them, with bloom). The stage owns its own <canvas>, placed just
// under the game's 2D canvas.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Whether this browser should run the stage: WebGL 2 on a real graphics chip. Software renderers
 * (SwiftShader, llvmpipe) are too slow for the post effects, so those keep the 2D renderer unless
 * forced (localStorage aetherion.force3d = 1, used by the visual checks).
 */
export function stageSupported(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    let forced = false;
    try { forced = localStorage.getItem('aetherion.force3d') === '1'; } catch { /* no storage */ }
    if (forced) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !/swiftshader|llvmpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

const texOf = new WeakMap<HTMLCanvasElement, THREE.CanvasTexture>();
function sheetTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  let t = texOf.get(c);
  if (!t) {
    t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    texOf.set(c, t);
  }
  return t;
}

interface Bill {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  uv: THREE.BufferAttribute;
  depth: THREE.MeshDepthMaterial;
  src: HTMLCanvasElement | null;
}

/** Composites the air-effects canvas over the rendered world, before bloom. */
const OverlayShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, tOver: { value: null as THREE.Texture | null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tOver; varying vec2 vUv;
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      vec4 o = texture2D(tOver, vUv);
      // the overlay canvas is sRGB with straight alpha; the scene is linear
      vec3 oc = pow(o.rgb, vec3(2.2));
      gl_FragColor = vec4(mix(base.rgb, oc, o.a), 1.0);
    }`,
};
/** Tilt-shift focus band, saturation and the time-of-day grade, plus a soft vignette. */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    focusY: { value: 0.5 }, band: { value: 0.28 }, blur: { value: 1.6 }, res: { value: new THREE.Vector2(1280, 720) },
    tint: { value: new THREE.Vector3(1, 1, 1) }, sat: { value: 1.12 }, tilt: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float focusY, band, blur, sat, tilt; uniform vec2 res; uniform vec3 tint; varying vec2 vUv;
    void main(){
      float d = max(0.0, abs(vUv.y - focusY) - band) / (1.0 - band);
      float r = d * blur * tilt;
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (r > 0.05) {
        vec3 acc = c; float n = 1.0;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.785398;
          vec2 o = vec2(cos(a), sin(a)) * r / res * 1.6;
          acc += texture2D(tDiffuse, vUv + o).rgb + texture2D(tDiffuse, vUv + o * 2.0).rgb;
          n += 2.0;
        }
        c = acc / n;
      }
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, sat) * tint;
      vec2 q = vUv - 0.5;
      c *= 1.0 - dot(q, q) * 0.55;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Stage3D {
  readonly canvas: HTMLCanvasElement;
  /** Ground effects, in screen pixels (drawn by the game with its usual world transform). */
  readonly groundCanvas = document.createElement('canvas');
  readonly groundCtx: CanvasRenderingContext2D;
  /** Air effects, weather and the night, in screen pixels: composited over the world before bloom. */
  readonly airCanvas = document.createElement('canvas');
  readonly airCtx: CanvasRenderingContext2D;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private overlay: ShaderPass;
  private finish: ShaderPass;
  private sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
  private sky = new THREE.HemisphereLight(0xcfe3ff, 0x6b5a44, 1.25);
  private chunks = new Map<string, { mesh: THREE.Mesh; src: HTMLCanvasElement; seen: number }>();
  private chunkGeo: THREE.PlaneGeometry;
  private bills: Bill[] = [];
  private used = 0;
  private frame = 0;
  private groundTex: THREE.CanvasTexture;
  private groundPlane: THREE.Mesh;
  private airTex: THREE.CanvasTexture;
  private base: THREE.Mesh;
  private statics: THREE.Mesh[] = [];
  private lamps: THREE.PointLight[] = [];
  private W = 0;
  private H = 0;
  groundDirty = false;
  airDirty = false;

  constructor(host: HTMLElement, before: HTMLElement, chunkPx: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world3d';
    host.insertBefore(this.canvas, before);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.groundCtx = this.groundCanvas.getContext('2d')!;
    this.airCtx = this.airCanvas.getContext('2d')!;
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target, this.sky);
    // a fixed pool of lights for the night (a changing light count would recompile every material)
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 300, 2);
      this.lamps.push(l);
      this.scene.add(l);
    }

    // anything outside the loaded chunks shows the dark backdrop
    this.scene.background = new THREE.Color(0x10131c);
    this.chunkGeo = new THREE.PlaneGeometry(chunkPx, chunkPx);
    this.chunkGeo.rotateX(-Math.PI / 2);
    this.chunkGeo.translate(chunkPx / 2, 0, chunkPx / 2);
    // the colour under chunks that are still being painted
    this.base = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x3a4a2e, side: THREE.DoubleSide }));
    this.base.receiveShadow = true;
    this.base.frustumCulled = false;
    this.base.renderOrder = -2;
    (this.base.material as THREE.Material).depthWrite = false;
    this.scene.add(this.base);

    // ground effects: a transparent sheet just above the terrain, covering the view
    this.groundTex = new THREE.CanvasTexture(this.groundCanvas);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.magFilter = this.groundTex.minFilter = THREE.LinearFilter;
    this.groundTex.generateMipmaps = false;
    this.groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.groundTex, transparent: true, depthWrite: false, side: THREE.DoubleSide })); // hidden behind sprites by depth
    this.groundPlane.renderOrder = 0;
    this.groundPlane.frustumCulled = false;
    this.scene.add(this.groundPlane);

    this.airTex = new THREE.CanvasTexture(this.airCanvas);
    this.airTex.colorSpace = THREE.NoColorSpace; // converted by hand in the overlay shader
    this.airTex.magFilter = this.airTex.minFilter = THREE.LinearFilter;
    this.airTex.generateMipmaps = false;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.overlay = new ShaderPass(OverlayShader);
    this.overlay.uniforms.tOver.value = this.airTex;
    this.composer.addPass(this.overlay);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(640, 360), 0.4, 0.5, 0.85);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());
    (window as any).__stage = this; // visual checks
  }

  private resize(W: number, H: number) {
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    this.renderer.setSize(W, H, false);
    this.composer.setSize(W, H);
    this.bloom.resolution.set(W / 2, H / 2);
    this.groundCanvas.width = this.airCanvas.width = W;
    this.groundCanvas.height = this.airCanvas.height = H;
    this.groundTex.dispose();
    this.airTex.dispose();
    (this.finish.uniforms.res.value as THREE.Vector2).set(W, H);
  }

  /** Starts a frame: clears the effect canvases and forgets last frame's sprites. */
  begin(W: number, H: number) {
    this.resize(W, H);
    this.groundCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.groundCtx.clearRect(0, 0, W, H);
    this.airCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.airCtx.clearRect(0, 0, W, H);
    this.used = 0;
    this.frame++;
  }

  /** A terrain chunk in view, by its grid position. */
  chunk(cx: number, cy: number, px: number, ground: HTMLCanvasElement) {
    const key = cx + ',' + cy;
    let c = this.chunks.get(key);
    if (c && c.src !== ground) {
      this.scene.remove(c.mesh);
      (c.mesh.material as THREE.MeshLambertMaterial).dispose();
      this.chunks.delete(key);
      c = undefined;
    }
    if (!c) {
      const mat = new THREE.MeshLambertMaterial({ map: sheetTexture(ground), depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.chunkGeo, mat);
      mesh.position.set(cx * px, 0, cy * px);
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = -1;
      this.scene.add(mesh);
      c = { mesh, src: ground, seen: 0 };
      this.chunks.set(key, c);
    }
    c.seen = this.frame;
  }

  /**
   * A sprite: the source rectangle (sx, sy, sw, sh) of `sheet`, drawn where the 2D renderer would
   * have put it (dx, dy, dw, dh in map pixels) for a figure standing at map row `footY`.
   * `order` breaks ties between sprites on the same row (later is in front).
   */
  sprite(sheet: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, footY: number, order: number, alpha = 1, flip = false, shadow = true, sway = 0) {
    let b = this.bills[this.used];
    if (!b) {
      // one shared texture per sheet; each sprite picks its frame through its own uv coordinates
      const mat = new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide });
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0.5, 0.5, 0);
      const mesh = new THREE.Mesh(geo, mat);
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.5, side: THREE.DoubleSide });
      mesh.customDepthMaterial = depth;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      b = { mesh, uv: geo.getAttribute('uv') as THREE.BufferAttribute, depth, src: null };
      this.bills.push(b);
    }
    this.used++;
    const m = b.mesh;
    m.visible = true;
    if (b.src !== sheet) {
      const tex = sheetTexture(sheet);
      const first = !m.material.map;
      m.material.map = tex;
      b.depth.map = tex;
      if (first) { m.material.needsUpdate = true; b.depth.needsUpdate = true; }
      b.src = sheet;
    }
    // the frame's uv rectangle (v grows upward in GL, rows downward in the sheet); PlaneGeometry
    // vertex order: top-left, top-right, bottom-left, bottom-right
    const W = sheet.width, H = sheet.height;
    let u0 = sx / W, u1 = (sx + sw) / W;
    const vt = 1 - sy / H, vb = 1 - (sy + sh) / H;
    if (flip) [u0, u1] = [u1, u0];
    const a = b.uv;
    a.setXY(0, u0, vt); a.setXY(1, u1, vt); a.setXY(2, u0, vb); a.setXY(3, u1, vb);
    a.needsUpdate = true;
    // standing on row footY: screen row y maps to height footY - y
    m.position.set(dx, footY - (dy + dh), footY + order * 0.002);
    m.scale.set(dw, dh, 1);
    const mat = m.material;
    const transparent = alpha < 1;
    if (mat.transparent !== transparent) {
      mat.transparent = transparent;
      mat.alphaTest = transparent ? 0.02 : 0.5;
      mat.needsUpdate = true;
    }
    mat.opacity = alpha;
    m.castShadow = shadow && alpha > 0.6;
    m.updateMatrix();
    // wind: a shear that moves the top sideways while the foot (local y = 0) stays planted
    if (sway) m.matrix.elements[4] = sway * dh;
  }

  /**
   * Draws the frame. (camX, camY) is the top-left of the view in map pixels, z the zoom.
   * `day` runs from 0 (deep night) to 1 (noon); `focusY` is the hero's screen row (0..1 from the top).
   */
  render(camX: number, camY: number, z: number, focusY: number, day: number, indoor: boolean, tiltShift: boolean) {
    const W = this.W, H = this.H, vw = W / z, vh = H / z;
    // sprites not used this frame and chunks out of view are hidden (chunks leave after a while)
    for (let i = this.used; i < this.bills.length; i++) this.bills[i].mesh.visible = false;
    for (const [k, c] of this.chunks) {
      c.mesh.visible = c.seen === this.frame;
      if (this.frame - c.seen > 600) {
        this.scene.remove(c.mesh);
        (c.mesh.material as THREE.Material).dispose();
        this.chunks.delete(k);
      }
    }
    // oblique projection: (X, Y, Z) -> screen (X, Z - Y); nearer the bottom of the screen is in front
    const depth = vh + 4000;
    const P = this.camera.projectionMatrix;
    P.set(
      2 / vw, 0, 0, -2 * camX / vw - 1,
      0, 2 / vh, -2 / vh, 2 * camY / vh + 1,
      0, 0, -2 / depth, 2 * (camY + vh + 2000) / depth - 1,
      0, 0, 0, 1,
    );
    this.camera.projectionMatrixInverse.copy(P).invert();
    this.camera.matrixWorld.identity();
    this.camera.matrixWorldInverse.identity();

    // ground sheets follow the view
    const pad = 64;
    this.base.position.set(camX + vw / 2, -0.5, camY + vh / 2);
    this.base.scale.set(vw + pad * 4, 1, vh + pad * 4);
    this.groundPlane.position.set(camX + vw / 2, 0.3, camY + vh / 2);
    this.groundPlane.scale.set(vw, 1, vh);
    if (this.groundDirty) this.groundTex.needsUpdate = true;
    this.airTex.needsUpdate = this.airDirty;

    // the sun: high in the back-left by day, so shadows fall forward and to the right; low and blue at night
    const d = Math.max(0, Math.min(1, day));
    const cx = camX + vw / 2, cz = camY + vh / 2;
    this.sun.position.set(cx - 240, 700, cz - 220);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.target.updateMatrixWorld();
    const sc = this.sun.shadow.camera;
    const half = Math.max(vw, vh) * 0.75 + 120;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 10; sc.far = 2000;
    sc.updateProjectionMatrix();
    this.sun.intensity = indoor ? 0.8 : 0.12 + 1.58 * d;
    this.sun.color.setRGB(1, 0.9 + 0.06 * d, 0.78 + 0.16 * d);
    // lit ground comes out near its painted colour, shadowed ground at about 60% (the night overlay darkens further)
    this.sky.intensity = indoor ? 2.6 : 0.75 + 1.65 * d;
    this.sky.color.setRGB(0.42 + 0.4 * d, 0.52 + 0.36 * d, 0.95);
    // sprites are unlit pixel art: the time of day tints them to sit in the same light as the ground
    const tint = indoor ? 0.95 : 0.55 + 0.45 * d;
    for (let i = 0; i < this.used; i++) this.bills[i].mesh.material.color.setRGB(tint, tint * (0.96 + 0.04 * d), tint * (0.94 + 0.08 * (1 - d) * 0.5));

    const u = this.finish.uniforms;
    u.focusY.value = 1 - focusY;
    u.tilt.value = tiltShift ? 1 : 0;
    (u.tint.value as THREE.Vector3).set(1.02 + 0.03 * d, 1.0, 0.96 + 0.08 * (1 - d));
    this.bloom.threshold = 0.8 - 0.1 * (1 - d);
    this.composer.render();
    this.groundDirty = false;
    this.airDirty = false;
  }

  /** Meshes that belong to the zone and stay put (buildings). Replaces the previous zone's. */
  setStatic(meshes: THREE.Mesh[]) {
    for (const m of this.statics) {
      this.scene.remove(m);
      m.geometry.dispose();
      const mat = m.material as THREE.MeshLambertMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    this.statics = meshes;
    for (const m of meshes) this.scene.add(m);
  }

  /** Night lights for this frame: up to six, nearest first (map pixels; h is the height). */
  setLights(list: { x: number; y: number; h: number; color: number; power: number; range: number }[]) {
    for (let i = 0; i < this.lamps.length; i++) {
      const l = this.lamps[i], s = list[i];
      if (!s) { l.intensity = 0; continue; }
      l.position.set(s.x, s.h, s.y);
      l.color.setHex(s.color);
      // flames are never quite steady: two slow waves and a little flutter, different for every lamp
      const t = performance.now() / 1000, k = s.x * 0.37 + s.y * 0.13;
      l.intensity = s.power * (0.86 + 0.08 * Math.sin(t * 2.3 + k) + 0.05 * Math.sin(t * 7.1 + k * 2) + 0.03 * Math.sin(t * 17 + k * 3));
      l.distance = s.range;
    }
  }

  /** Clears the chunks (a zone change: the old map's terrain must not linger). */
  reset() {
    for (const c of this.chunks.values()) {
      this.scene.remove(c.mesh);
      (c.mesh.material as THREE.Material).dispose();
    }
    this.chunks.clear();
  }

  destroy() {
    this.reset();
    this.setStatic([]);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
