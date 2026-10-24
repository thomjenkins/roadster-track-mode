(() => {
'use strict';

const THREE = window.THREE;

// ============================================================
// Specs — every announced next-gen Roadster capability in one car
// ============================================================
const G = 9.81;
const MPH = 2.23694;
const MPH60 = 60 / MPH;
const HALF_W = 7;
const STEP = 1 / 120;
const SECTORS = 6;
const RACE_LAPS = 3;
const GAS_RECHARGE = 6; // L/s — onboard compressor top-up (game liberty)
const LIFT_A = 2.15 * G;
const LIFT_POP = 7;
const DIVE_A = 2 * G;

// motorA: tire-driven launch accel (m/s^2), thrustA: extra cold-gas accel.
// 17.6 + 28.4 → 0-60 ≈ 0.58 s.
const ROADSTER = {
  id: 'roadster', name: 'Roadster',
  zeroSixty: '< 0.59 s', topSpeed: '230+ mph',
  features: ['Suction fans hold it upside down', 'Active aero + Track Mode', 'Cold-gas thrusters · 600 L COPV', 'Lift thrusters — it can fly'],
  motorA: 17.6, vtopMotor: 96, thrustA: 28.4, vtopThrust: 107,
  tank: 600, boostDrain: 42, liftDrain: 65,
  color: 0x8a0208, css: '#c8102e',
};

const RIVAL_DEFS = [
  { name: 'Volt GT', color: 0x2f7bf5, css: '#2f7bf5' },
  { name: 'Apex E-R', color: 0xf5a623, css: '#f5a623' },
  { name: 'Zenith X', color: 0x27c46b, css: '#27c46b' },
];

// ============================================================
// Utils
// ============================================================
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  let xf = x - xi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf); zf = zf * zf * (3 - 2 * zf);
  return lerp(lerp(hash2(xi, zi), hash2(xi + 1, zi), xf), lerp(hash2(xi, zi + 1), hash2(xi + 1, zi + 1), xf), zf);
}
function fbm(x, z, oct = 4) {
  let v = 0, a = 0.5;
  for (let i = 0; i < oct; i++) { v += a * vnoise(x, z); x *= 2.03; z *= 2.03; a *= 0.5; }
  return v;
}
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
function rot(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const kv = cross(k, v), d = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
}
const UPW = [0, 1, 0];

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fmtTime(t) {
  if (t == null || !isFinite(t)) return '-:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m + ':' + s.toFixed(3).padStart(6, '0');
}
const fmtSec = (t) => (t == null ? '—' : t.toFixed(2) + ' s');

const store = {
  get(k) { try { const v = localStorage.getItem('roadster.' + k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('roadster.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

// ============================================================
// Track — built from pieces by a turtle walking 1 m per frame.
// Each frame stores position, tangent T, surface-up U, right R = T×U.
// ============================================================
const PIECES = [
  { t: 'straight', len: 220 },
  { t: 'turn', deg: 90, r: 90, bank: 10 },
  { t: 'straight', len: 60 },
  { t: 'climb', rise: 14, len: 160, sign: 'CANYON JUMP · 80+ MPH', signAt: 90 },
  { t: 'straight', len: 50 },
  { t: 'kicker', deg: 10, len: 18 },
  { t: 'gap', v: 36, drop: 3, decor: 'canyon' },
  { t: 'land', len: 50 },
  { t: 'level', len: 80 },
  { t: 'turn', deg: -120, r: 60, bank: 14 },
  { t: 'straight', len: 100, sign: 'LOOP', signAt: 20 },
  { t: 'loop', r: 22, offset: 18 },
  { t: 'straight', len: 120 },
  { t: 'turn', deg: -60, r: 80, bank: 8 },
  { t: 'straight', len: 69, sign: 'WALL RIDE', signAt: 5 },
  { t: 'turn', deg: -90, r: 55, bank: 62 },
  { t: 'straight', len: 60, sign: 'SLALOM', signAt: 10 },
  { t: 'straight', len: 200, obstacles: [[30, -7, 1], [70, -1, 7], [110, -7, 1], [150, -1, 7], [185, -3.5, 3.5]] },
  { t: 'straight', len: 60, sign: 'BOOSTER HOP · 70+ MPH', signAt: 0 },
  { t: 'climb', rise: 4, len: 40 },
  { t: 'kicker', deg: 8, len: 12 },
  { t: 'gap', v: 32, drop: 1.5, decor: 'booster' },
  { t: 'land', len: 30 },
  { t: 'level', len: 30 },
  { t: 'straightToX', x: -120 },
  { t: 'turnToZ', deg: 180, bank: 10 },
];

function buildTrack() {
  const P = [], TT = [], UU = [], bank = [], surf = [], tag = [];
  let pos = [0, 0, 0], T = [1, 0, 0], U0 = [0, 1, 0];
  const feat = { signs: [], obstacles: [], jumps: [], decor: [] };
  const push = (b, s, tg) => { P.push(pos.slice()); TT.push(T.slice()); UU.push(U0.slice()); bank.push(b); surf.push(s ? 1 : 0); tag.push(tg || ''); };
  const step = () => { pos = madd(pos, T, 1); };
  const horiz = () => norm([T[0], 0, T[2]]);
  const setPitch = (H, th) => { T = add(scl(H, Math.cos(th)), scl(UPW, Math.sin(th))); U0 = add(scl(H, -Math.sin(th)), scl(UPW, Math.cos(th))); };
  const ease = (i, n, ramp) => {
    const a = Math.min(1, i / ramp, (n - i) / ramp);
    return a * a * (3 - 2 * a);
  };

  for (const pc of PIECES) {
    const start = P.length;
    if (pc.sign) feat.signs.push({ s: start + (pc.signAt || 0), text: pc.sign });
    if (pc.t === 'straight' || pc.t === 'straightToX') {
      const len = pc.t === 'straight' ? pc.len : Math.round(Math.abs(pos[0] - pc.x));
      for (let i = 0; i < len; i++) { push(0, 1); step(); }
      if (pc.obstacles) for (const [o, a, b] of pc.obstacles) feat.obstacles.push({ s0: start + o, s1: start + o + 2, lat0: a, lat1: b, h: 1.4 });
    } else if (pc.t === 'turn' || pc.t === 'turnToZ') {
      const sign = Math.sign(pc.deg);
      const ang = Math.abs(pc.deg) * Math.PI / 180;
      const r = pc.t === 'turn' ? pc.r : Math.abs(pos[2]) / 2;
      const n = Math.round(r * ang);
      const d = ang / n;
      const ramp = Math.min(30, n / 3);
      for (let i = 0; i < n; i++) {
        push(sign * pc.bank * ease(i, n, ramp), 1);
        step();
        T = rot(T, U0, -sign * d);
      }
    } else if (pc.t === 'climb' || pc.t === 'level') {
      const rise = pc.t === 'climb' ? pc.rise : -pos[1];
      const H = horiz();
      const n = pc.len;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        setPitch(H, Math.atan(rise * Math.PI / (2 * n) * Math.sin(Math.PI * t)));
        push(0, 1); step();
      }
      T = H; U0 = UPW.slice();
    } else if (pc.t === 'kicker') {
      feat.kickStart = P.length;
      const H = horiz();
      for (let i = 0; i < pc.len; i++) {
        setPitch(H, (pc.deg * Math.PI / 180) * (i + 0.5) / pc.len);
        push(0, 1, 'kick'); step();
      }
    } else if (pc.t === 'gap') {
      const lipY = pos[1];
      let p = pos.slice(), vel = scl(T, pc.v), arc = 0;
      const gapStart = P.length;
      const dt = 0.002;
      while (p[1] > lipY - pc.drop || vel[1] > 0) {
        p = madd(p, vel, dt); vel[1] -= G * dt;
        arc += vlen(vel) * dt;
        if (arc >= 1) {
          arc -= 1;
          T = norm(vel);
          const R0 = norm(cross(T, UPW));
          U0 = cross(R0, T);
          pos = p.slice();
          push(0, 0, 'gap');
        }
      }
      pos = p.slice(); T = norm(vel);
      const R0 = norm(cross(T, UPW)); U0 = cross(R0, T);
      feat.jumps.push({ kick: feat.kickStart ?? gapStart, s0: gapStart, s1: P.length, v: pc.v });
      feat.decor.push({ type: pc.decor, s: Math.round((gapStart + P.length) / 2) });
    } else if (pc.t === 'land') {
      const H = horiz();
      const th0 = Math.asin(clamp(T[1], -1, 1));
      for (let i = 0; i < pc.len; i++) {
        setPitch(H, th0 * (1 - (i + 0.5) / pc.len));
        push(0, 1, 'land'); step();
      }
      T = H; U0 = UPW.slice();
    } else if (pc.t === 'loop') {
      const T0 = T.slice(), U00 = U0.slice();
      const Rr = norm(cross(T, U0));
      const n = Math.round(2 * Math.PI * pc.r);
      const d = (2 * Math.PI) / n;
      for (let i = 0; i < n; i++) {
        push(0, 1, 'loop');
        pos = madd(madd(pos, T, 1), Rr, pc.offset / n);
        T = rot(T, Rr, d); U0 = rot(U0, Rr, d);
      }
      T = T0; U0 = U00;
    }
  }

  // Hermite connector back to the start line.
  {
    const p0 = pos, p1 = [0, 0, 0];
    const dist = vlen(sub(p1, p0));
    const m0 = scl(T, dist), m1 = [dist, 0, 0];
    const raw = [];
    for (let k = 0; k <= 400; k++) {
      const t = k / 400, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      raw.push([0, 1, 2].map((c) => h00 * p0[c] + h10 * m0[c] + h01 * p1[c] + h11 * m1[c]));
    }
    const cum = [0];
    for (let k = 1; k < raw.length; k++) cum.push(cum[k - 1] + vlen(sub(raw[k], raw[k - 1])));
    const total = cum[cum.length - 1];
    const n = Math.max(1, Math.round(total));
    let j = 0;
    for (let i = 0; i < n; i++) {
      const target = (i / n) * total;
      while (cum[j + 1] < target) j++;
      const t = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
      pos = add(raw[j], scl(sub(raw[j + 1], raw[j]), t));
      T = norm(sub(raw[j + 1], raw[j]));
      const R0 = norm(cross(T, UPW)); U0 = cross(R0, T);
      push(0, 1);
    }
  }

  const N = P.length;
  // smooth banking
  let b = bank.slice();
  for (let pass = 0; pass < 2; pass++) {
    const b2 = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let o = -12; o <= 12; o++) s += b[(i + o + N) % N];
      b2[i] = s / 25;
    }
    b = b2;
  }
  // banked ground-level corners pivot on their inside edge so it never dips below the grass
  const lift = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    if (UU[i][1] > 0.99) lift[i] = (HALF_W + 0.4) * Math.sin(Math.abs(b[i]) * Math.PI / 180);
  }
  for (let i = 0; i < N; i++) {
    if (!lift[i] && !lift[(i + 1) % N] && !lift[(i - 1 + N) % N]) continue;
    P[i][1] += lift[i];
    TT[i] = norm(add(TT[i], [0, (lift[(i + 1) % N] - lift[(i - 1 + N) % N]) / 2, 0]));
  }
  const TP = new Float64Array(N * 3), TTn = new Float64Array(N * 3), TU = new Float64Array(N * 3), TR = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) {
    const t = norm(TT[i]);
    const R0 = norm(cross(t, UU[i]));
    const U0n = cross(R0, t);
    const be = b[i] * Math.PI / 180;
    let u = norm(add(scl(U0n, Math.cos(be)), scl(R0, Math.sin(be))));
    const r = norm(cross(t, u));
    u = cross(r, t);
    for (let c = 0; c < 3; c++) { TP[i * 3 + c] = P[i][c]; TTn[i * 3 + c] = t[c]; TU[i * 3 + c] = u[c]; TR[i * 3 + c] = r[c]; }
  }
  const kn = new Float64Array(N), kg = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, c = (i + 1) % N;
    const dT = [0, 1, 2].map((k) => (TTn[c * 3 + k] - TTn[a * 3 + k]) / 2);
    const u = [TU[i * 3], TU[i * 3 + 1], TU[i * 3 + 2]], r = [TR[i * 3], TR[i * 3 + 1], TR[i * 3 + 2]];
    kn[i] = dot(dT, u); kg[i] = dot(dT, r);
  }
  return { N, L: N, P: TP, T: TTn, U: TU, R: TR, kn, kg, lift, surf: Uint8Array.from(surf), tag, feat };
}

const track = buildTrack();
const L = track.L;
const wrapS = (s) => ((s % L) + L) % L;
const wrapD = (d) => { d = wrapS(d); return d > L / 2 ? d - L : d; };

const FR = { P: [0, 0, 0], T: [0, 0, 0], U: [0, 0, 0], R: [0, 0, 0], kn: 0, kg: 0, surf: 1, i: 0 };
function frameAt(s, out = FR) {
  s = wrapS(s);
  const i = Math.floor(s) % track.N, j = (i + 1) % track.N, t = s - Math.floor(s);
  const A = track;
  for (let c = 0; c < 3; c++) {
    out.P[c] = lerp(A.P[i * 3 + c], A.P[j * 3 + c], t);
    out.T[c] = lerp(A.T[i * 3 + c], A.T[j * 3 + c], t);
    out.U[c] = lerp(A.U[i * 3 + c], A.U[j * 3 + c], t);
    out.R[c] = lerp(A.R[i * 3 + c], A.R[j * 3 + c], t);
  }
  out.T = norm(out.T); out.U = norm(out.U); out.R = norm(out.R);
  out.kn = lerp(A.kn[i], A.kn[j], t);
  out.kg = lerp(A.kg[i], A.kg[j], t);
  out.surf = t < 0.5 ? A.surf[i] : A.surf[j];
  out.i = i;
  return out;
}
const fP = (i) => [track.P[i * 3], track.P[i * 3 + 1], track.P[i * 3 + 2]];
const fT = (i) => [track.T[i * 3], track.T[i * 3 + 1], track.T[i * 3 + 2]];
const fU = (i) => [track.U[i * 3], track.U[i * 3 + 1], track.U[i * 3 + 2]];
const fR = (i) => [track.R[i * 3], track.R[i * 3 + 1], track.R[i * 3 + 2]];

function nearestFrame(p, surfaceOnly = false) {
  const A = track;
  let best = 0, bd = Infinity;
  for (let i = 0; i < A.N; i++) {
    if (surfaceOnly && !A.surf[i]) continue;
    const dx = A.P[i * 3] - p[0], dy = A.P[i * 3 + 1] - p[1], dz = A.P[i * 3 + 2] - p[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return { i: best, d: Math.sqrt(bd) };
}

function jumpAt(s) {
  for (const j of track.feat.jumps) if (s >= j.kick - 10 && s <= j.s1 + 5) return j;
  return null;
}

// AI speed profile
const aiProfile = (() => {
  const v = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    v[i] = Math.min(92, Math.sqrt(24 / Math.max(Math.abs(track.kg[i]), 1e-5)));
    if (track.tag[i] === 'loop') v[i] = Math.min(v[i], 42);
  }
  for (const j of track.feat.jumps) for (let i = j.kick; i < j.s1; i++) v[i] = j.v;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = L - 1; i >= 0; i--) {
      const nx = v[(i + 1) % L];
      v[i] = Math.min(v[i], Math.sqrt(nx * nx + 2 * 20 * 1));
    }
  }
  return v;
})();
const profileAt = (d) => aiProfile[Math.floor(wrapS(d)) % L];

// ============================================================
// Canvas / renderer
// ============================================================
const glCanvas = document.getElementById('game');
const hudCanvas = document.getElementById('hud');
const ctx = hudCanvas.getContext('2d');
const overlay = document.getElementById('overlay');
let W = 0, H = 0, DPR = 1;

const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.5, 6000);
scene.fog = new THREE.Fog(0xcad9e6, 350, 2600);

// ---------- post: HDR scene (MSAA) -> dual-filter bloom -> tonemap, grade, vignette ----------
// Rendering into a float target skips three's own tonemapping/encoding, so the composite does both.
const post = (() => {
  const gl2 = renderer.capabilities.isWebGL2;
  const hdr = { type: THREE.HalfFloatType, depthBuffer: false };
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: gl2 ? 4 : 0 });
  const LEVELS = 6;
  const mips = Array.from({ length: LEVELS }, () => new THREE.WebGLRenderTarget(1, 1, hdr));
  const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const qScene = new THREE.Scene();
  qScene.add(quad);
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const mat = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });
  const prefilter = mat(`
    uniform sampler2D src; uniform vec2 texel; uniform float threshold; varying vec2 vUv;
    vec3 tap(vec2 o) { vec3 c = texture2D(src, vUv + o * texel).rgb; float b = max(c.r, max(c.g, c.b));
      float soft = clamp(b - threshold + 0.5, 0.0, 1.0); soft = soft * soft * 0.5;
      float w = max(soft, b - threshold) / max(b, 1e-4); return c * w / (1.0 + b * w); }
    void main() { vec3 c = tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0));
      c *= 0.25; float b = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c / max(1.0 - b, 0.04), 1.0); }`,
  { src: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1.6 } });
  const down = mat(`
    uniform sampler2D src; uniform vec2 texel; varying vec2 vUv;
    void main() { vec3 c = texture2D(src, vUv).rgb * 4.0;
      c += texture2D(src, vUv + vec2(-1.0, -1.0) * texel).rgb + texture2D(src, vUv + vec2(1.0, -1.0) * texel).rgb;
      c += texture2D(src, vUv + vec2(-1.0, 1.0) * texel).rgb + texture2D(src, vUv + vec2(1.0, 1.0) * texel).rgb;
      gl_FragColor = vec4(c * 0.125, 1.0); }`,
  { src: { value: null }, texel: { value: new THREE.Vector2() } });
  const up = mat(`
    uniform sampler2D src; uniform vec2 texel; uniform float weight; varying vec2 vUv;
    void main() { vec3 c = vec3(0.0);
      c += texture2D(src, vUv + vec2(-2.0, 0.0) * texel).rgb + texture2D(src, vUv + vec2(2.0, 0.0) * texel).rgb;
      c += texture2D(src, vUv + vec2(0.0, -2.0) * texel).rgb + texture2D(src, vUv + vec2(0.0, 2.0) * texel).rgb;
      c += (texture2D(src, vUv + vec2(-1.0, 1.0) * texel).rgb + texture2D(src, vUv + vec2(1.0, 1.0) * texel).rgb
          + texture2D(src, vUv + vec2(-1.0, -1.0) * texel).rgb + texture2D(src, vUv + vec2(1.0, -1.0) * texel).rgb) * 2.0;
      gl_FragColor = vec4(c / 12.0 * weight, 1.0); }`,
  { src: { value: null }, texel: { value: new THREE.Vector2() }, weight: { value: 1 } }, { blending: THREE.AdditiveBlending, transparent: true });
  const composite = mat(`
    uniform sampler2D scene; uniform sampler2D bloom; uniform float bloomStrength; uniform float exposure; uniform float time; uniform vec2 aspect;
    varying vec2 vUv;
    vec3 rrtOdt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 acesFit(vec3 color) {
      const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color *= exposure / 0.6; color = OUT * rrtOdt(IN * color); return clamp(color, 0.0, 1.0); }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main() {
      vec2 d = (vUv - 0.5) * aspect;
      vec3 c = texture2D(scene, vUv).rgb;
      c += texture2D(bloom, vUv).rgb * bloomStrength;
      c = toSRGB(acesFit(c));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.1);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.3);
      c *= mix(vec3(0.97, 0.985, 1.03), vec3(1.03, 1.0, 0.95), smoothstep(0.2, 0.8, l));
      c *= 1.0 - 0.32 * smoothstep(0.35, 1.05, length(d));
      c += (hash(vUv * 731.0) - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0); }`,
  { scene: { value: sceneRT.texture }, bloom: { value: mips[0].texture }, bloomStrength: { value: 0.11 }, exposure: { value: renderer.toneMappingExposure }, time: { value: 0 }, aspect: { value: new THREE.Vector2(1, 1) } });
  const pass = (material, target) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(qScene, qCam); };
  return {
    sceneRT, composite,
    setSize(w, h) {
      sceneRT.setSize(w, h);
      let mw = w, mh = h;
      for (const m of mips) { mw = Math.max(1, Math.round(mw / 2)); mh = Math.max(1, Math.round(mh / 2)); m.setSize(mw, mh); }
      composite.uniforms.aspect.value.set(w / h, 1);
    },
    render(sc, cm) {
      renderer.setRenderTarget(sceneRT);
      renderer.render(sc, cm);
      prefilter.uniforms.src.value = sceneRT.texture;
      prefilter.uniforms.texel.value.set(1 / sceneRT.width, 1 / sceneRT.height);
      pass(prefilter, mips[0]);
      for (let i = 1; i < LEVELS; i++) {
        down.uniforms.src.value = mips[i - 1].texture;
        down.uniforms.texel.value.set(1 / mips[i - 1].width, 1 / mips[i - 1].height);
        pass(down, mips[i]);
      }
      renderer.autoClear = false;
      for (let i = LEVELS - 1; i > 0; i--) {
        up.uniforms.src.value = mips[i].texture;
        up.uniforms.texel.value.set(0.5 / mips[i].width, 0.5 / mips[i].height);
        pass(up, mips[i - 1]);
      }
      renderer.autoClear = true;
      composite.uniforms.time.value = (performance.now() % 1000) / 1000;
      pass(composite, null);
    },
  };
})();

// Dynamic resolution: step the 3D render scale down when frames run long, back up (once) when there's headroom.
const perf = { scale: 1, acc: 0, n: 0, cool: 3, slow: 0, fast: 0, wentUp: false, lockUp: false };
function trackPerf(dt) {
  perf.cool -= dt;
  perf.acc += dt; perf.n++;
  if (perf.n < 90) return;
  const avg = perf.acc / perf.n;
  perf.acc = 0; perf.n = 0;
  if (perf.cool > 0 || document.hidden || dt > 0.09) return;
  if (avg > 1 / 48) {
    perf.fast = 0;
    if (++perf.slow >= 2 && perf.scale > 0.55) {
      perf.scale = Math.max(0.55, perf.scale - 0.15); perf.slow = 0; perf.cool = 2;
      if (perf.wentUp) perf.lockUp = true;
      resize();
    }
  } else if (avg < 1 / 57) {
    perf.slow = 0;
    if (++perf.fast >= 8 && perf.scale < 1 && !perf.lockUp) {
      perf.scale = Math.min(1, perf.scale + 0.15); perf.fast = 0; perf.cool = 2; perf.wentUp = true;
      resize();
    }
  } else { perf.slow = 0; perf.fast = 0; }
}

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  const gpr = Math.min(1.5, DPR) * perf.scale;
  renderer.setPixelRatio(gpr);
  renderer.setSize(W, H, false);
  post.setSize(Math.round(W * gpr), Math.round(H * gpr));
  glCanvas.style.width = W + 'px'; glCanvas.style.height = H + 'px';
  hudCanvas.width = Math.round(W * DPR); hudCanvas.height = Math.round(H * DPR);
  hudCanvas.style.width = W + 'px'; hudCanvas.style.height = H + 'px';
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- textures ----------
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// tileable value noise over a w×h pixel grid (period in lattice cells must divide the size)
function tileNoise(w, h, cell, seed) {
  const pw = Math.max(1, Math.round(w / cell)), ph = Math.max(1, Math.round(h / cell));
  const lat = new Float32Array(pw * ph);
  const r = rng(seed);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * ph, j = Math.floor(fy), ty = fy - j, sy = ty * ty * (3 - 2 * ty);
    const j0 = (j % ph) * pw, j1 = ((j + 1) % ph) * pw;
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * pw, i = Math.floor(fx), tx = fx - i, sx = tx * tx * (3 - 2 * tx);
      const i0 = i % pw, i1 = (i + 1) % pw;
      out[y * w + x] = lerp(lerp(lat[j0 + i0], lat[j0 + i1], sx), lerp(lat[j1 + i0], lat[j1 + i1], sx), sy);
    }
  }
  return out;
}
// height field -> tangent-space normal map
function normalTex(hgt, w, h, strength) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const hx = hgt[y * w + ((x + 1) % w)] - hgt[y * w + ((x - 1 + w) % w)];
    const hy = hgt[((y + 1) % h) * w + x] - hgt[((y - 1 + h) % h) * w + x];
    let nx = -hx * strength, ny = hy * strength;
    const l = Math.hypot(nx, ny, 1);
    const o = (y * w + x) * 4;
    d[o] = (nx / l * 0.5 + 0.5) * 255; d[o + 1] = (ny / l * 0.5 + 0.5) * 255; d[o + 2] = (1 / l * 0.5 + 0.5) * 255; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function dataCanvasTex(w, h, fn, srgb) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h);
  for (let k = 0; k < w * h; k++) { const v = fn(k); img.data.set([v[0], v[1], v[2], 255], k * 4); }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.encoding = THREE.sRGBEncoding;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return { tex: t, g, c };
}

// asphalt: 14 m across (u) × 10 m along (v); aggregate height drives albedo, normals and roughness
const asphalt = (() => {
  const w = 1024, h = 768, n = w * h;
  const n1 = tileNoise(w, h, 1.6, 21), n2 = tileNoise(w, h, 4, 22), n3 = tileNoise(w, h, 48, 23), n4 = tileNoise(w, h, 160, 24);
  const r = rng(25);
  const hgt = new Float32Array(n), grain = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const stone = Math.max(0, n1[k] * 0.7 + n2[k] * 0.5 - 0.62) * 3;
    hgt[k] = stone + r() * 0.12;
    grain[k] = r();
  }
  const latOf = (x) => (x / w) * 14 - 7;
  const rubber = (x) => { const l = Math.abs(latOf(x)); return Math.exp(-(((l - 2.4) / 1.1) ** 2)) * 0.6 + Math.exp(-((l / 1.6) ** 2)) * 0.25; };
  const rub = new Float32Array(w);
  for (let x = 0; x < w; x++) rub[x] = rubber(x);
  const map = dataCanvasTex(w, h, (k) => {
    const x = k % w;
    let l = 56 + hgt[k] * 9 + (grain[k] - 0.5) * 8 + (n3[k] - 0.5) * 12 + (n4[k] - 0.5) * 14;
    l *= 1 - rub[x] * (0.28 + n3[k] * 0.12);
    return [l, l * 1.02, l * 1.07];
  }, true);
  const g = map.g;
  // paint: edge lines + centre dashes, slightly worn
  const px = (lat) => ((lat + 7) / 14) * w;
  const paint = (x0, x1, y0, y1) => {
    for (let y = y0; y < y1; y += 2) {
      g.fillStyle = `rgba(232,232,226,${0.72 + r() * 0.25})`;
      g.fillRect(x0, y, x1 - x0, 2);
    }
  };
  for (const s of [-1, 1]) paint(Math.min(px(s * 5.55), px(s * 5.75)), Math.max(px(s * 5.55), px(s * 5.75)), 0, h);
  paint(px(-0.08), px(0.08), 0, h * 0.4);
  // a few faint skid marks
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const x = px((r() - 0.5) * 9), y = r() * h, len = 120 + r() * 260, bend = (r() - 0.5) * 40;
    g.strokeStyle = `rgba(10,10,12,${0.08 + r() * 0.1})`;
    for (const off of [0, 115]) {
      g.lineWidth = 14 + r() * 5;
      g.beginPath(); g.moveTo(x + off, y); g.quadraticCurveTo(x + off + bend, y + len / 2, x + off + bend * 0.3, y + len); g.stroke();
    }
  }
  map.tex.needsUpdate = true;
  const rough = dataCanvasTex(w, h, (k) => {
    const x = k % w;
    const v = (0.9 - hgt[k] * 0.12 - rub[x] * 0.16 + (n3[k] - 0.5) * 0.08) * 255;
    return [v, v, v];
  }, false);
  for (const s of [-1, 1]) { rough.g.fillStyle = 'rgb(150,150,150)'; rough.g.fillRect(Math.min(px(s * 5.55), px(s * 5.75)), 0, Math.abs(px(s * 5.75) - px(s * 5.55)), h); }
  rough.g.fillRect(px(-0.08), 0, px(0.08) - px(-0.08), h * 0.4);
  rough.tex.needsUpdate = true;
  return { map: map.tex, rough: rough.tex, normal: normalTex(hgt, w, h, 1.2) };
})();

// red/white kerb, 1 m wide (u) × 6 m (v); transverse ribs are baked into normals
const kerb = (() => {
  const w = 64, h = 512, n = w * h;
  const hgt = new Float32Array(n);
  const map = dataCanvasTex(w, h, (k) => {
    const x = k % w, y = Math.floor(k / w);
    const rib = 0.5 + 0.5 * Math.cos((y / h) * 6 * Math.PI * 2 * 4);
    hgt[k] = rib * 0.6 + (x < 4 ? -1 : 0);
    const red = Math.floor((y / h) * 4) % 2 === 0;
    const shade = 0.86 + rib * 0.14;
    const c = red ? [196, 30, 40] : [226, 226, 220];
    return [c[0] * shade, c[1] * shade, c[2] * shade];
  }, true);
  return { map: map.tex, normal: normalTex(hgt, w, h, 1.6) };
})();

// concrete barrier: height across u (0 bottom → 1 cap), 8 m along v; painted red/white top band
const concreteTex = (band) => {
  const w = 128, h = 512;
  const n1 = tileNoise(w, h, 4, 31), n2 = tileNoise(w, h, 24, 32);
  const r = rng(33);
  const m = dataCanvasTex(w, h, (k) => {
    const x = k % w, y = Math.floor(k / w), u = x / w;
    let c;
    if (band && u > 0.62 && u < 0.9) c = Math.floor(y / (h / 2)) % 2 ? [214, 214, 208] : [178, 30, 38];
    else c = [150, 148, 142];
    const grime = 1 - smoothstep(0.35, 0, u) * 0.35 - (u > 0.9 ? 0 : (1 - n2[k]) * 0.12);
    const v = grime * (0.9 + n1[k] * 0.14 + (r() - 0.5) * 0.06);
    const joint = (y % (h / 2)) < 2 ? 0.55 : 1;
    return [c[0] * v * joint, c[1] * v * joint, c[2] * v * joint];
  }, true);
  return m.tex;
};
const wallTex = concreteTex(true);
const slabTex = concreteTex(false);

// neutral detail layer — terrain vertex colours supply the hue
const grassTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#d6d6d0'; g.fillRect(0, 0, w, h);
  const r = rng(3);
  for (let i = 0; i < 9000; i++) {
    const l = Math.floor(150 + r() * 105);
    g.strokeStyle = `rgba(${l},${l},${l - 10},${0.25 + r() * 0.35})`;
    g.lineWidth = 1 + r();
    const x = r() * w, y = r() * h, a = -Math.PI / 2 + (r() - 0.5) * 0.9, len = 3 + r() * 7;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  }
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(90,80,60,${0.15 + r() * 0.2})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
});

const checkerTex = canvasTex(256, 64, (g, w, h) => {
  const cs = 16;
  for (let y = 0; y < h / cs; y++) for (let x = 0; x < w / cs; x++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
    g.fillRect(x * cs, y * cs, cs, cs);
  }
}, false);

const dotTex = canvasTex(64, 64, (g, w, h) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}, false);

function textTex(text, w = 1024, h = 256, bg = '#e31937', fg = '#fff') {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0, h - 18, w, 18);
    g.fillStyle = fg;
    g.font = `800 ${Math.round(h * 0.42)}px -apple-system, Helvetica, Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2, w - 40);
  }, false);
}

// ---------- sky, light, ground ----------
// Golden-hour Texas sky: low warm sun, haze at the horizon, drifting cumulus.
const SUN_DIR = norm([0.62, 0.3, -0.72]);
const HORIZON = [0.72, 0.56, 0.4];
const SKY_GLSL = `
  uniform vec3 sunDir; uniform vec3 horizon; uniform float cloudShift; varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
  vec3 skyColor(vec3 d) {
    float h = d.y;
    vec3 zenith = vec3(0.05, 0.16, 0.5);
    vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.32));
    if (h < 0.0) col = mix(horizon, vec3(0.42, 0.34, 0.24), clamp(-h * 5.0, 0.0, 1.0));
    float sd = max(dot(d, sunDir), 0.0);
    col += vec3(1.0, 0.62, 0.30) * pow(sd, 6.0) * 0.45;
    col += vec3(1.0, 0.80, 0.55) * pow(sd, 48.0) * 0.8;
    col += vec3(1.0, 0.92, 0.78) * smoothstep(0.99935, 0.9997, sd) * 12.0;
    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.06) * 1.3 + vec2(cloudShift, 0.0);
      float c = smoothstep(0.56, 0.8, fbm(uv)) * smoothstep(0.0, 0.18, h);
      float lit = 0.75 + 0.6 * pow(sd, 3.0);
      vec3 cc = mix(vec3(0.95, 0.86, 0.78), vec3(1.0, 0.72, 0.45), pow(sd, 2.0)) * lit;
      col = mix(col, cc, c * 0.9);
    }
    return col;
  }
`;
function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: new THREE.Vector3(...SUN_DIR) }, horizon: { value: new THREE.Vector3(...HORIZON) }, cloudShift: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: SKY_GLSL + 'void main(){ gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0); \n#include <tonemapping_fragment>\n#include <encodings_fragment>\n}',
  });
}
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), skyMaterial());
  sky.renderOrder = -1;
  scene.add(sky);
  scene.userData.sky = sky;
}
{
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), skyMaterial()));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
}
scene.fog.color.setRGB(...HORIZON);
// aerial perspective: exponential haze starting at fog.near, ~55% by 2 km, so mid-distance gains depth too
scene.fog.near = 60; scene.fog.far = 5400;
THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
  'float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );',
  'float fogFactor = 1.0 - exp( -max( vFogDepth - fogNear, 0.0 ) / ( fogFar - fogNear ) * 1.9 );');
scene.add(new THREE.HemisphereLight(0xa9c2f0, 0x6a5434, 0.5));
const sun = new THREE.DirectionalLight(0xffd2a0, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -64, right: 64, top: 64, bottom: -64, near: 1, far: 420 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.04;
sun.shadow.camera.layers.enable(1); // layer 1 = shadow-only proxies (vegetation)
scene.add(sun);
scene.add(sun.target);

// ---------- terrain: flat near the track, rolling hills beyond ----------
const STARSHIP_POS = [120, -160];
const terrain = (() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) {
    minX = Math.min(minX, track.P[i * 3]); maxX = Math.max(maxX, track.P[i * 3]);
    minZ = Math.min(minZ, track.P[i * 3 + 2]); maxZ = Math.max(maxZ, track.P[i * 3 + 2]);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const SIZE = 6400, CELL = 10, GN = SIZE / CELL + 1;
  const x0 = cx - SIZE / 2, z0 = cz - SIZE / 2;
  const dist = new Float32Array(GN * GN).fill(1e4);
  const stamp = (x, z, flat) => {
    const rc = Math.ceil(240 / CELL);
    const gi = Math.round((x - x0) / CELL), gj = Math.round((z - z0) / CELL);
    for (let j = Math.max(0, gj - rc); j <= Math.min(GN - 1, gj + rc); j++) {
      for (let i = Math.max(0, gi - rc); i <= Math.min(GN - 1, gi + rc); i++) {
        const d = Math.hypot(x0 + i * CELL - x, z0 + j * CELL - z) - flat;
        const k = j * GN + i;
        if (d < dist[k]) dist[k] = d;
      }
    }
  };
  for (let i = 0; i < track.N; i += 2) stamp(track.P[i * 3], track.P[i * 3 + 2], 0);
  for (const d of track.feat.decor) {
    if (d.type !== 'canyon') continue;
    const P = fP(d.s), T = fT(d.s), yaw = Math.atan2(T[0], T[2]);
    for (let o = -400; o <= 400; o += 10) stamp(P[0] + Math.cos(yaw) * o, P[2] - Math.sin(yaw) * o, 25);
  }
  stamp(STARSHIP_POS[0], STARSHIP_POS[1], 45);
  // the river canyon under the big jump: a real trench, 14 m deep
  const cd = track.feat.decor.find((d) => d.type === 'canyon');
  const canyon = cd && (() => {
    const P = fP(cd.s), T = fT(cd.s), yaw = Math.atan2(T[0], T[2]);
    return { cx: P[0], cz: P[2], A: [Math.cos(yaw), 0, -Math.sin(yaw)], B: norm([T[0], 0, T[2]]), yaw, LEN: 420, DEPTH: 14 };
  })();
  const canyonLocal = (x, z) => {
    const dx = x - canyon.cx, dz = z - canyon.cz;
    return [dx * canyon.A[0] + dz * canyon.A[2], dx * canyon.B[0] + dz * canyon.B[2]];
  };
  const canyonY = (a, w) => -0.12 - canyon.DEPTH * smoothstep(canyon.LEN, canyon.LEN - 140, Math.abs(a)) * (1 - Math.pow(clamp((Math.abs(w) - 17) / 11, 0, 1), 0.6));
  const distTo = (x, z) => {
    const fx = (x - x0) / CELL, fz = (z - z0) / CELL;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= GN - 1 || j >= GN - 1) return 1e4;
    const tx = fx - i, tz = fz - j, k = j * GN + i;
    return lerp(lerp(dist[k], dist[k + 1], tx), lerp(dist[k + GN], dist[k + GN + 1], tx), tz);
  };
  const height = (x, z) => {
    if (canyon) {
      const [a, w] = canyonLocal(x, z);
      if (Math.abs(a) < canyon.LEN && Math.abs(w) < 30) return canyonY(a, w);
    }
    const near = smoothstep(40, 210, distTo(x, z));
    if (near <= 0) return -0.12;
    const edge = smoothstep(SIZE / 2, SIZE / 2 - 700, Math.max(Math.abs(x - cx), Math.abs(z - cz)));
    const hills = Math.max(0, fbm(x / 520 + 3.1, z / 520 - 7.7) * 1.9 - 0.6) * 75 + fbm(x / 110, z / 110, 3) * 5;
    return -0.12 + near * edge * hills;
  };
  // the terrain mesh drops away under the canyon mesh so the trench edges stay crisp
  const meshHeight = (x, z) => {
    if (canyon) {
      const [a, w] = canyonLocal(x, z);
      if (Math.abs(a) < canyon.LEN - 25 && Math.abs(w) < 55) return -40;
    }
    return height(x, z);
  };
  return { height, meshHeight, distTo, cx, cz, SIZE, canyon, canyonY };
})();
const groundHeight = terrain.height;

{
  const SEG = 320;
  const geo = new THREE.PlaneGeometry(terrain.SIZE, terrain.SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k) + terrain.cx, z = pos.getZ(k) + terrain.cz;
    pos.setXYZ(k, x, terrain.meshHeight(x, z), z);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const cols = new Float32Array(pos.count * 3);
  const green = [0.085, 0.13, 0.035], dry = [0.25, 0.19, 0.075], mowed = [0.075, 0.13, 0.03], dirt = [0.22, 0.13, 0.06], rock = [0.34, 0.15, 0.07];
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const groundColor = (x, z, ny) => {
    let c = mix3(green, dry, smoothstep(0.38, 0.62, fbm(x / 160, z / 160, 3)));
    c = mix3(c, dirt, smoothstep(0.66, 0.78, fbm(x / 45 + 11, z / 45, 3)) * 0.8);
    c = mix3(c, rock, smoothstep(0.94, 0.78, ny));
    c = mix3(c, mowed, smoothstep(34, 18, terrain.distTo(x, z)));
    const v = 0.88 + vnoise(x / 9, z / 9) * 0.24;
    return [c[0] * v, c[1] * v, c[2] * v];
  };
  for (let k = 0; k < pos.count; k++) cols.set(groundColor(pos.getX(k), pos.getZ(k), nrm.getY(k)), k * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));

  const cy = terrain.canyon;
  if (cy) {
    const ws = [-80, -64, -50, -40, -33, -29, -27, -25.5, -24, -22.5, -21, -19.5, -18.2, -17.2, -16, -12, -6, 0];
    const prof = ws.concat(ws.slice(0, -1).reverse().map((w) => -w));
    const STEP = 4, rows = Math.round((cy.LEN * 2) / STEP) + 1, nc = prof.length;
    const cpos = new Float32Array(rows * nc * 3), ccol = new Float32Array(rows * nc * 3), idx = [];
    const strata = [[0.5, 0.22, 0.1], [0.66, 0.42, 0.24], [0.56, 0.29, 0.14], [0.72, 0.52, 0.33], [0.46, 0.2, 0.09]];
    const sand = [0.3, 0.22, 0.13];
    for (let r = 0; r < rows; r++) {
      const a = -cy.LEN + r * STEP;
      for (let c = 0; c < nc; c++) {
        const w = prof[c], aw = Math.abs(w);
        let y = terrain.canyonY(a, w);
        if (aw >= 30) y = -0.04;
        let ww = w;
        if (aw > 16.5 && aw < 29) ww += Math.sign(w) * (vnoise(a / 9, y / 3 + 5) - 0.5) * 3.2;
        const x = cy.cx + cy.A[0] * a + cy.B[0] * ww, z = cy.cz + cy.A[2] * a + cy.B[2] * ww;
        cpos.set([x, y, z], (r * nc + c) * 3);
        let col;
        if (aw >= 29) col = groundColor(x, z, 1);
        else if (aw < 16.5) col = sand;
        else {
          col = strata[Math.floor(clamp((y + 15) / 2.2 + vnoise(a / 25, y) * 0.8, 0, 99)) % strata.length];
          const v = 0.85 + vnoise(a / 4, y * 2) * 0.3;
          col = [col[0] * v, col[1] * v, col[2] * v];
        }
        ccol.set(col, (r * nc + c) * 3);
        if (r < rows - 1 && c < nc - 1) {
          const o = r * nc + c;
          idx.push(o, o + 1, o + nc, o + 1, o + nc + 1, o + nc);
        }
      }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(cpos, 3));
    cg.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
    cg.setIndex(idx);
    cg.computeVertexNormals();
    const cmesh = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
    cmesh.receiveShadow = true;
    scene.add(cmesh);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(cy.LEN * 2, 18), new THREE.MeshStandardMaterial({ color: 0x03202a, roughness: 0.12, metalness: 0, envMapIntensity: 0.35 }));
    water.rotation.x = -Math.PI / 2;
    water.rotation.z = cy.yaw;
    water.position.set(cy.cx, -0.12 - cy.DEPTH + 0.55, cy.cz);
    scene.add(water);
  }
  grassTex.repeat.set(terrain.SIZE / 6, terrain.SIZE / 6);
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: grassTex, roughness: 0.96 });
  // world-space patchiness (dry patches, clumps) + a second detail scale to hide the 6 m tile
  groundMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWPos;
      float gH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(gH(i), gH(i + vec2(1.0, 0.0)), f.x), mix(gH(i + vec2(0.0, 1.0)), gH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      { vec2 wp = vWPos.xz;
        float m1 = gN(wp / 21.0) * 0.6 + gN(wp / 9.0 + 7.3) * 0.4, m2 = gN(wp / 2.6 + 13.1), m3 = gN(wp / 85.0 - 4.7) * 0.7 + gN(wp / 37.0 + 2.2) * 0.3;
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.35, 1.1, 0.68), smoothstep(0.42, 0.8, m3) * 0.55);
        diffuseColor.rgb *= 0.66 + 0.5 * m1 + 0.2 * (m2 - 0.5);
        float d2 = texture2D(map, vUv * 0.217 + vec2(0.37, 0.71)).g / 0.66;
        diffuseColor.rgb *= mix(1.0, d2, 0.55); }`);
  };
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);
  const far = new THREE.Mesh(new THREE.RingGeometry(terrain.SIZE * 0.47, 20000, 64, 1), new THREE.MeshLambertMaterial({ color: new THREE.Color(0.3, 0.25, 0.11) }));
  far.rotation.x = -Math.PI / 2;
  far.position.set(terrain.cx, -0.8, terrain.cz);
  scene.add(far);
}

// ---------- track meshes ----------
function surfaceRuns() {
  const N = track.N, s = track.surf;
  let start = 0;
  while (s[start] || !s[(start + 1) % N]) { start = (start + 1) % N; if (start === 0) break; }
  start = (start + 1) % N;
  const runs = [];
  let cur = [];
  for (let k = 0; k < N; k++) {
    const i = (start + k) % N;
    if (s[i]) cur.push(i);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function strip(run, a, b, vRep, mat, uA = 0, uB = 1, cast = false) {
  const n = run.length;
  const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4);
  const idx = [];
  for (let k = 0; k < n; k++) {
    const i = run[k];
    const P = fP(i), R = fR(i), U = fU(i);
    const pa = madd(madd(P, R, a[0]), U, a[1]);
    const pb = madd(madd(P, R, b[0]), U, b[1]);
    pos.set(pa, k * 6); pos.set(pb, k * 6 + 3);
    const vv = (run[0] + k) / vRep;
    uv.set([uA, vv, uB, vv], k * 4);
    if (k < n - 1) { const o = k * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  m.castShadow = cast;
  scene.add(m);
  return m;
}

{
  const topMat = new THREE.MeshStandardMaterial({ map: asphalt.map, roughnessMap: asphalt.rough, normalMap: asphalt.normal, normalScale: new THREE.Vector2(0.22, 0.22), roughness: 1, metalness: 0 });
  // low-frequency patching so the 10 m tile doesn't read as a repeat
  topMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { vec2 q = vec2(vUv.x * 3.0, vUv.y * 0.23); vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
        float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5), b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5);
        float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5), d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5);
        diffuseColor.rgb *= 0.86 + 0.26 * mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }`);
  };
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerb.map, normalMap: kerb.normal, roughness: 0.62, polygonOffset: true, polygonOffsetFactor: -2 });
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x9a9ea4, map: slabTex, roughness: 0.9 });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.82, side: THREE.DoubleSide });
  for (const run of surfaceRuns()) {
    strip(run, [-HALF_W, 0.02], [HALF_W, 0.02], 10, topMat);
    strip(run, [-HALF_W, 0.075], [-HALF_W + 1, 0.028], 6, kerbMat, 1, 0);
    strip(run, [HALF_W - 1, 0.028], [HALF_W, 0.075], 6, kerbMat, 0, 1);
    strip(run, [HALF_W, -0.7], [-HALF_W, -0.7], 10, slabMat);
    strip(run, [-HALF_W - 0.4, -0.7], [-HALF_W - 0.4, 1.0], 10, slabMat);
    strip(run, [HALF_W + 0.4, 1.0], [HALF_W + 0.4, -0.7], 10, slabMat);
    for (const side of [-1, 1]) {
      const lat = side * (HALF_W + 0.1);
      strip(run, [lat, 0], [lat, 1.0], 8, wallMat, 0, 1, true);
      strip(run, [lat, 1.0], [side * (HALF_W + 0.4), 1.0], 8, wallMat, 0.9, 1);
    }
  }
  // embankment under the raised outside edge of banked corners
  const bankMat = new THREE.MeshStandardMaterial({ color: 0x7a6a55, roughness: 1, side: THREE.DoubleSide });
  for (const run of surfaceRuns()) {
    if (!run.some((i) => track.lift[i] > 0.05)) continue;
    for (const side of [-1, 1]) {
      const pos = [], idx = [];
      run.forEach((i, k) => {
        const top = madd(madd(fP(i), fR(i), side * (HALF_W + 0.4)), fU(i), -0.7);
        const bottom = track.lift[i] > 0.05 ? [top[0], -0.12, top[2]] : top;
        pos.push(...top, ...bottom);
        if (k < run.length - 1) { const o = k * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, bankMat);
      m.receiveShadow = true;
      scene.add(m);
    }
  }
}

// pillars under elevated sections
{
  const spots = [];
  for (let i = 0; i < track.N; i += 14) {
    if (!track.surf[i]) continue;
    const P = fP(i), U = fU(i), R = fR(i);
    if (P[1] < 2.5 || U[1] < 0.85) continue;
    for (const side of [-1, 1]) {
      const base = madd(madd(P, R, side * HALF_W * 0.55), U, -0.7);
      let clear = true;
      for (let j = 0; j < track.N; j += 2) {
        if (Math.abs(wrapD(j - i)) < 40) continue;
        const Q = fP(j);
        if (Math.hypot(Q[0] - base[0], Q[2] - base[2]) < HALF_W + 3 && Q[1] < base[1]) { clear = false; break; }
      }
      if (clear) spots.push(base);
    }
  }
  const geo = new THREE.CylinderGeometry(0.7, 0.9, 1, 12);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x8f949b, roughness: 0.8 }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach((b, k) => {
    const g = groundHeight(b[0], b[2]) - 0.3;
    m.makeScale(1, b[1] - g, 1); m.setPosition(b[0], g, b[2]);
    mesh.setMatrixAt(k, m);
  });
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
}

function basisAt(i, kind = 'TUR') {
  const T = fT(i), U = fU(i), R = fR(i);
  const v = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const m = new THREE.Matrix4();
  if (kind === 'TUR') m.makeBasis(v(T), v(U), v(R));
  else m.makeBasis(v(R), v(U), v(scl(T, -1)));
  return m;
}

// start gantry + checker
{
  const i = 0;
  const P = fP(i), R = fR(i);
  const check = new THREE.Mesh(new THREE.PlaneGeometry(2.5, HALF_W * 2), new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 0.8 }));
  check.geometry.rotateX(-Math.PI / 2);
  check.quaternion.setFromRotationMatrix(basisAt(i, 'TUR'));
  check.position.set(P[0], P[1] + 0.04, P[2]);
  check.receiveShadow = true;
  scene.add(check);

  const mat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.4 });
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), mat);
    const q = madd(P, R, side * (HALF_W + 1.4));
    leg.position.set(q[0], 4.5, q[2]);
    leg.castShadow = true;
    scene.add(leg);
  }
  const banner = new THREE.MeshBasicMaterial({ map: textTex('THRUSTER  ROADSTER', 1024, 160, '#111', '#fff') });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, HALF_W * 2 + 4), [banner, banner, mat, mat, mat, mat]);
  beam.quaternion.setFromRotationMatrix(basisAt(i, 'TUR'));
  beam.position.set(P[0], 9, P[2]);
  beam.castShadow = true;
  scene.add(beam);
}

// signs
for (const sg of track.feat.signs) {
  const i = Math.floor(wrapS(sg.s));
  const P = fP(i), R = fR(i), U = fU(i);
  const grp = new THREE.Group();
  const postH = Math.max(0, P[1]) + 3.2;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshBasicMaterial({ map: textTex(sg.text) }));
  board.position.y = postH + 1.4;
  grp.add(board);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshStandardMaterial({ color: 0x30343a }));
  back.rotation.y = Math.PI; back.position.set(0, postH + 1.4, -0.02);
  grp.add(back);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x30343a });
  for (const x of [-5, 5]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, postH, 0.3), postMat);
    post.position.set(x, postH / 2, -0.15);
    post.castShadow = true;
    grp.add(post);
  }
  const base = madd(P, R, -(HALF_W + 9));
  grp.position.set(base[0], -0.1, base[2]);
  const T = fT(i);
  grp.rotation.y = Math.atan2(-T[0], -T[2]);
  scene.add(grp);
  void U;
}

// obstacles (concrete barriers with chevrons)
{
  const chev = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d42131';
    for (let x = -h; x < w + h; x += 64) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 32, 0); g.lineTo(x + 32 + h, h); g.lineTo(x + h, h); g.closePath(); g.fill();
    }
  });
  const mat = new THREE.MeshStandardMaterial({ map: chev, roughness: 0.7 });
  for (const ob of track.feat.obstacles) {
    const w = ob.lat1 - ob.lat0;
    const i = ob.s0 + 1;
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, ob.h, w), mat);
    const P = fP(i), R = fR(i), U = fU(i);
    const c = madd(madd(P, R, (ob.lat0 + ob.lat1) / 2), U, ob.h / 2);
    box.quaternion.setFromRotationMatrix(basisAt(i));
    box.position.set(c[0], c[1], c[2]);
    box.castShadow = true; box.receiveShadow = true;
    scene.add(box);
  }
}

// gap decor: river canyon + Falcon booster
for (const d of track.feat.decor) {
  const P = fP(d.s), T = fT(d.s);
  const yaw = Math.atan2(T[0], T[2]);
  if (d.type === 'booster') {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 26, 24), new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.35, metalness: 0.2 }));
    body.rotation.z = Math.PI / 2;
    body.castShadow = true;
    grp.add(body);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.82, 1.82, 3, 24), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
    band.rotation.z = Math.PI / 2; band.position.x = 9;
    grp.add(band);
    grp.position.set(P[0], 1.7, P[2]);
    grp.rotation.y = yaw;
    scene.add(grp);
  }
}

// Starship landmark, grandstand, vegetation, rocks, mesas
function mergeGeos(parts) {
  const geos = parts.map(([g, m]) => { const n = g.index ? g.toNonIndexed() : g.clone(); if (m) n.applyMatrix4(m); return n; });
  const count = geos.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  geos.forEach((g, idx) => {
    const n = g.attributes.position.count, c = parts[idx][2] || [1, 1, 1];
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    for (let k = 0; k < n; k++) col.set(c, (o + k) * 3);
    o += n;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
const M4 = (x, y, z, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
const distCulled = []; // instanced chunks hidden beyond a camera distance
const shadowProxies = [];
const lodChunks = []; // instanced chunks that swap to a low-poly geometry when far
const shadowRefill = { x: 1e9, z: 1e9 };
function refillShadowProxies(x, z) {
  if (Math.hypot(x - shadowRefill.x, z - shadowRefill.z) < 12) return;
  shadowRefill.x = x; shadowRefill.z = z;
  const R2 = 110 * 110;
  for (const sp of shadowProxies) {
    const arr = sp.proxy.instanceMatrix.array, max = sp.proxy.instanceMatrix.count;
    let n = 0;
    for (let k = 0; k < sp.list.length && n < max; k++) {
      const it = sp.list[k], dx = it[0] - x, dz = it[2] - z;
      if (dx * dx + dz * dz > R2) continue;
      arr.set(sp.mats.subarray(k * 16, k * 16 + 16), n * 16);
      n++;
    }
    sp.proxy.count = n;
    sp.proxy.instanceMatrix.needsUpdate = true;
  }
}

{
  const steel = new THREE.MeshStandardMaterial({ color: 0xd2d6db, metalness: 0.9, roughness: 0.22 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.6, metalness: 0.5 });
  const ship = new THREE.Group();
  const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; ship.add(mesh); return mesh; };
  // launch mount
  for (const [x, z] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) add(new THREE.Mesh(new THREE.BoxGeometry(3, 20, 3), dark), x, 10, z);
  add(new THREE.Mesh(new THREE.TorusGeometry(6.5, 1.4, 12, 32), dark), 0, 20, 0).rotation.x = Math.PI / 2;
  // booster + ship
  add(new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 70, 40), steel), 0, 56, 0);
  for (let y = 26; y < 92; y += 6) add(new THREE.Mesh(new THREE.CylinderGeometry(4.53, 4.53, 0.25, 40), dark), 0, y, 0);
  for (let k = 0; k < 4; k++) {
    const fin = add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.2, 3.6), dark), 0, 88, 0);
    fin.rotation.y = k * Math.PI / 2; fin.translateZ(5.6);
  }
  add(new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 50, 40), steel), 0, 116, 0);
  const nose = add(new THREE.Mesh(new THREE.SphereGeometry(4.5, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), steel), 0, 141, 0);
  nose.scale.y = 2.4;
  for (const [y, s] of [[96, 2.6], [138, 1.6]]) for (const side of [-1, 1]) {
    const flap = add(new THREE.Mesh(new THREE.BoxGeometry(0.35, s * 2.2, s * 1.4), steel), 0, y, 0);
    flap.translateX(side * (4.5 + s * 0.6));
  }
  // tower + chopsticks
  add(new THREE.Mesh(new THREE.BoxGeometry(7, 165, 7), dark), 16, 82.5, 0);
  for (let y = 10; y < 165; y += 10) add(new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.5, 7.4), steel), 16, y, 0);
  for (const z of [-3, 3]) add(new THREE.Mesh(new THREE.BoxGeometry(18, 1.6, 1.2), dark), 7, 128, z);
  ship.position.set(STARSHIP_POS[0], -0.12, STARSHIP_POS[1]);
  scene.add(ship);

  const pad = new THREE.Mesh(new THREE.CylinderGeometry(42, 44, 0.4, 48), new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.9 }));
  pad.position.set(STARSHIP_POS[0], -0.05, STARSHIP_POS[1]);
  pad.receiveShadow = true;
  scene.add(pad);

  const stand = new THREE.Group();
  const crowdTex = canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = '#5d636b'; g.fillRect(0, 0, w, h);
    const r = rng(11);
    const cols = ['#e31937', '#f4f4f4', '#2f7bf5', '#f5a623', '#27c46b', '#c27cff', '#222', '#f4f4f4'];
    for (let row = 0; row < 10; row++) {
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, row * 12.8 + 10, w, 2);
      for (let x = 0; x < w; x += 3 + r() * 2) { g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(x, row * 12.8 + 2 + r() * 2, 2.4, 6); }
    }
  }, false);
  const standTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#80848a'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, y, w, 3); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, y + 3, w, 2); }
    for (let x = 0; x < w; x += 64) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, 0, 3, h); }
  });
  standTex.repeat.set(4, 2);
  const grey = new THREE.MeshStandardMaterial({ color: 0x8a8e94, map: standTex, roughness: 0.85 });
  const seats = new THREE.Mesh(new THREE.BoxGeometry(160, 12, 18), [grey, grey, grey, grey, new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.9 }), grey]);
  seats.rotation.x = -0.35;
  seats.position.set(110, 6, -HALF_W - 22);
  seats.castShadow = true; seats.receiveShadow = true;
  stand.add(seats);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(168, 0.8, 26), new THREE.MeshStandardMaterial({ color: 0xf1f2f4, roughness: 0.5, metalness: 0.3 }));
  roof.position.set(110, 19, -HALF_W - 24);
  roof.rotation.x = 0.06;
  roof.castShadow = true;
  stand.add(roof);
  for (let x = 30; x <= 190; x += 20) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 19, 8), dark);
    col.position.set(x, 9.5, -HALF_W - 35);
    col.castShadow = true;
    stand.add(col);
  }
  scene.add(stand);

  // vegetation: juniper, live oak, scrub, rocks
  const leaf = [0.16, 0.23, 0.08], leafDark = [0.09, 0.15, 0.06], bark = [0.25, 0.16, 0.09];
  // lumpy foliage blobs with soft, jittered normals (reads as leaf mass rather than facets)
  let blobSeed = 0;
  const ico = (r, detail = 1) => {
    const g = new THREE.IcosahedronGeometry(1, detail), sd = (blobSeed += 1.7);
    const p = g.attributes.position, nr = g.attributes.normal;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const s = r * (0.8 + vnoise(x * 2.1 + sd, z * 2.1 + y * 1.9) * 0.34);
      p.setXYZ(k, x * s, y * s, z * s);
      const j = 0.45;
      const n = norm([x + (hash2(x * 9.1 + sd, y * 7.3 + z) - 0.5) * j, y + 0.25 + (hash2(y * 5.7, z * 8.1 + sd) - 0.5) * j, z + (hash2(z * 6.3 + x, sd) - 0.5) * j]);
      nr.setXYZ(k, n[0], n[1], n[2]);
    }
    return g;
  };
  // darken toward the inside/bottom of the canopy (cheap baked AO), leave bark alone
  const shadeFoliage = (g) => {
    const p = g.attributes.position, c = g.attributes.color;
    let y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < p.count; k++) if (c.getY(k) > c.getX(k)) { y0 = Math.min(y0, p.getY(k)); y1 = Math.max(y1, p.getY(k)); }
    for (let k = 0; k < p.count; k++) {
      if (c.getY(k) <= c.getX(k)) continue;
      const t = (p.getY(k) - y0) / Math.max(0.01, y1 - y0);
      const v = (0.45 + 0.75 * t) * (0.9 + hash2(p.getX(k) * 3.3, p.getZ(k) * 2.9 + p.getY(k)) * 0.2);
      c.setXYZ(k, c.getX(k) * v * (1.05 - 0.1 * t), c.getY(k) * v, c.getZ(k) * v * (0.9 + 0.1 * t));
    }
    return g;
  };
  const juniperGeo = (d) => shadeFoliage(mergeGeos([
    [new THREE.CylinderGeometry(0.2, 0.32, 2.2, 6), M4(0, 1.1, 0), bark],
    [ico(1.7, d), M4(0, 3.0, 0, 1, 1.25, 1), leafDark],
    [ico(1.35, d), M4(0.2, 4.6, -0.1), leafDark],
    [ico(0.95, d), M4(-0.1, 5.9, 0.1), leafDark],
    [ico(0.9, d), M4(0.9, 3.4, 0.6), leafDark],
  ]));
  const oakGeo = (d) => shadeFoliage(mergeGeos([
    [new THREE.CylinderGeometry(0.32, 0.5, 2.6, 7), M4(0, 1.3, 0), bark],
    [ico(2.4, d), M4(0, 3.8, 0, 1.4, 0.72, 1.4), leaf],
    [ico(1.8, d), M4(1.9, 3.5, 0.9, 1.1, 0.8, 1.1), leaf],
    [ico(1.7, d), M4(-1.8, 3.6, -0.7, 1.1, 0.8, 1.1), leaf],
    [ico(1.5, d), M4(0.4, 4.6, -1.4, 1.1, 0.8, 1.1), leaf],
  ]));
  const juniper = juniperGeo(1), juniperLo = juniperGeo(0), oak = oakGeo(1), oakLo = oakGeo(0);
  const scrub = shadeFoliage(mergeGeos([[ico(1, 0), M4(0, 0.45, 0, 1.3, 0.75, 1.3), leaf], [ico(0.7, 0), M4(0.8, 0.4, 0.3), leaf]]));
  const rockGeo = (() => {
    const g = new THREE.DodecahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const s = 0.75 + hash2(x * 3.1 + z * 1.7, y * 2.3) * 0.5;
      p.setXYZ(k, x * s, y * s * 0.7, z * s);
    }
    g.computeVertexNormals();
    return mergeGeos([[g, null, [0.5, 0.33, 0.22]]]);
  })();

  const r = rng(7);
  const lists = { juniper: [], oak: [], scrub: [], rock: [] };
  const R0 = 950;
  for (let t = 0; t < 26000; t++) {
    const x = terrain.cx + (r() * 2 - 1) * R0 * 1.3, z = terrain.cz + (r() * 2 - 1) * R0;
    const d = terrain.distTo(x, z);
    if (d < 14) continue;
    if (x > 20 && x < 200 && z > -50 && z < -10) continue;
    const dense = fbm(x / 230 + 5, z / 230 - 2, 3);
    const roll = r();
    let kind = null;
    if (d > 24 && roll < smoothstep(0.42, 0.62, dense) * 0.55) kind = r() < 0.6 ? 'juniper' : 'oak';
    else if (roll < 0.2) kind = 'scrub';
    else if (roll < 0.26) kind = 'rock';
    if (!kind || lists[kind].length >= { juniper: 1100, oak: 650, scrub: 1600, rock: 600 }[kind]) continue;
    lists[kind].push([x, groundHeight(x, z), z, 0.7 + r() * 0.7, r() * Math.PI * 2, r()]);
  }
  // Instances are bucketed into world-space chunks, each with a bounding sphere covering its instances,
  // so the camera frustum can cull them (r149 culls InstancedMesh by the base geometry only).
  // Shadows come from a small proxy on layer 1 (seen only by the shadow camera), refilled with nearby instances.
  const plant = (geo, list, mat, shadow, tint, chunk = 600, maxDist = 0, lowGeo = null) => {
    if (shadow) {
      const mats = new Float32Array(list.length * 16), mm = new THREE.Matrix4(), qq = new THREE.Quaternion();
      list.forEach(([x, y, z, s, yaw, v], k) => {
        qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        mm.compose(new THREE.Vector3(x, y - 0.15, z), qq, new THREE.Vector3(s, s * (0.85 + v * 0.3), s));
        mm.toArray(mats, k * 16);
      });
      const proxy = new THREE.InstancedMesh(geo, mat, Math.min(list.length, 600));
      proxy.count = 0;
      proxy.castShadow = true;
      proxy.frustumCulled = false;
      proxy.layers.set(1);
      scene.add(proxy);
      shadowProxies.push({ proxy, list, mats });
    }
    geo.computeBoundingSphere();
    const gr = geo.boundingSphere.radius * 2.2;
    const buckets = new Map();
    for (const it of list) {
      const key = Math.floor(it[0] / chunk) + ',' + Math.floor(it[2] / chunk);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(it);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    for (const items of buckets.values()) {
      const cg = new THREE.BufferGeometry();
      for (const name in geo.attributes) cg.setAttribute(name, geo.attributes[name]);
      if (geo.index) cg.setIndex(geo.index);
      const box = new THREE.Box3();
      for (const it of items) box.expandByPoint(va.set(it[0], it[1], it[2]));
      cg.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      cg.boundingSphere.radius += gr;
      const mesh = new THREE.InstancedMesh(cg, mat, items.length);
      items.forEach(([x, y, z, s, yaw, v], k) => {
        q.setFromAxisAngle(vb.set(0, 1, 0), yaw);
        m.compose(va.set(x, y - 0.15, z), q, vc.set(s, s * (0.85 + v * 0.3), s));
        mesh.setMatrixAt(k, m);
        tint(c, v);
        mesh.setColorAt(k, c);
      });
      mesh.receiveShadow = true;
      if (maxDist) distCulled.push({ mesh, c: cg.boundingSphere.center, r: cg.boundingSphere.radius + maxDist });
      if (lowGeo) {
        const lg = new THREE.BufferGeometry();
        for (const name in lowGeo.attributes) lg.setAttribute(name, lowGeo.attributes[name]);
        lg.boundingSphere = cg.boundingSphere;
        lodChunks.push({ mesh, hi: cg, lo: lg, c: cg.boundingSphere.center, r: cg.boundingSphere.radius });
      }
      scene.add(mesh);
    }
  };
  const foliage = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  plant(juniper, lists.juniper, foliage, true, (c, v) => c.setRGB(0.8 + v * 0.4, 0.9 + v * 0.3, 0.78 + (1 - v) * 0.3), 300, 0, juniperLo);
  plant(oak, lists.oak, foliage, true, (c, v) => c.setRGB(0.62 + v * 0.45, 0.7 + v * 0.3, 0.5 + v * 0.1), 300, 0, oakLo);
  plant(scrub, lists.scrub, foliage, false, (c, v) => c.setRGB(0.8 + v * 0.7, 0.85 + v * 0.4, 0.6 + v * 0.2));
  plant(rockGeo, lists.rock, rockMat, true, (c, v) => c.setRGB(0.8 + v * 0.5, 0.75 + v * 0.4, 0.7 + v * 0.35));

  // grass tufts along the verges: thin blade fans, base colour dark, tips sun-bleached
  {
    const pos = [], col = [], nrm = [];
    const tr = rng(41);
    for (let b = 0; b < 14; b++) {
      const a = (b / 14) * Math.PI * 2 + tr() * 0.8, rad = 0.04 + tr() * 0.32, h = 0.16 + tr() * 0.24, lean = 0.05 + tr() * 0.14;
      const bx = Math.cos(a) * rad, bz = Math.sin(a) * rad, px = -Math.sin(a) * 0.03, pz = Math.cos(a) * 0.03;
      const tx = bx + Math.cos(a) * lean, tz = bz + Math.sin(a) * lean;
      pos.push(bx - px, 0.1, bz - pz, bx + px, 0.1, bz + pz, tx, 0.1 + h, tz);
      col.push(0.055, 0.085, 0.025, 0.055, 0.085, 0.025, 0.13, 0.16, 0.06);
      for (let k = 0; k < 3; k++) nrm.push(Math.cos(a) * 0.3, 0.95, Math.sin(a) * 0.3);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const tufts = [];
    for (let t = 0; t < 200000 && tufts.length < 60000; t++) {
      const i = Math.floor(tr() * track.N);
      if (!track.surf[i] || track.P[i * 3 + 1] > 3) continue;
      const P = fP(i), R = fR(i), side = tr() < 0.5 ? -1 : 1, off = HALF_W + 1.5 + Math.pow(tr(), 1.8) * 50;
      const x = P[0] + R[0] * side * off + (tr() - 0.5) * 6, z = P[2] + R[2] * side * off + (tr() - 0.5) * 6;
      if (terrain.distTo(x, z) < HALF_W + 1.2) continue;
      if (x > 20 && x < 200 && z > -50 && z < -10) continue;
      const y = groundHeight(x, z);
      if (y < -0.6) continue;
      const dry = smoothstep(0.38, 0.62, fbm(x / 160, z / 160, 3));
      tufts.push([x, y + 0.09, z, 0.6 + tr() * 0.7, tr() * Math.PI * 2, dry]);
    }
    const tuftMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const tr2 = rng(43);
    plant(tg, tufts, tuftMat, false, (c, v) => { const b = 0.8 + tr2() * 0.45; c.setRGB((1 + v * 1.2) * b, (1 + v * 0.35) * b, (0.9 + v * 0.2) * b); }, 120, 150);
  }

  // distant mesas: layered red sandstone, flat tops
  const mesaMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const bands = [[0.5, 0.22, 0.1], [0.62, 0.36, 0.19], [0.7, 0.5, 0.32], [0.46, 0.2, 0.1], [0.58, 0.3, 0.15]];
  for (let k = 0; k < 34; k++) {
    const a = (k / 34) * Math.PI * 2 + r() * 0.12;
    const rad = 1500 + r() * 1100;
    const rt = 90 + r() * 210, h = 60 + r() * 150;
    const geo = new THREE.CylinderGeometry(rt, rt * 1.4, h, 30, 14);
    const p = geo.attributes.position, nrm = geo.attributes.normal;
    const cols = new Float32Array(p.count * 3);
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
      const th = Math.atan2(z, x), yn = (y + h / 2) / h;
      const ledge = 1 + 0.07 * Math.sin(Math.floor(yn * 5) * 2.1 + k);
      const rr = (1 + (vnoise(th * 2.2 + k * 7, 0.3) - 0.5) * 0.45 + (vnoise(th * 8 + k * 3, yn * 5) - 0.5) * 0.18) * (yn < 0.97 ? ledge : 1);
      p.setXYZ(v, x * rr, y, z * rr);
      let c = bands[Math.floor(clamp(yn * 9 + vnoise(th * 4, yn * 12) * 1.5, 0, 9.99)) % bands.length];
      if (nrm.getY(v) > 0.5) c = [0.34, 0.29, 0.13];
      cols.set(c, v * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const mesa = new THREE.Mesh(geo, mesaMat);
    const mx = terrain.cx + Math.cos(a) * rad, mz = terrain.cz + Math.sin(a) * rad;
    mesa.position.set(mx, groundHeight(mx, mz) + h / 2 - 10, mz);
    mesa.rotation.y = r() * Math.PI * 2;
    scene.add(mesa);
  }
}

// ============================================================
// City — downtown street grid for City mode (built on first use)
// ============================================================
// Everything created above is the track world; City mode hides it and shows city.group instead.
const trackWorld = scene.children.filter((o) => !o.isLight && o !== sun.target && o !== scene.userData.sky);

// 9×9 blocks on a 96 m pitch. Roads are 14 m (two 3.5 m lanes each way, driving on the right),
// blocks are raised 15 cm curbs with a 4 m sidewalk ring. EDGE is the outer sidewalk's far side.
const CITY = (() => {
  const BLOCKS = 9, PITCH = 96, ROAD_W = 14, WALK = 4, CURB = 0.15, LANE = 3.5;
  const SPAN = BLOCKS * PITCH;
  return { BLOCKS, PITCH, ROAD_W, WALK, CURB, LANE, SPAN, MIN: -SPAN / 2, MAX: SPAN / 2, EDGE: SPAN / 2 + ROAD_W / 2 + WALK };
})();
const roadLine = (i) => CITY.MIN + i * CITY.PITCH;

// 0 = road, 1 = inside a block, 2 = beyond the outer roads (outer sidewalk)
function cityBand(c) {
  const o = c - CITY.MIN, h = CITY.ROAD_W / 2;
  if (o < -h || o > CITY.SPAN + h) return 2;
  const f = ((o % CITY.PITCH) + CITY.PITCH) % CITY.PITCH;
  return f > h && f < CITY.PITCH - h ? 1 : 0;
}
function cityGround(x, z) {
  const a = cityBand(x), b = cityBand(z);
  return a === 2 || b === 2 || (a === 1 && b === 1) ? CITY.CURB : 0;
}

const city = {
  built: false, group: null, blocks: [], cells: new Map(), walls: [],
  signals: [], signalLamps: null, signalHalos: null, carMeshes: [], policeLamps: null, traffic: [], pedMeshes: null, peds: [],
};
const cityCell = (c) => Math.floor((c - CITY.MIN) / CITY.PITCH);
const cellKey = (i, j) => (i + 2) * 100 + (j + 2);
function addSolid(x0, z0, x1, z1, h) {
  const k = cellKey(cityCell((x0 + x1) / 2), cityCell((z0 + z1) / 2));
  if (!city.cells.has(k)) city.cells.set(k, []);
  city.cells.get(k).push({ x0, z0, x1, z1, h });
}
// solids that can touch anything within a cell of (x, z), plus the city boundary
function solidsNear(x, z, out) {
  out.length = 0;
  const i = cityCell(x), j = cityCell(z);
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const list = city.cells.get(cellKey(i + di, j + dj));
    if (list) for (const s of list) out.push(s);
  }
  for (const s of city.walls) out.push(s);
  return out;
}
const _camSolids = [];
// inside (or within 0.5 m of) a building or the boundary; lamp posts, trees and the fountain don't count
function cityCamBlocked(x, y, z) {
  const pad = 0.5;
  for (const b of solidsNear(x, z, _camSolids)) {
    if (b.h > 8.5 && y < b.h + pad && x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) return true;
  }
  return false;
}

// raw-triangle accumulator → one merged mesh per material
const triBuf = () => ({ pos: [], nor: [], uv: [], col: [] });
function triQuad(G, a, b, c, d, n, ua, ub, uc, ud, col) {
  for (const [p, t] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) {
    G.pos.push(p[0], p[1], p[2]); G.nor.push(n[0], n[1], n[2]); G.uv.push(t[0], t[1]); G.col.push(col[0], col[1], col[2]);
  }
}
// axis-aligned box without a bottom; wall UVs are (metres along the face + u0, height) scaled by (su, sv),
// the roof samples a single texel at roofUV
function triBox(G, x0, y0, z0, x1, y1, z1, col, su, sv, u0 = 0, roofUV = null) {
  const dx = x1 - x0, dz = z1 - z0;
  const w = (len, off) => [[(u0 + off) * su, y0 * sv], [(u0 + off + len) * su, y0 * sv], [(u0 + off + len) * su, y1 * sv], [(u0 + off) * su, y1 * sv]];
  let uv = w(dz, 0);
  triQuad(G, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], ...uv, col);
  uv = w(dx, dz);
  triQuad(G, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], ...uv, col);
  uv = w(dz, dz + dx);
  triQuad(G, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], ...uv, col);
  uv = w(dx, 2 * dz + dx);
  triQuad(G, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], ...uv, col);
  const top = roofUV ? [roofUV, roofUV, roofUV, roofUV] : [[x0 * su, z0 * su], [x0 * su, z1 * su], [x1 * su, z1 * su], [x1 * su, z0 * su]];
  triQuad(G, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], ...top, col);
}
function triMesh(G, mat, shadows = true) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(G.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(G.col, 3));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = shadows; m.receiveShadow = true;
  return m;
}

function buildCityTextures() {
  const P = 18.3; // px per metre on the 14 m-wide road textures
  const n1 = tileNoise(256, 256, 4, 61), n2 = tileNoise(256, 256, 32, 62), r = rng(63);
  const asphaltMap = dataCanvasTex(256, 256, (k) => {
    const l = 80 + (n1[k] - 0.5) * 12 + (n2[k] - 0.5) * 16 + (r() - 0.5) * 12;
    return [l * 1.03, l, l * 0.95];
  }, true).tex;
  // lane paint on transparent: 14 m across (u) × 12 m along (v)
  const lanes = canvasTex(256, 512, (g, w, h) => {
    const vy = h / 12, px = (lat) => (lat + 7) * P;
    g.fillStyle = 'rgba(236,190,40,0.95)';
    for (const s of [-1, 1]) g.fillRect(px(s > 0 ? 0.1 : -0.25), 0, 0.15 * P, h);
    g.fillStyle = 'rgba(236,236,230,0.92)';
    for (const s of [-1, 1]) {
      g.fillRect(px(s * 3.5) - 0.08 * P, 0, 0.15 * P, 3 * vy);
      g.fillRect(px(s * 6.55) - 0.08 * P, 0, 0.15 * P, h);
    }
  });
  // crosswalk + stop line: 14 m across (u) × 5 m out from the intersection (v); stop line on the incoming (u > 0.5) half
  const crossing = canvasTex(256, 96, (g, w, h) => {
    const vy = h / 5, px = (lat) => (lat + 7) * P;
    g.fillStyle = 'rgba(240,240,234,0.95)';
    for (let lat = -6.3; lat < 6.4; lat += 1.05) g.fillRect(px(lat), 0.6 * vy, 0.55 * P, 2.8 * vy);
    g.fillRect(px(0.1), 4.0 * vy, 6.5 * P, 0.45 * vy);
  }, false);
  // sidewalk slabs: 3 m square, 1.5 m joints
  const s1 = tileNoise(256, 256, 3, 64), s2 = tileNoise(256, 256, 40, 65);
  const walk = dataCanvasTex(256, 256, (k) => {
    const x = k % 256, y = Math.floor(k / 256);
    const joint = x % 128 < 3 || y % 128 < 3 ? 0.72 : 1;
    const l = (168 + (s1[k] - 0.5) * 16 + (s2[k] - 0.5) * 22) * joint;
    return [l, l * 0.98, l * 0.94];
  }, true).tex;
  // facades: 8×8 cells, one window per cell (3 m bay × 3.6 m floor)
  const facade = canvasTex(512, 512, (g) => {
    const rr = rng(66);
    g.fillStyle = '#e4e0d8'; g.fillRect(0, 0, 512, 512);
    for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) {
      const x = cx * 64, y = cy * 64, lit = rr() < 0.12;
      const gr = g.createLinearGradient(0, y + 14, 0, y + 54);
      if (lit) { gr.addColorStop(0, '#f2d49a'); gr.addColorStop(1, '#c99a5c'); }
      else { gr.addColorStop(0, '#5d7286'); gr.addColorStop(1, '#25303c'); }
      g.fillStyle = gr; g.fillRect(x + 12, y + 12, 40, 42);
      if (!lit && rr() < 0.3) { g.fillStyle = 'rgba(220,214,200,0.7)'; g.fillRect(x + 12, y + 12, 40, 8 + rr() * 26); }
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 10, y + 54, 44, 3);
    }
  });
  // curtain-wall glass: 8×8 panels with mullions and a dark spandrel band per floor
  const glass = canvasTex(512, 512, (g) => {
    const rr = rng(67);
    g.fillStyle = '#9aa2aa'; g.fillRect(0, 0, 512, 512);
    for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) {
      const x = cx * 64, y = cy * 64, t = rr() * 18;
      g.fillStyle = `rgb(${92 + t},${110 + t},${126 + t})`; g.fillRect(x + 3, y + 3, 58, 46);
      g.fillStyle = '#3a414b'; g.fillRect(x + 3, y + 50, 58, 12);
    }
  });
  return { asphaltMap, lanes, crossing, walk, facade, glass };
}

function buildCity() {
  const { BLOCKS: B, PITCH, ROAD_W, WALK, CURB, EDGE } = CITY;
  const h = ROAD_W / 2;
  const tex = buildCityTextures();
  const grp = city.group = new THREE.Group();
  scene.add(grp);
  const r = rng(4242);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const WHITE = [1, 1, 1];

  // ground: city asphalt, then a wide apron beyond the skyline
  tex.asphaltMap.repeat.set((EDGE * 2) / 8, (EDGE * 2) / 8);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(EDGE * 2 + 2, EDGE * 2 + 2), new THREE.MeshStandardMaterial({ map: tex.asphaltMap, roughness: 0.93 }));
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  grp.add(road);
  const apronTex = grassTex.clone(); apronTex.needsUpdate = true; apronTex.repeat.set(500, 500);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x8a8274, map: apronTex, roughness: 0.97 }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.04;
  apron.receiveShadow = true;
  grp.add(apron);

  // lane paint and crossings
  const paintMat = (map) => new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, roughness: 0.75, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const laneG = triBuf(), crossG = triBuf();
  const UP = [0, 1, 0], Y = 0.01;
  for (let j = 0; j <= B; j++) {
    const c = roadLine(j);
    for (let i = 0; i < B; i++) {
      const a = roadLine(i) + h + 5, b = roadLine(i + 1) - h - 5;
      // along x (lateral +z is the right-hand side heading +x) and along z (lateral −x heading +z)
      triQuad(laneG, [a, Y, c - h], [b, Y, c - h], [b, Y, c + h], [a, Y, c + h], UP, [0, a / 12], [0, b / 12], [1, b / 12], [1, a / 12], WHITE);
      triQuad(laneG, [c + h, Y, a], [c + h, Y, b], [c - h, Y, b], [c - h, Y, a], UP, [0, a / 12], [0, b / 12], [1, b / 12], [1, a / 12], WHITE);
    }
  }
  for (let i = 0; i <= B; i++) for (let j = 0; j <= B; j++) {
    const cx = roadLine(i), cz = roadLine(j);
    // d = direction of travel into the intersection; R = driver's right; only where that road exists
    for (const [dx, dz, ok] of [[1, 0, i > 0], [-1, 0, i < B], [0, 1, j > 0], [0, -1, j < B]]) {
      if (!ok) continue;
      const Rx = -dz, Rz = dx;
      const at = (lat, out) => [cx + Rx * lat - dx * (h + out), Y, cz + Rz * lat - dz * (h + out)];
      triQuad(crossG, at(-h, 0), at(h, 0), at(h, 5), at(-h, 5), UP, [0, 0], [1, 0], [1, 1], [0, 1], WHITE);
    }
  }
  grp.add(triMesh(laneG, paintMat(tex.lanes), false));
  grp.add(triMesh(crossG, paintMat(tex.crossing), false));

  // blocks: curbs, then buildings / park / plaza
  const curbG = triBuf(), facadeG = triBuf(), glassG = triBuf();
  const lamps = [], trees = [];
  const FACADE_COLS = [[0.92, 0.86, 0.74], [0.78, 0.52, 0.42], [0.9, 0.9, 0.88], [0.64, 0.62, 0.6], [0.86, 0.74, 0.58], [0.7, 0.46, 0.36]];
  const GLASS_COLS = [[0.85, 0.92, 1], [0.76, 0.86, 0.92], [0.92, 0.93, 0.95], [0.72, 0.8, 0.88]];
  const FS = 1 / (3 * 8), FV = 1 / (3.6 * 8); // facade texture: 3 m bays × 3.6 m floors, 8 cells per tile
  const building = (x0, z0, x1, z1, ht, glassy) => {
    const G = glassy ? glassG : facadeG;
    const col = pick(glassy ? GLASS_COLS : FACADE_COLS);
    const u0 = Math.floor(r() * 8) * 3;
    const roof = [0.003, 0.003];
    if (ht > 50) {
      const pod = 10 + r() * 8, ix = (x1 - x0) * (0.12 + r() * 0.12), iz = (z1 - z0) * (0.12 + r() * 0.12);
      triBox(G, x0, CURB, z0, x1, pod, z1, col, FS, FV, u0, roof);
      triBox(G, x0 + ix, pod, z0 + iz, x1 - ix, ht, z1 - iz, col, FS, FV, u0, roof);
    } else triBox(G, x0, CURB, z0, x1, ht, z1, col, FS, FV, u0, roof);
    if (r() < 0.6) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = (x1 - x0) * 0.15, sz = (z1 - z0) * 0.15;
      triBox(facadeG, cx - sx, ht, cz - sz, cx + sx, ht + 2 + r() * 2.5, cz + sz, [0.45, 0.46, 0.48], FS, FV, 0, roof);
    }
    addSolid(x0, z0, x1, z1, ht);
  };
  const split = (a, b, n, gap) => {
    const wts = Array.from({ length: n }, () => 0.7 + r() * 0.6), sum = wts.reduce((s, v) => s + v, 0);
    const usable = b - a - gap * (n - 1), out = [];
    let s = a;
    for (const wt of wts) { const e = s + (usable * wt) / sum; out.push([s, e]); s = e + gap; }
    return out;
  };
  const lampAt = (x, z, yaw) => { lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(x, CURB, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1))); addSolid(x - 0.25, z - 0.25, x + 0.25, z + 0.25, 8); };
  const treeAt = (x, z) => { const s = 0.8 + r() * 0.5; trees.push(M4(x, CURB, z, s, s, s)); addSolid(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 6); };
  const WS = 1 / 3; // sidewalk texture: 3 m tile
  for (let bi = 0; bi < B; bi++) for (let bj = 0; bj < B; bj++) {
    const x0 = roadLine(bi) + h, x1 = roadLine(bi + 1) - h, z0 = roadLine(bj) + h, z1 = roadLine(bj + 1) - h;
    const kind = bi === 2 && bj === 6 ? 'park' : bi === 6 && bj === 2 ? 'plaza' : 'build';
    city.blocks.push({ x0, z0, x1, z1, kind });
    triBox(curbG, x0, 0, z0, x1, CURB, z1, WHITE, WS, WS);
    for (const t of [0.22, 0.5, 0.78]) {
      lampAt(lerp(x0, x1, t), z0 + 0.7, Math.PI / 2);
      lampAt(lerp(x0, x1, t), z1 - 0.7, -Math.PI / 2);
      lampAt(x0 + 0.7, lerp(z0, z1, t), Math.PI);
      lampAt(x1 - 0.7, lerp(z0, z1, t), 0);
    }
    const ix0 = x0 + WALK, ix1 = x1 - WALK, iz0 = z0 + WALK, iz1 = z1 - WALK;
    if (kind === 'park') {
      const lawn = new THREE.Mesh(new THREE.PlaneGeometry(ix1 - ix0, iz1 - iz0), new THREE.MeshStandardMaterial({ color: 0x5f7a3a, map: grassTex, roughness: 0.95 }));
      lawn.rotation.x = -Math.PI / 2;
      lawn.position.set((ix0 + ix1) / 2, CURB + 0.01, (iz0 + iz1) / 2);
      lawn.receiveShadow = true;
      grp.add(lawn);
      for (let k = 0; k < 26; k++) {
        const x = lerp(ix0 + 3, ix1 - 3, r()), z = lerp(iz0 + 3, iz1 - 3, r());
        if (Math.abs(x - (ix0 + ix1) / 2) < 4 || Math.abs(z - (iz0 + iz1) / 2) < 4) continue; // keep the cross paths open
        treeAt(x, z);
      }
    } else if (kind === 'plaza') {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const stone = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.8 });
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.3, 0.8, 40), stone);
      basin.position.set(cx, CURB + 0.4, cz); basin.castShadow = basin.receiveShadow = true;
      const water = new THREE.Mesh(new THREE.CircleGeometry(5.6, 40), new THREE.MeshStandardMaterial({ color: 0x2a5a6a, roughness: 0.1, metalness: 0.1 }));
      water.rotation.x = -Math.PI / 2; water.position.set(cx, CURB + 0.72, cz);
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 2.4, 16), stone);
      spout.position.set(cx, CURB + 1.2, cz); spout.castShadow = true;
      grp.add(basin, water, spout);
      addSolid(cx - 5.4, cz - 5.4, cx + 5.4, cz + 5.4, 1);
      for (const [tx, tz] of [[ix0 + 4, iz0 + 4], [ix1 - 4, iz0 + 4], [ix0 + 4, iz1 - 4], [ix1 - 4, iz1 - 4]]) treeAt(tx, tz);
    } else {
      const cxB = (x0 + x1) / 2, czB = (z0 + z1) / 2;
      const tall = clamp(1 - (Math.hypot(cxB, czB) / (CITY.SPAN / 2)) * 1.1, 0, 1);
      for (const [lx0, lx1] of split(ix0, ix1, 2 + (r() < 0.5 ? 1 : 0), 2)) {
        for (const [lz0, lz1] of split(iz0, iz1, 2 + (r() < 0.5 ? 1 : 0), 2)) {
          const ins = () => 0.3 + r() * 1.4;
          let ht = 9 + r() * 16 + Math.pow(tall, 1.6) * (40 + r() * 110);
          if (r() < 0.08) ht += 30 * tall;
          building(lx0 + ins(), lz0 + ins(), lx1 - ins(), lz1 - ins(), ht, ht > 45 || (tall > 0.5 && r() < 0.5));
        }
      }
    }
  }
  // outer sidewalk ring between the perimeter roads and the skyline
  const o0 = CITY.MAX + h;
  triBox(curbG, o0, 0, -EDGE, EDGE, CURB, EDGE, WHITE, WS, WS);
  triBox(curbG, -EDGE, 0, -EDGE, -o0, CURB, EDGE, WHITE, WS, WS);
  triBox(curbG, -o0, 0, o0, o0, CURB, EDGE, WHITE, WS, WS);
  triBox(curbG, -o0, 0, -EDGE, o0, CURB, -o0, WHITE, WS, WS);
  // skyline ring outside the boundary (scenery only; the boundary wall keeps the car in)
  for (let side = 0; side < 4; side++) {
    const span = side < 2 ? EDGE + 260 : EDGE;
    for (let row = 0, d = EDGE; row < 5; row++) {
      const depth = 22 + r() * 18;
      for (let t = -span; t < span;) {
        const wdt = 18 + r() * 24, gap = row === 0 ? 0.5 : 2 + r() * 6;
        const ht = 14 + r() * (row === 0 ? 30 : 60);
        const a0 = t, a1 = Math.min(span, t + wdt), b0 = d + (row === 0 ? 0 : r() * 3), b1 = d + depth;
        const [x0, z0, x1, z1] = side === 0 ? [b0, a0, b1, a1] : side === 1 ? [-b1, a0, -b0, a1] : side === 2 ? [a0, b0, a1, b1] : [a0, -b1, a1, -b0];
        const glassy = ht > 50;
        triBox(glassy ? glassG : facadeG, x0, 0, z0, x1, ht, z1, pick(glassy ? GLASS_COLS : FACADE_COLS), FS, FV, Math.floor(r() * 8) * 3, [0.003, 0.003]);
        t = a1 + gap;
      }
      d += depth + 8 + r() * 10;
    }
  }
  const BIG = 1e4;
  city.walls.push(
    { x0: EDGE, z0: -BIG, x1: EDGE + 50, z1: BIG, h: BIG }, { x0: -EDGE - 50, z0: -BIG, x1: -EDGE, z1: BIG, h: BIG },
    { x0: -BIG, z0: EDGE, x1: BIG, z1: EDGE + 50, h: BIG }, { x0: -BIG, z0: -EDGE - 50, x1: BIG, z1: -EDGE, h: BIG },
  );

  grp.add(triMesh(curbG, new THREE.MeshStandardMaterial({ map: tex.walk, vertexColors: true, roughness: 0.9 }), false));
  grp.add(triMesh(facadeG, new THREE.MeshStandardMaterial({ map: tex.facade, vertexColors: true, roughness: 0.78, metalness: 0.05 })));
  grp.add(triMesh(glassG, new THREE.MeshStandardMaterial({ map: tex.glass, vertexColors: true, roughness: 0.3, metalness: 0.35, envMapIntensity: 0.9 })));

  const inst = (geo, mat, list) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mx, k) => m.setMatrixAt(k, mx));
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
  };
  const lampGeo = mergeGeos([
    [new THREE.CylinderGeometry(0.09, 0.13, 8, 8), M4(0, 4, 0), [0.24, 0.25, 0.27]],
    [new THREE.BoxGeometry(2.3, 0.12, 0.12), M4(1.05, 7.85, 0), [0.24, 0.25, 0.27]],
    [new THREE.BoxGeometry(0.7, 0.16, 0.34), M4(2.05, 7.75, 0), [0.18, 0.18, 0.2]],
  ]);
  inst(lampGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }), lamps);
  const treeGeo = mergeGeos([
    [new THREE.CylinderGeometry(0.18, 0.26, 3, 7), M4(0, 1.5, 0), [0.3, 0.2, 0.12]],
    [new THREE.IcosahedronGeometry(2.4, 1), M4(0, 4.2, 0, 1, 0.9, 1), [0.2, 0.32, 0.12]],
  ]);
  inst(treeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), trees);

  // traffic signals: a mast-arm signal on the far-right corner of every approach, hanging over its lanes
  const sigGeo = mergeGeos([
    [new THREE.CylinderGeometry(0.1, 0.13, 6, 8), M4(0, 3, 0), [0.2, 0.21, 0.23]],
    [new THREE.BoxGeometry(0.14, 0.14, 5), M4(0, 5.85, 2.5), [0.2, 0.21, 0.23]],
    [new THREE.BoxGeometry(0.42, 1.36, 0.5), M4(0.1, 5.2, 4.6), [0.12, 0.12, 0.13]],
    [new THREE.BoxGeometry(0.05, 1.7, 0.8), M4(-0.13, 5.2, 4.6), [0.06, 0.06, 0.07]],
  ]);
  const sigMats = [], up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i <= B; i++) for (let j = 0; j <= B; j++) {
    for (const [dx, dz, ok] of [[1, 0, i > 0], [-1, 0, i < B], [0, 1, j > 0], [0, -1, j < B]]) {
      if (!ok) continue;
      const px = roadLine(i) - dz * (h + 0.9) + dx * (h + 0.9), pz = roadLine(j) + dx * (h + 0.9) + dz * (h + 0.9);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(px, CURB, pz), new THREE.Quaternion().setFromAxisAngle(up, Math.atan2(dz, -dx)), one);
      sigMats.push(m);
      addSolid(px - 0.2, pz - 0.2, px + 0.2, pz + 0.2, 6);
      city.signals.push({ i, j, alongX: dx !== 0, m, shown: '' });
    }
  }
  inst(sigGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5 }), sigMats);
  // bulbs plus a soft additive halo in front of each, so the lit lamp reads from a block away
  const n = city.signals.length * 3;
  const bulbs = city.signalLamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
  const halos = city.signalHalos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.3, 1.3).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), n);
  const local = new THREE.Matrix4(), off = new THREE.Color().setRGB(...SIG_OFF), dark = new THREE.Color(0, 0, 0);
  city.signals.forEach((s, k) => {
    [5.65, 5.2, 4.75].forEach((y, li) => {
      bulbs.setMatrixAt(k * 3 + li, local.makeTranslation(0.32, y, 4.6).premultiply(s.m));
      halos.setMatrixAt(k * 3 + li, local.makeTranslation(0.5, y, 4.6).premultiply(s.m));
      bulbs.setColorAt(k * 3 + li, off); // creates instanceColor before the first render
      halos.setColorAt(k * 3 + li, dark);
    });
  });
  for (const m of [bulbs, halos]) { m.frustumCulled = false; grp.add(m); }

  // traffic: one instanced mesh per body style (the last is the police interceptor), recoloured per car
  const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.25 });
  city.carMeshes = [...TRAFFIC_STYLES, 'police'].map((style) => {
    const n = style === 'police' ? POLICE_N : TRAFFIC_N;
    const m = new THREE.InstancedMesh(trafficGeo(style), carMat, n);
    m.count = 0;
    for (let k = 0; k < n; k++) m.setColorAt(k, new THREE.Color(1, 1, 1));
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false;
    grp.add(m);
    return m;
  });
  // police light bars: a red and a blue lamp per car, flashed in syncTraffic
  const lamps2 = city.policeLamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.13, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff }), POLICE_N * 2);
  for (let k = 0; k < POLICE_N * 2; k++) lamps2.setColorAt(k, new THREE.Color(0, 0, 0));
  lamps2.frustumCulled = false;
  grp.add(lamps2);

  // pedestrians: shirt (torso + arms), head, and legs (two instances each so they can swing)
  const pedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const W1 = [1, 1, 1];
  const pedMesh = (geo, n) => {
    const m = new THREE.InstancedMesh(geo, pedMat, n);
    m.count = 0;
    for (let k = 0; k < n; k++) m.setColorAt(k, new THREE.Color(1, 1, 1));
    m.castShadow = true; m.frustumCulled = false;
    grp.add(m);
    return m;
  };
  city.pedMeshes = {
    torso: pedMesh(mergeGeos([
      [new THREE.BoxGeometry(0.24, 0.62, 0.4), M4(0, 1.22, 0), W1],
      [new THREE.BoxGeometry(0.11, 0.6, 0.11), M4(0, 1.2, -0.26), W1],
      [new THREE.BoxGeometry(0.11, 0.6, 0.11), M4(0, 1.2, 0.26), W1],
    ]), PED_N),
    head: pedMesh(mergeGeos([[new THREE.SphereGeometry(0.125, 12, 8), M4(0, 1.67, 0), W1]]), PED_N),
    legs: pedMesh(mergeGeos([[new THREE.BoxGeometry(0.15, 0.9, 0.17), M4(0, -0.45, 0), W1]]), PED_N * 2),
  };

  city.built = true;
}

let cityActive = false;
function setWorld(cityOn) {
  if (cityOn === cityActive) return;
  if (cityOn && !city.built) buildCity();
  cityActive = cityOn;
  for (const o of trackWorld) {
    if (cityOn) { o.userData.wasVisible = o.visible; o.visible = false; }
    else o.visible = o.userData.wasVisible;
  }
  city.group.visible = cityOn;
}

// Signals cycle per intersection: roads along x get the first half, roads along z the second,
// each with green, yellow, then a short all-red. Offsets stagger neighbouring intersections.
const SIG = { cycle: 26, green: 10, yellow: 2.5 };
function sigLocal(i, j, alongX, t) {
  const ph = (((t + i * 4 + j * 9) % SIG.cycle) + SIG.cycle) % SIG.cycle;
  return alongX ? ph : (ph + SIG.cycle / 2) % SIG.cycle;
}
function signalAt(i, j, alongX, t) {
  const local = sigLocal(i, j, alongX, t);
  return local < SIG.green ? 'g' : local < SIG.green + SIG.yellow ? 'y' : 'r';
}
// pedestrians start across a road only in the first few seconds of its red, so they're over before green
function walkSignal(i, j, alongX, t) {
  const l = sigLocal(i, j, alongX, t) - SIG.green - SIG.yellow;
  return l > 0.3 && l < 4;
}
const SIG_ON = { r: [4, 0.25, 0.15], y: [4, 2.4, 0.2], g: [0.3, 3.4, 1.6] };
const SIG_OFF = [0.1, 0.09, 0.08];
function updateSignalLamps(t) {
  const bulbs = city.signalLamps, halos = city.signalHalos, c = new THREE.Color();
  let dirty = false;
  for (let k = 0; k < city.signals.length; k++) {
    const s = city.signals[k], st = signalAt(s.i, s.j, s.alongX, t);
    if (st === s.shown) continue;
    s.shown = st; dirty = true;
    ['r', 'y', 'g'].forEach((col, li) => {
      const on = col === st;
      bulbs.setColorAt(k * 3 + li, c.setRGB(...(on ? SIG_ON[col] : SIG_OFF)));
      halos.setColorAt(k * 3 + li, on ? c.setRGB(...SIG_ON[col]).multiplyScalar(0.3) : c.setRGB(0, 0, 0));
    });
  }
  if (dirty) { bulbs.instanceColor.needsUpdate = true; halos.instanceColor.needsUpdate = true; }
}

// Traffic car bodies: local +X forward, +Z right, wheels on y = 0. Paint is white so instance colours tint it.
const TRAFFIC_N = 44;
const TRAFFIC_STYLES = ['sedan', 'suv', 'van'];
const POLICE_N = 6, POLICE_STYLE = TRAFFIC_STYLES.length;
const POLICE_BAR = [[-0.25, 1.71, -0.38], [-0.25, 1.71, 0.38]]; // red, blue lamp centres in the car's frame
const TRAFFIC_PAINT = [[0.92, 0.92, 0.9], [0.62, 0.64, 0.67], [0.1, 0.1, 0.11], [0.6, 0.06, 0.06], [0.08, 0.2, 0.5], [0.12, 0.3, 0.18], [0.95, 0.72, 0.08], [0.72, 0.64, 0.5]];
function trafficGeo(style) {
  const PAINT = [1, 1, 1], BLACK = [0.06, 0.06, 0.07], GLASS = [0.05, 0.06, 0.07], TYRE = [0.04, 0.04, 0.04], HEAD = [1, 1, 0.95], TAIL = [0.9, 0.06, 0.05];
  const police = style === 'police';
  const [L, H, W] = style === 'van' ? [5.4, 1.7, 2.0] : style === 'suv' ? [4.8, 0.95, 1.95] : police ? [4.7, 0.74, 1.88] : [4.5, 0.72, 1.84];
  const y0 = 0.22;
  const parts = police // black-and-white: dark lower body, white upper
    ? [[new THREE.BoxGeometry(L, H * 0.5, W), M4(0, y0 + H * 0.25, 0), BLACK], [new THREE.BoxGeometry(L * 0.99, H * 0.5, W * 1.005), M4(0, y0 + H * 0.75, 0), PAINT]]
    : [[new THREE.BoxGeometry(L, H, W), M4(0, y0 + H / 2, 0), PAINT]];
  if (style === 'van') parts.push([new THREE.BoxGeometry(0.9, H * 0.42, W * 1.01), M4(L / 2 - 0.5, y0 + H * 0.72, 0), GLASS]);
  else {
    const [cl, ch, cx] = style === 'suv' ? [2.9, 0.72, -0.35] : [2.3, 0.58, -0.25];
    parts.push([new THREE.BoxGeometry(cl, ch, W * 0.88), M4(cx, y0 + H + ch / 2, 0), GLASS]);
    parts.push([new THREE.BoxGeometry(cl * 0.86, 0.07, W * 0.9), M4(cx, y0 + H + ch, 0), PAINT]);
  }
  if (police) {
    parts.push([new THREE.BoxGeometry(0.34, 0.1, 1.34), M4(-0.25, y0 + H + 0.63, 0), [0.12, 0.12, 0.13]]);
    parts.push([new THREE.BoxGeometry(0.12, 0.42, 1.4), M4(L / 2 + 0.08, y0 + 0.32, 0), BLACK]); // push bar
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push([new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(sx * L * 0.32, 0.34, sz * (W / 2 - 0.08)), TYRE]);
  }
  for (const sz of [-1, 1]) {
    parts.push([new THREE.BoxGeometry(0.06, 0.13, 0.36), M4(L / 2, y0 + H * 0.62, sz * W * 0.32), HEAD]);
    parts.push([new THREE.BoxGeometry(0.06, 0.13, 0.4), M4(-L / 2, y0 + H * 0.62, sz * W * 0.32), TAIL]);
  }
  return mergeGeos(parts);
}

// ============================================================
// Car model
// ============================================================
const shadowTex = canvasTex(128, 64, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)');
  gr.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.scale(1, h / w * 2); g.fillStyle = gr; g.fillRect(0, 0, w, w); g.restore();
}, false);

function makeCar(color, opts = {}) {
  const grp = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.12, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.65 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.42, metalness: 0.35 });
  const shape = new THREE.Shape();
  shape.moveTo(2.3, 0.26);
  shape.quadraticCurveTo(2.46, 0.34, 2.38, 0.46);
  shape.quadraticCurveTo(1.7, 0.62, 0.7, 0.76);
  shape.quadraticCurveTo(-0.4, 0.8, -1.5, 0.86);
  shape.quadraticCurveTo(-2.0, 0.88, -2.3, 0.8);
  shape.lineTo(-2.36, 0.36);
  shape.quadraticCurveTo(-2.24, 0.22, -1.9, 0.22);
  shape.lineTo(1.9, 0.22);
  shape.quadraticCurveTo(2.2, 0.22, 2.3, 0.26);
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.12, bevelSegments: 6, curveSegments: 16 });
  bodyGeo.translate(0, 0, -0.8);
  {
    const pa = bodyGeo.attributes.position;
    for (let k = 0; k < pa.count; k++) {
      const x = pa.getX(k), y = pa.getY(k), z = pa.getZ(k);
      const top = clamp((y - 0.5) / 0.45, 0, 1);
      const nose = clamp((x - 1.3) / 1.1, 0, 1);
      const haunch = Math.exp(-(((x + 1.4) / 0.8) ** 2)) * 0.07 + Math.exp(-(((x - 1.45) / 0.6) ** 2)) * 0.03;
      pa.setZ(k, z * (1 - 0.22 * top) * (1 - 0.2 * nose * nose) * (1 + haunch));
    }
    bodyGeo.computeVertexNormals();
  }
  const body = new THREE.Mesh(bodyGeo, paint);
  body.castShadow = true;
  grp.add(body);

  const part = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; grp.add(m); return m; };
  part(new THREE.BoxGeometry(0.5, 0.05, 1.9), carbon, 2.22, 0.22, 0);
  // rear: gloss-black fascia, diffuser with strakes
  const gloss = new THREE.MeshPhysicalMaterial({ color: 0x050607, roughness: 0.18, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 });
  part(new THREE.BoxGeometry(0.08, 0.27, 1.56), gloss, -2.45, 0.64, 0);
  part(new THREE.BoxGeometry(0.1, 0.16, 1.72), carbon, -2.43, 0.25, 0);
  for (const z of [-0.66, -0.33, 0, 0.33, 0.66]) part(new THREE.BoxGeometry(0.3, 0.2, 0.025), carbon, -2.5, 0.24, z);
  for (const side of [-1, 1]) {
    part(new THREE.BoxGeometry(2.3, 0.1, 0.08), carbon, 0, 0.27, side * 0.98);
    const intake = part(new THREE.BoxGeometry(0.7, 0.16, 0.05), carbon, -0.75, 0.5, side * 0.99);
    intake.rotation.y = side * 0.12;
  }

  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x020203, metalness: 0.3, roughness: 0.05, clearcoat: 1, envMapIntensity: 0.75 });
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), glassMat);
  glass.scale.set(1.42, 0.37, 0.64);
  glass.position.set(-0.25, 0.83, 0);
  // headrest fairings behind the canopy
  for (const z of [-0.3, 0.3]) {
    const fair = part(new THREE.SphereGeometry(1, 20, 12), paint, -1.25, 0.86, z);
    fair.scale.set(0.62, 0.17, 0.2);
  }
  glass.castShadow = true;
  grp.add(glass);

  const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.88 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb4bac1, metalness: 0.95, roughness: 0.22 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x5a5d61, metalness: 0.8, roughness: 0.45 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: 0xd61f2c, roughness: 0.35, metalness: 0.2 });
  const tireGeo = new THREE.LatheGeometry([[0.25, -0.16], [0.33, -0.17], [0.37, -0.14], [0.385, -0.05], [0.385, 0.05], [0.37, 0.14], [0.33, 0.17], [0.25, 0.16]].map(([a, b]) => new THREE.Vector2(a, b)), 28);
  tireGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.255, 0.255, 0.05, 28); rimGeo.rotateX(Math.PI / 2);
  const barrelGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.3, 24, 1, true); barrelGeo.rotateX(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.05, 0.22, 0.04);
  const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12); hubGeo.rotateX(Math.PI / 2);
  const discGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.03, 24); discGeo.rotateX(Math.PI / 2);
  const front = [], wheels = [];
  for (const [x, z] of [[1.45, -0.86], [1.45, 0.86], [-1.45, -0.88], [-1.45, 0.88]]) {
    const out = Math.sign(z);
    const w = new THREE.Group();
    const spin = new THREE.Group();
    const t = new THREE.Mesh(tireGeo, tire); t.castShadow = true; spin.add(t);
    const barrel = new THREE.Mesh(barrelGeo, rimMat); spin.add(barrel);
    const face = new THREE.Group();
    face.position.z = out * 0.13;
    const dish = new THREE.Mesh(rimGeo, discMat); dish.scale.set(0.95, 0.95, 0.4); face.add(dish);
    for (let k = 0; k < 5; k++) {
      const s = new THREE.Mesh(spokeGeo, rimMat);
      s.rotation.z = k * Math.PI * 2 / 5;
      s.translateY(0.13);
      face.add(s);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.018, 6, 28), rimMat); face.add(ring);
    face.add(new THREE.Mesh(hubGeo, rimMat));
    spin.add(face);
    const disc = new THREE.Mesh(discGeo, discMat); disc.position.z = out * 0.04; spin.add(disc);
    w.add(spin);
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.08), caliperMat);
    caliper.position.set(x > 0 ? -0.14 : 0.14, 0.1, out * 0.06);
    w.add(caliper);
    w.position.set(x, 0.385, z);
    grp.add(w);
    wheels.push(spin);
    if (x > 0) front.push(w);
  }

  const glow = (col) => new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
  // HDR colours (>1) so the post bloom picks the lamps up
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.08, 0.1) });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 1.5), tailMat);
  tail.position.set(-2.5, 0.73, 0);
  grp.add(tail);
  for (const z of [-0.74, 0.74]) {
    const end = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.05), tailMat);
    end.position.set(-2.5, 0.67, z);
    grp.add(end);
  }
  const tailGlows = [];
  for (const z of [-0.6, 0, 0.6]) {
    const g = glow(0xff2030);
    g.position.set(-2.56, 0.72, z); g.scale.set(0.9, 0.3, 1);
    g.material.opacity = 0.3;
    grp.add(g);
    tailGlows.push(g);
  }
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.9, 2.7) });
  for (const z of [-0.58, 0.58]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.45), headMat);
    hl.position.set(2.32, 0.5, z); hl.rotation.y = z > 0 ? -0.35 : 0.35;
    grp.add(hl);
    const g = glow(0xfff4e0);
    g.position.set(2.42, 0.5, z); g.scale.set(0.8, 0.4, 1);
    g.material.opacity = 0.55;
    grp.add(g);
  }

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.8), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  shadow.renderOrder = 1;
  grp.add(shadow);

  let wing = null;
  if (opts.roadster) {
    const foil = new THREE.Shape();
    foil.moveTo(0.24, 0);
    foil.bezierCurveTo(0.1, 0.035, -0.12, 0.05, -0.22, 0.02);
    foil.lineTo(-0.24, -0.005);
    foil.bezierCurveTo(-0.1, -0.012, 0.1, -0.01, 0.24, 0);
    const foilGeo = new THREE.ExtrudeGeometry(foil, { depth: 1.62, bevelEnabled: false, curveSegments: 10 });
    foilGeo.translate(0, 0, -0.81);
    wing = new THREE.Mesh(foilGeo, carbon);
    wing.position.set(-1.98, 1.04, 0);
    wing.castShadow = true;
    grp.add(wing);
    for (const z of [-0.82, 0.82]) part(new THREE.BoxGeometry(0.56, 0.26, 0.018), carbon, -1.98, 1.0, z);
    for (const z of [-0.36, 0.36]) part(new THREE.BoxGeometry(0.16, 0.2, 0.025), carbon, -1.92, 0.94, z);
  }

  const plumes = [];
  if (opts.nozzles) {
    const nozMat = new THREE.MeshStandardMaterial({ color: 0x4a4f56, metalness: 0.95, roughness: 0.32, side: THREE.DoubleSide });
    const nozGeo = new THREE.LatheGeometry([[0.06, 0], [0.075, 0.03], [0.1, 0.09], [0.125, 0.15], [0.118, 0.16]].map(([a, b]) => new THREE.Vector2(a, b)), 20);
    nozGeo.rotateZ(Math.PI / 2);
    const throatGeo = new THREE.CircleGeometry(0.07, 16); throatGeo.rotateY(-Math.PI / 2);
    const throatMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.55, 1.1) });
    const plumeGeo = new THREE.ConeGeometry(0.24, 1, 14, 1, true); plumeGeo.rotateZ(Math.PI / 2); plumeGeo.translate(-0.5, 0, 0);
    const plumeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.95, 1.25), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const z of [-0.6, -0.27, 0.27, 0.6]) {
      const nz = new THREE.Mesh(nozGeo, nozMat); nz.position.set(-2.4, 0.46, z); grp.add(nz);
      const th = new THREE.Mesh(throatGeo, throatMat); th.position.set(-2.42, 0.46, z); grp.add(th);
      const pl = new THREE.Mesh(plumeGeo, plumeMat); pl.position.set(-2.56, 0.46, z); pl.visible = false; grp.add(pl);
      plumes.push(pl);
    }
  }
  const lifts = [];
  if (opts.corner) {
    const g = new THREE.ConeGeometry(0.3, 1, 14, 1, true); g.rotateX(Math.PI); g.translate(0, -0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const [x, z] of [[1.75, -0.95], [1.75, 0.95], [-1.85, -0.98], [-1.85, 0.98]]) {
      const pl = new THREE.Mesh(g, mat); pl.position.set(x, 0.25, z); pl.visible = false; grp.add(pl);
      lifts.push(pl);
    }
  }
  // collapse static parts into one mesh per material (keeps draw calls per car low)
  const wheelGroups = new Set(wheels.map((s) => s.parent));
  mergeStatic(grp, new Set([wing, shadow, ...plumes, ...lifts, ...wheelGroups]));
  for (const s of wheels) mergeStatic(s, new Set());
  scene.add(grp);
  return { grp, front, wheels, tailMat, tailGlows, shadow, wing, plumes, lifts, spinT: performance.now() / 1000 };
}

function mergeStatic(root, skip) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const visit = (o) => {
    for (const ch of o.children) {
      if (skip.has(ch)) continue;
      if (ch.isMesh && !ch.isInstancedMesh) {
        if (!byMat.has(ch.material)) byMat.set(ch.material, []);
        byMat.get(ch.material).push(ch);
      }
      if (ch.children.length) visit(ch);
    }
  };
  visit(root);
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      return g;
    });
    const names = ['position', 'normal', 'uv'].filter((n) => geos.every((g) => g.attributes[n]));
    const out = new THREE.BufferGeometry();
    for (const n of names) {
      const size = geos[0].attributes[n].itemSize;
      const arr = new Float32Array(geos.reduce((s, g) => s + g.attributes[n].count * size, 0));
      let o = 0;
      for (const g of geos) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
      out.setAttribute(n, new THREE.BufferAttribute(arr, size));
    }
    const merged = new THREE.Mesh(out, mat);
    merged.castShadow = list.some((m) => m.castShadow);
    merged.receiveShadow = list.some((m) => m.receiveShadow);
    for (const m of list) m.parent.remove(m);
    for (const g of geos) g.dispose();
    root.add(merged);
  }
}

function setBrakeLights(m, on) {
  if (on) m.tailMat.color.setRGB(9, 0.3, 0.35); else m.tailMat.color.setRGB(3, 0.08, 0.1);
  for (const g of m.tailGlows) g.material.opacity = on ? 0.95 : 0.3;
}

function spinWheels(m, speed) {
  const t = performance.now() / 1000;
  const dt = Math.min(0.1, t - m.spinT);
  m.spinT = t;
  for (const w of m.wheels) w.rotation.z -= speed * dt / 0.385;
}

// ============================================================
// Particles (additive vapor + sparks)
// ============================================================
const PMAX = 700;
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3);
const pData = [];
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const pMesh = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 1.6, map: dotTex, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
pMesh.frustumCulled = false;
scene.add(pMesh);
let pHead = 0;
function emit(p, v, life, col) {
  pData[pHead] = { p: p.slice(), v: v.slice(), life, max: life, col };
  pHead = (pHead + 1) % PMAX;
}
function updateParticles(dt) {
  for (let k = 0; k < PMAX; k++) {
    const q = pData[k];
    if (!q || q.life <= 0) { pPos[k * 3 + 1] = -9999; continue; }
    q.life -= dt;
    q.p = madd(q.p, q.v, dt);
    q.v = scl(q.v, 1 - 2 * dt);
    const a = Math.max(0, q.life / q.max) * 0.55;
    pPos.set(q.p, k * 3);
    pCol.set([q.col[0] * a, q.col[1] * a, q.col[2] * a], k * 3);
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}

// ============================================================
// Audio (synthesized)
// ============================================================
const audio = {
  ctx: null,
  muted: store.get('muted') === true,
  musicOn: store.get('music') !== false,
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      this.build();
    } catch (e) { this.ctx = null; }
  },
  build() {
    const c = this.ctx;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1;
    const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 9000; tone.Q.value = 0.5;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(tone); tone.connect(comp); comp.connect(lim); lim.connect(c.destination);
    this.mf = c.createBiquadFilter(); this.mf.type = 'lowpass'; this.mf.frequency.value = 400; this.mf.Q.value = 0.7;
    this.mg = c.createGain(); this.mg.gain.value = 0;
    this.mf.connect(this.mg); this.mg.connect(this.master);
    const mo = (type, vol) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = type; g.gain.value = vol;
      o.connect(g); g.connect(this.mf); o.start(); return o;
    };
    this.m1 = mo('sine', 0.6); this.m2 = mo('triangle', 0.3); this.m3 = mo('sine', 0.18);
    const len = c.sampleRate * 2;
    this.white = c.createBuffer(1, len, c.sampleRate); this.brown = c.createBuffer(1, len, c.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    for (let i = 0, last = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5;
    }
    const mk = (type, freq, q) => {
      const s = c.createBufferSource(); s.buffer = this.brown; s.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(this.master); s.start();
      return { g: g.gain, f };
    };
    this.whoosh = mk('lowpass', 750, 0.5);
    this.wind = mk('lowpass', 300, 0.3);
    this.fan = mk('bandpass', 280, 1.2);
    this.skid = mk('bandpass', 520, 1.5);
    this.scrape = mk('lowpass', 900, 0.7);
    // police siren: two detuned squares through a band-pass; the wail is swept in update()
    const sf = c.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1100; sf.Q.value = 0.8;
    this.sirenG = c.createGain(); this.sirenG.gain.value = 0;
    sf.connect(this.sirenG); this.sirenG.connect(this.master);
    this.sirenO = [-8, 8].map((det) => { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 800; o.detune.value = det; o.connect(sf); o.start(); return o; });
    this.buildMusic();
  },
  update(p) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const set = (param, v, k = 0.06) => param.setTargetAtTime(v, t, k);
    set(this.master.gain, this.muted ? 0 : 0.8, 0.03);
    const live = p && (state === 'race' || state === 'countdown' || state === 'results');
    const m = live ? 1 : 0;
    const sp = p ? vlen(p.V) : 0;
    const air = p && p.mode === 'air';
    const thr = input.throttle * (air ? 0.3 : 1);
    set(this.m1.frequency, 42 + sp * 0.9);
    set(this.m2.frequency, 70 + sp * 3.2);
    set(this.m3.frequency, 140 + sp * 6.4);
    set(this.mf.frequency, Math.min(1800, 380 + sp * 9 + thr * 250));
    set(this.mg.gain, m * (0.05 + 0.09 * thr + Math.min(0.06, sp * 0.0008)));
    set(this.whoosh.g, m * ((p && p.boosting ? 0.22 : 0) + (p && p.lifting ? 0.26 : 0)), 0.08);
    set(this.whoosh.f.frequency, p && p.boosting ? 1100 : 750);
    set(this.wind.g, m * Math.min(0.2, sp * sp * 0.00004));
    set(this.wind.f.frequency, Math.min(1400, 250 + sp * 10));
    set(this.fan.g, m * (p && (p.suction || p.diving) ? 0.12 : 0.02));
    set(this.skid.g, m * (p && !air && p.slip > 4 ? Math.min(0.12, (p.slip - 4) * 0.015) : 0), 0.08);
    set(this.scrape.g, m * (p && p.scraping > 0 ? 0.1 : 0));
    const siren = live && cityActive ? law.siren : 0;
    set(this.sirenG.gain, siren * 0.05, 0.1);
    if (siren > 0) for (const o of this.sirenO) o.frequency.setTargetAtTime(820 + 380 * Math.sin(t * Math.PI * 0.9), t, 0.02);
    this.music(t);
  },
  // ---- music: 118 BPM synthwave in A minor, 8-bar loop of 16th steps
  bpm: 118,
  chords: [[33, 57, 60, 64], [29, 57, 60, 65], [36, 55, 60, 64], [31, 55, 59, 62], [33, 57, 60, 64], [29, 57, 60, 65], [31, 55, 59, 62], [28, 56, 59, 64]],
  arpSeq: [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 3, 1, 2],
  hz: (n) => 440 * Math.pow(2, (n - 69) / 12),
  buildMusic() {
    const c = this.ctx;
    this.six = 60 / this.bpm / 4;
    this.mus = c.createGain(); this.mus.gain.value = 0;
    this.musLP = c.createBiquadFilter(); this.musLP.type = 'lowpass'; this.musLP.frequency.value = 12000; this.musLP.Q.value = 0.5;
    this.mus.connect(this.musLP); this.musLP.connect(this.master);
    this.padF = c.createBiquadFilter(); this.padF.type = 'lowpass'; this.padF.frequency.value = 1000; this.padF.Q.value = 0.6;
    this.padF.connect(this.mus);
    this.arpBus = c.createGain(); this.arpBus.connect(this.mus);
    const dly = c.createDelay(1), fb = c.createGain(), dlf = c.createBiquadFilter(), wet = c.createGain();
    dly.delayTime.value = this.six * 3; fb.gain.value = 0.32; wet.gain.value = 0.35;
    dlf.type = 'lowpass'; dlf.frequency.value = 1800;
    this.arpBus.connect(dly); dly.connect(dlf); dlf.connect(fb); fb.connect(dly); dlf.connect(wet); wet.connect(this.mus);
    this.step = 0; this.next = 0;
  },
  music(t) {
    const mode = state === 'paused' ? 'pause' : state === 'results' ? 'results' : state === 'title' ? 'title' : 'race';
    const on = this.musicOn && !this.muted;
    this.mus.gain.setTargetAtTime(on ? (mode === 'pause' ? 0.12 : mode === 'race' ? 0.2 : 0.26) : 0, t, 0.3);
    this.musLP.frequency.setTargetAtTime(mode === 'pause' ? 600 : 12000, t, 0.2);
    if (!on) { this.next = 0; return; }
    if (!this.next) { this.next = t + 0.05; this.step = 0; }
    if (this.next < t - 0.1) this.next = t + 0.02;
    while (this.next < t + 0.2) {
      this.note(this.step, this.next, mode === 'pause' ? 'race' : mode);
      this.next += this.six; this.step = (this.step + 1) % 128;
    }
  },
  note(s, w, mode) {
    const bar = s >> 4, b = s & 15, ch = this.chords[bar], six = this.six;
    const drums = mode !== 'results';
    if (b === 0) for (let i = 1; i < 4; i++) this.pad(this.hz(ch[i]), w, six * 16, mode === 'results' ? 0.06 : 0.045);
    if (drums && b % 4 === 0) this.kick(w, mode === 'title' ? 0.45 : 0.8);
    if (drums && b % 4 === 2) this.hat(w, mode === 'title' ? 0.03 : 0.05);
    if (mode === 'race' && (b === 4 || b === 12)) this.snare(w, 0.12);
    if (mode === 'race' && bar === 7 && b >= 13) this.snare(w, 0.04 + (b - 13) * 0.025);
    if (b % 2 === 0) this.bass(this.hz(ch[0] + (b % 4 === 2 ? 12 : 0)), w, six * 1.7, mode === 'results' ? 0.18 : 0.3);
    if (mode !== 'title' || bar >= 4 || b % 2 === 0) {
      const k = this.arpSeq[b];
      this.arp(this.hz((k === 3 ? ch[1] + 12 : ch[k + 1]) + 12), w, six * 0.9, mode === 'results' ? 0.05 : 0.07);
    }
  },
  osc(type, f, w, dest) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, w); g.gain.setValueAtTime(0, w);
    o.connect(g); g.connect(dest); return [o, g.gain];
  },
  pad(f, w, dur, vol) {
    for (const det of [-7, 7]) {
      const [o, g] = this.osc('sawtooth', f, w, this.padF);
      o.detune.value = det;
      g.linearRampToValueAtTime(vol, w + 0.35); g.setValueAtTime(vol, w + dur - 0.1); g.linearRampToValueAtTime(0, w + dur + 0.4);
      o.start(w); o.stop(w + dur + 0.45);
    }
  },
  bass(f, w, dur, vol) {
    const c = this.ctx, lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(900, w); lp.frequency.exponentialRampToValueAtTime(200, w + 0.15);
    lp.connect(this.mus);
    for (const [type, v] of [['sawtooth', vol], ['sine', vol * 0.8]]) {
      const [o, g] = this.osc(type, f, w, lp);
      g.linearRampToValueAtTime(v, w + 0.005); g.exponentialRampToValueAtTime(0.0001, w + dur);
      o.start(w); o.stop(w + dur + 0.02);
    }
  },
  arp(f, w, dur, vol) {
    const [o, g] = this.osc('triangle', f, w, this.arpBus);
    g.linearRampToValueAtTime(vol, w + 0.004); g.exponentialRampToValueAtTime(0.0001, w + dur);
    o.start(w); o.stop(w + dur + 0.02);
  },
  kick(w, vol) {
    const [o, g] = this.osc('sine', 130, w, this.mus);
    o.frequency.exponentialRampToValueAtTime(45, w + 0.12);
    g.linearRampToValueAtTime(vol, w + 0.003); g.exponentialRampToValueAtTime(0.0001, w + 0.35);
    o.start(w); o.stop(w + 0.4);
  },
  noise(w, dur, vol, type, freq, q) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.white; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(vol, w + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, w + dur);
    s.connect(f); f.connect(g); g.connect(this.mus); s.start(w, Math.random() * 1.5); s.stop(w + dur + 0.02);
  },
  hat(w, vol) { this.noise(w, 0.04, vol, 'bandpass', 7500, 0.8); },
  snare(w, vol) {
    this.noise(w, 0.16, vol, 'bandpass', 1800, 0.7);
    const [o, g] = this.osc('triangle', 180, w, this.mus);
    g.linearRampToValueAtTime(vol * 0.8, w + 0.003); g.exponentialRampToValueAtTime(0.0001, w + 0.08);
    o.start(w); o.stop(w + 0.1);
  },
  beep(freq, dur, vol = 0.18) {
    if (!this.ctx || this.muted) return;
    const w = this.ctx.currentTime;
    for (const [type, f, v] of [['triangle', freq, vol], ['sine', freq / 2, vol * 0.6]]) {
      const [o, g] = this.osc(type, f, w, this.master);
      g.linearRampToValueAtTime(v, w + 0.008); g.exponentialRampToValueAtTime(0.0001, w + dur);
      o.start(w); o.stop(w + dur + 0.02);
    }
  },
  thud(vol = 0.4) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, w = c.currentTime, [o, g] = this.osc('sine', 90, w, this.master);
    o.frequency.exponentialRampToValueAtTime(32, w + 0.25);
    g.linearRampToValueAtTime(vol * 0.8, w + 0.006); g.exponentialRampToValueAtTime(0.0001, w + 0.3);
    o.start(w); o.stop(w + 0.32);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), ng = c.createGain();
    s.buffer = this.brown; f.type = 'lowpass'; f.frequency.value = 250;
    ng.gain.setValueAtTime(vol * 0.5, w); ng.gain.exponentialRampToValueAtTime(0.0001, w + 0.18);
    s.connect(f); f.connect(ng); ng.connect(this.master); s.start(w, Math.random() * 1.5); s.stop(w + 0.2);
  },
};
document.addEventListener('visibilitychange', () => {
  if (!audio.ctx) return;
  if (document.hidden) audio.ctx.suspend(); else audio.ctx.resume();
});

// ============================================================
// Input — keyboard + Xbox controller (standard Gamepad mapping)
// ============================================================
const keys = new Set();
const actions = [];
const input = { steer: 0, throttle: 0, brake: 0, boost: false, lift: false, dive: false };
let kbSteer = 0;
let lastDevice = 'kb';
let pad = null;
let padPrev = [];
let padKnown = null;
let stickDir = null, stickT = 0;

const KEY_ACTIONS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Enter: 'confirm', Space: 'confirm', Escape: 'pause', KeyP: 'pause', Backspace: 'back',
  KeyR: 'reset', KeyT: 'restart', KeyM: 'mute', KeyN: 'music', KeyC: 'camera',
};
const PAD_ACTIONS = { 0: 'confirm', 1: 'back', 4: 'camera', 5: 'camera', 8: 'restart', 9: 'pause', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'].includes(e.code)) e.preventDefault();
  audio.unlock();
  lastDevice = 'kb';
  keys.add(e.code);
  if (!e.repeat && KEY_ACTIONS[e.code]) actions.push(KEY_ACTIONS[e.code]);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); if (state === 'race' || state === 'countdown') pauseGame(); });
window.addEventListener('pointerdown', () => audio.unlock());

const padName = (gp) => (gp.id.replace(/\s*\(.*\)\s*/g, '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim() || 'Gamepad');

window.addEventListener('gamepadconnected', (e) => {
  lastDevice = 'pad';
  toast(`${padName(e.gamepad)} connected`, 'good');
  if (e.gamepad.mapping !== 'standard') toast('Non-standard controller mapping — use Chrome or Safari for best results', 'warn');
  renderOverlay();
});
window.addEventListener('gamepaddisconnected', () => {
  toast('Controller disconnected', 'warn');
  if (state === 'race' || state === 'countdown') pauseGame();
  renderOverlay();
});

function getPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let best = null;
  for (const gp of pads) {
    if (!gp || !gp.connected) continue;
    if (!best || (gp.mapping === 'standard' && best.mapping !== 'standard')) best = gp;
  }
  return best;
}

function pollPad(dt) {
  const gp = getPad();
  pad = gp;
  const known = gp ? gp.id : null;
  if (known !== padKnown) { padKnown = known; renderOverlay(); }
  if (!gp) { padPrev = []; return null; }
  const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const value = (i) => (gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0);
  for (const k in PAD_ACTIONS) {
    const i = +k;
    if (pressed(i) && !padPrev[i]) { actions.push(PAD_ACTIONS[k]); lastDevice = 'pad'; }
  }
  const menuState = state !== 'race' && state !== 'countdown';
  if (!menuState && pressed(12) && !padPrev[12]) actions.push('reset');
  padPrev = gp.buttons.map((b) => b.pressed);

  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  let dir = null;
  if (Math.abs(ax) > 0.6 && Math.abs(ax) >= Math.abs(ay)) dir = ax > 0 ? 'right' : 'left';
  else if (Math.abs(ay) > 0.6) dir = ay > 0 ? 'down' : 'up';
  if (dir) {
    if (dir !== stickDir) { stickDir = dir; stickT = 0.35; if (menuState) actions.push(dir); }
    else { stickT -= dt; if (stickT <= 0) { stickT = 0.14; if (menuState) actions.push(dir); } }
  } else stickDir = null;

  const dz = 0.12;
  let sx = Math.abs(ax) < dz ? 0 : Math.sign(ax) * (Math.abs(ax) - dz) / (1 - dz);
  sx = Math.sign(sx) * Math.pow(Math.abs(sx), 1.5);
  if (pressed(14)) sx = -1;
  if (pressed(15)) sx = 1;
  const rt = value(7), lt = value(6);
  if (Math.abs(ax) > 0.3 || rt > 0.1 || lt > 0.1) lastDevice = 'pad';
  return { steer: sx, throttle: rt, brake: lt, boost: pressed(0), lift: pressed(2), dive: pressed(3) };
}

function readInput(dt) {
  const k = (...c) => c.some((x) => keys.has(x));
  const kSteer = (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0);
  kbSteer = approach(kbSteer, kSteer, dt * (kSteer === 0 || Math.sign(kSteer) !== Math.sign(kbSteer) ? 9 : 4.5));
  const p = pollPad(dt) || { steer: 0, throttle: 0, brake: 0, boost: false, lift: false, dive: false };
  input.steer = clamp(Math.abs(p.steer) > Math.abs(kbSteer) ? p.steer : kbSteer, -1, 1);
  input.throttle = Math.max(p.throttle, k('ArrowUp', 'KeyW') ? 1 : 0);
  input.brake = Math.max(p.brake, k('ArrowDown', 'KeyS') ? 1 : 0);
  input.boost = p.boost || k('Space');
  input.lift = p.lift || k('ShiftLeft', 'ShiftRight', 'KeyE');
  input.dive = p.dive || k('KeyF');
}

let rumbleUntil = 0;
function rumble(strong, weak, ms, force = false) {
  const va = pad && pad.vibrationActuator;
  if (!va || !va.playEffect) return;
  const now = performance.now();
  if (!force && now < rumbleUntil - 30) return;
  rumbleUntil = now + ms;
  try {
    const r = va.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak });
    if (r && r.catch) r.catch(() => {});
  } catch (e) { /* unsupported */ }
}

// ============================================================
// Game state
// ============================================================
let state = 'title'; // title | countdown | race | paused | results  (City mode skips the countdown and never finishes)
const MODES = ['race', 'trial', 'city'];
const MODE_NAMES = { race: 'Race', trial: 'Time Trial', city: 'City' };
let pausedFrom = 'race';
let mode = MODES.includes(store.get('mode')) ? store.get('mode') : 'race';
let pauseSel = 0;
let resultsSel = 0;
let player = null;
let rivals = [];
let raceTime = 0;
let countdown = 0;
let lastLights = -1;
let goFlash = 0;
let finishTimer = 0;
let simClock = 0;
let camMode = 0; // 0 chase, 1 far chase, 2 hood
let shake = 0;
const toasts = [];

function toast(text, kind = '') {
  const dup = toasts.find((t) => t.text === text);
  if (dup) { dup.t = Math.min(dup.t, 0.2); return; }
  toasts.push({ text, kind, t: 0, life: kind === 'big' ? 2.2 : 2.6 });
  if (toasts.length > 4) toasts.shift();
}

function makePlayer(trim) {
  const back = mode === 'race' ? 46 : 14;
  const p = {
    trim, mode: 'track', s: L - back, lat: mode === 'race' ? 3.5 : 0, psi: 0, u: 0, v: 0,
    P: [0, 0, 0], V: [0, 0, 0], F: [1, 0, 0], Up: [0, 1, 0],
    gas: trim.tank, gasIdle: 0, suction: false, fell: false, loopWarned: false, steerVis: 0, slip: 0, load: G * 2, scraping: 0,
    lap: 0, visited: new Array(SECTORS).fill(true), lapStart: 0,
    lastLap: null, bestLap: store.get('best.' + trim.id), lapTimes: [],
    boosting: false, lifting: false, braking: false, inverted: false,
    finished: false, finishTime: null, offCourse: 0, lastTrackS: L - back,
    launchStart: null, best060: store.get('z60.' + trim.id), last060: null,
    gLong: 0, gLat: 0, peakG: 0, airTime: 0, maxAlt: 0, resetCooldown: 0, loops: 0, loopEntry: false,
  };
  p.model = makeCar(trim.color, { roadster: true, nozzles: true, corner: true });
  syncTrackPose(p);
  return p;
}

function makeRivals(attract = false) {
  const base = 0.97;
  return RIVAL_DEFS.map((def, i) => {
    const r = {
      ...def, d: attract ? -i * 160 : -10 - i * 12, v: attract ? 40 : 0,
      lane: i % 2 === 0 ? -3.5 : 3.5, off: i % 2 === 0 ? -3.5 : 3.5, avoid: 0,
      skill: (attract ? 0.92 : base) + (2 - i) * 0.03, rubber: 1, acc: 15, brake: 22, vmax: 93,
      phase: i * 2.1, finishTime: null, braking: false, P: [0, 0, 0], F: [1, 0, 0], Up: [0, 1, 0],
    };
    r.model = makeCar(def.color, {});
    poseRival(r);
    return r;
  });
}

function disposeModel(model) {
  scene.remove(model.grp);
  model.grp.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}
function disposeCars() {
  if (player) disposeModel(player.model);
  for (const r of rivals) disposeModel(r.model);
}

function makeCityPlayer(trim) {
  const p = {
    trim, city: true, mode: 'street', psi: 0, u: 0, v: 0,
    P: [roadLine(1) + CITY.PITCH / 2, 0, roadLine(5) + CITY.LANE / 2], V: [0, 0, 0], F: [1, 0, 0], Up: [0, 1, 0],
    gas: trim.tank, gasIdle: 0, suction: false, diving: false, diveHeld: false, steerVis: 0, slip: 0, load: G * 1.5,
    scraping: 0, scrapeSide: 1, boosting: false, lifting: false, braking: false, inverted: false,
    finished: false, offCourse: 0, resetCooldown: 0, hopT: 0, hopHeld: false, hops: 0, topSpeed: 0, dist: 0, pedHits: 0,
    launchStart: null, best060: store.get('z60.' + trim.id), last060: null,
    gLong: 0, gLat: 0, peakG: 0, airTime: 0, maxAlt: 0,
  };
  p.model = makeCar(trim.color, { roadster: true, nozzles: true, corner: true });
  cityPose(p);
  return p;
}

function startRace() {
  store.set('mode', mode);
  disposeCars();
  setWorld(mode === 'city');
  player = mode === 'city' ? makeCityPlayer(ROADSTER) : makePlayer(ROADSTER);
  rivals = mode === 'race' ? makeRivals() : [];
  if (mode === 'city') { Object.assign(law, freshLaw()); spawnTraffic(); spawnPeds(); }
  raceTime = 0; simClock = 0; countdown = 4; lastLights = -1; goFlash = 0; finishTimer = 0;
  toasts.length = 0;
  camInit = false;
  state = mode === 'city' ? 'race' : 'countdown';
  audio.unlock();
  renderOverlay();
}

function toTitle() {
  disposeCars();
  setWorld(false);
  state = 'title';
  player = null;
  rivals = makeRivals(true);
  camInit = false;
  renderOverlay();
}

function pauseGame() {
  if (state !== 'race' && state !== 'countdown') return;
  pausedFrom = state; state = 'paused'; pauseSel = 0;
  renderOverlay();
}
function resumeGame() { state = pausedFrom; renderOverlay(); }

function playerProgress() {
  const p = player;
  if (!p) return 0;
  if (p.lap === 0) return p.s > L / 2 ? p.s - L : p.s;
  return (p.lap - 1) * L + p.s;
}

function standings() {
  const cars = [];
  if (player) cars.push({ name: 'You', you: true, prog: playerProgress(), fin: player.finishTime, color: player.trim.css, v: vlen(player.V) });
  for (const r of rivals) cars.push({ name: r.name, you: false, prog: r.d, fin: r.finishTime, color: r.css, v: r.v });
  cars.sort((a, b) => {
    if (a.fin != null && b.fin != null) return a.fin - b.fin;
    if (a.fin != null) return -1;
    if (b.fin != null) return 1;
    return b.prog - a.prog;
  });
  return cars;
}

// ============================================================
// Physics
// ============================================================
function syncTrackPose(p) {
  const f = frameAt(p.s);
  const c = Math.cos(p.psi), s = Math.sin(p.psi);
  p.P = madd(f.P, f.R, p.lat);
  p.F = add(scl(f.T, c), scl(f.R, s));
  p.Up = f.U.slice();
  const r = add(scl(f.T, -s), scl(f.R, c));
  p.V = add(scl(p.F, p.u), scl(r, p.v));
}

function gasLogic(p, inp, dt) {
  const T = p.trim;
  const canGas = p.gas > 0.5;
  p.boosting = inp.boost && canGas;
  // in the city the lift thrusters only fire during a hop's short burn (see stepStreet)
  p.lifting = inp.lift && canGas && (!p.city || p.hopT > 0);
  if (p === player) {
    if (!canGas && ((inp.lift && !p.liftHeld) || (inp.boost && !p.boostHeld))) toast('Cold-gas tank empty — recharging', 'warn');
    p.liftHeld = inp.lift;
    p.boostHeld = inp.boost;
  }
  const drain = (p.boosting ? T.boostDrain : 0) + (p.lifting ? T.liftDrain : 0);
  if (drain > 0) { p.gas = Math.max(0, p.gas - drain * dt); p.gasIdle = 0; }
  else { p.gasIdle += dt; if (p.gasIdle > 0.8) p.gas = Math.min(T.tank, p.gas + GAS_RECHARGE * dt); }
}

// Motor, brakes, cold-gas thrust, steering and tyre grip in the car's own frame (u forward, v right).
// N is the normal acceleration; gf / gr are gravity along / across the car. Shared by track and city.
function tyreStep(p, inp, dt, N, hiDF, gf, gr) {
  const T = p.trim;
  const grip = 1.1 * N;
  let u = p.u, v = p.v;
  let aTire = 0, aThrust = 0;
  const vtopM = T.vtopMotor * (hiDF ? 0.93 : 1);
  if (inp.throttle > 0) {
    if (u > -1) aTire += inp.throttle * T.motorA * Math.max(0, 1 - Math.pow(Math.max(u, 0) / vtopM, 3));
    else aTire += inp.throttle * 3.8 * G;
  }
  p.braking = false;
  if (inp.brake > 0) {
    if (u > 1) { aTire -= inp.brake * 3.8 * G; p.braking = true; }
    else if (inp.throttle < 0.1 && u > -14) aTire -= inp.brake * 7;
  }
  aTire = clamp(aTire, -grip * 0.85, grip);
  if (p.boosting) aThrust = T.thrustA * Math.max(0, 1 - Math.pow(Math.max(u, 0) / (T.vtopThrust * (hiDF ? 0.96 : 1)), 3));

  const dragK = hiDF ? 0.0005 : 0.0003;
  const resist = (0.4 + dragK * u * u) * (1 - inp.throttle * 0.85);
  u += (aTire + aThrust + gf) * dt;
  const rr = resist * dt;
  u = Math.abs(u) <= rr ? 0 : u - Math.sign(u) * rr;

  const sAbs = Math.abs(u);
  const steerMax = 0.62 / (1 + sAbs / 12);
  let yaw = u * Math.tan(inp.steer * steerMax) / 2.7;
  const yawLim = (grip * 1.35) / Math.max(sAbs, 3);
  yaw = clamp(yaw, -yawLim, yawLim);

  const a = yaw * dt;
  const nu = u * Math.cos(a) + v * Math.sin(a);
  const nv = -u * Math.sin(a) + v * Math.cos(a);
  u = nu; v = nv;
  v += gr * dt;
  const latAvail = Math.max(grip * 0.55, Math.sqrt(Math.max(0, grip * grip - aTire * aTire)));
  const corr = Math.min(Math.abs(v), latAvail * dt);
  v -= Math.sign(v) * corr;
  p.slip = Math.abs(v);
  return { u, v, a, yaw, aTire, aThrust };
}

function stepTrack(p, inp, dt) {
  const f = frameAt(p.s);
  const hiDF = p.suction = inp.dive && !p.lifting;
  let c = Math.cos(p.psi), s = Math.sin(p.psi);
  let vs = p.u * c - p.v * s;
  const speed = Math.hypot(p.u, p.v);
  const inLoop = track.tag[Math.floor(p.s)] === 'loop';
  const fan = p.lifting ? 0 : (hiDF ? 1.3 : inLoop ? 0 : 0.5) * G;
  const aero = p.lifting ? 0 : (hiDF ? 0.003 : 0.0025) * speed * speed;
  const N = vs * vs * f.kn + G * f.U[1] + fan + aero - (p.lifting ? LIFT_A : 0);
  p.load = N;
  p.inverted = f.U[1] < -0.2;

  const loopSoon = track.tag[Math.floor(wrapS(p.s + 60))] === 'loop';
  if (loopSoon && !inLoop && !p.loopWarned && p === player && !hiDF && speed < 34) { p.loopWarned = true; toast('Loop ahead — hold Y so the fans keep you on', 'warn'); }
  if (!loopSoon && !inLoop) p.loopWarned = false;

  const stalled = inLoop && !hiDF && !p.lifting && f.U[1] < 0.3 && speed < 5;
  if (!f.surf || N < 0 || stalled) {
    const fell = (p.inverted || stalled) && !p.lifting;
    detach(p);
    p.fell = fell;
    if (p.lifting) p.V = madd(p.V, p.Up, LIFT_POP);
    stepAir(p, inp, dt);
    return;
  }

  const gT = -G * f.T[1], gR = -G * f.R[1];
  const t = tyreStep(p, inp, dt, N, hiDF, gT * c + gR * s, -gT * s + gR * c);
  let u = t.u, v = t.v;
  const { a, yaw, aTire, aThrust } = t;

  p.psi = wrapAngle(p.psi + a - f.kg * vs * dt);
  c = Math.cos(p.psi); s = Math.sin(p.psi);
  vs = u * c - v * s;
  let vl = u * s + v * c;
  p.s = wrapS(p.s + vs * dt);
  p.lat += vl * dt;

  // walls
  const lim = HALF_W - 1.05;
  p.scraping = Math.max(0, p.scraping - dt);
  if (Math.abs(p.lat) > lim) {
    const side = Math.sign(p.lat);
    p.lat = side * lim;
    if (vl * side > 0) {
      const impact = Math.abs(vl);
      vl = -vl * 0.25;
      vs *= 1 - Math.min(0.25, impact * 0.012);
      p.psi *= 0.6;
      c = Math.cos(p.psi); s = Math.sin(p.psi);
      u = vs * c + vl * s; v = -vs * s + vl * c;
      p.scraping = 0.15;
      p.scrapeSide = side;
      if (impact > 6) { shake = Math.max(shake, 0.25 + impact * 0.02); rumble(0.6, 0.6, 160, true); audio.thud(0.2 + impact * 0.01); }
      else rumble(0.25, 0.35, 90);
    }
  }

  // obstacles
  for (const ob of track.feat.obstacles) {
    const ds = wrapD(p.s - ob.s0);
    if (ds < -2.4 || ds > 2 + 2.4) continue;
    if (p.lat < ob.lat0 - 1.0 || p.lat > ob.lat1 + 1.0) continue;
    const fromFront = ds < 1;
    p.s = wrapS(ob.s0 + (fromFront ? -2.45 : 4.45));
    vs = fromFront ? -Math.abs(vs) * 0.2 : Math.abs(vs) * 0.2;
    u = vs * c + vl * s; v = -vs * s + vl * c;
    shake = Math.max(shake, 0.8);
    rumble(1, 1, 300, true);
    audio.thud(0.6);
    toast('Crunch! Hold lift to hop it, or steer around', 'warn');
  }

  p.u = u; p.v = v;
  p.lastTrackS = p.s;
  syncTrackPose(p);

  p.gLong = lerp(p.gLong, (aTire + aThrust) / G, 0.08);
  p.gLat = lerp(p.gLat, (yaw * u) / G, 0.08);

  if (inLoop) p.loopEntry = true;
  else if (p.loopEntry) { p.loopEntry = false; p.loops++; toast('Loop! Fans held you through the top', 'good'); }
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function detach(p) {
  syncTrackPose(p);
  p.mode = 'air';
  p.airTime = 0; p.maxAlt = 0;
  p.inverted = false;
  p.loopEntry = false;
}

function crash(p, msg) {
  p.V = [0, 0, 0];
  p.fell = false;
  if (p.offCourse > 0) return;
  p.offCourse = 1.2;
  toast(msg, 'warn');
  rumble(1, 0.8, 350, true);
  audio.thud(0.6);
  shake = Math.max(shake, 1);
}

function stepAir(p, inp, dt) {
  const T = p.trim;
  const speed = vlen(p.V);
  p.V[1] -= G * dt;
  if (p.lifting) {
    const taper = clamp((45 - p.P[1]) / 12, 0, 1);
    p.V = madd(p.V, p.Up, LIFT_A * taper * dt);
    p.V = madd(p.V, p.V, -0.25 * dt);
  }
  let aThrust = 0;
  if (p.boosting) {
    aThrust = T.thrustA * 0.8 * Math.max(0, 1 - Math.pow(speed / T.vtopThrust, 3));
    p.V = madd(p.V, p.F, aThrust * dt);
  }
  p.V = madd(p.V, p.V, -0.00025 * speed * dt);

  // yaw thrusters + self-levelling
  p.F = rot(p.F, p.Up, -inp.steer * 1.9 * dt);
  const near = nearestFrame(p.P, true);
  // suction fans only have something to pull against when there's track beneath
  {
    const d0 = sub(p.P, fP(near.i));
    const below = Math.abs(dot(d0, fT(near.i))) < 3 && Math.abs(dot(d0, fR(near.i))) < HALF_W && dot(d0, fU(near.i)) > -1;
    p.diveHeld = inp.dive && !p.lifting;
    p.diving = p.diveHeld && below;
    if (p.diving) p.V = madd(p.V, fU(near.i), -DIVE_A * dt);
  }
  const tgtUp = near.d < 30 ? fU(near.i) : UPW;
  const k = 1 - Math.exp(-(p.diving ? 6 : 2.5) * dt);
  p.Up = norm(add(scl(p.Up, 1 - k), scl(tgtUp, k)));
  p.F = norm(madd(p.F, p.Up, -dot(p.F, p.Up)));

  p.P = madd(p.P, p.V, dt);
  p.airTime += dt;
  p.maxAlt = Math.max(p.maxAlt, p.P[1]);
  p.slip = 0; p.braking = false; p.scraping = 0;
  p.gLong = lerp(p.gLong, aThrust / G, 0.08);
  p.gLat = lerp(p.gLat, 0, 0.08);

  // track-relative position for lap logic / obstacles
  const i = near.i;
  const Pi = fP(i), Ti = fT(i), Ui = fU(i), Ri = fR(i);
  const d = sub(p.P, Pi);
  const h = dot(d, Ui), lat = dot(d, Ri);
  if (near.d < 40) p.s = wrapS(i + dot(d, Ti));

  // obstacles in the air
  if (near.d < 10) {
    for (const ob of track.feat.obstacles) {
      const ds = wrapD(p.s - ob.s0);
      if (ds < -2.4 || ds > 4.4 || lat < ob.lat0 - 1 || lat > ob.lat1 + 1 || h > ob.h + 0.1 || h < -1) continue;
      p.V = madd(p.V, Ti, -dot(p.V, Ti) * 1.2);
      shake = Math.max(shake, 0.8);
      rumble(1, 1, 300, true);
      audio.thud(0.6);
    }
  }

  // landing — only onto real surface directly beneath the car
  const along = dot(d, Ti);
  const overTrack = track.surf[i] && Math.abs(along) < 1.5 && Math.abs(lat) < HALF_W - 0.2;
  if (p.airTime > 0.15 && overTrack && h < 0.15 && h > -2.5 && dot(p.V, Ui) < 2) {
    if (p.fell) crash(p, 'Fell off upside down — hold Y for suction');
    else land(p, i, d, lat);
    return;
  }
  // off course: hit the ground
  const gy = groundHeight(p.P[0], p.P[2]) + 0.32;
  if (p.P[1] < gy && !(overTrack && h > -2.5)) {
    p.P[1] = gy;
    crash(p, p.fell ? 'Fell off upside down — hold Y for suction' : 'Off course — returning to track');
  }
}

function land(p, i, d, lat) {
  const Ti = fT(i), Ui = fU(i), Ri = fR(i);
  const impact = -dot(p.V, Ui);
  const vs = dot(p.V, Ti), vl = dot(p.V, Ri);
  const fp = madd(p.F, Ui, -dot(p.F, Ui));
  p.psi = Math.atan2(dot(fp, Ri), dot(fp, Ti));
  const c = Math.cos(p.psi), s = Math.sin(p.psi);
  let u = vs * c + vl * s, v = -vs * s + vl * c;
  if (impact > 12) {
    u *= 0.8; v *= 0.8;
    shake = Math.max(shake, 1.2);
    rumble(1, 0.8, 320, true);
    audio.thud(0.6);
    toast('Hard landing', 'warn');
  } else {
    shake = Math.max(shake, 0.3);
    rumble(0.4, 0.3, 160, true);
    audio.thud(0.25);
  }
  if (p.airTime > 1.0) toast(`Air time ${p.airTime.toFixed(1)} s`, 'good');
  p.u = u; p.v = v;
  p.s = wrapS(i + dot(d, Ti));
  p.lat = clamp(lat, -(HALF_W - 1.05), HALF_W - 1.05);
  p.mode = 'track';
  for (let k = 0; k < 20; k++) {
    const a = Math.random() * Math.PI * 2;
    emit(p.P, [Math.cos(a) * 10, 1 + Math.random() * 2, Math.sin(a) * 10], 0.6, [0.9, 0.9, 0.85]);
  }
  syncTrackPose(p);
}

function resetToTrack(p, silent = false) {
  if (p.resetCooldown > 0) return;
  let s = p.mode === 'air' ? p.lastTrackS : p.s;
  const j = jumpAt(s);
  if (j) s = j.kick - 110;
  if (track.tag[Math.floor(wrapS(s))] === 'loop') {
    while (track.tag[Math.floor(wrapS(s))] === 'loop') s -= 5;
    s -= 40;
  }
  while (!track.surf[Math.floor(wrapS(s))]) s -= 5;
  p.s = wrapS(s); p.lat = clamp(p.lat, -3, 3); p.psi = 0; p.u = 0; p.v = 0;
  p.mode = 'track'; p.offCourse = 0; p.resetCooldown = 1; p.fell = false;
  syncTrackPose(p);
  if (!silent) toast('Reset to track');
}

// ---------- city: free-roam driving on the flat street grid ----------
// Lift thrusters give a short hop, not flight: a pop plus a brief burn, then gravity.
// The next hop needs the wheels back on the ground and a fresh press.
const HOP = { pop: 5, burn: 0.3, gas: 15 };

function cityPose(p) {
  const c = Math.cos(p.psi), s = Math.sin(p.psi);
  p.F = [c, 0, s];
  p.Up = UPW.slice();
  return [-s, 0, c]; // right
}

const _solids = [];
// Push the car (two circles along its length) out of buildings, lamp posts and the boundary,
// bounce the velocity off the wall and spin the car about the contact point.
function cityCollide(p, dt) {
  p.scraping = Math.max(0, p.scraping - dt);
  let worst = 0;
  const c = Math.cos(p.psi), s = Math.sin(p.psi), R = 1.05;
  solidsNear(p.P[0], p.P[2], _solids);
  for (const off of [1.4, -1.4]) {
    let cx = p.P[0] + c * off, cz = p.P[2] + s * off;
    for (const b of _solids) {
      if (p.P[1] >= b.h) continue;
      const qx = clamp(cx, b.x0, b.x1), qz = clamp(cz, b.z0, b.z1);
      const dx = cx - qx, dz = cz - qz, d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      let nx, nz, pen;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = R - d; }
      else {
        const l = cx - b.x0, rt = b.x1 - cx, t = cz - b.z0, bt = b.z1 - cz, m = Math.min(l, rt, t, bt);
        if (m === l) { nx = -1; nz = 0; pen = l + R; } else if (m === rt) { nx = 1; nz = 0; pen = rt + R; }
        else if (m === t) { nx = 0; nz = -1; pen = t + R; } else { nx = 0; nz = 1; pen = bt + R; }
      }
      p.P[0] += nx * pen; p.P[2] += nz * pen; cx += nx * pen; cz += nz * pen;
      const vn = p.V[0] * nx + p.V[2] * nz;
      if (vn >= 0) continue;
      const j = -vn * (vn < -12 ? 1.08 : 1.25); // hard hits crumple rather than bounce
      p.V[0] += nx * j; p.V[2] += nz * j;
      const tx = -nz, tz = nx, vt = p.V[0] * tx + p.V[2] * tz;
      const scrub = Math.sign(vt) * Math.min(Math.abs(vt), j * 0.35);
      p.V[0] -= tx * scrub; p.V[2] -= tz * scrub;
      const ax = cx - p.P[0], az = cz - p.P[2];
      p.psi = wrapAngle(p.psi + clamp((ax * nz - az * nx) * j * 0.012, -0.35, 0.35));
      p.scrapeSide = -Math.sign(nz * c - nx * s) || 1;
      if (Math.abs(vt) > 4) p.scraping = 0.15;
      worst = Math.max(worst, -vn);
    }
  }
  if (worst > 6) {
    shake = Math.max(shake, 0.25 + Math.min(1, worst * 0.03));
    rumble(0.6 + Math.min(0.4, worst / 40), 0.6, 180, true);
    audio.thud(0.2 + Math.min(0.4, worst * 0.012));
  } else if (worst > 0.5) rumble(0.25, 0.35, 90);
}

function stepStreet(p, inp, dt) {
  const hiDF = p.suction = inp.dive;
  const speed = Math.hypot(p.u, p.v);
  const N = G + (hiDF ? 1.3 : 0.5) * G + (hiDF ? 0.003 : 0.0025) * speed * speed;
  p.load = N;
  p.inverted = false;
  const t = tyreStep(p, inp, dt, N, hiDF, 0, 0);
  p.psi = wrapAngle(p.psi + t.a);
  let R = cityPose(p);
  p.V = [p.F[0] * t.u + R[0] * t.v, 0, p.F[2] * t.u + R[2] * t.v];
  p.P[0] += p.V[0] * dt; p.P[2] += p.V[2] * dt;
  cityCollide(p, dt);
  R = cityPose(p);
  p.u = dot(p.V, p.F); p.v = dot(p.V, R);
  p.P[1] = lerp(p.P[1], cityGround(p.P[0], p.P[2]), 1 - Math.exp(-dt * 30)); // ride up / down curbs
  p.gLong = lerp(p.gLong, (t.aTire + t.aThrust) / G, 0.08);
  p.gLat = lerp(p.gLat, (t.yaw * t.u) / G, 0.08);

  if (inp.lift && !p.hopHeld) {
    if (p.gas >= HOP.gas) {
      p.gas -= HOP.gas; p.gasIdle = 0;
      p.hopT = HOP.burn; p.hops++;
      p.V[1] = HOP.pop;
      p.mode = 'air'; p.airTime = 0; p.maxAlt = 0;
    } else if (p === player) toast('Not enough cold gas to hop', 'warn');
  }
  p.hopHeld = inp.lift;
}

function stepCityAir(p, inp, dt) {
  const T = p.trim;
  p.V[1] -= G * dt;
  if (p.lifting) { p.V[1] += LIFT_A * dt; p.hopT -= dt; }
  else p.hopT = 0; // letting go of lift ends the burn
  p.hopHeld = inp.lift;
  p.suction = false;
  p.diveHeld = p.diving = inp.dive && !p.lifting;
  if (p.diving) p.V[1] -= DIVE_A * dt;
  let aThrust = 0;
  if (p.boosting) {
    aThrust = T.thrustA * 0.8 * Math.max(0, 1 - Math.pow(Math.hypot(p.V[0], p.V[2]) / T.vtopThrust, 3));
    p.V[0] += p.F[0] * aThrust * dt; p.V[2] += p.F[2] * aThrust * dt;
  }
  p.V = madd(p.V, p.V, -0.00025 * vlen(p.V) * dt);
  // yaw thrusters turn the nose; the car keeps flying the way it was going
  p.psi = wrapAngle(p.psi + inp.steer * 1.2 * dt);
  cityPose(p);
  p.P = madd(p.P, p.V, dt);
  p.airTime += dt;
  p.maxAlt = Math.max(p.maxAlt, p.P[1]);
  p.slip = 0; p.braking = false;
  p.gLong = lerp(p.gLong, aThrust / G, 0.08);
  p.gLat = lerp(p.gLat, 0, 0.08);
  cityCollide(p, dt);
  const g = cityGround(p.P[0], p.P[2]);
  if (p.P[1] <= g && p.V[1] <= 0) cityLand(p, g);
}

function cityLand(p, g) {
  const impact = -p.V[1];
  p.P[1] = g; p.V[1] = 0;
  p.mode = 'street'; p.hopT = 0; p.diving = false;
  const R = cityPose(p);
  p.u = dot(p.V, p.F); p.v = dot(p.V, R);
  if (impact > 12) {
    p.u *= 0.8; p.v *= 0.8;
    shake = Math.max(shake, 1.2); rumble(1, 0.8, 320, true); audio.thud(0.6);
    toast('Hard landing', 'warn');
  } else { shake = Math.max(shake, 0.3); rumble(0.4, 0.3, 160, true); audio.thud(0.25); }
  if (p.airTime > 1.0) toast(`Hop ${p.airTime.toFixed(1)} s · ${p.maxAlt.toFixed(1)} m high`, 'good');
  for (let k = 0; k < 20; k++) {
    const a = Math.random() * Math.PI * 2;
    emit(p.P, [Math.cos(a) * 10, 1 + Math.random() * 2, Math.sin(a) * 10], 0.6, [0.9, 0.9, 0.85]);
  }
}

// Snap onto the right-hand lane of the nearest road, facing the way the car was mostly pointing.
function resetToStreet(p, silent = false) {
  if (p.resetCooldown > 0) return;
  const snap = (c) => roadLine(clamp(Math.round((c - CITY.MIN) / CITY.PITCH), 0, CITY.BLOCKS));
  const x = clamp(p.P[0], CITY.MIN, CITY.MAX), z = clamp(p.P[2], CITY.MIN, CITY.MAX);
  const sx = snap(x), sz = snap(z), lane = CITY.LANE / 2;
  if (Math.abs(x - sx) < Math.abs(z - sz)) {
    const dir = Math.sin(p.psi) >= 0 ? 1 : -1;
    p.psi = (dir * Math.PI) / 2; p.P = [sx - dir * lane, 0, z];
  } else {
    const dir = Math.cos(p.psi) >= 0 ? 1 : -1;
    p.psi = dir > 0 ? 0 : Math.PI; p.P = [x, 0, sz + dir * lane];
  }
  p.u = 0; p.v = 0; p.V = [0, 0, 0];
  p.mode = 'street'; p.hopT = 0; p.resetCooldown = 1;
  cityPose(p);
  if (!silent) toast('Back on the street');
}

// ---------- city traffic: lane-following cars that stop for signals and for whatever is ahead ----------
// A car drives toward junction (ni, nj) along d with signed distance a (negative before the centre) and
// lateral offset off to its right. At the junction it goes straight, or turns on a quarter circle.
const LANE_IN = CITY.LANE / 2, LANE_OUT = CITY.LANE * 1.5;
const STOP_A = -(CITY.ROAD_W / 2 + 4.5) - 2.3; // car centre when its nose is at the stop line
const RIGHT_R = 6, LEFT_R = CITY.ROAD_W / 2 + LANE_IN;
const inGrid = (i, j) => i >= 0 && j >= 0 && i <= CITY.BLOCKS && j <= CITY.BLOCKS;

function chooseTurn(c) {
  const [dx, dz] = c.d, rx = -dz, rz = dx;
  const opts = [];
  if (inGrid(c.ni + dx, c.nj + dz)) opts.push(['S', 0.55]);
  if (inGrid(c.ni + rx, c.nj + rz)) opts.push(['R', 0.25]);
  if (inGrid(c.ni - rx, c.nj - rz)) opts.push(['L', 0.2]);
  let x = Math.random() * opts.reduce((s, o) => s + o[1], 0);
  c.next = opts[opts.length - 1][0];
  for (const [o, w] of opts) if ((x -= w) <= 0) { c.next = o; break; }
  if (c.next === 'R') c.offT = LANE_OUT;
  else if (c.next === 'L') c.offT = LANE_IN;
}

function poseLane(c) {
  const [dx, dz] = c.d;
  c.P[0] = roadLine(c.ni) + dx * c.a - dz * c.off;
  c.P[1] = roadLine(c.nj) + dz * c.a + dx * c.off;
  c.psi = Math.atan2(dz, dx) + c.laneYaw;
}
function poseTurn(c) {
  const [dx, dz] = c.d, rx = -dz, rz = dx;
  const A = c.tac + c.tr * Math.cos(c.phi), Bq = c.tbc + c.tr * Math.sin(c.phi);
  c.P[0] = roadLine(c.ni) + dx * A + rx * Bq;
  c.P[1] = roadLine(c.nj) + dz * A + rz * Bq;
  // tangent of a right turn (phi increasing) is d·(−sin φ) + R·cos φ; a left turn runs the other way
  const ta = -Math.sin(c.phi) * c.tdir, tb = Math.cos(c.phi) * c.tdir;
  c.psi = Math.atan2(dz * ta + rz * tb, dx * ta + rx * tb);
}
function startTurn(c) {
  if (c.next === 'R') { c.tr = RIGHT_R; c.tac = -LANE_OUT - RIGHT_R; c.tbc = c.off + RIGHT_R; c.phi = -Math.PI / 2; c.tdir = 1; }
  else { c.tr = LEFT_R; c.tac = LANE_IN - LEFT_R; c.tbc = c.off - LEFT_R; c.phi = Math.PI / 2; c.tdir = -1; }
  c.state = 'turn';
  c.laneYaw = 0;
}
function finishTurn(c) {
  const [dx, dz] = c.d;
  const nd = c.tdir > 0 ? [-dz, dx] : [dz, -dx];
  c.d = nd; c.ni += nd[0]; c.nj += nd[1];
  const rx = c.P[0] - roadLine(c.ni), rz = c.P[1] - roadLine(c.nj);
  c.a = rx * nd[0] + rz * nd[1];
  c.off = c.offT = c.tdir > 0 ? LANE_OUT : LANE_IN;
  c.state = 'lane';
  chooseTurn(c);
}

// distance between bumpers to the nearest car (or the player) in a narrow cone ahead; remembers who it was
function gapAhead(c) {
  const fx = Math.cos(c.psi), fz = Math.sin(c.psi);
  let best = Infinity;
  c.blocker = null;
  for (let k = -1; k < city.traffic.length; k++) {
    let x, z, o;
    if (k < 0) { if (!player || player.P[1] > 2) continue; o = player; x = player.P[0]; z = player.P[2]; }
    else { o = city.traffic[k]; if (o === c) continue; x = o.P[0]; z = o.P[1]; }
    const rx = x - c.P[0], rz = z - c.P[1], along = rx * fx + rz * fz;
    if (along <= 0 || along > 40 || Math.abs(rz * fx - rx * fz) > 2) continue;
    if (along - 4.8 < best) { best = along - 4.8; c.blocker = o; }
  }
  // pedestrians out on the road (crossing, jaywalking, or knocked down)
  for (const q of city.peds) {
    if (cityGround(q.P[0], q.P[2]) !== 0) continue;
    const rx = q.P[0] - c.P[0], rz = q.P[2] - c.P[1], along = rx * fx + rz * fz;
    if (along <= 0 || along > 30 || Math.abs(rz * fx - rx * fz) > 1.8) continue;
    if (along - 2.7 < best) { best = along - 2.7; c.blocker = q; }
  }
  return best;
}
// nobody (car, wreck or player) in the lane at offset `off` from 8 m behind to 12 m ahead of c
function laneClear(c, off) {
  const [dx, dz] = c.d, cx = roadLine(c.ni), cz = roadLine(c.nj);
  const busy = (x, z) => {
    const rx = x - cx, rz = z - cz, a = rx * dx + rz * dz;
    return Math.abs(rz * dx - rx * dz - off) < 2 && a > c.a - 8 && a < c.a + 12;
  };
  if (player && player.P[1] < 2 && busy(player.P[0], player.P[2])) return false;
  for (const o of city.traffic) if (o !== c && busy(o.P[0], o.P[1])) return false;
  return true;
}
// a car coming the other way that a left turner must wait for
function oncoming(c) {
  for (const o of city.traffic) {
    if (o.state !== 'lane' || o.ni !== c.ni || o.nj !== c.nj || o.next === 'L') continue;
    if (o.d[0] === -c.d[0] && o.d[1] === -c.d[1] && o.a > -45 && o.a < CITY.ROAD_W / 2) return true;
  }
  return false;
}

function placeTraffic(c, x0, z0, minD, maxD) {
  const B = CITY.BLOCKS, h = CITY.ROAD_W / 2;
  for (let tries = 0; tries < 40; tries++) {
    const ni = Math.floor(Math.random() * (B + 1)), nj = Math.floor(Math.random() * (B + 1));
    const d = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)];
    if (!inGrid(ni - d[0], nj - d[1])) continue;
    Object.assign(c, { ni, nj, d, a: lerp(-CITY.PITCH + h + 10, -h - 24, Math.random()), off: Math.random() < 0.5 ? LANE_IN : LANE_OUT, laneYaw: 0 });
    c.offT = c.off;
    poseLane(c);
    const dist = Math.hypot(c.P[0] - x0, c.P[1] - z0);
    if (dist < minD || dist > maxD) continue;
    if (city.traffic.some((o) => o !== c && o.P && Math.hypot(o.P[0] - c.P[0], o.P[1] - c.P[1]) < 12)) continue;
    break;
  }
  Object.assign(c, { state: 'lane', v: c.cruise * 0.8, V: [0, 0], w: 0, knockT: 0, stuck: 0, ignoreT: 0, braking: false });
  chooseTurn(c);
  poseLane(c);
}

function spawnTraffic() {
  city.traffic = [];
  const paint = new THREE.Color();
  for (let k = 0; k < TRAFFIC_N; k++) {
    const c = { k, style: k % TRAFFIC_STYLES.length, idx: Math.floor(k / TRAFFIC_STYLES.length), cruise: 10 + Math.random() * 4, recycleT: Math.random(), P: null };
    c.P = [0, 0];
    placeTraffic(c, player.P[0], player.P[2], 30, 420);
    city.traffic.push(c);
    city.carMeshes[c.style].setColorAt(c.idx, paint.setRGB(...TRAFFIC_PAINT[Math.floor(Math.random() * TRAFFIC_PAINT.length)]));
  }
  // police: a couple on patrol in traffic, the rest parked until they're dispatched
  for (let k = 0; k < POLICE_N; k++) {
    const c = { k: TRAFFIC_N + k, police: true, style: POLICE_STYLE, idx: k, cruise: 11 + Math.random() * 2, recycleT: Math.random(), P: [0, 0] };
    if (k < POLICE_PATROL) placeTraffic(c, player.P[0], player.P[2], 80, 380);
    else parkPolice(c);
    city.traffic.push(c);
  }
  city.carMeshes.forEach((m, s) => { m.count = city.traffic.filter((c) => c.style === s).length; m.instanceColor.needsUpdate = true; });
}

function stepKnocked(c, dt) {
  const k = Math.exp(-1.6 * dt);
  c.V[0] *= k; c.V[1] *= k;
  c.w *= Math.exp(-2.5 * dt);
  c.P[0] += c.V[0] * dt; c.P[1] += c.V[1] * dt;
  c.psi += c.w * dt;
  for (const b of solidsNear(c.P[0], c.P[1], _solids)) {
    if (b.h < 1) continue;
    const qx = clamp(c.P[0], b.x0, b.x1), qz = clamp(c.P[1], b.z0, b.z1), dx = c.P[0] - qx, dz = c.P[1] - qz, d = Math.hypot(dx, dz);
    if (d >= 1.6 || d < 1e-6) continue;
    const nx = dx / d, nz = dz / d, vn = c.V[0] * nx + c.V[1] * nz;
    c.P[0] += nx * (1.6 - d); c.P[1] += nz * (1.6 - d);
    if (vn < 0) { c.V[0] -= nx * vn * 1.3; c.V[1] -= nz * vn * 1.3; }
  }
  c.v = Math.hypot(c.V[0], c.V[1]);
  c.knockT += dt;
}

function stepTraffic(dt) {
  const h = CITY.ROAD_W / 2;
  for (const c of city.traffic) {
    if (c.state === 'off') continue;
    c.recycleT -= dt;
    if (c.recycleT <= 0 && c.state !== 'pursuit') {
      c.recycleT = 1 + Math.random();
      const far = Math.hypot(c.P[0] - player.P[0], c.P[1] - player.P[2]);
      if (far > 340 || (c.state === 'knocked' && c.knockT > 8 && far > 40)) { placeTraffic(c, player.P[0], player.P[2], 120, 300); continue; }
    }
    if (c.state === 'knocked') {
      stepKnocked(c, dt);
      if (c.police && law.stars > 0 && c.knockT > 2) startPursuit(c); // shakes it off and carries on
      continue;
    }
    if (c.state === 'pursuit') {
      // a unit left far behind is radioed back in closer to you
      if (c.recycleT <= 0) { c.recycleT = 2; if (Math.hypot(c.P[0] - player.P[0], c.P[1] - player.P[2]) > 420) deployPolice(c); }
      stepPursuit(c, dt);
      continue;
    }

    let vT = c.state === 'turn' ? 7 : c.cruise;
    if (c.state === 'lane' && c.next !== 'S') vT = Math.min(vT, 7 + Math.max(0, (c.next === 'R' ? -LANE_OUT - RIGHT_R : -h) - c.a) * 0.35);
    const gap = c.ignoreT > 0 ? Infinity : gapAhead(c);
    vT = Math.min(vT, Math.max(0, gap - 2.5) * 0.9);
    // a wreck or the player stopped in our lane: move over if the other lane is free
    const b = c.blocker;
    if (c.state === 'lane' && gap < 12 && b && (b === player || b.state === 'knocked') && c.a < STOP_A - 6) {
      const other = c.offT > CITY.LANE ? LANE_IN : LANE_OUT;
      if (laneClear(c, other)) c.offT = other;
    }
    let held = false;
    if (c.state === 'lane') {
      const dist = STOP_A - c.a;
      if (dist > -0.3) {
        const sig = signalAt(c.ni, c.nj, c.d[0] !== 0, simClock);
        if (sig === 'r' || (sig === 'y' && dist > (c.v * c.v) / 8) || (c.next === 'L' && dist < 4 && oncoming(c))) {
          vT = Math.min(vT, Math.sqrt(10 * Math.max(0, dist)));
          held = true;
        }
      }
    }
    c.braking = vT < c.v - 0.2 || (held && c.v < 0.5);
    c.v = c.v < vT ? Math.min(vT, c.v + 2.8 * dt) : Math.max(vT, c.v - 9 * dt);
    // nose-to-nose standoffs (not at a red light): after a while, creep through
    if (c.v < 0.3 && !held && gap < 6) { c.stuck += dt; if (c.stuck > 5) { c.ignoreT = 1.5; c.stuck = 0; } } else c.stuck = 0;
    c.ignoreT = Math.max(0, c.ignoreT - dt);

    if (c.state === 'lane') {
      c.a += c.v * dt;
      const prev = c.off;
      if (c.off === c.offT || laneClear(c, c.offT)) c.off = approach(c.off, c.offT, 1.3 * dt); // merge only into a gap
      c.laneYaw = Math.atan2((c.off - prev) / dt, Math.max(c.v, 2));
      if (c.next === 'R' && c.a >= -LANE_OUT - RIGHT_R) startTurn(c);
      else if (c.next === 'L' && c.a >= -h) startTurn(c);
      else if (c.next === 'S' && c.a > h + 0.5) { c.ni += c.d[0]; c.nj += c.d[1]; c.a -= CITY.PITCH; chooseTurn(c); }
      if (c.state === 'lane') poseLane(c); else poseTurn(c);
    } else {
      c.phi += c.tdir * (c.v / c.tr) * dt;
      if (c.tdir * c.phi >= 0) { c.phi = 0; poseTurn(c); finishTurn(c); poseLane(c); }
      else poseTurn(c);
    }
  }
}

// Player against traffic: circle pairs along each car. Slow nudges bounce off; real hits knock the car loose
// (police are heavier and take a big hit to stun). Hopping clears them.
function trafficCollide(p) {
  if (p.P[1] > 1.7) return 0;
  let worst = 0;
  const pc = Math.cos(p.psi), ps = Math.sin(p.psi);
  for (const c of city.traffic) {
    const dx0 = p.P[0] - c.P[0], dz0 = p.P[2] - c.P[1];
    if (c.state === 'off' || dx0 * dx0 + dz0 * dz0 > 49) continue;
    const cc = Math.cos(c.psi), cs = Math.sin(c.psi);
    for (const po of [1.4, -1.4]) for (const co of [1.3, -1.3]) {
      const ax = p.P[0] + pc * po, az = p.P[2] + ps * po, bx = c.P[0] + cc * co, bz = c.P[1] + cs * co;
      let nx = ax - bx, nz = az - bz;
      const d = Math.hypot(nx, nz), rs = 2.15;
      if (d >= rs || d < 1e-6) continue;
      nx /= d; nz /= d;
      const knocked = c.state === 'knocked';
      p.P[0] += nx * (rs - d) * (knocked ? 0.6 : 1); p.P[2] += nz * (rs - d) * (knocked ? 0.6 : 1);
      if (knocked) { c.P[0] -= nx * (rs - d) * 0.4; c.P[1] -= nz * (rs - d) * 0.4; }
      const cvx = knocked ? c.V[0] : cc * c.v, cvz = knocked ? c.V[1] : cs * c.v;
      const vrel = (p.V[0] - cvx) * nx + (p.V[2] - cvz) * nz;
      if (vrel >= 0) continue;
      const cop = c.police && !knocked;
      if (!knocked && vrel > (cop ? -14 : -2)) {
        p.V[0] -= nx * vrel * 1.2; p.V[2] -= nz * vrel * 1.2;
        if (cop) {
          c.v *= 0.85;
          worst = Math.max(worst, -vrel);
          if (p.V[0] * nx + p.V[2] * nz < -4 && c.state !== 'pursuit') report('police'); // you drove into a patrol car
        }
        continue;
      }
      if (!knocked) {
        c.state = 'knocked'; c.V = [cvx, cvz]; c.w = 0; c.knockT = 0; c.braking = true; c.laneYaw = 0;
        if (!c.police) { if (p.V[0] * nx + p.V[2] * nz < -2) report('crash'); } // you hit them, not the other way round
        else if (p.V[0] * nx + p.V[2] * nz < -4) report('police'); // only if you were the one ramming
      }
      const j = (-1.2 * vrel) / (1 + 1 / 1.3);
      p.V[0] += nx * j; p.V[2] += nz * j;
      c.V[0] -= (nx * j) / 1.3; c.V[1] -= (nz * j) / 1.3;
      c.w = clamp(c.w + ((bx - c.P[0]) * -nz + (bz - c.P[1]) * nx) * j * 0.05, -3, 3);
      p.psi = wrapAngle(p.psi + clamp(((ax - p.P[0]) * nz - (az - p.P[2]) * nx) * j * 0.012, -0.3, 0.3));
      worst = Math.max(worst, -vrel);
    }
  }
  if (worst > 0) {
    if (worst > 6) { shake = Math.max(shake, 0.3 + Math.min(0.9, worst * 0.03)); rumble(0.8, 0.7, 220, true); audio.thud(0.25 + Math.min(0.4, worst * 0.015)); }
    else rumble(0.3, 0.4, 100);
    if (p.mode !== 'air') { const R = cityPose(p); p.u = dot(p.V, p.F); p.v = dot(p.V, R); }
  }
  return worst;
}

const _tm = new THREE.Matrix4(), _tq = new THREE.Quaternion(), _tp = new THREE.Vector3(), _ts = new THREE.Vector3(1, 1, 1), _ty = new THREE.Vector3(0, 1, 0);
const _tc = new THREE.Color(), _hide = new THREE.Matrix4().makeScale(0, 0, 0);
function syncTraffic() {
  const lamps = city.policeLamps, flash = Math.floor(performance.now() / 110) % 2;
  for (const c of city.traffic) {
    if (c.state === 'off') {
      city.carMeshes[c.style].setMatrixAt(c.idx, _hide);
      if (c.police) { lamps.setMatrixAt(c.idx * 2, _hide); lamps.setMatrixAt(c.idx * 2 + 1, _hide); }
      continue;
    }
    _tm.compose(_tp.set(c.P[0], 0, c.P[1]), _tq.setFromAxisAngle(_ty, -c.psi), _ts);
    city.carMeshes[c.style].setMatrixAt(c.idx, _tm);
    if (!c.police) continue;
    // light bar: alternating red / blue while chasing, with a puff of additive glow
    const on = c.state === 'pursuit' || (c.state === 'knocked' && law.stars > 0);
    POLICE_BAR.forEach(([lx, ly, lz], li) => {
      const lit = on && li === flash;
      _tp.set(lx, ly, lz).applyMatrix4(_tm);
      lamps.setMatrixAt(c.idx * 2 + li, _pl.makeTranslation(lx, ly, lz).premultiply(_tm));
      lamps.setColorAt(c.idx * 2 + li, lit ? _tc.setRGB(...(li ? [0.25, 0.55, 5] : [5, 0.25, 0.18])) : _tc.setRGB(...(li ? [0.05, 0.08, 0.35] : [0.35, 0.05, 0.05])));
      if (lit && Math.random() < 0.7) emit([_tp.x, _tp.y, _tp.z], [Math.cos(c.psi) * c.v, 0.3, Math.sin(c.psi) * c.v], 0.1, li ? [0.35, 0.55, 1.6] : [1.6, 0.35, 0.3]);
    });
  }
  for (const m of city.carMeshes) m.instanceMatrix.needsUpdate = true;
  lamps.instanceMatrix.needsUpdate = true;
  lamps.instanceColor.needsUpdate = true;
}

// ---------- city pedestrians: walk round the block sidewalks, cross at crosswalks on the walk phase ----------
// A pedestrian walks from block corner `from` to `to` (corners 0..3 = x0z0, x1z0, x1z1, x0z1, inset 2 m
// into the sidewalk, which lines up with the crosswalk stripes). At a corner they may wait and cross.
const PED_N = 70;
const PED_SHIRT = [[0.85, 0.2, 0.18], [0.2, 0.4, 0.75], [0.95, 0.85, 0.3], [0.25, 0.6, 0.35], [0.9, 0.9, 0.88], [0.15, 0.15, 0.17], [0.6, 0.3, 0.6], [0.95, 0.55, 0.2]];
const PED_PANTS = [[0.15, 0.18, 0.3], [0.25, 0.25, 0.27], [0.45, 0.35, 0.25], [0.1, 0.1, 0.1], [0.55, 0.55, 0.5]];
const PED_SKIN = [[0.95, 0.78, 0.65], [0.82, 0.62, 0.48], [0.6, 0.42, 0.3], [0.4, 0.27, 0.2]];
// for each corner, its two crossings: [block di, dj, arrival corner, crosses a road along x]
const PED_CROSS = [
  [[0, -1, 3, true], [-1, 0, 1, false]],
  [[0, -1, 2, true], [1, 0, 0, false]],
  [[0, 1, 1, true], [1, 0, 3, false]],
  [[0, 1, 0, true], [-1, 0, 2, false]],
];
const PED_NODE = [[0, 0], [1, 0], [1, 1], [0, 1]]; // corner → its junction, relative to the block's (bi, bj)
const inBlocks = (i, j) => i >= 0 && j >= 0 && i < CITY.BLOCKS && j < CITY.BLOCKS;

function pedCorner(bi, bj, k) {
  const b = city.blocks[bi * CITY.BLOCKS + bj];
  return [k === 0 || k === 3 ? b.x0 + 2 : b.x1 - 2, k < 2 ? b.z0 + 2 : b.z1 - 2];
}
// where the route puts the pedestrian, and the direction it runs
function pedRoute(q) {
  let a, b, t;
  if (q.mode === 'cross') { a = q.ca; b = q.cb; t = q.u / q.len; }
  else {
    a = pedCorner(q.bi, q.bj, q.from); b = pedCorner(q.bi, q.bj, q.to);
    t = q.mode === 'walk' ? q.u / Math.hypot(b[0] - a[0], b[1] - a[1]) : 1;
  }
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  return [lerp(a[0], b[0], t) - (dz / l) * q.lat, lerp(a[1], b[1], t) + (dx / l) * q.lat, dx / l, dz / l];
}

function placePed(q, x0, z0, minD, maxD) {
  const B = CITY.BLOCKS;
  q.mode = 'walk';
  for (let tries = 0; tries < 40; tries++) {
    q.bi = Math.floor(Math.random() * B); q.bj = Math.floor(Math.random() * B);
    q.from = Math.floor(Math.random() * 4); q.dir = Math.random() < 0.5 ? 1 : -1; q.to = (q.from + q.dir + 4) % 4;
    const a = pedCorner(q.bi, q.bj, q.from), b = pedCorner(q.bi, q.bj, q.to);
    q.u = Math.random() * Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [x, z] = pedRoute(q), d = Math.hypot(x - x0, z - z0);
    if (d >= minD && d <= maxD) break;
  }
  const [x, z, hx, hz] = pedRoute(q);
  Object.assign(q, { P: [x, CITY.CURB, z], hd: Math.atan2(hz, hx), push: [0, 0], pushV: [0, 0], waitT: 0, dodgeT: 0, ang: 0, V: [0, 0, 0] });
}

function spawnPeds() {
  const m = city.pedMeshes, col = new THREE.Color(), pick = (a) => a[Math.floor(Math.random() * a.length)];
  city.peds = [];
  for (let k = 0; k < PED_N; k++) {
    const q = { k, speed: 1.1 + Math.random() * 0.6, lat: (Math.random() - 0.5) * 1.6, jay: Math.random() < 0.08, phase: Math.random() * 6, recycleT: Math.random() * 2 };
    placePed(q, player.P[0], player.P[2], 12, 200);
    city.peds.push(q);
    m.torso.setColorAt(k, col.setRGB(...pick(PED_SHIRT)));
    m.head.setColorAt(k, col.setRGB(...pick(PED_SKIN)));
    col.setRGB(...pick(PED_PANTS));
    m.legs.setColorAt(k * 2, col); m.legs.setColorAt(k * 2 + 1, col);
  }
  for (const mesh of [m.torso, m.head, m.legs]) { mesh.count = mesh === m.legs ? PED_N * 2 : PED_N; mesh.instanceColor.needsUpdate = true; }
}

function stepPeds(dt) {
  for (const q of city.peds) {
    const g = cityGround(q.P[0], q.P[2]);
    if (q.mode === 'tumble') {
      q.V[1] -= G * dt;
      for (const b of solidsNear(q.P[0], q.P[2], _solids)) {
        if (b.h > 2 && q.P[0] > b.x0 - 0.3 && q.P[0] < b.x1 + 0.3 && q.P[2] > b.z0 - 0.3 && q.P[2] < b.z1 + 0.3) { q.V[0] *= -0.2; q.V[2] *= -0.2; break; }
      }
      q.P[0] += q.V[0] * dt; q.P[1] += q.V[1] * dt; q.P[2] += q.V[2] * dt;
      q.ang += q.angV * dt;
      if (q.P[1] <= g - 0.75 && q.V[1] < 0) {
        q.P[1] = g - 0.75; q.mode = 'down'; q.downT = 0;
        q.angT = Math.round((q.ang - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2; // flat on back or front
      }
      continue;
    }
    if (q.mode === 'down') {
      const k = Math.exp(-5 * dt);
      q.V[0] *= k; q.V[2] *= k;
      q.P[0] += q.V[0] * dt; q.P[2] += q.V[2] * dt;
      q.ang = approach(q.ang, q.angT, dt * 7);
      q.downT += dt;
      if (q.downT > 2.8) { q.mode = 'getup'; q.angT = Math.round(q.ang / (Math.PI * 2)) * Math.PI * 2; }
      continue;
    }
    if (q.mode === 'getup') {
      q.ang = approach(q.ang, q.angT, dt * 2.5);
      q.P[1] = approach(q.P[1], g, dt * 1.2);
      if (q.ang === q.angT && q.P[1] === g) {
        q.ang = 0;
        q.mode = q.resume;
        const [x, z] = pedRoute(q);
        q.push = [q.P[0] - x, q.P[2] - z]; // dust off and walk back to the route
      }
      continue;
    }

    q.recycleT -= dt;
    if (q.recycleT <= 0) {
      q.recycleT = 1.5 + Math.random();
      if (Math.hypot(q.P[0] - player.P[0], q.P[2] - player.P[2]) > 230) { placePed(q, player.P[0], player.P[2], 70, 190); continue; }
    }
    let moving = true;
    if (q.mode === 'walk') {
      const a = pedCorner(q.bi, q.bj, q.from), b = pedCorner(q.bi, q.bj, q.to);
      q.u += q.speed * dt;
      if (q.u >= Math.hypot(b[0] - a[0], b[1] - a[1])) {
        // at the corner: cross a street now and then, otherwise carry on round the block
        const opts = PED_CROSS[q.to].filter(([di, dj]) => inBlocks(q.bi + di, q.bj + dj));
        if (opts.length && Math.random() < 0.35) { q.cross = opts[Math.floor(Math.random() * opts.length)]; q.mode = 'wait'; q.waitT = 0; }
        else { q.from = q.to; q.to = (q.to + q.dir + 4) % 4; q.u = 0; }
      }
    } else if (q.mode === 'wait') {
      moving = false;
      const [di, dj, tk, alongX] = q.cross, node = PED_NODE[q.to];
      q.waitT += dt;
      if (q.jay ? q.waitT > 1.5 : walkSignal(q.bi + node[0], q.bj + node[1], alongX, simClock)) {
        q.ca = pedCorner(q.bi, q.bj, q.to); q.cb = pedCorner(q.bi + di, q.bj + dj, tk);
        q.len = Math.hypot(q.cb[0] - q.ca[0], q.cb[1] - q.ca[1]); q.u = 0; q.mode = 'cross';
      } else if (q.waitT > 10) { q.mode = 'walk'; q.from = q.to; q.to = (q.to + q.dir + 4) % 4; q.u = 0; }
    } else if (q.mode === 'cross') {
      q.u += q.speed * 1.15 * dt;
      if (q.u >= q.len) {
        const [di, dj, tk] = q.cross;
        q.bi += di; q.bj += dj; q.from = tk; q.dir = Math.random() < 0.5 ? 1 : -1; q.to = (tk + q.dir + 4) % 4; q.u = 0; q.mode = 'walk';
      }
    }

    // startle: a fast car bearing down within about a second → most jump out of its path
    q.dodgeT -= dt;
    if (player.P[1] < 1.5 && q.dodgeT <= 0) {
      const vx = player.V[0], vz = player.V[2], sp = Math.hypot(vx, vz);
      const rx = q.P[0] - player.P[0], rz = q.P[2] - player.P[2];
      const along = (rx * vx + rz * vz) / (sp || 1), lat = (rz * vx - rx * vz) / (sp || 1);
      if (sp > 6 && along > 0 && along < sp * 0.9 && Math.abs(lat) < 2.4) {
        q.dodgeT = 1.5;
        if (Math.random() < 0.65) { const s = (Math.sign(lat) || 1) * 5 / sp; q.pushV = [-vz * s, vx * s]; }
      }
    }
    q.push[0] += q.pushV[0] * dt; q.push[1] += q.pushV[1] * dt;
    const kv = Math.exp(-4 * dt);
    q.pushV[0] *= kv; q.pushV[1] *= kv;
    const pl = Math.hypot(q.push[0], q.push[1]);
    if (pl > 0) { const s = approach(pl, 0, q.speed * dt) / pl; q.push[0] *= s; q.push[1] *= s; }

    const [x, z, hx, hz] = pedRoute(q);
    const nx = x + q.push[0], nz = z + q.push[1], mx = nx - q.P[0], mz = nz - q.P[2];
    if (Math.hypot(mx, mz) > 0.3 * dt) q.hd = Math.atan2(mz, mx);
    else if (!moving) q.hd = Math.atan2(hz, hx);
    q.P[0] = nx; q.P[2] = nz;
    q.P[1] = approach(q.P[1], cityGround(nx, nz), dt * 2);
    if (moving || pl > 0.05) q.phase += q.speed * dt * 5.5;
  }
}

// Player against pedestrians: a crawl nudges them aside, anything faster knocks them flying (cartoon
// tumble, they lie there a moment, then get up and walk it off). Hopping clears them.
function pedCollide(p) {
  if (p.P[1] > 1.2) return;
  const sp = Math.hypot(p.V[0], p.V[2]), c = Math.cos(p.psi), s = Math.sin(p.psi);
  for (const q of city.peds) {
    if (q.mode === 'tumble' || q.mode === 'down' || q.mode === 'getup') continue;
    const dx = q.P[0] - p.P[0], dz = q.P[2] - p.P[2];
    if (dx * dx + dz * dz > 16) continue;
    for (const off of [1.4, -1.4]) {
      let nx = q.P[0] - (p.P[0] + c * off), nz = q.P[2] - (p.P[2] + s * off);
      const d = Math.hypot(nx, nz);
      if (d >= 1.35) continue;
      nx /= d || 1; nz /= d || 1;
      if (sp < 2.5) { q.push[0] += nx * (1.35 - d); q.push[1] += nz * (1.35 - d); break; }
      const k = Math.min(1, 14 / sp) * 0.75;
      q.resume = q.mode;
      q.mode = 'tumble';
      q.V = [p.V[0] * k + nx * 2, clamp(2.5 + sp * 0.1, 3, 8), p.V[2] * k + nz * 2];
      q.hd = Math.atan2(-p.V[2], -p.V[0]); // facing the car, so the tumble goes over backwards
      q.angV = 7 + Math.random() * 5;
      p.pedHits++;
      p.V[0] *= 0.96; p.V[2] *= 0.96;
      if (p.mode !== 'air') { const R = cityPose(p); p.u = dot(p.V, p.F); p.v = dot(p.V, R); }
      shake = Math.max(shake, 0.25); rumble(0.4, 0.6, 140, true); audio.thud(0.18);
      report('ped');
      break;
    }
  }
}

const _pr = new THREE.Matrix4(), _pl = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _pz = new THREE.Vector3(0, 0, 1);
function syncPeds() {
  const m = city.pedMeshes;
  for (const q of city.peds) {
    // root: pivot about the body centre (1 m up) for heading and tumble, feet at q.P when upright
    _pr.makeTranslation(q.P[0], q.P[1] + 1, q.P[2])
      .multiply(_pl.makeRotationY(-q.hd))
      .multiply(_pl.makeRotationZ(q.ang))
      .multiply(_pl.makeTranslation(0, -1, 0));
    m.torso.setMatrixAt(q.k, _pr);
    m.head.setMatrixAt(q.k, _pr);
    const swing = q.mode === 'walk' || q.mode === 'cross' || Math.hypot(q.push[0], q.push[1]) > 0.05 ? Math.sin(q.phase) * 0.55 : 0;
    for (const side of [-1, 1]) {
      _pl.compose(_tp.set(0, 0.92, side * 0.11), _pq.setFromAxisAngle(_pz, swing * side), _ts);
      m.legs.setMatrixAt(q.k * 2 + (side > 0 ? 1 : 0), _pl.premultiply(_pr));
    }
  }
  for (const mesh of [m.torso, m.head, m.legs]) mesh.instanceMatrix.needsUpdate = true;
}

// ---------- city law: offences seen by police raise the wanted level; police chase and try to box you in ----------
const SPEED_LIMIT = 35 / MPH; // posted everywhere downtown
// needsCop: only counts if a police car can see you; hits are always called in by witnesses.
// heat accumulates: the first offence makes you wanted (1★), each star after that takes more.
const OFFENCES = {
  speeding: { name: 'Speeding', heat: 0.4, needsCop: true, fine: 150 },
  reckless: { name: 'Reckless speed', heat: 0.8, needsCop: true, fine: 600 },
  red: { name: 'Ran a red light', heat: 0.6, needsCop: true, fine: 250 },
  sidewalk: { name: 'Driving on the sidewalk', heat: 0.5, needsCop: true, fine: 300 },
  wrongway: { name: 'Wrong way', heat: 0.5, needsCop: true, fine: 200 },
  flight: { name: 'Illegal flight', heat: 1.5, needsCop: true, fine: 1000 },
  crash: { name: 'Hit a car', heat: 0.7, needsCop: false, fine: 400 },
  ped: { name: 'Hit a pedestrian', heat: 1.5, needsCop: false, fine: 2000 },
  police: { name: 'Rammed a police car', heat: 1, needsCop: false, fine: 800 },
};
const PURSUERS = [0, 1, 2, 3, 4, 6]; // units hunting you at each star level
const POLICE_PATROL = 2;
const POLICE_VMAX = 40; // ≈ 90 mph: the Roadster can outrun them on a straight, not round corners
const freshLaw = () => ({ heat: 0, stars: 0, maxStars: 0, seen: false, hunterSees: false, unseenT: 0, bustT: 0, tickT: 0, cool: {}, counts: {}, fines: 0, runT: 0, sidewalkT: 0, wrongT: 0, wasJunction: false, lastBand: null, flew: false, siren: 0 });
const law = freshLaw();

function report(kind) {
  const o = OFFENCES[kind];
  if (!player || player.finished || (o.needsCop && !law.seen) || law.cool[kind] > 0) return;
  law.cool[kind] = 8;
  law.counts[kind] = (law.counts[kind] || 0) + 1;
  law.fines += o.fine;
  const before = law.stars;
  law.heat = Math.min(5.99, Math.max(law.heat + o.heat, 1));
  law.stars = Math.floor(law.heat);
  law.maxStars = Math.max(law.maxStars, law.stars);
  law.unseenT = 0;
  toast(`${o.name}${law.stars > before ? '  ' + '★'.repeat(law.stars) : ''}`, 'warn');
  dispatchPolice();
}

// a clear view at car height: no building in the way (sampled every 5 m)
const _losSolids = [];
function cityLineClear(x0, z0, x1, z1) {
  const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 5);
  for (let s = 1; s < n; s++) {
    const x = lerp(x0, x1, s / n), z = lerp(z0, z1, s / n);
    for (const b of solidsNear(x, z, _losSolids)) if (b.h > 3 && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return false;
  }
  return true;
}

function parkPolice(c) {
  Object.assign(c, { state: 'off', P: [1e5, 1e5], psi: 0, v: 0, V: [0, 0], w: 0, knockT: 0, braking: false, sees: false });
}
function startPursuit(c) {
  Object.assign(c, { state: 'pursuit', laneYaw: 0, reverseT: 0, stuckT: 0, direct: false, braking: false, vT: 10 });
  if (Math.abs(c.v) < 0.1 && c.V) c.v = Math.hypot(c.V[0], c.V[1]);
  chaseSegment(c);
}
// bring a parked unit in at a junction 150–240 m away, out of sight if possible
function deployPolice(c) {
  const p = player;
  let ni = 0, nj = 0;
  for (let tries = 0; tries < 40; tries++) {
    ni = Math.floor(Math.random() * (CITY.BLOCKS + 1)); nj = Math.floor(Math.random() * (CITY.BLOCKS + 1));
    const x = roadLine(ni), z = roadLine(nj), d = Math.hypot(x - p.P[0], z - p.P[2]);
    if (d > 150 && d < 240 && (tries > 30 || !cityLineClear(x, z, p.P[0], p.P[2]))) break;
  }
  Object.assign(c, { ni, nj, P: [roadLine(ni), roadLine(nj)], psi: Math.atan2(p.P[2] - roadLine(nj), p.P[0] - roadLine(ni)), v: 12, V: [0, 0], w: 0 });
  startPursuit(c);
}
function dispatchPolice() {
  if (!law.stars) return;
  const want = PURSUERS[law.stars];
  const cops = city.traffic.filter((c) => c.police);
  let hunting = cops.filter((c) => c.state === 'pursuit' || c.state === 'knocked').length;
  const patrol = (c) => c.state === 'lane' || c.state === 'turn';
  for (const c of cops) if (hunting < want && patrol(c) && c.sees) { startPursuit(c); hunting++; }
  for (const c of cops) if (hunting < want && c.state === 'off') { deployPolice(c); hunting++; }
  for (const c of cops) if (hunting < want && patrol(c)) { startPursuit(c); hunting++; } // radioed in
}
function endPursuit() {
  let patrols = 0;
  for (const c of city.traffic) {
    if (!c.police || c.state === 'lane' || c.state === 'turn') { if (c.police && c.state !== 'off') patrols++; continue; }
    if (patrols < POLICE_PATROL) { placeTraffic(c, player.P[0], player.P[2], 150, 300); patrols++; }
    else parkPolice(c);
  }
}

// Pursuit driving: head straight for you (with a little lead) when they can see you up close,
// otherwise follow the streets segment by segment (prev → next junction), keeping right, toward you.
function nextChaseNode(c) {
  let bd = Infinity;
  const ci = c.ni, cj = c.nj;
  c.pi = ci; c.pj = cj;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const i = ci + dx, j = cj + dz;
    if (!inGrid(i, j)) continue;
    const d = Math.hypot(roadLine(i) - player.P[0], roadLine(j) - player.P[2]);
    if (d < bd) { bd = d; c.ni = i; c.nj = j; }
  }
}
// put the unit on the nearest street segment, heading for whichever end is nearer to you
function chaseSegment(c) {
  const B = CITY.BLOCKS, fi = (c.P[0] - CITY.MIN) / CITY.PITCH, fj = (c.P[1] - CITY.MIN) / CITY.PITCH;
  const ri = clamp(Math.round(fi), 0, B), rj = clamp(Math.round(fj), 0, B);
  let a, b;
  if (Math.abs(c.P[1] - roadLine(rj)) < Math.abs(c.P[0] - roadLine(ri))) { const i0 = clamp(Math.floor(fi), 0, B - 1); a = [i0, rj]; b = [i0 + 1, rj]; }
  else { const j0 = clamp(Math.floor(fj), 0, B - 1); a = [ri, j0]; b = [ri, j0 + 1]; }
  const da = Math.hypot(roadLine(a[0]) - player.P[0], roadLine(a[1]) - player.P[2]);
  const db = Math.hypot(roadLine(b[0]) - player.P[0], roadLine(b[1]) - player.P[2]);
  const [prev, next] = da < db ? [b, a] : [a, b];
  [c.pi, c.pj] = prev; [c.ni, c.nj] = next;
}
function stepPursuit(c, dt) {
  const p = player;
  const dist = Math.hypot(p.P[0] - c.P[0], p.P[2] - c.P[1]);
  let tx, tz;
  if (c.sees && dist < 60) {
    const lead = Math.min(0.8, dist / 40);
    tx = p.P[0] + p.V[0] * lead; tz = p.P[2] + p.V[2] * lead;
    c.direct = true;
  } else {
    if (c.direct) { c.direct = false; chaseSegment(c); }
    let ax = roadLine(c.pi), az = roadLine(c.pj), sx = roadLine(c.ni) - ax, sz = roadLine(c.nj) - az, L = Math.hypot(sx, sz);
    let t = (c.P[0] - ax) * (sx / L) + (c.P[1] - az) * (sz / L);
    if (t > L - 3) { // at the junction: pick the next street
      nextChaseNode(c);
      ax = roadLine(c.pi); az = roadLine(c.pj); sx = roadLine(c.ni) - ax; sz = roadLine(c.nj) - az; L = Math.hypot(sx, sz);
      t = (c.P[0] - ax) * (sx / L) + (c.P[1] - az) * (sz / L);
    }
    // pure pursuit on the street's right-hand lane, 14 m ahead of where we are along it
    const ux = sx / L, uz = sz / L, look = Math.min(L, Math.max(0, t) + 14);
    tx = ax + ux * look - uz * LANE_IN; tz = az + uz * look + ux * LANE_IN;
  }
  const err = wrapAngle(Math.atan2(tz - c.P[1], tx - c.P[0]) - c.psi);
  if (c.reverseT > 0) {
    // backing out of a wall: reverse while swinging the nose toward the target
    c.reverseT -= dt;
    c.v = approach(c.v, -6, 15 * dt);
    c.psi = wrapAngle(c.psi - clamp(err, -1, 1) * 1.2 * dt);
  } else {
    const yawMax = 9 / Math.max(Math.abs(c.v), 5);
    c.psi = wrapAngle(c.psi + clamp(err * 2.5, -yawMax, yawMax) * dt);
    const a = Math.abs(err), mine = Math.hypot(p.V[0], p.V[2]);
    // close in, then match your speed; pull up beside you when you stop. From 3★ they ram you while you run.
    const close = law.stars >= 3 && mine > 6 ? Math.max(mine + 4, 10) : dist < 8 ? Math.max(0, mine - 1) : Math.max(mine + 4, 6);
    const vT = a > 1.2 ? 8 : a > 0.5 ? 18 : c.direct && dist < 15 ? close : POLICE_VMAX;
    c.v = c.v < vT ? Math.min(vT, c.v + 11 * dt) : Math.max(vT, c.v - 16 * dt);
    c.vT = vT;
  }
  c.braking = c.v < 0;
  c.P[0] += Math.cos(c.psi) * c.v * dt; c.P[1] += Math.sin(c.psi) * c.v * dt;
  let walled = false;
  for (const b of solidsNear(c.P[0], c.P[1], _solids)) {
    if (b.h < 1) continue;
    const qx = clamp(c.P[0], b.x0, b.x1), qz = clamp(c.P[1], b.z0, b.z1), dx = c.P[0] - qx, dz = c.P[1] - qz, d = Math.hypot(dx, dz);
    if (d >= 1.7 || d < 1e-6) continue;
    c.P[0] += (dx / d) * (1.7 - d); c.P[1] += (dz / d) * (1.7 - d);
    walled = true;
  }
  if (walled) c.v *= 0.9;
  if (Math.abs(c.v) < 1.5 && c.reverseT <= 0 && c.vT > 4) { c.stuckT += dt; if (c.stuckT > 1.2) { c.reverseT = 1.1; c.stuckT = 0; } } else c.stuckT = 0;
  // shove civilians out of the way; keep clear of other units
  for (const o of city.traffic) {
    if (o === c || o.state === 'off') continue;
    const dx = o.P[0] - c.P[0], dz = o.P[1] - c.P[1], d = Math.hypot(dx, dz);
    if (d > 3.6 || d < 1e-6) continue;
    const nx = dx / d, nz = dz / d, push = 3.6 - d;
    if (o.police && o.state === 'pursuit') { o.P[0] += nx * push * 0.5; o.P[1] += nz * push * 0.5; c.P[0] -= nx * push * 0.5; c.P[1] -= nz * push * 0.5; continue; }
    if (o.state !== 'knocked') { o.state = 'knocked'; o.V = [Math.cos(o.psi) * o.v, Math.sin(o.psi) * o.v]; o.w = 0; o.knockT = 0; o.laneYaw = 0; }
    o.V[0] += nx * (2 + Math.abs(c.v) * 0.3); o.V[1] += nz * (2 + Math.abs(c.v) * 0.3);
    o.w += (Math.random() - 0.5) * 2;
    c.v *= 0.9;
  }
  c.V = [Math.cos(c.psi) * c.v, Math.sin(c.psi) * c.v];
}

// 10 Hz: who can see you, which rules you're breaking, losing the police, getting boxed in
function lawTick(p, dt) {
  for (const k in law.cool) law.cool[k] -= dt;
  law.seen = false; law.hunterSees = false;
  let near = Infinity;
  for (const c of city.traffic) {
    if (!c.police) continue;
    c.sees = false;
    if (c.state === 'off' || c.state === 'knocked') continue;
    const d = Math.hypot(p.P[0] - c.P[0], p.P[2] - c.P[1]), hunting = c.state === 'pursuit';
    if (d < (hunting ? 140 : 70) && cityLineClear(c.P[0], c.P[1], p.P[0], p.P[2])) {
      c.sees = law.seen = true;
      if (hunting) law.hunterSees = true;
    }
    if (hunting) near = Math.min(near, d);
  }
  law.siren = near < Infinity ? clamp(1 - near / 260, 0, 1) : 0;
  if (p.finished) return;

  const sp = Math.hypot(p.V[0], p.V[2]);
  if (p.mode === 'air') {
    if (!law.flew && law.seen) { law.flew = true; report('flight'); }
  } else {
    law.flew = false;
    if (sp > 90 / MPH) report('reckless');
    else if (sp > SPEED_LIMIT + 15 / MPH) report('speeding');
    const driving = input.throttle > 0.1 || p.boosting; // being shoved onto the curb by a cruiser isn't on you
    law.sidewalkT = cityGround(p.P[0], p.P[2]) > 0 && sp > 2 && driving ? law.sidewalkT + dt : 0;
    if (law.sidewalkT > 0.4) report('sidewalk');
    // wrong way: pointing along a road while in its left-hand lanes
    const bx = cityBand(p.P[0]), bz = cityBand(p.P[2]), c = Math.cos(p.psi), s = Math.sin(p.psi);
    const lineX = roadLine(Math.round((p.P[0] - CITY.MIN) / CITY.PITCH)), lineZ = roadLine(Math.round((p.P[2] - CITY.MIN) / CITY.PITCH));
    let wrong = false;
    if (bz === 0 && bx === 1 && Math.abs(c) > 0.7) wrong = Math.sign(c) * (p.P[2] - lineZ) < -0.8; // heading +x keeps to +z
    if (bx === 0 && bz === 1 && Math.abs(s) > 0.7) wrong = Math.sign(s) * (p.P[0] - lineX) > 0.8; // heading +z keeps to −x
    law.wrongT = wrong && sp > 3 && driving ? law.wrongT + dt : 0;
    if (law.wrongT > 1.5) report('wrongway');
    // red light: rolling into a junction off a road whose signal is red
    const inJ = bx === 0 && bz === 0;
    if (inJ && !law.wasJunction && law.lastBand && sp > 3) {
      const i = Math.round((p.P[0] - CITY.MIN) / CITY.PITCH), j = Math.round((p.P[2] - CITY.MIN) / CITY.PITCH);
      if (signalAt(i, j, law.lastBand === 'x', simClock) === 'r') report('red');
    }
    law.wasJunction = inJ;
    if (bz === 0 && bx === 1) law.lastBand = 'x';
    else if (bx === 0 && bz === 1) law.lastBand = 'z';
  }

  if (law.stars > 0) {
    law.runT += dt;
    dispatchPolice();
    law.unseenT = law.hunterSees ? 0 : law.unseenT + dt;
    if (law.unseenT > escapeTime()) {
      law.stars--; law.heat = law.stars; law.unseenT = 0;
      toast(law.stars ? `Losing them…  ${'★'.repeat(law.stars)}` : 'You lost the police', 'good');
      if (!law.stars) endPursuit();
    }
    // stopped with a unit right on you: they're making the arrest
    const boxed = p.mode !== 'air' && sp < 2.5 && near < 9;
    law.bustT = boxed ? law.bustT + dt : Math.max(0, law.bustT - dt * 0.5);
    if (law.bustT > 2.5) {
      p.finished = true; finishTimer = 2.2;
      toast('BUSTED', 'big');
      rumble(1, 1, 500, true); audio.thud(0.5);
    }
  } else law.bustT = 0;
}
const escapeTime = () => 8 + 2 * law.stars; // seconds out of every hunter's sight to drop a star

function stepPlayer(p, inp, dt) {
  if (p.offCourse > 0) {
    p.offCourse -= dt;
    if (p.offCourse <= 0) { p.resetCooldown = 0; resetToTrack(p, true); }
    return;
  }
  gasLogic(p, inp, dt);
  if (p.city) (p.mode === 'air' ? stepCityAir : stepStreet)(p, inp, dt);
  else if (p.mode === 'track') stepTrack(p, inp, dt);
  else stepAir(p, inp, dt);
  p.steerVis = approach(p.steerVis, inp.steer, dt * 8);
  p.peakG = Math.max(p.peakG, Math.hypot(p.gLong, p.gLat));
  if (p.resetCooldown > 0) p.resetCooldown -= dt;

  const sp = vlen(p.V);
  if (sp < 0.4 && p.mode !== 'air') p.launchStart = simClock;
  else if (p.launchStart != null && sp >= MPH60) {
    const t = simClock - p.launchStart;
    p.launchStart = null;
    if (t < 6) {
      p.last060 = t;
      let msg = `0–60 mph in ${t.toFixed(2)} s`;
      if (p.best060 == null || t < p.best060) { p.best060 = t; store.set('z60.' + p.trim.id, t); msg += ' · personal best'; }
      toast(msg, 'good');
    }
  }
}

function poseRival(r) {
  const f = frameAt(r.d);
  r.P = madd(f.P, f.R, r.off);
  r.F = f.T.slice();
  r.Up = f.U.slice();
  r.s = wrapS(r.d);
}

function stepRival(r, dt) {
  let target = profileAt(r.d + 6 + r.v * 0.3) * r.skill * r.rubber;
  const here = Math.floor(wrapS(r.d));
  const j = jumpAt(here);
  if (j && here >= j.kick) target = j.v;
  if (r.finishTime != null) target = Math.min(target, 38);
  target = Math.min(target, r.vmax * r.skill);

  if (player && state !== 'title') {
    if (player.mode === 'track') {
      const gap = wrapD(player.s - r.d);
      if (gap > 0 && gap < 16 && Math.abs(player.lat - r.off) < 3.6) {
        r.avoid = player.lat > r.off ? -1 : 1;
        if (gap < 9) target = Math.min(target, Math.max(0, player.u) * 0.98);
      }
    }
    if (mode === 'race' && r.finishTime == null) {
      const lead = r.d - playerProgress();
      const tgt = lead > 150 ? 0.95 : lead < -220 ? 1.06 : lead < -70 ? 1.02 : 1;
      r.rubber = approach(r.rubber, tgt, dt * 0.05);
    }
  }

  r.braking = r.v > target + 0.5;
  if (j && here >= j.s0 && here < j.s1) r.v = j.v;
  else if (r.v < target) r.v = Math.min(target, r.v + r.acc * Math.max(0.2, 1 - (r.v / r.vmax) ** 2) * dt);
  else r.v = Math.max(target, r.v - r.brake * dt);
  r.d += r.v * dt;

  let want = clamp(r.lane * 0.35 + Math.sin(r.d / 160 + r.phase) * 2.5 + r.avoid * 4, -HALF_W + 1.6, HALF_W - 1.6);
  for (const ob of track.feat.obstacles) {
    const ahead = wrapD(ob.s0 - r.d);
    if (ahead < -3 || ahead > 70) continue;
    const lo = -HALF_W + 1.4, hi = HALF_W - 1.4;
    const leftGap = ob.lat0 - 1.2 - lo, rightGap = hi - (ob.lat1 + 1.2);
    want = leftGap > rightGap ? (lo + ob.lat0 - 1.2) / 2 : (ob.lat1 + 1.2 + hi) / 2;
    break;
  }
  r.avoid = approach(r.avoid, 0, dt * 0.6);
  r.off = approach(r.off, want, dt * 5);
  poseRival(r);

  if (state !== 'title' && mode === 'race' && r.finishTime == null && r.d >= RACE_LAPS * L) {
    r.finishTime = raceTime - (r.d - RACE_LAPS * L) / Math.max(r.v, 1);
  }
}

function collide() {
  const p = player;
  if (!p || p.mode !== 'track') return;
  for (const r of rivals) {
    const ds = wrapD(p.s - r.s);
    const dl = p.lat - r.off;
    if (Math.abs(ds) > 4.4 || Math.abs(dl) > 2.1) continue;
    const c = Math.cos(p.psi), s = Math.sin(p.psi);
    let vs = p.u * c - p.v * s, vl = p.u * s + p.v * c;
    let hit = 0;
    if (Math.abs(ds) / 4.4 > Math.abs(dl) / 2.1) {
      if (ds < 0) { p.s = wrapS(r.s - 4.4); if (vs > r.v) { hit = vs - r.v; vs = r.v - 1; r.v += hit * 0.3; } }
      else { p.s = wrapS(r.s + 4.4); if (vs < r.v) { hit = r.v - vs; r.v = Math.max(0, vs - 1); vs += hit * 0.3; } }
    } else {
      const side = Math.sign(dl) || 1;
      p.lat = r.off + side * 2.1;
      if (vl * side < 0) { hit = Math.abs(vl); vl = side * 2; }
    }
    p.u = vs * c + vl * s; p.v = -vs * s + vl * c;
    syncTrackPose(p);
    if (hit > 0.5) {
      shake = Math.max(shake, 0.2 + Math.min(0.8, hit * 0.06));
      rumble(0.5 + Math.min(0.5, hit / 20), 0.6, 180, true);
      audio.thud(0.2 + Math.min(0.3, hit * 0.02));
    }
  }
}

function trackLogic() {
  const p = player;
  if (p.finished) return;
  const s = p.s;
  const prev = p.prevS ?? s;
  p.prevS = s;
  const sec = Math.min(SECTORS - 1, Math.floor((s / L) * SECTORS));
  if (prev > L * 0.75 && s < L * 0.25) {
    if (p.visited.every(Boolean)) completeLap(p);
    else toast('Lap not counted — missed a sector', 'warn');
    p.visited.fill(false);
  } else if (prev < L * 0.25 && s > L * 0.75) {
    p.visited.fill(false);
  }
  p.visited[sec] = true;
}

function completeLap(p) {
  if (p.lap >= 1) {
    const t = raceTime - p.lapStart;
    p.lastLap = t; p.lapTimes.push(t);
    if (p.bestLap == null || t < p.bestLap) {
      p.bestLap = t; store.set('best.' + p.trim.id, t);
      toast(`New best lap ${fmtTime(t)}`, 'good');
    } else toast(`Lap ${fmtTime(t)}`);
  }
  p.lap++;
  p.lapStart = raceTime;
  if (mode === 'race') {
    if (p.lap > RACE_LAPS) {
      p.finished = true; p.finishTime = raceTime; p.lap = RACE_LAPS;
      finishTimer = 2.5;
      const pos = standings().findIndex((c) => c.you) + 1;
      toast(pos === 1 ? 'Victory!' : `Finished P${pos}`, 'big');
      rumble(0.6, 1, 500, true);
    } else if (p.lap === RACE_LAPS) toast('Final lap', 'big');
  }
}

function simStep(dt) {
  simClock += dt;
  if (state === 'race' || state === 'results') raceTime += dt;
  const auto = { steer: 0, throttle: 0, brake: 0.35, boost: false, lift: false, dive: false };
  stepPlayer(player, player.finished ? auto : input, dt);
  if (player.city) {
    stepTraffic(dt);
    trafficCollide(player);
    stepPeds(dt);
    pedCollide(player);
    law.tickT += dt;
    if (law.tickT >= 0.1) { law.tickT -= 0.1; lawTick(player, 0.1); }
    const sp = Math.hypot(player.V[0], player.V[2]);
    player.topSpeed = Math.max(player.topSpeed, sp);
    player.dist += sp * dt;
    return;
  }
  for (const r of rivals) stepRival(r, dt);
  collide();
  trackLogic();
}

function frameEffects(dt) {
  const p = player;
  if (!p) return;
  const right = cross(p.F, p.Up);
  const sp = vlen(p.V);
  if (p.boosting) {
    for (const o of [-0.62, -0.28, 0.28, 0.62]) {
      if (Math.random() < 0.6) {
        const at = madd(madd(madd(p.P, p.F, -2.5), right, o), p.Up, 0.5);
        emit(at, add(scl(p.V, 0.4), add(scl(p.F, -(20 + Math.random() * 15)), [(Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3])), 0.4, [0.75, 0.88, 1]);
      }
    }
    rumble(0.2, 0.55, 110);
    shake = Math.max(shake, 0.08);
  }
  if (p.lifting) {
    for (const [cx, cz] of [[1.75, -0.95], [1.75, 0.95], [-1.85, -0.98], [-1.85, 0.98]]) {
      const at = madd(madd(p.P, p.F, cx), right, cz);
      emit(at, add(scl(p.V, 0.5), add(scl(p.Up, -18), [(Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6])), 0.5, [0.85, 0.93, 1]);
    }
    rumble(0.45, 0.3, 110);
  }
  if (p.scraping > 0 && sp > 8) {
    const at = madd(madd(p.P, cross(p.F, p.Up), p.scrapeSide * 1.0), p.Up, 0.4);
    for (let k = 0; k < 3; k++) emit(at, add(scl(p.V, 0.6), [(Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6]), 0.35, [1, 0.6, 0.2]);
  }
  if (p.mode !== 'air' && p.slip > 4.5 && Math.random() < 0.5) {
    emit(madd(p.P, p.F, -1.5), [(Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2], 0.8, [0.45, 0.45, 0.45]);
  }
}

// ============================================================
// Action handling
// ============================================================
function handleActions() {
  while (actions.length) {
    const a = actions.shift();
    if (a === 'mute') { audio.muted = !audio.muted; store.set('muted', audio.muted); toast(audio.muted ? 'Sound off' : 'Sound on'); continue; }
    if (a === 'music') { audio.musicOn = !audio.musicOn; store.set('music', audio.musicOn); toast(audio.musicOn ? (audio.muted ? 'Music on (sound muted — M)' : 'Music on') : 'Music off'); continue; }
    if (a === 'camera') { camMode = (camMode + 1) % 3; toast(['Chase cam', 'Far chase cam', 'Hood cam'][camMode]); continue; }

    if (state === 'title') {
      if (a === 'left' || a === 'right') { mode = MODES[(MODES.indexOf(mode) + (a === 'right' ? 1 : MODES.length - 1)) % MODES.length]; renderOverlay(); }
      else if (a === 'confirm') startRace();
    } else if (state === 'race' || state === 'countdown') {
      if (a === 'pause') pauseGame();
      else if (a === 'reset' && state === 'race' && player && !player.finished) (player.city ? resetToStreet : resetToTrack)(player);
      else if (a === 'restart') startRace();
    } else if (state === 'paused') {
      const items = ['resume', 'restart', 'menu'];
      if (a === 'up') { pauseSel = (pauseSel + 2) % 3; renderOverlay(); }
      else if (a === 'down') { pauseSel = (pauseSel + 1) % 3; renderOverlay(); }
      else if (a === 'confirm') doMenu(items[pauseSel]);
      else if (a === 'pause' || a === 'back') resumeGame();
    } else if (state === 'results') {
      const items = ['restart', 'menu'];
      if (a === 'up' || a === 'down' || a === 'left' || a === 'right') { resultsSel = 1 - resultsSel; renderOverlay(); }
      else if (a === 'confirm') doMenu(items[resultsSel]);
      else if (a === 'back' || a === 'pause') toTitle();
    }
  }
}

function doMenu(act) {
  if (act === 'resume') resumeGame();
  else if (act === 'restart') startRace();
  else if (act === 'menu') toTitle();
}

// ============================================================
// Overlay (HTML menus)
// ============================================================
function padStatusHTML() {
  const gp = getPad();
  if (gp) {
    const warn = gp.mapping !== 'standard' ? ' — non-standard mapping, try Chrome or Safari' : '';
    return `<div class="padstatus on">● ${padName(gp)} connected${warn}</div>`;
  }
  return '<div class="padstatus">○ No controller detected — pair your Xbox controller in System Settings → Bluetooth, then press any button</div>';
}

const X = (l, c) => `<kbd class="round ${c}">${l}</kbd>`;

function renderOverlay() {
  let html = '';
  if (state === 'title') {
    html = `<div class="panel">
      <div class="brand">THRUSTER ROADSTER<span>TRACK MODE</span></div>
      <div class="sub">Loops, canyon jumps and wall rides — suction fans hold it upside down, and its thrusters let it fly</div>
      ${(() => {
        const t = ROADSTER, best = store.get('best.' + t.id), z60 = store.get('z60.' + t.id);
        return `<div class="row"><div class="cards"><div class="card sel">
          <div class="swatch" style="background:${t.css}"></div>
          <h2>Thruster ${t.name}</h2>
          <div class="stats"><div><b>${t.zeroSixty}</b><span>0–60 mph</span></div><div><b>${t.topSpeed}</b><span>Top speed</span></div></div>
          <ul>${t.features.map((f) => `<li>${f}</li>`).join('')}</ul>
          <div class="pb">Best lap ${best != null ? fmtTime(best) : '—'} · Best 0–60 ${fmtSec(z60)}</div>
        </div></div></div>`;
      })()}
      <div class="row focus"><div class="modes">
        <div class="mode ${mode === 'race' ? 'sel' : ''}" data-act="mode:race"><b>Race</b><span>${RACE_LAPS} laps against 3 electric hypercars</span></div>
        <div class="mode ${mode === 'trial' ? 'sel' : ''}" data-act="mode:trial"><b>Time Trial</b><span>Open track — chase your best lap and 0–60</span></div>
        <div class="mode ${mode === 'city' ? 'sel' : ''}" data-act="mode:city"><b>City</b><span>Traffic, pedestrians and police — 35 mph limit, and lift is a short (illegal) hop</span></div>
      </div></div>
      <button class="start" data-act="start">START · ${X('A', 'a')} / Enter</button>
      <div class="help">
        <div class="box"><h3>XBOX CONTROLLER</h3><table>
          <tr><td>Left stick / D-pad</td><td>Steer · navigate menus</td></tr>
          <tr><td>RT / LT</td><td>Throttle / brake (analog) · LT at rest = reverse</td></tr>
          <tr><td>${X('A', 'a')} hold</td><td>Cold-gas thrusters — boost</td></tr>
          <tr><td>${X('X', 'x')} hold</td><td>Lift thrusters — hop barriers, fly · City: short hop</td></tr>
          <tr><td>${X('Y', 'y')}</td><td>hold — suction fans: grip, stay on upside down · dive in the air</td></tr>
          <tr><td>D-pad ↑</td><td>Reset to track / street</td></tr>
          <tr><td>${X('B', 'b')}</td><td>Back (menus)</td></tr>
          <tr><td>LB / RB</td><td>Change camera</td></tr>
          <tr><td>☰ Menu / ⧉ View</td><td>Pause / restart</td></tr>
        </table></div>
        <div class="box"><h3>KEYBOARD</h3><table>
          <tr><td><kbd>←</kbd><kbd>→</kbd> or <kbd>A</kbd><kbd>D</kbd></td><td>Steer</td></tr>
          <tr><td><kbd>↑</kbd><kbd>↓</kbd> or <kbd>W</kbd><kbd>S</kbd></td><td>Throttle / brake · reverse</td></tr>
          <tr><td><kbd>Space</kbd></td><td>Cold-gas thrusters</td></tr>
          <tr><td><kbd>Shift</kbd> / <kbd>E</kbd></td><td>Lift thrusters — fly</td></tr>
          <tr><td><kbd>F</kbd> · <kbd>C</kbd></td><td>Hold for suction fans / dive · camera</td></tr>
          <tr><td><kbd>R</kbd> · <kbd>T</kbd></td><td>Reset to track · restart</td></tr>
          <tr><td><kbd>Esc</kbd> · <kbd>M</kbd> · <kbd>N</kbd></td><td>Pause · mute · music</td></tr>
        </table></div>
      </div>
      ${padStatusHTML()}
      <div class="disclaimer">Unofficial fan game inspired by the next-gen Roadster. Not affiliated with or endorsed by Tesla, Inc.</div>
    </div>`;
  } else if (state === 'paused') {
    const items = [['resume', 'Resume'], ['restart', 'Restart'], ['menu', 'Main menu']];
    html = `<div class="panel narrow">
      <h1 class="heading">PAUSED</h1>
      <div class="heading-sub">${MODE_NAMES[mode]}</div>
      <div class="menu-list">${items.map(([a, l], i) => `<div class="menu-item ${i === pauseSel ? 'sel' : ''}" data-act="${a}">${l}</div>`).join('')}</div>
      <div class="hint">${X('A', 'a')} select · ${X('B', 'b')} resume</div>
      ${padStatusHTML()}
    </div>`;
  } else if (state === 'results' && player && player.city) {
    const rows = Object.entries(law.counts).map(([k, n]) => `<tr><td>${OFFENCES[k].name}</td><td>× ${n}</td><td>$${(OFFENCES[k].fine * n).toLocaleString()}</td></tr>`).join('')
      || '<tr><td colspan="3">Clean record — they just caught up with you</td></tr>';
    html = `<div class="panel narrow">
      <h1 class="heading">BUSTED</h1>
      <div class="heading-sub">On the run ${fmtTime(law.runT)} · Most wanted ${'★'.repeat(law.maxStars) || '—'} · Fines $${law.fines.toLocaleString()}</div>
      <table class="results"><tr><th>OFFENCE</th><th>COUNT</th><th>FINE</th></tr>${rows}</table>
      <div class="menu-list">
        <div class="menu-item ${resultsSel === 0 ? 'sel' : ''}" data-act="restart">Try again</div>
        <div class="menu-item ${resultsSel === 1 ? 'sel' : ''}" data-act="menu">Main menu</div>
      </div>
    </div>`;
  } else if (state === 'results') {
    const rows = standings().map((c, i) => {
      const time = c.fin != null ? fmtTime(c.fin) : '~' + fmtTime(raceTime + (RACE_LAPS * L - c.prog) / Math.max(c.v, 25));
      return `<tr class="${c.you ? 'you' : ''}"><td>P${i + 1}</td><td><span class="dot" style="background:${c.color}"></span>${c.you ? 'You — Roadster' : c.name}</td><td>${time}</td></tr>`;
    }).join('');
    const p = player;
    const pos = standings().findIndex((c) => c.you) + 1;
    html = `<div class="panel narrow">
      <h1 class="heading">${pos === 1 ? 'VICTORY' : 'FINISHED P' + pos}</h1>
      <div class="heading-sub">Best lap ${fmtTime(p.lapTimes.length ? Math.min(...p.lapTimes) : null)} · 0–60 ${fmtSec(p.last060)} · Peak ${p.peakG.toFixed(1)} g · ${p.loops} loops</div>
      <table class="results"><tr><th>POS</th><th>DRIVER</th><th>TIME</th></tr>${rows}</table>
      <div class="menu-list">
        <div class="menu-item ${resultsSel === 0 ? 'sel' : ''}" data-act="restart">Race again</div>
        <div class="menu-item ${resultsSel === 1 ? 'sel' : ''}" data-act="menu">Main menu</div>
      </div>
    </div>`;
  }
  overlay.innerHTML = html;
  overlay.className = 'overlay' + (html ? ' show' : '');
}

overlay.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  audio.unlock();
  const act = el.dataset.act;
  if (act.startsWith('mode:')) { mode = act.slice(5); renderOverlay(); }
  else if (act === 'start') startRace();
  else doMenu(act);
});

// ============================================================
// 3D sync + camera
// ============================================================
const _m = new THREE.Matrix4();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
function placeModel(model, P, F, Up) {
  const R = cross(F, Up);
  _m.makeBasis(_v1.set(F[0], F[1], F[2]), _v2.set(Up[0], Up[1], Up[2]), _v3.set(R[0], R[1], R[2]));
  model.grp.quaternion.setFromRotationMatrix(_m);
  model.grp.position.set(P[0], P[1], P[2]);
}

function syncScene() {
  const t = performance.now() / 1000;
  if (cityActive) { syncTraffic(); syncPeds(); updateSignalLamps(simClock); }
  for (const r of rivals) {
    placeModel(r.model, r.P, r.F, r.Up);
    setBrakeLights(r.model, r.braking);
    spinWheels(r.model, r.v);
  }
  const p = player;
  if (!p) return;
  placeModel(p.model, p.P, p.F, p.Up);
  const m = p.model;
  for (const w of m.front) w.rotation.y = -p.steerVis * 0.45;
  setBrakeLights(m, p.braking || input.brake > 0.2);
  if (p.mode !== 'air') spinWheels(m, p.u); else m.spinT = performance.now() / 1000;
  m.shadow.visible = p.mode !== 'air';
  if (m.wing) m.wing.rotation.z = p.suction || p.diving ? 0.32 : 0.04;
  for (const pl of m.plumes) { pl.visible = p.boosting; pl.scale.set(3 + Math.sin(t * 60 + pl.position.z * 9) * 0.8 + Math.random(), 1, 1); }
  for (const pl of m.lifts) { pl.visible = p.lifting; pl.scale.set(1, 2.5 + Math.random() * 1.2, 1); }
}

const cam = { pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), look: new THREE.Vector3(), fov: 68 };
let camInit = false;
function updateCamera(dt) {
  let P, F, Up, sp;
  if (player) { P = player.P; F = player.F; Up = player.Up; sp = vlen(player.V); }
  else if (rivals.length) { const r = rivals[0]; P = r.P; F = r.F; Up = r.Up; sp = r.v; }
  else return;
  const air = player && player.mode === 'air';
  const camUp = air ? norm(add(scl(Up, 0.4), scl(UPW, 0.6))) : Up;
  let back = 8.5, high = 3.0, ahead = 5;
  if (!player) { back = 13; high = 4.5; }
  else if (camMode === 1) { back = 14; high = 5; ahead = 8; }
  const hood = player && camMode === 2;
  if (hood) { back = -0.6; high = 1.25; ahead = 30; }
  const tp = madd(madd(P, F, -back), camUp, high);
  if (cityActive && !hood) {
    // don't let the chase cam end up inside a building: slide it in toward the car
    for (let n = 0; n < 8 && cityCamBlocked(tp[0], tp[1], tp[2]); n++) { tp[0] = lerp(tp[0], P[0], 0.2); tp[2] = lerp(tp[2], P[2], 0.2); }
  }
  tp[1] = Math.max(tp[1], (cityActive ? cityGround(tp[0], tp[2]) : groundHeight(tp[0], tp[2])) + 0.7);
  const tl = madd(madd(P, F, ahead), camUp, hood ? 1.0 : 1.2);
  const k = hood ? 1 : 1 - Math.exp(-dt * (air ? 5 : 9));
  if (!camInit) { cam.pos.set(...tp); cam.look.set(...tl); cam.up.set(...camUp); camInit = true; }
  cam.pos.lerp(_v1.set(...tp), k);
  cam.look.lerp(_v1.set(...tl), hood ? 1 : 1 - Math.exp(-dt * 12));
  cam.up.lerp(_v1.set(...camUp), 1 - Math.exp(-dt * 6)).normalize();
  cam.fov = lerp(cam.fov, 66 + Math.min(26, sp * 0.22) + (player && player.boosting ? 6 : 0), 1 - Math.exp(-dt * 3));
  shake = Math.max(0, shake - dt * 2.5);
  camera.position.copy(cam.pos);
  if (shake > 0) camera.position.add(_v2.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
  camera.up.copy(cam.up);
  camera.lookAt(cam.look);
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();

  // centre the shadow frustum a little ahead of the car, where the chase cam is looking
  camera.getWorldDirection(_v2);
  const sc = [P[0] + _v2.x * 22, P[1] + _v2.y * 22, P[2] + _v2.z * 22];
  sun.position.set(sc[0] + SUN_DIR[0] * 200, sc[1] + SUN_DIR[1] * 200, sc[2] + SUN_DIR[2] * 200);
  sun.target.position.set(sc[0], sc[1], sc[2]);
  if (!cityActive) for (const d of distCulled) d.mesh.visible = d.c.distanceToSquared(camera.position) < d.r * d.r;
  refillShadowProxies(sc[0], sc[2]);
  for (const d of lodChunks) d.mesh.geometry = d.c.distanceTo(camera.position) - d.r > 140 ? d.lo : d.hi;
  scene.userData.sky.position.copy(camera.position);
  scene.userData.sky.material.uniforms.cloudShift.value = performance.now() * 0.000004;
}

// ============================================================
// HUD (2D canvas)
// ============================================================
function panel(x, y, w, h, r = 12) {
  ctx.fillStyle = 'rgba(10,11,14,0.62)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();
}

function text(str, x, y, size, color = '#eef0f3', align = 'left', weight = 600) {
  ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(str, x, y);
}

function drawHUD() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (player) {
    if (player.boosting && vlen(player.V) > 35) drawSpeedLines(vlen(player.V));
    drawPlayerHUD();
  }
  drawToasts();
}

function drawSpeedLines(sp) {
  const n = 36, cx = W / 2, cy = H / 2;
  ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.3, (sp - 35) / 160)})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = Math.max(W, H) * (0.35 + Math.random() * 0.2);
    const r1 = r0 + 40 + Math.random() * 120;
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
  }
  ctx.stroke();
}

function drawPlayerHUD() {
  const p = player;
  const mph = vlen(p.V) * MPH;
  const T = p.trim;

  const cx = W / 2, cy = H - 88, R = 70;
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  ctx.fillStyle = 'rgba(10,11,14,0.45)';
  ctx.beginPath(); ctx.arc(cx, cy, R + 14, 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
  const frac = clamp(mph / 250, 0, 1);
  const grd = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
  grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.7, '#ff6b7c'); grd.addColorStop(1, '#e31937');
  ctx.strokeStyle = grd;
  ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + (a1 - a0) * frac); ctx.stroke();
  text(Math.round(mph).toString(), cx, cy + 12, 44, '#fff', 'center', 700);
  text('MPH', cx, cy + 32, 11, '#9aa0a8', 'center', 600);
  let label, col;
  if (p.mode === 'air') {
    label = p.diving ? 'DIVE · FANS PULLING DOWN'
      : p.city ? (p.lifting ? 'HOP · LIFT BURN' : `HOP · ${p.airTime.toFixed(1)} s`)
      : p.diveHeld ? 'DIVE · WAITING FOR TRACK BELOW' : `AIRBORNE · ${p.airTime.toFixed(1)} s`;
    col = '#7cf7ff';
  }
  else if (p.inverted) { label = p.suction ? 'UPSIDE DOWN · FANS HOLDING' : 'UPSIDE DOWN · HOLD Y!'; col = p.suction ? '#ff9f43' : '#ff5a5a'; }
  else { label = p.suction ? 'SUCTION · FANS MAX' : 'LOW DRAG'; col = p.suction ? '#9fd4ff' : '#f2c230'; }
  text(label, cx, cy + 62, 11, col, 'center', 700);

  // G meter + load (left of the speedo when there's room, otherwise above the minimap)
  let gx = cx - 175, gy = H - 92;
  if (gx < 290) { gx = 70; gy = H - 250; }
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.fillStyle = 'rgba(10,11,14,0.5)';
  ctx.beginPath(); ctx.arc(gx, gy, 42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(gx, gy, 21, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gx - 42, gy); ctx.lineTo(gx + 42, gy); ctx.moveTo(gx, gy - 42); ctx.lineTo(gx, gy + 42); ctx.stroke();
  const gs = 42 / 5;
  ctx.fillStyle = '#e31937';
  ctx.beginPath(); ctx.arc(gx + clamp(p.gLat, -5, 5) * gs, gy - clamp(p.gLong, -5, 5) * gs, 5, 0, Math.PI * 2); ctx.fill();
  text(`${Math.hypot(p.gLat, p.gLong).toFixed(1)} g`, gx, gy + 60, 12, '#eef0f3', 'center', 700);
  text(p.mode !== 'air' ? `load ${(p.load / G).toFixed(1)} g` : 'load 0.0 g', gx, gy + 74, 10, '#8a9099', 'center', 500);

  // cold gas
  const bx = cx + 150, by = H - 150;
  {
    const f = p.gas / T.tank;
    ctx.fillStyle = 'rgba(10,11,14,0.55)';
    ctx.beginPath(); ctx.roundRect(bx, by, 26, 110, 6); ctx.fill();
    ctx.fillStyle = p.boosting || p.lifting ? '#ffffff' : f < 0.2 ? '#e0443a' : '#7cc8ff';
    ctx.beginPath(); ctx.roundRect(bx + 4, by + 4 + 102 * (1 - f), 18, 102 * f, 4); ctx.fill();
    panel(bx + 32, by, 118, 84, 10);
    text('COLD GAS', bx + 42, by + 18, 10, '#8a9099', 'left', 700);
    text(`${Math.round(p.gas)} L`, bx + 42, by + 40, 18, '#fff', 'left', 700);
    text(`COPV ${T.tank} L`, bx + 42, by + 56, 10, '#8a9099', 'left', 500);
    const tags = [];
    if (p.boosting) tags.push('THRUST');
    if (p.lifting) tags.push('LIFT');
    text(tags.join(' + '), bx + 42, by + 75, 12, '#7cf7ff', 'left', 800);
  }

  if (p.city) { drawCityPanel(p); drawLawHUD(p); }
  else drawRacePanels(p);

  drawMinimap();

  const lift = p.city ? 'hop' : 'lift';
  const hint = lastDevice === 'pad'
    ? `RT throttle · LT brake · A thrusters · X ${lift} · Y suction/dive · D-pad ↑ reset · LB/RB camera · ☰ pause`
    : `↑ throttle · ↓ brake · Space thrusters · Shift ${lift} · F suction/dive · C camera · R reset · Esc pause`;
  text(hint, W / 2, H - 6, 11, 'rgba(255,255,255,0.55)', 'center', 500);

  if (state === 'countdown' || goFlash > 0) {
    const lit = state === 'countdown' ? (countdown > 3 ? 0 : countdown > 2 ? 1 : countdown > 1 ? 2 : 3) : 3;
    const lx = W / 2 - 75, ly = H * 0.22;
    panel(lx - 20, ly - 32, 190, 64, 32);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = goFlash > 0 ? '#27e06b' : i < lit ? '#ff2a3a' : 'rgba(255,255,255,0.1)';
      ctx.beginPath(); ctx.arc(lx + 5 + i * 70, ly, 20, 0, Math.PI * 2); ctx.fill();
    }
    if (goFlash > 0) text('GO', W / 2, ly + 80, 48, '#27e06b', 'center', 900);
    else if (countdown > 3) text(`Hold ${lastDevice === 'pad' ? 'RT' : '↑'} at green · hold ${lastDevice === 'pad' ? 'Y' : 'F'} for suction grip`, W / 2, ly + 66, 14, '#fff', 'center', 600);
  }
  if (p.offCourse > 0) text('OFF COURSE', W / 2, H * 0.45, 40, '#ffb347', 'center', 900);
}

function drawRacePanels(p) {
  // lap panel
  panel(16, 16, 230, 150);
  const lapStr = mode === 'race' ? `LAP ${Math.max(1, Math.min(p.lap, RACE_LAPS))}/${RACE_LAPS}` : `LAP ${Math.max(1, p.lap)}`;
  text(lapStr, 32, 46, 22, '#fff', 'left', 800);
  const cur = p.lap >= 1 && !p.finished ? raceTime - p.lapStart : p.finished ? p.lastLap : 0;
  text(fmtTime(cur), 32, 74, 20, '#fff', 'left', 600);
  text('LAST', 32, 98, 10, '#8a9099', 'left', 700); text(fmtTime(p.lastLap), 80, 98, 13, '#d0d4d9', 'left', 600);
  text('BEST', 32, 116, 10, '#8a9099', 'left', 700); text(fmtTime(p.bestLap), 80, 116, 13, '#d0d4d9', 'left', 600);
  for (let i = 0; i < SECTORS; i++) {
    ctx.fillStyle = p.visited[i] ? '#27c46b' : 'rgba(255,255,255,0.15)';
    ctx.fillRect(32 + i * 32, 134, 28, 6);
  }
  text('SECTORS', 32, 156, 9, '#6b7179', 'left', 700);

  if (mode === 'race') {
    const st = standings();
    const pos = st.findIndex((c) => c.you) + 1;
    panel(W - 216, 16, 200, 46 + st.length * 22);
    text(`P${pos}`, W - 200, 52, 32, '#fff', 'left', 800);
    text(`/ ${st.length}`, W - 150, 52, 16, '#8a9099', 'left', 600);
    st.forEach((c, i) => {
      const y = 82 + i * 22;
      ctx.fillStyle = c.color;
      ctx.beginPath(); ctx.arc(W - 194, y - 4, 5, 0, Math.PI * 2); ctx.fill();
      text(`${i + 1}. ${c.name}`, W - 182, y, 13, c.you ? '#fff' : '#b8bdc4', 'left', c.you ? 800 : 500);
    });
  } else {
    panel(W - 216, 16, 200, 70);
    text('TIME TRIAL', W - 200, 42, 12, '#8a9099', 'left', 700);
    text(`Best 0–60  ${fmtSec(p.best060)}`, W - 200, 66, 13, '#fff', 'left', 600);
  }
}

function drawCityPanel(p) {
  panel(16, 16, 230, 140);
  text('CITY', 32, 46, 22, '#fff', 'left', 800);
  text('FREE ROAM', 96, 46, 11, '#8a9099', 'left', 700);
  const rows = [
    ['TOP', `${Math.round(p.topSpeed * MPH)} mph`],
    ['DRIVEN', `${(p.dist / 1609.34).toFixed(2)} mi`],
    ['HOPS', `${p.hops}`],
    ['0–60', fmtSec(p.best060)],
    ['FINES', `$${law.fines.toLocaleString()}`],
  ];
  rows.forEach(([k, v], i) => {
    text(k, 32, 70 + i * 18, 10, '#8a9099', 'left', 700);
    text(v, 92, 70 + i * 18, 13, '#d0d4d9', 'left', 600);
  });
}

// wanted stars, the posted limit, and how close you are to losing them or being arrested
function drawLawHUD(p) {
  const x = W - 216, sp = Math.hypot(p.V[0], p.V[2]);
  panel(x, 16, 200, 92);
  const blink = law.stars > 0 && !law.hunterSees && Math.floor(performance.now() / 300) % 2;
  for (let i = 0; i < 5; i++) {
    const lit = i < law.stars;
    text('★', x + 26 + i * 34, 52, 30, lit ? (blink ? 'rgba(242,194,48,0.35)' : '#f2c230') : 'rgba(255,255,255,0.14)', 'center', 900);
  }
  if (law.stars > 0) {
    const f = law.hunterSees ? 0 : clamp(law.unseenT / escapeTime(), 0, 1);
    text(law.hunterSees ? 'POLICE ON YOU' : 'OUT OF SIGHT — STAY HIDDEN', x + 16, 78, 10, law.hunterSees ? '#ff6b6b' : '#9fd4ff', 'left', 800);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 16, 86, 168, 5);
    ctx.fillStyle = '#9fd4ff'; ctx.fillRect(x + 16, 86, 168 * f, 5);
  } else text(law.seen ? 'POLICE NEARBY' : 'NOT WANTED', x + 16, 82, 10, law.seen ? '#f2c230' : '#8a9099', 'left', 800);
  // speed limit sign by the speedo; the needle readout goes red once you'd be pulled over
  const sx = W / 2 - 128, sy = H - 150;
  ctx.fillStyle = '#f4f4f0'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(sx, sy, 44, 56, 5); ctx.fill(); ctx.stroke();
  text('SPEED', sx + 22, sy + 12, 7, '#111', 'center', 800);
  text('LIMIT', sx + 22, sy + 21, 7, '#111', 'center', 800);
  text('35', sx + 22, sy + 47, 22, sp > SPEED_LIMIT + 15 / MPH ? '#d0021b' : '#111', 'center', 900);
  if (law.bustT > 0 && !p.finished) {
    const f = clamp(law.bustT / 2.5, 0, 1), cx = W / 2, cy = H * 0.3;
    ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ff4b4b'; ctx.beginPath(); ctx.arc(cx, cy, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); ctx.stroke();
    text('PULL OVER', cx, cy + 62, 18, '#ff6b6b', 'center', 900);
    text('drive off to get away', cx, cy + 80, 11, '#d0d4d9', 'center', 600);
  }
}

const mini = (() => {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) {
    minX = Math.min(minX, track.P[i * 3]); maxX = Math.max(maxX, track.P[i * 3]);
    minZ = Math.min(minZ, track.P[i * 3 + 2]); maxZ = Math.max(maxZ, track.P[i * 3 + 2]);
  }
  return { minX, minZ, maxX, maxZ };
})();

function drawMinimap() {
  if (player && player.city) { drawCityMap(); return; }
  const mw = 220, mh = 160, mx = 16, my = H - mh - 22;
  panel(mx, my, mw, mh);
  const bw = mini.maxX - mini.minX, bh = mini.maxZ - mini.minZ;
  const sc = Math.min((mw - 24) / bw, (mh - 24) / bh);
  const ox = mx + (mw - bw * sc) / 2 - mini.minX * sc, oy = my + (mh - bh * sc) / 2 - mini.minZ * sc;
  const X = (x) => ox + x * sc, Y = (z) => oy + z * sc;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i <= track.N; i++) {
    const k = i % track.N;
    if (!track.surf[k]) { pen = false; continue; }
    const x = X(track.P[k * 3]), y = Y(track.P[k * 3 + 2]);
    if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (const r of rivals) {
    ctx.fillStyle = r.css;
    ctx.beginPath(); ctx.arc(X(r.P[0]), Y(r.P[2]), 3.5, 0, Math.PI * 2); ctx.fill();
  }
  if (player) {
    ctx.fillStyle = '#e31937'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(player.P[0]), Y(player.P[2]), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

// north-up street map, 260 m tall, centred on the car
function drawCityMap() {
  const mw = 220, mh = 160, mx = 16, my = H - mh - 22;
  panel(mx, my, mw, mh);
  const p = player, sc = mh / 260;
  const X = (x) => mx + mw / 2 + (x - p.P[0]) * sc, Y = (z) => my + mh / 2 + (z - p.P[2]) * sc;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(mx + 3, my + 3, mw - 6, mh - 6, 10); ctx.clip();
  const e = CITY.EDGE;
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(X(-e), Y(-e), 2 * e * sc, 2 * e * sc);
  for (const b of city.blocks) {
    ctx.fillStyle = b.kind === 'park' ? 'rgba(84,140,70,0.9)' : b.kind === 'plaza' ? 'rgba(120,118,112,0.9)' : 'rgba(22,24,29,0.92)';
    ctx.fillRect(X(b.x0), Y(b.z0), (b.x1 - b.x0) * sc, (b.z1 - b.z0) * sc);
  }
  const o = CITY.MAX + CITY.ROAD_W / 2;
  ctx.fillStyle = 'rgba(22,24,29,0.92)';
  ctx.fillRect(X(-e), Y(-e), 2 * e * sc, (e - o) * sc); ctx.fillRect(X(-e), Y(o), 2 * e * sc, (e - o) * sc);
  ctx.fillRect(X(-e), Y(-e), (e - o) * sc, 2 * e * sc); ctx.fillRect(X(o), Y(-e), (e - o) * sc, 2 * e * sc);
  for (const c of city.traffic) {
    ctx.fillStyle = c.police ? (c.state === 'pursuit' ? (Math.floor(performance.now() / 150) % 2 ? '#ff3b3b' : '#4b8bff') : '#4b8bff') : 'rgba(235,238,242,0.85)';
    ctx.beginPath(); ctx.arc(X(c.P[0]), Y(c.P[1]), c.police ? 3.2 : 2, 0, Math.PI * 2); ctx.fill();
  }
  const cx = X(p.P[0]), cy = Y(p.P[2]), fx = p.F[0], fz = p.F[2];
  ctx.fillStyle = '#e31937'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx + fx * 9, cy + fz * 9);
  ctx.lineTo(cx - fx * 6 - fz * 6, cy - fz * 6 + fx * 6);
  ctx.lineTo(cx - fx * 6 + fz * 6, cy - fz * 6 - fx * 6);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawToasts() {
  let y = H * 0.34;
  for (const t of toasts) {
    const a = clamp(Math.min(t.t * 6, (t.life - t.t) * 2), 0, 1);
    ctx.globalAlpha = a;
    const big = t.kind === 'big';
    const size = big ? 40 : 17;
    ctx.font = `${big ? 900 : 700} ${size}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const w = ctx.measureText(t.text).width + 36;
    if (!big) panel(W / 2 - w / 2, y - 24, w, 36, 18);
    const col = t.kind === 'good' ? '#6fdc8c' : t.kind === 'warn' ? '#ffb347' : '#fff';
    text(t.text, W / 2, y, size, col, 'center', big ? 900 : 700);
    y += big ? 56 : 44;
  }
  ctx.globalAlpha = 1;
}

// ============================================================
// Main loop
// ============================================================
let last = performance.now();
let acc = 0;
let overlayTick = 0;

function frame(now) {
  try { tick(now); } catch (e) { console.error(e); }
  requestAnimationFrame(frame);
}

function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  readInput(dt);
  handleActions();

  if (state === 'countdown') {
    const before = countdown;
    countdown -= dt;
    const lit = countdown > 3 ? 0 : countdown > 2 ? 1 : countdown > 1 ? 2 : 3;
    if (lit !== lastLights && lit > 0 && before > 0) { audio.beep(440, 0.18); rumble(0.15, 0.25, 90, true); }
    lastLights = lit;
    if (countdown <= 0) {
      state = 'race';
      goFlash = 1;
      audio.beep(880, 0.45, 0.22);
      rumble(0.3, 0.6, 200, true);
      player.launchStart = simClock;
      acc = 0;
    }
  }
  if (goFlash > 0) goFlash -= dt;

  if (state === 'race' || state === 'results') {
    acc += dt;
    while (acc >= STEP) { simStep(STEP); acc -= STEP; }
    frameEffects(dt);
    if (player.finished && state === 'race') {
      finishTimer -= dt;
      if (finishTimer <= 0) { state = 'results'; resultsSel = 0; renderOverlay(); }
    }
    if (state === 'results') {
      overlayTick += dt;
      if (overlayTick > 1) { overlayTick = 0; renderOverlay(); }
    }
  } else if (state === 'title') {
    for (const r of rivals) stepRival(r, dt);
  }

  for (const t of toasts) t.t += dt;
  for (let i = toasts.length - 1; i >= 0; i--) if (toasts[i].t > toasts[i].life) toasts.splice(i, 1);

  if (state !== 'paused') updateParticles(dt);
  syncScene();
  updateCamera(dt);
  post.render(scene, camera);
  trackPerf(dt);
  drawHUD();
  audio.update(player);
}

toTitle();
requestAnimationFrame(frame);
})();
