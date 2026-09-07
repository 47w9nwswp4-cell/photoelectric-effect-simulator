const H = 6.62607015e-34;
const QE = 1.60217662e-19;
const C = 2.99792458e8;
const ME = 9.1093837e-31;

const METALS = [
  { id: "Cs", name: "鋰 Cs", phi: 2.14 },
  { id: "K",  name: "鈦 K",  phi: 2.30 },
  { id: "Na", name: "鈉 Na", phi: 2.36 },
  { id: "Ca", name: "鈣 Ca", phi: 2.87 },
  { id: "Zn", name: "鋅 Zn", phi: 4.33 },
  { id: "Cu", name: "銅 Cu", phi: 4.65 },
  { id: "Pt", name: "鉑 Pt", phi: 6.35 },
];

const MODES = [
  { id: "cell", label: "真空光電池" },
  { id: "thresh", label: "臨界頻率" },
  { id: "stop", label: "遏止電壓" },
  { id: "inten", label: "強度 → Iₛ" },
];

const XC = -1.32, XA = 1.32, DVIS = XA - XC;
const YP = 0.82, ZP = 0.55;
const LAMP = { x: -2.35, y: 1.55, z: 0.15 };

const state = {
  mode: "cell",
  metal: "Na",
  lam: 380,
  inten: 2.2,
  V: 2.0,
};

let play = true, autoSpin = false, lastTs = 0, accEmit = 0;
let collected = 0, returned = 0, emitted = 0, absorbed = 0;
const cam = { yaw: 0.62, pitch: 0.34, dist: 6.4 };
let dragging = false, lastMX = 0, lastMY = 0;

const photons = [];
const electrons = [];
const sparks = [];
const MAX_P = 80, MAX_E = 90;

const $ = (id) => document.getElementById(id);
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function metal() { return METALS.find((m) => m.id === state.metal); }
function fmt(n, d = 2) {
  if (!Number.isFinite(n)) return "—";
  const x = Math.abs(n) < 1e-15 ? 0 : n;
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e4 || a < 1e-3)) return x.toExponential(2);
  return x.toFixed(d);
}
function wlColor(nm) {
  if (nm < 380) return "#b388ff";
  if (nm < 450) return "#6b7cff";
  if (nm < 495) return "#3dd6c6";
  if (nm < 570) return "#5ee08a";
  if (nm < 590) return "#e4e05a";
  if (nm < 620) return "#ffb020";
  return "#ff6b7a";
}

function physics() {
  const phi = metal().phi;
  const lam = state.lam * 1e-9;
  const f = C / lam;
  const hf = (H * f) / QE;
  const f0 = (phi * QE) / H;
  const lam0 = (H * C) / (phi * QE) * 1e9;
  const above = hf > phi + 1e-9;
  const Kmax = above ? hf - phi : 0;
  const Vs = Kmax;
  const vmax = above ? Math.sqrt(2 * Kmax * QE / ME) : 0;
  const Isat = above ? state.inten * 12.5 : 0;
  let I = 0;
  if (above) {
    if (state.V >= 0) I = Isat;
    else if (state.V <= -Vs) I = 0;
    else I = Isat * (1 - Math.pow((-state.V) / (Vs || 1), 1.35));
  }
  return { phi, f, hf, f0, lam0, above, Kmax, Vs, vmax, Isat, I };
}

function resetParticles() {
  photons.length = 0;
  electrons.length = 0;
  sparks.length = 0;
  accEmit = 0;
  collected = returned = emitted = absorbed = 0;
}

function spawnPhoton() {
  if (photons.length >= MAX_P) return;
  const ty = (Math.random() * 2 - 1) * YP * 0.82;
  const tz = (Math.random() * 2 - 1) * ZP * 0.82;
  const dx = XC + 0.04 - LAMP.x, dy = ty - LAMP.y, dz = tz - LAMP.z;
  const L = Math.hypot(dx, dy, dz) || 1;
  photons.push({
    x: LAMP.x, y: LAMP.y, z: LAMP.z,
    vx: dx / L * 3.6, vy: dy / L * 3.6, vz: dz / L * 3.6,
    tx: XC + 0.04, ty, tz,
  });
}

function emitElectron(y, z) {
  const p = physics();
  if (!p.above) { absorbed++; return; }
  if (electrons.length >= MAX_E) return;
  const frac = 0.42 + Math.random() * 0.58;
  const KeV = p.Kmax * frac;
  const vVis = Math.sqrt(Math.max(KeV, 0.02)) * 1.85;
  const a1 = (Math.random() - 0.5) * 0.7;
  const a2 = (Math.random() - 0.5) * 0.7;
  const nx = 1, ny = a1, nz = a2;
  const n = Math.hypot(nx, ny, nz);
  electrons.push({
    x: XC + 0.07, y, z,
    vx: nx / n * vVis, vy: ny / n * vVis, vz: nz / n * vVis,
    ke0: KeV, trail: [], alive: true, hit: "",
  });
  emitted++;
}

function stepParticles(dt) {
  const p = physics();
  const ax = state.V * 0.65;
  for (let i = photons.length - 1; i >= 0; i--) {
    const ph = photons[i];
    ph.x += ph.vx * dt; ph.y += ph.vy * dt; ph.z += ph.vz * dt;
    if (ph.x <= XC + 0.05) {
      emitElectron(ph.ty, ph.tz);
      photons.splice(i, 1);
    } else if (ph.x < -3.4 || ph.y > 3 || ph.y < -3) {
      photons.splice(i, 1);
    }
  }
  for (let i = electrons.length - 1; i >= 0; i--) {
    const e = electrons[i];
    if (!e.alive) { electrons.splice(i, 1); continue; }
    e.vx += ax * dt;
    e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
    e.trail.push([e.x, e.y, e.z]);
    if (e.trail.length > 48) e.trail.shift();
    if (e.x >= XA - 0.06 && Math.abs(e.y) < YP + 0.08 && Math.abs(e.z) < ZP + 0.08) {
      collected++;
      sparks.push({ x: e.x, y: e.y, z: e.z, t: 0.28, c: "#5ee08a" });
      electrons.splice(i, 1);
      continue;
    }
    if (e.x <= XC + 0.04) {
      returned++;
      sparks.push({ x: e.x, y: e.y, z: e.z, t: 0.28, c: "#ff6b7a" });
      electrons.splice(i, 1);
      continue;
    }
    if (Math.abs(e.y) > 1.7 || Math.abs(e.z) > 1.4 || e.x > XA + 0.4) {
      electrons.splice(i, 1);
    }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    sparks[i].t -= dt;
    if (sparks[i].t <= 0) sparks.splice(i, 1);
  }
  void p;
}
