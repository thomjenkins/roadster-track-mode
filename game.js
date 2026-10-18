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

const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.5, 6000);
scene.fog = new THREE.Fog(0xcad9e6, 350, 2600);

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  renderer.setPixelRatio(DPR);
  renderer.setSize(W, H, false);
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

const asphaltTex = canvasTex(256, 512, (g, w, h) => {
  g.fillStyle = '#3a3d42'; g.fillRect(0, 0, w, h);
  const r = rng(5);
  for (let i = 0; i < 9000; i++) {
    const l = 40 + r() * 50;
    g.fillStyle = `rgba(${l},${l + 2},${l + 6},${0.35 + r() * 0.4})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
  for (let k = 0; k < 4; k++) {
    g.fillStyle = k % 2 ? '#f2f2f2' : '#d42131';
    g.fillRect(0, k * 128, 12, 128);
    g.fillRect(w - 12, k * 128, 12, 128);
  }
  g.fillStyle = '#e8e8e8';
  g.fillRect(14, 0, 5, h); g.fillRect(w - 19, 0, 5, h);
  g.fillStyle = 'rgba(240,240,240,0.75)';
  g.fillRect(w / 2 - 2, 0, 4, 220);
});

const wallTex = canvasTex(64, 256, (g, w, h) => {
  g.fillStyle = '#f1f2f4'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#d42131';
  g.fillRect(0, 0, w, 128);
  g.fillStyle = 'rgba(0,0,0,0.08)';
  g.fillRect(0, 0, w, 6);
});

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
scene.fog.near = 300; scene.fog.far = 3400;
scene.add(new THREE.HemisphereLight(0xa9c2f0, 0x6a5434, 0.5));
const sun = new THREE.DirectionalLight(0xffd2a0, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 420 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.04;
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
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: grassTex, roughness: 0.96 }));
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
  const topMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, metalness: 0 });
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x6b7078, roughness: 0.9 });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.6, side: THREE.DoubleSide });
  for (const run of surfaceRuns()) {
    strip(run, [-HALF_W, 0.02], [HALF_W, 0.02], 10, topMat);
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
  const grey = new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.8 });
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
  const ico = (r) => new THREE.IcosahedronGeometry(r, 0);
  const juniper = mergeGeos([
    [new THREE.CylinderGeometry(0.2, 0.32, 2.2, 6), M4(0, 1.1, 0), bark],
    [ico(1.7), M4(0, 3.0, 0, 1, 1.25, 1), leafDark],
    [ico(1.35), M4(0.2, 4.6, -0.1), leafDark],
    [ico(0.95), M4(-0.1, 5.9, 0.1), leafDark],
    [ico(0.9), M4(0.9, 3.4, 0.6), leafDark],
  ]);
  const oak = mergeGeos([
    [new THREE.CylinderGeometry(0.32, 0.5, 2.6, 7), M4(0, 1.3, 0), bark],
    [ico(2.4), M4(0, 3.8, 0, 1.4, 0.72, 1.4), leaf],
    [ico(1.8), M4(1.9, 3.5, 0.9, 1.1, 0.8, 1.1), leaf],
    [ico(1.7), M4(-1.8, 3.6, -0.7, 1.1, 0.8, 1.1), leaf],
    [ico(1.5), M4(0.4, 4.6, -1.4, 1.1, 0.8, 1.1), leaf],
  ]);
  const scrub = mergeGeos([[ico(1), M4(0, 0.45, 0, 1.3, 0.75, 1.3), leaf], [ico(0.7), M4(0.8, 0.4, 0.3), leaf]]);
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
  const plant = (geo, list, mat, shadow, tint) => {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    list.forEach(([x, y, z, s, yaw, v], k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      m.compose(new THREE.Vector3(x, y - 0.15, z), q, new THREE.Vector3(s, s * (0.85 + v * 0.3), s));
      mesh.setMatrixAt(k, m);
      tint(c, v);
      mesh.setColorAt(k, c);
    });
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    scene.add(mesh);
  };
  const foliage = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  plant(juniper, lists.juniper, foliage, true, (c, v) => c.setRGB(0.85 + v * 0.3, 0.9 + v * 0.25, 0.8 + v * 0.2));
  plant(oak, lists.oak, foliage, true, (c, v) => c.setRGB(0.62 + v * 0.3, 0.68 + v * 0.22, 0.55 + v * 0.15));
  plant(scrub, lists.scrub, foliage, false, (c, v) => c.setRGB(0.8 + v * 0.5, 0.85 + v * 0.3, 0.6 + v * 0.2));
  plant(rockGeo, lists.rock, foliage, true, (c, v) => c.setRGB(0.8 + v * 0.5, 0.75 + v * 0.4, 0.7 + v * 0.35));

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
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.35, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.7 });
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
  part(new THREE.BoxGeometry(0.42, 0.2, 1.62), carbon, -2.2, 0.32, 0);
  for (const z of [-0.5, -0.17, 0.17, 0.5]) part(new THREE.BoxGeometry(0.5, 0.2, 0.03), carbon, -2.25, 0.3, z);
  for (const side of [-1, 1]) {
    part(new THREE.BoxGeometry(2.3, 0.1, 0.08), carbon, 0, 0.27, side * 0.98);
    const intake = part(new THREE.BoxGeometry(0.7, 0.16, 0.05), carbon, -0.75, 0.5, side * 0.99);
    intake.rotation.y = side * 0.12;
  }

  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x080c12, metalness: 0.2, roughness: 0.03, clearcoat: 1, envMapIntensity: 1.8 });
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), glassMat);
  glass.scale.set(1.5, 0.44, 0.7);
  glass.position.set(-0.3, 0.84, 0);
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
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x8a0f18 });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 1.55), tailMat);
  tail.position.set(-2.37, 0.66, 0);
  grp.add(tail);
  const tailGlows = [];
  for (const z of [-0.6, 0, 0.6]) {
    const g = glow(0xff2030);
    g.position.set(-2.45, 0.66, z); g.scale.set(0.7, 0.35, 1);
    g.material.opacity = 0.35;
    grp.add(g);
    tailGlows.push(g);
  }
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
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
    wing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 1.6), carbon);
    wing.position.set(-1.98, 1.04, 0);
    wing.castShadow = true;
    grp.add(wing);
    for (const z of [-0.81, 0.81]) part(new THREE.BoxGeometry(0.5, 0.22, 0.02), carbon, -1.98, 1.0, z);
  }

  const plumes = [];
  if (opts.nozzles) {
    const nozMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.9, roughness: 0.3 });
    const nozGeo = new THREE.CylinderGeometry(0.1, 0.13, 0.16, 12); nozGeo.rotateZ(Math.PI / 2);
    const plumeGeo = new THREE.ConeGeometry(0.24, 1, 14, 1, true); plumeGeo.rotateZ(Math.PI / 2); plumeGeo.translate(-0.5, 0, 0);
    const plumeMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const z of [-0.62, -0.28, 0.28, 0.62]) {
      const nz = new THREE.Mesh(nozGeo, nozMat); nz.position.set(-2.4, 0.5, z); grp.add(nz);
      const pl = new THREE.Mesh(plumeGeo, plumeMat); pl.position.set(-2.46, 0.5, z); pl.visible = false; grp.add(pl);
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
  scene.add(grp);
  return { grp, front, wheels, tailMat, tailGlows, shadow, wing, plumes, lifts, spinT: performance.now() / 1000 };
}

function setBrakeLights(m, on) {
  m.tailMat.color.setHex(on ? 0xff2a3a : 0x8a0f18);
  for (const g of m.tailGlows) g.material.opacity = on ? 0.95 : 0.35;
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
const pMesh = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 1.6, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
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
    this.master = c.createGain(); this.master.gain.value = 0.5; this.master.connect(c.destination);
    this.m1 = c.createOscillator(); this.m1.type = 'sawtooth';
    this.m2 = c.createOscillator(); this.m2.type = 'sine';
    this.mf = c.createBiquadFilter(); this.mf.type = 'lowpass'; this.mf.frequency.value = 1400; this.mf.Q.value = 3;
    this.mg = c.createGain(); this.mg.gain.value = 0;
    this.m1.connect(this.mf); this.m2.connect(this.mf); this.mf.connect(this.mg); this.mg.connect(this.master);
    this.m1.start(); this.m2.start();
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const mk = (type, freq, q) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(this.master); s.start();
      return g.gain;
    };
    this.hiss = mk('bandpass', 3200, 0.5);
    this.wind = mk('lowpass', 450, 0.4);
    this.fan = mk('bandpass', 950, 4);
    this.skid = mk('bandpass', 1700, 7);
    this.scrape = mk('bandpass', 4200, 3);
  },
  update(p) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const set = (param, v) => param.setTargetAtTime(v, t, 0.05);
    const live = !this.muted && p && (state === 'race' || state === 'countdown' || state === 'results');
    const m = live ? 1 : 0;
    const sp = p ? vlen(p.V) : 0;
    const air = p && p.mode === 'air';
    set(this.m1.frequency, 38 + sp * 9);
    set(this.m2.frequency, 76 + sp * 18);
    set(this.mg.gain, m * (0.02 + 0.055 * input.throttle * (air ? 0.3 : 1) + sp * 0.00035));
    set(this.hiss, m * ((p && p.boosting ? 0.32 : 0) + (p && p.lifting ? 0.38 : 0)));
    set(this.wind, m * Math.min(0.22, sp * sp * 0.00003));
    set(this.fan, m * (p && p.aero === 0 ? 0.035 : 0.012));
    set(this.skid, m * (p && !air && p.slip > 3 ? Math.min(0.14, (p.slip - 3) * 0.02) : 0));
    set(this.scrape, m * (p && p.scraping > 0 ? 0.12 : 0));
  },
  beep(freq, dur, vol = 0.18) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + dur + 0.02);
  },
  thud(vol = 0.4) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(35, c.currentTime + 0.25);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
    o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + 0.32);
  },
};

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
  KeyF: 'aero', KeyR: 'reset', KeyT: 'restart', KeyM: 'mute', KeyC: 'camera',
};
const PAD_ACTIONS = { 0: 'confirm', 1: 'back', 3: 'aero', 4: 'camera', 5: 'camera', 8: 'restart', 9: 'pause', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

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
let state = 'title'; // title | countdown | race | paused | results
let pausedFrom = 'race';
let mode = store.get('mode') || 'race';
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
    gas: trim.tank, gasIdle: 0, aero: 0, steerVis: 0, slip: 0, load: G * 2, scraping: 0,
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

function startRace() {
  store.set('mode', mode);
  disposeCars();
  player = makePlayer(ROADSTER);
  rivals = mode === 'race' ? makeRivals() : [];
  raceTime = 0; simClock = 0; countdown = 4; lastLights = -1; goFlash = 0; finishTimer = 0;
  toasts.length = 0;
  camInit = false;
  state = 'countdown';
  audio.unlock();
  renderOverlay();
}

function toTitle() {
  disposeCars();
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
  p.lifting = inp.lift && canGas;
  if (p === player) {
    if (!canGas && ((inp.lift && !p.liftHeld) || (inp.boost && !p.boostHeld))) toast('Cold-gas tank empty — recharging', 'warn');
    p.liftHeld = inp.lift;
    p.boostHeld = inp.boost;
  }
  const drain = (p.boosting ? T.boostDrain : 0) + (p.lifting ? T.liftDrain : 0);
  if (drain > 0) { p.gas = Math.max(0, p.gas - drain * dt); p.gasIdle = 0; }
  else { p.gasIdle += dt; if (p.gasIdle > 0.8) p.gas = Math.min(T.tank, p.gas + GAS_RECHARGE * dt); }
}

function stepTrack(p, inp, dt) {
  const T = p.trim;
  const f = frameAt(p.s);
  const hiDF = p.aero === 0;
  let c = Math.cos(p.psi), s = Math.sin(p.psi);
  let vs = p.u * c - p.v * s;
  const speed = Math.hypot(p.u, p.v);
  const fan = p.lifting ? 0 : (hiDF ? 1.0 : 0.5) * G;
  const aero = p.lifting ? 0 : (hiDF ? 0.003 : 0.0011) * speed * speed;
  const N = vs * vs * f.kn + G * f.U[1] + fan + aero - (p.lifting ? LIFT_A : 0);
  p.load = N;
  p.inverted = f.U[1] < -0.2;

  if (!f.surf || N < 0) {
    detach(p);
    if (p.lifting) p.V = madd(p.V, p.Up, LIFT_POP);
    stepAir(p, inp, dt);
    return;
  }

  const grip = 1.1 * N;
  const gT = -G * f.T[1], gR = -G * f.R[1];
  const gf = gT * c + gR * s, gr = -gT * s + gR * c;

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

  if (track.tag[Math.floor(p.s)] === 'loop') p.loopEntry = true;
  else if (p.loopEntry) { p.loopEntry = false; p.loops++; toast('Loop! Fans held you through the top', 'good'); }
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function detach(p) {
  syncTrackPose(p);
  p.mode = 'air';
  p.airTime = 0; p.maxAlt = 0;
  p.inverted = false;
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
    land(p, i, d, lat);
    return;
  }
  // off course: hit the ground
  const gy = groundHeight(p.P[0], p.P[2]) + 0.32;
  if (p.P[1] < gy && !(overTrack && h > -2.5)) {
    p.P[1] = gy;
    p.V = [0, 0, 0];
    if (p.offCourse <= 0) {
      p.offCourse = 1.2;
      toast('Off course — returning to track', 'warn');
      rumble(1, 0.8, 350, true);
      audio.thud(0.6);
      shake = Math.max(shake, 1);
    }
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
  while (!track.surf[Math.floor(wrapS(s))]) s -= 5;
  p.s = wrapS(s); p.lat = clamp(p.lat, -3, 3); p.psi = 0; p.u = 0; p.v = 0;
  p.mode = 'track'; p.offCourse = 0; p.resetCooldown = 1;
  syncTrackPose(p);
  if (!silent) toast('Reset to track');
}

function stepPlayer(p, inp, dt) {
  if (p.offCourse > 0) {
    p.offCourse -= dt;
    if (p.offCourse <= 0) { p.resetCooldown = 0; resetToTrack(p, true); }
    return;
  }
  gasLogic(p, inp, dt);
  if (p.mode === 'track') stepTrack(p, inp, dt);
  else stepAir(p, inp, dt);
  p.steerVis = approach(p.steerVis, inp.steer, dt * 8);
  p.peakG = Math.max(p.peakG, Math.hypot(p.gLong, p.gLat));
  if (p.resetCooldown > 0) p.resetCooldown -= dt;

  const sp = vlen(p.V);
  if (sp < 0.4 && p.mode === 'track') p.launchStart = simClock;
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
    const side = Math.sign(p.lat);
    const at = madd(madd(p.P, cross(p.F, p.Up), side * 1.0), p.Up, 0.4);
    for (let k = 0; k < 3; k++) emit(at, add(scl(p.V, 0.6), [(Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6]), 0.35, [1, 0.6, 0.2]);
  }
  if (p.mode === 'track' && p.slip > 4.5 && Math.random() < 0.5) {
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
    if (a === 'camera') { camMode = (camMode + 1) % 3; toast(['Chase cam', 'Far chase cam', 'Hood cam'][camMode]); continue; }

    if (state === 'title') {
      if (a === 'left' || a === 'right') { mode = mode === 'race' ? 'trial' : 'race'; renderOverlay(); }
      else if (a === 'confirm') startRace();
    } else if (state === 'race' || state === 'countdown') {
      if (a === 'pause') pauseGame();
      else if (a === 'aero' && player && player.mode === 'track') {
        player.aero = player.aero === 0 ? 1 : 0;
        toast(player.aero === 0 ? 'High downforce — fans max (holds upside down)' : 'Low drag — fans eco, wing flat');
        rumble(0.2, 0.3, 80, true);
      } else if (a === 'reset' && state === 'race' && player && !player.finished) resetToTrack(player);
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
      </div></div>
      <button class="start" data-act="start">START · ${X('A', 'a')} / Enter</button>
      <div class="help">
        <div class="box"><h3>XBOX CONTROLLER</h3><table>
          <tr><td>Left stick / D-pad</td><td>Steer · navigate menus</td></tr>
          <tr><td>RT / LT</td><td>Throttle / brake (analog) · LT at rest = reverse</td></tr>
          <tr><td>${X('A', 'a')} hold</td><td>Cold-gas thrusters — boost</td></tr>
          <tr><td>${X('X', 'x')} hold</td><td>Lift thrusters — hop barriers, fly</td></tr>
          <tr><td>${X('Y', 'y')}</td><td>Aero: high downforce ↔ low drag · hold in the air to dive</td></tr>
          <tr><td>D-pad ↑</td><td>Reset to track</td></tr>
          <tr><td>${X('B', 'b')}</td><td>Back (menus)</td></tr>
          <tr><td>LB / RB</td><td>Change camera</td></tr>
          <tr><td>☰ Menu / ⧉ View</td><td>Pause / restart</td></tr>
        </table></div>
        <div class="box"><h3>KEYBOARD</h3><table>
          <tr><td><kbd>←</kbd><kbd>→</kbd> or <kbd>A</kbd><kbd>D</kbd></td><td>Steer</td></tr>
          <tr><td><kbd>↑</kbd><kbd>↓</kbd> or <kbd>W</kbd><kbd>S</kbd></td><td>Throttle / brake · reverse</td></tr>
          <tr><td><kbd>Space</kbd></td><td>Cold-gas thrusters</td></tr>
          <tr><td><kbd>Shift</kbd> / <kbd>E</kbd></td><td>Lift thrusters — fly</td></tr>
          <tr><td><kbd>F</kbd> · <kbd>C</kbd></td><td>Aero mode (hold in the air to dive) · camera</td></tr>
          <tr><td><kbd>R</kbd> · <kbd>T</kbd></td><td>Reset to track · restart</td></tr>
          <tr><td><kbd>Esc</kbd> · <kbd>M</kbd></td><td>Pause · mute</td></tr>
        </table></div>
      </div>
      ${padStatusHTML()}
      <div class="disclaimer">Unofficial fan game inspired by the next-gen Roadster. Not affiliated with or endorsed by Tesla, Inc.</div>
    </div>`;
  } else if (state === 'paused') {
    const items = [['resume', 'Resume'], ['restart', 'Restart'], ['menu', 'Main menu']];
    html = `<div class="panel narrow">
      <h1 class="heading">PAUSED</h1>
      <div class="heading-sub">${mode === 'race' ? 'Race' : 'Time Trial'}</div>
      <div class="menu-list">${items.map(([a, l], i) => `<div class="menu-item ${i === pauseSel ? 'sel' : ''}" data-act="${a}">${l}</div>`).join('')}</div>
      <div class="hint">${X('A', 'a')} select · ${X('B', 'b')} resume</div>
      ${padStatusHTML()}
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
  if (p.mode === 'track') spinWheels(m, p.u); else m.spinT = performance.now() / 1000;
  m.shadow.visible = p.mode === 'track';
  if (m.wing) m.wing.rotation.z = p.aero === 0 ? 0.32 : 0.04;
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
  tp[1] = Math.max(tp[1], groundHeight(tp[0], tp[2]) + 0.7);
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

  sun.position.set(P[0] + SUN_DIR[0] * 200, P[1] + SUN_DIR[1] * 200, P[2] + SUN_DIR[2] * 200);
  sun.target.position.set(P[0], P[1], P[2]);
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
  if (p.mode === 'air') { label = p.diving ? 'DIVE · FANS PULLING DOWN' : p.diveHeld ? 'DIVE · WAITING FOR TRACK BELOW' : `AIRBORNE · ${p.airTime.toFixed(1)} s`; col = '#7cf7ff'; }
  else if (p.inverted) { label = 'UPSIDE DOWN · FANS HOLDING'; col = '#ff9f43'; }
  else { label = p.aero === 0 ? 'HIGH DOWNFORCE' : 'LOW DRAG'; col = p.aero === 0 ? '#9fd4ff' : '#f2c230'; }
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
  text(p.mode === 'track' ? `load ${(p.load / G).toFixed(1)} g` : 'load 0.0 g', gx, gy + 74, 10, '#8a9099', 'center', 500);

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

  drawMinimap();

  const hint = lastDevice === 'pad'
    ? 'RT throttle · LT brake · A thrusters · X lift · Y aero/dive · D-pad ↑ reset · LB/RB camera · ☰ pause'
    : '↑ throttle · ↓ brake · Space thrusters · Shift lift · F aero · C camera · R reset · Esc pause';
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
    else if (countdown > 3) text(`Hold ${lastDevice === 'pad' ? 'RT' : '↑'} at green · launch in HIGH DOWNFORCE`, W / 2, ly + 66, 14, '#fff', 'center', 600);
  }
  if (p.offCourse > 0) text('OFF COURSE', W / 2, H * 0.45, 40, '#ffb347', 'center', 900);
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
  renderer.render(scene, camera);
  drawHUD();
  audio.update(player);
}

toTitle();
requestAnimationFrame(frame);
})();
