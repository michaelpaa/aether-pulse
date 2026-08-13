/*
 * SUPER CHICKEN 3D — CLUCK GP  (CLUCK_GP_HANGFIX_v4)
 *
 * Not a blob racer. Real GLB karts + characters on a closed 3D track.
 *
 * Reused (see assets/CREDITS.txt):
 * - Chase-cam pullback / FOV punch: Three.js vehicle examples + HexGL-style speed offset
 *   (patterns only; HexGL CameraChase.js is CC-BY-NC and was NOT copied)
 * - Boost pads, dust, toon-ish race loop: cconsta1/threejs_car_demo (MIT)
 * - Chickensoft mascot GLB (CC BY 4.0) — Thibaud Goiffon / Chickensoft
 * - Kenney Car Kit 3.1 karts/cones/boxes (CC0)
 * - three.js Flamingo/Parrot/Stork (MIT) as track crowd
 * - Poly Haven asphalt + grass (CC0)
 * - Adult pack: original stylized adult GLBs (opt-in, not photoreal people)
 *
 * Hang-safe: dt clamp, NaN guards, wall + fall checkpoint, try/catch rAF,
 * 8s asset timeout, procedural fallback, adult pack only after opt-in.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SkeletonUtils } from "three/addons/utils/SkeletonUtils.js";

window.CLUCK_GP_BUILD = "CLUCK_GP_HANGFIX_v4";
console.log("CLUCK_GP_HANGFIX_v4");

const canvas = document.getElementById("game");
const overlay = document.getElementById("overlay");
const menu = document.getElementById("menu");
const results = document.getElementById("results");
const hud = document.getElementById("hud");
const loaderEl = document.getElementById("loader");
const loadFill = document.getElementById("load-fill");
const loadStatus = document.getElementById("load-status");
const placeEl = document.getElementById("place");
const lapEl = document.getElementById("lap");
const lapsEl = document.getElementById("laps");
const timerEl = document.getElementById("timer");
const speedEl = document.getElementById("speed");
const boostFill = document.getElementById("boost");
const weaponSlot = document.getElementById("weapon-slot");
const weaponMeta = document.getElementById("weapon-meta");
const countdownEl = document.getElementById("countdown");
const standingsEl = document.getElementById("standings");
const resultTitle = document.getElementById("result-title");
const tauntEl = document.getElementById("taunt");
const btnStart = document.getElementById("btn-start");
const btnRetry = document.getElementById("btn-retry");
const btnAdultMenu = document.getElementById("btn-adult-menu");
const btnAdultHud = document.getElementById("btn-adult-hud");
const adultStatus = document.getElementById("adult-status");
const adultWarn = document.getElementById("adult-warn");
const btnAdultCancel = document.getElementById("btn-adult-cancel");
const btnAdultConfirm = document.getElementById("btn-adult-confirm");
const mobilePad = document.getElementById("mobile-pad");

const TOTAL_LAPS = 3;
const RACER_COUNT = 4;
const MAX_SHOTS = 48;
const MAX_FX = 90;
const HALF_W = 4.55;
lapsEl.textContent = String(TOTAL_LAPS);

const WEAPONS = [
  { id: "egg", name: "EGG", cd: 0.3, speed: 36, life: 1.15, radius: 0.4, stun: 0.55, slow: 0.52 },
  { id: "corn", name: "CORN", cd: 0.82, speed: 28, life: 1.85, radius: 0.44, stun: 1.05, slow: 0.32, home: true },
  { id: "feather", name: "FEATHER", cd: 0.46, speed: 32, life: 0.4, radius: 0.22, stun: 0.28, slow: 0.76, spray: true },
];

const HEN_PACK = [
  { name: "YOU", tint: 0xfff3c4, kart: 0, taunt: "CLUCK AROUND AND FIND OUT" },
  { name: "CLUCK NORRIS", tint: 0xc4783a, kart: 1, taunt: "ROUNDHOUSE PECK" },
  { name: "HEN SOLO", tint: 0xf4eee6, kart: 2, taunt: "NEVER TELL ME THE CLUCKS" },
  { name: "PECKY BLINDERS", tint: 0xe8a54b, kart: 3, taunt: "BY ORDER OF THE PECK" },
];
const ADULT_PACK = [
  { name: "YOU", taunt: "KEEP UP, DARLING" },
  { name: "VENUS", taunt: "WATCH THE CURVES" },
  { name: "IVY", taunt: "KISS THE ASPHALT" },
  { name: "LOLA", taunt: "TOO SLOW, BABY" },
];
const COLORS = ["#ffc43d", "#39e7ff", "#ff6b9d", "#b6ff3b"];
const KART_FILES = ["kart-oobi.glb", "kart-oodi.glb", "kart-ooli.glb", "kart-oopi.glb"];
const CHICKEN_TAUNTS = ["BUK-BUK-BOOM!", "EGG ON YOUR FACE", "THAT'S A FOWL", "WINGS UP"];
const ADULT_TAUNTS = ["NICE TRY", "STILL BEHIND", "HEAT LAP", "DON'T STARE — RACE"];
const ASSET_TIMEOUT_MS = 8000;
const BOOT_DEADLINE_MS = 10000;

const assets = {
  chicken: null,
  karts: [null, null, null, null],
  adults: [null, null, null, null],
  flamingo: null,
  parrot: null,
  stork: null,
  cone: null,
  box: null,
  asphalt: null,
  grass: null,
};

let W = 800;
let H = 600;
let last = 0;
let mode = "menu";
let raceTime = 0;
let countValue = 3;
let countTimer = 0;
let adultMode = false;
let adultConfirmed = false;
let worldTime = 0;
let tauntTimer = 0;
let loaded = false;
let crowdPlaced = false;
let adultAssetsPromise = null;
let crowdAssetsPromise = null;

const input = {
  left: false,
  right: false,
  accel: false,
  brake: false,
  boost: false,
  fire: false,
  firePressed: false,
  weaponPressed: false,
  touchSteer: 0,
  touchAccel: 0,
  usingTouch: false,
};

const audio = { ctx: null, master: null };
const track = { pts: [], cum: [], length: 0, halfW: HALF_W, checkpoints: [], jumpS: 0 };
const racers = [];
const shots = [];
const fx = [];
const itemBoxes = [];
const boostPads = [];
let player = null;
let scene = null;
let camera = null;
let renderer = null;
let world = null;
let sun = null;
let speedLines = [];
const loadingManager = new THREE.LoadingManager();
loadingManager.setURLModifier((url) => {
  const clean = String(url || "").split("?")[0];
  if (/colormap\.png$/i.test(clean)) {
    return new URL("assets/karts/colormap.png", window.location.href).href;
  }
  return url;
});
const gltfLoader = new GLTFLoader(loadingManager);
const texLoader = new THREE.TextureLoader(loadingManager);

function rand(a, b) {
  return a + Math.random() * (b - a);
}
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function finite(n) {
  return Number.isFinite(n);
}
function angNorm(a) {
  if (!finite(a)) return 0;
  a = ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a;
}
function clampDt(raw) {
  if (!finite(raw) || raw <= 0) return 0.016;
  return Math.min(raw, 0.033);
}

function setLoad(p, msg) {
  if (loadFill) {
    loadFill.setAttribute("data-lock", "1");
    loadFill.style.width = clamp(p, 0, 1) * 100 + "%";
  }
  if (loadStatus && msg) {
    loadStatus.setAttribute("data-live", "1");
    loadStatus.textContent = msg;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(ms, label, fn) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("timeout " + ms + "ms: " + label));
    }, ms);
    Promise.resolve()
      .then(fn)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

function safeBeep(freq, dur, type, vol, slide) {
  try {
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.16;
      audio.master.connect(audio.ctx.destination);
    }
    if (audio.ctx.state === "suspended") audio.ctx.resume();
    const t0 = audio.ctx.currentTime;
    const o = audio.ctx.createOscillator();
    const g = audio.ctx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(Math.max(40, freq), t0);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(Math.max(0.0001, vol || 0.08), t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.03, dur));
    o.connect(g);
    g.connect(audio.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  } catch (_) {}
}

function sfx(name) {
  if (name === "start") safeBeep(220, 0.1, "triangle", 0.08, 180);
  else if (name === "count") safeBeep(440, 0.08, "square", 0.07, 0);
  else if (name === "go") safeBeep(660, 0.18, "sawtooth", 0.1, 220);
  else if (name === "shot") safeBeep(780, 0.05, "square", 0.05, -240);
  else if (name === "hit") safeBeep(120, 0.16, "sawtooth", 0.1, -40);
  else if (name === "boost") safeBeep(180, 0.2, "sawtooth", 0.09, 260);
  else if (name === "lap") safeBeep(400, 0.12, "triangle", 0.08, 240);
  else if (name === "weapon") safeBeep(520, 0.06, "square", 0.06, 200);
  else if (name === "item") safeBeep(880, 0.1, "triangle", 0.07, 200);
  else if (name === "finish") {
    safeBeep(400, 0.12, "triangle", 0.09, 120);
    safeBeep(600, 0.18, "sine", 0.08, 180);
  }
}

function mat(color, extra) {
  return new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.62, metalness: 0.04 }, extra || {}));
}

function prepTex(t, repeatX, repeatY) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX || 1, repeatY || 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function loadGLB(url) {
  return withTimeout(ASSET_TIMEOUT_MS, url, async () => {
    const ctrl = new AbortController();
    const abortTimer = setTimeout(() => ctrl.abort(), ASSET_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
      const buf = await res.arrayBuffer();
      const resourcePath = url.slice(0, url.lastIndexOf("/") + 1);
      return await new Promise((resolve, reject) => {
        gltfLoader.parse(buf, resourcePath, resolve, reject);
      });
    } finally {
      clearTimeout(abortTimer);
    }
  });
}

function loadTex(url) {
  return withTimeout(ASSET_TIMEOUT_MS, url, () => {
    return new Promise((resolve, reject) => {
      texLoader.load(url, resolve, undefined, reject);
    });
  });
}

async function loadOne(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn("CLUCK GP asset failed, using fallback:", label, err);
    return null;
  }
}

async function runJobs(jobs, progressFrom, progressTo) {
  if (!jobs.length) {
    setLoad(progressTo, "Ready.");
    return;
  }
  let done = 0;
  await Promise.all(
    jobs.map(async ([label, fn]) => {
      setLoad(progressFrom + ((progressTo - progressFrom) * done) / jobs.length, "Lade " + label + "…");
      await loadOne(label, fn);
      done += 1;
      setLoad(progressFrom + ((progressTo - progressFrom) * done) / jobs.length, "Lade " + label + "…");
    })
  );
}

async function loadBootAssets() {
  const jobs = [
    ["Huhn", async () => (assets.chicken = await loadGLB("assets/chickens/chickensoft.glb"))],
    ["Kart 1", async () => (assets.karts[0] = await loadGLB("assets/karts/" + KART_FILES[0]))],
    ["Kart 2", async () => (assets.karts[1] = await loadGLB("assets/karts/" + KART_FILES[1]))],
    ["Kart 3", async () => (assets.karts[2] = await loadGLB("assets/karts/" + KART_FILES[2]))],
    ["Kart 4", async () => (assets.karts[3] = await loadGLB("assets/karts/" + KART_FILES[3]))],
    ["Cone", async () => (assets.cone = await loadGLB("assets/karts/cone.glb"))],
    ["Item", async () => (assets.box = await loadGLB("assets/karts/item-box.glb"))],
    ["Asphalt", async () => (assets.asphalt = prepTex(await loadTex("assets/track/asphalt.jpg"), 18, 1.2))],
    ["Gras", async () => (assets.grass = prepTex(await loadTex("assets/track/grass.jpg"), 28, 28))],
  ];
  setLoad(0.08, "Lade Strecke… Timeout 8s, dann Fallback.");
  await runJobs(jobs, 0.1, 0.92);
  setLoad(1, "Ready.");
}

function loadCrowdAssets() {
  if (crowdAssetsPromise) return crowdAssetsPromise;
  crowdAssetsPromise = (async () => {
    await runJobs(
      [
        ["Flamingo", async () => (assets.flamingo = await loadGLB("assets/chickens/flamingo.glb"))],
        ["Parrot", async () => (assets.parrot = await loadGLB("assets/chickens/parrot.glb"))],
        ["Stork", async () => (assets.stork = await loadGLB("assets/chickens/stork.glb"))],
      ],
      1,
      1
    );
    spawnCrowd();
  })().catch((err) => console.warn("CLUCK GP crowd skipped:", err));
  return crowdAssetsPromise;
}

function loadAdultAssets() {
  if (adultAssetsPromise) return adultAssetsPromise;
  adultAssetsPromise = runJobs(
    [
      ["Venus", async () => (assets.adults[0] = await loadGLB("assets/adults/venus.glb"))],
      ["Ivy", async () => (assets.adults[1] = await loadGLB("assets/adults/ivy.glb"))],
      ["Sienna", async () => (assets.adults[2] = await loadGLB("assets/adults/sienna.glb"))],
      ["Lola", async () => (assets.adults[3] = await loadGLB("assets/adults/lola.glb"))],
    ],
    0.2,
    1
  );
  return adultAssetsPromise;
}

function cloneGltf(gltf) {
  if (!gltf || !gltf.scene) return null;
  const hasSkin = (() => {
    let s = false;
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh) s = true;
    });
    return s;
  })();
  const root = hasSkin ? SkeletonUtils.clone(gltf.scene) : gltf.scene.clone(true);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) {
        if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
        else o.material = o.material.clone();
      }
    }
  });
  return root;
}

function tintRoot(root, color) {
  if (!root) return;
  const c = new THREE.Color(color);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const apply = (m) => {
      const nm = m.clone();
      if (nm.color) nm.color.lerp(c, 0.55);
      else nm.color = c.clone();
      nm.roughness = 0.55;
      nm.metalness = 0.04;
      return nm;
    };
    if (!o.material) {
      o.material = new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.04 });
    } else if (Array.isArray(o.material)) {
      o.material = o.material.map(apply);
    } else {
      o.material = apply(o.material);
    }
  });
}

function fitModel(root, targetH, sitY) {
  if (!root) return root;
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.z > size.y * 1.35 && size.z > size.x) {
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    box.getSize(size);
  }
  const s = targetH / Math.max(size.y, 0.001);
  root.scale.multiplyScalar(s);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.x -= c.x;
  root.position.z -= c.z;
  root.position.y += (sitY || 0) - box.min.y;
  return root;
}

function findClip(gltf, names) {
  if (!gltf || !gltf.animations) return null;
  const lower = gltf.animations.map((a) => a.name.toLowerCase());
  for (const n of names) {
    const i = lower.findIndex((x) => x === n || x.includes(n));
    if (i >= 0) return gltf.animations[i];
  }
  return gltf.animations[0] || null;
}

function buildTrackData() {
  const N = 112;
  const raw = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 48 + 12 * Math.cos(2 * a) + 6 * Math.sin(3 * a + 0.35);
    const x = Math.cos(a) * r + 6 * Math.sin(2 * a);
    const z = Math.sin(a) * r * 0.72 + 4 * Math.cos(3 * a);
    let y = 0.85 + 2.2 * Math.sin(2 * a) + 0.75 * Math.cos(4 * a);
    const jump = Math.exp(-Math.pow((a - 2.15) * 5.2, 2)) * 6.2;
    y += jump;
    raw.push({ x, y, z });
  }
  const pts = raw.map((p, i) => {
    const a = raw[(i - 1 + N) % N];
    const b = raw[i];
    const c = raw[(i + 1) % N];
    return { x: (a.x + b.x * 2 + c.x) / 4, y: (a.y + b.y * 2 + c.y) / 4, z: (a.z + b.z * 2 + c.z) / 4 };
  });
  track.pts = [];
  track.cum = [0];
  track.length = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % N];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    const tx = dx / d;
    const tz = dz / d;
    track.pts.push({ x: a.x, y: a.y, z: a.z, tx, ty: dy / d, tz, nx: -tz, nz: tx });
    track.length += Math.hypot(dx, dy, dz) || 1;
    track.cum.push(track.length);
  }
  track.jumpS = track.length * (2.15 / (Math.PI * 2));
  track.checkpoints = [];
  for (let i = 0; i < 14; i++) {
    const s = (i / 14) * track.length;
    track.checkpoints.push(Object.assign({ s }, sampleTrack(s)));
  }
}

function sampleTrack(s) {
  const L = track.length || 1;
  s = ((s % L) + L) % L;
  let i = 0;
  while (i < track.cum.length - 1 && track.cum[i + 1] < s) i++;
  const s0 = track.cum[i];
  const s1 = track.cum[i + 1];
  const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
  const a = track.pts[i % track.pts.length];
  const b = track.pts[(i + 1) % track.pts.length];
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    tx: lerp(a.tx, b.tx, t),
    tz: lerp(a.tz, b.tz, t),
    nx: lerp(a.nx, b.nx, t),
    nz: lerp(a.nz, b.nz, t),
    s,
    i,
    t,
  };
}

function nearestOnTrack(x, z) {
  let best = 0;
  let bestD = Infinity;
  const step = Math.max(4, (track.pts.length / 20) | 0);
  for (let i = 0; i < track.pts.length; i += step) {
    const p = track.pts[i];
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const lo = best - step;
  const hi = best + step;
  for (let i = lo; i <= hi; i++) {
    const idx = ((i % track.pts.length) + track.pts.length) % track.pts.length;
    const p = track.pts[idx];
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bestD) {
      bestD = d;
      best = idx;
    }
  }
  const a = track.pts[best];
  const b = track.pts[(best + 1) % track.pts.length];
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const apx = x - a.x;
  const apz = z - a.z;
  const ab2 = abx * abx + abz * abz || 1;
  const t = clamp((apx * abx + apz * abz) / ab2, 0, 1);
  const px = a.x + abx * t;
  const pz = a.z + abz * t;
  const py = lerp(a.y, b.y, t);
  const dlen = Math.hypot(abx, abz) || 1;
  const tx = abx / dlen;
  const tz = abz / dlen;
  const nx = -tz;
  const nz = tx;
  const lat = (x - px) * nx + (z - pz) * nz;
  const s = track.cum[best] + t * dlen;
  return { x: px, y: py, z: pz, tx, tz, nx, nz, lat, s, dist: Math.hypot(x - px, z - pz) };
}

function makeRoadMesh() {
  const n = track.pts.length;
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  const hw = track.halfW;
  let run = 0;
  for (let i = 0; i <= n; i++) {
    const p = track.pts[i % n];
    const q = track.pts[(i + 1) % n];
    pos.push(p.x + p.nx * hw, p.y + 0.05, p.z + p.nz * hw);
    pos.push(p.x - p.nx * hw, p.y + 0.05, p.z - p.nz * hw);
    nrm.push(0, 1, 0, 0, 1, 0);
    const u = (run / Math.max(1, track.length)) * 22;
    uv.push(u, 0, u, 1);
    run += Math.hypot(q.x - p.x, q.z - p.z);
  }
  for (let i = 0; i < n; i++) {
    const l0 = i * 2;
    const r0 = l0 + 1;
    const l1 = (i + 1) * 2;
    const r1 = l1 + 1;
    idx.push(l0, r0, l1, r0, r1, l1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const roadMat = assets.asphalt
    ? new THREE.MeshStandardMaterial({ map: assets.asphalt, roughness: 0.92, metalness: 0.04 })
    : mat(0x4a453c, { roughness: 0.9 });
  const mesh = new THREE.Mesh(geo, roadMat);
  mesh.receiveShadow = true;
  return mesh;
}

function addCurbs(group) {
  const n = track.pts.length;
  const hw = track.halfW;
  for (const side of [-1, 1]) {
    const pos = [];
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const p = track.pts[i % n];
      const ox = p.nx * hw * side;
      const oz = p.nz * hw * side;
      pos.push(p.x + ox, p.y + 0.03, p.z + oz);
      pos.push(p.x + ox + p.nx * 0.32 * side, p.y + 0.42, p.z + oz + p.nz * 0.32 * side);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = (i + 1) * 2;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat(side > 0 ? 0xffc43d : 0xe23d3d, { roughness: 0.45 }));
    m.receiveShadow = true;
    group.add(m);
  }
}

function placeClone(gltf, x, y, z, h, yaw) {
  const n = cloneGltf(gltf);
  if (!n) return null;
  fitModel(n, h, 0);
  n.position.x += x;
  n.position.y += y;
  n.position.z += z;
  n.rotation.y += yaw || 0;
  world.add(n);
  return n;
}

function buildWorld() {
  if (world) scene.remove(world);
  crowdPlaced = false;
  world = new THREE.Group();
  scene.add(world);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(170, 64),
    assets.grass
      ? new THREE.MeshStandardMaterial({ map: assets.grass, roughness: 1, metalness: 0 })
      : mat(0x3f8a38, { roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.55;
  ground.receiveShadow = true;
  world.add(ground);

  world.add(makeRoadMesh());
  addCurbs(world);

  const lineMat = mat(0xffe08a, { roughness: 0.35, emissive: 0x3a2a00, emissiveIntensity: 0.15 });
  for (let i = 0; i < track.pts.length; i += 2) {
    const p = track.pts[i];
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 1.05), lineMat);
    dash.position.set(p.x, p.y + 0.08, p.z);
    dash.rotation.y = Math.atan2(p.tx, p.tz);
    world.add(dash);
  }

  const start = sampleTrack(0);
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.14, 3.4, 8);
  const poleMat = mat(0xf2f2f2);
  for (const s of [-1, 1]) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(start.x + start.nx * HALF_W * s, start.y + 1.7, start.z + start.nz * HALF_W * s);
    pole.castShadow = true;
    world.add(pole);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2.15, 0.6, 0.08), mat(0xff7a1a, { emissive: 0x4a1800, emissiveIntensity: 0.2 }));
  banner.position.set(start.x, start.y + 3.2, start.z);
  banner.rotation.y = Math.atan2(start.tx, start.tz);
  world.add(banner);

  itemBoxes.length = 0;
  boostPads.length = 0;
  for (let i = 0; i < 8; i++) {
    const s = ((i + 0.5) / 8) * track.length;
    const p = sampleTrack(s);
    let mesh;
    if (assets.box) {
      mesh = cloneGltf(assets.box);
      fitModel(mesh, 0.55, p.y + 0.55);
      mesh.position.x += p.x;
      mesh.position.z += p.z;
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), mat(0x39e7ff, { emissive: 0x113344, emissiveIntensity: 0.4 }));
      mesh.position.set(p.x, p.y + 0.7, p.z);
    }
    world.add(mesh);
    itemBoxes.push({ s, mesh, taken: false, respawn: 0, x: p.x, y: p.y, z: p.z });
  }
  for (let i = 0; i < 5; i++) {
    const s = ((i + 0.2) / 5) * track.length;
    const p = sampleTrack(s);
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.06, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x39e7ff, emissive: 0x39e7ff, emissiveIntensity: 0.7, roughness: 0.3 })
    );
    pad.position.set(p.x, p.y + 0.09, p.z);
    pad.rotation.y = Math.atan2(p.tx, p.tz);
    world.add(pad);
    boostPads.push({ s, mesh: pad, x: p.x, z: p.z });
  }

  const jump = sampleTrack(track.jumpS);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 1.7, 0.18, 3.2), mat(0xffc43d, { emissive: 0x664400, emissiveIntensity: 0.25 }));
  ramp.position.set(jump.x, jump.y + 0.2, jump.z);
  ramp.rotation.y = Math.atan2(jump.tx, jump.tz);
  world.add(ramp);

  for (let i = 0; i < 18; i++) {
    const p = track.pts[(i * 6) % track.pts.length];
    const side = i % 2 === 0 ? 1 : -1;
    const dist = HALF_W + 5.5 + (i % 4);
    const x = p.x + p.nx * dist * side;
    const z = p.z + p.nz * dist * side;
    if (assets.cone && i % 3 === 0) {
      placeClone(assets.cone, x, p.y - 0.2, z, 0.7, 0);
    } else {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 1.5, 6), mat(0x6b3f1f));
      trunk.position.y = 0.75;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1.05, 8, 6), mat(0x2f6b28));
      leaf.position.y = 2.05;
      leaf.scale.set(1, 1.15, 1);
      tree.add(trunk, leaf);
      tree.position.set(x, p.y - 0.25, z);
      tree.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      world.add(tree);
    }
  }

  spawnCrowd();
}

function spawnCrowd() {
  if (!world || crowdPlaced) return;
  const birds = [assets.flamingo, assets.parrot, assets.stork];
  if (!birds.some(Boolean)) return;
  crowdPlaced = true;
  for (let i = 0; i < 9; i++) {
    const g = birds[i % birds.length];
    if (!g) continue;
    const p = track.pts[(i * 11 + 4) % track.pts.length];
    const side = i % 2 ? 1 : -1;
    const n = placeClone(g, p.x + p.nx * (HALF_W + 8) * side, p.y + 0.2, p.z + p.nz * (HALF_W + 8) * side, 1.1, rand(0, Math.PI * 2));
    if (n && g.animations && g.animations[0]) {
      const mix = new THREE.AnimationMixer(n);
      mix.clipAction(g.animations[0]).play();
      n.userData.mixer = mix;
    }
  }
}

function makeFlame() {
  const g = new THREE.Group();
  const m1 = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.6, 7), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
  m1.rotation.x = Math.PI;
  const m2 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.42, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
  m2.rotation.x = Math.PI;
  m2.position.y = -0.05;
  g.add(m1, m2);
  g.visible = false;
  return g;
}

function makeChickenFallback(pack) {
  const g = new THREE.Group();
  const bodyM = mat(pack.tint);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 12), bodyM);
  body.scale.set(1.15, 0.9, 1);
  body.position.set(0, 0.55, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), bodyM);
  head.position.set(0, 0.95, 0.32);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 6), mat(0xff9a2e));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.9, 0.55);
  const comb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), mat(0xe23d3d));
  comb.position.set(0, 1.18, 0.28);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.38, 6), mat(0xe23d3d));
  tail.rotation.x = -1.1;
  tail.position.set(0, 0.62, -0.42);
  g.add(body, head, beak, comb, tail);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}

function makeDriver(id, adult) {
  if (adult) {
    const gltf = assets.adults[id];
    if (gltf) {
      const n = cloneGltf(gltf);
      fitModel(n, 0.92, 0.28);
      n.userData.kind = "adult";
      n.userData.baseY = n.position.y;
      return n;
    }
    console.warn("CLUCK GP: adult GLB missing for", id, "— fallback");
  } else {
    if (assets.chicken) {
      const n = cloneGltf(assets.chicken);
      tintRoot(n, HEN_PACK[id].tint);
      fitModel(n, 0.58, 0.32);
      const mixer = new THREE.AnimationMixer(n);
      const idleClip = findClip(assets.chicken, ["idle"]);
      const runClip = findClip(assets.chicken, ["run"]);
      const jumpClip = findClip(assets.chicken, ["jump"]);
      const actions = {};
      if (idleClip) actions.idle = mixer.clipAction(idleClip);
      if (runClip) actions.run = mixer.clipAction(runClip);
      if (jumpClip) actions.jump = mixer.clipAction(jumpClip);
      if (actions.idle) actions.idle.play();
      n.userData.mixer = mixer;
      n.userData.actions = actions;
      n.userData.kind = "chicken";
      n.userData.baseY = n.position.y;
      return n;
    }
    console.warn("CLUCK GP: chicken GLB missing — fallback primitive");
    return makeChickenFallback(HEN_PACK[id]);
  }
  return makeChickenFallback(HEN_PACK[id]);
}

function makeKartFallback(id) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.28, 1.45), mat(HEN_PACK[id].tint));
  body.position.y = 0.28;
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.16, 0.5), mat(0x222222));
  hood.position.set(0, 0.42, -0.35);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.4), mat(0x1a1408));
  seat.position.set(0, 0.48, 0.12);
  g.add(body, hood, seat);
  const wheelM = mat(0x1a1a1a, { roughness: 0.9 });
  const spots = [
    [-0.42, 0.42],
    [0.42, 0.42],
    [-0.42, -0.48],
    [0.42, -0.48],
  ];
  for (const [x, z] of spots) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 10), wheelM);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.16, z);
    g.add(w);
  }
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

function makeKart(id) {
  const gltf = assets.karts[id] || assets.karts.find(Boolean);
  if (gltf) {
    const n = cloneGltf(gltf);
    fitModel(n, 0.62, 0);
    const wrap = new THREE.Group();
    wrap.add(n);
    wrap.rotation.y = Math.PI;
    return wrap;
  }
  console.warn("CLUCK GP: kart GLB missing — fallback primitive");
  return makeKartFallback(id);
}

function applySkin(r) {
  if (r.driver) {
    r.root.remove(r.driver);
    if (r.driver.userData && r.driver.userData.mixer) {
      try {
        r.driver.userData.mixer.stopAllAction();
      } catch (_) {}
    }
  }
  r.driver = makeDriver(r.id, adultMode);
  r.root.add(r.driver);
  r.name = adultMode ? ADULT_PACK[r.id].name : HEN_PACK[r.id].name;
}

function setAdultMode(on) {
  adultMode = !!on;
  if (adultMode) adultConfirmed = true;
  for (const r of racers) applySkin(r);
  syncAdultUi();
}

function syncAdultUi() {
  const label = adultMode ? "18+ ON" : "18+ CHICKENS";
  if (btnAdultHud) {
    btnAdultHud.textContent = label;
    btnAdultHud.classList.toggle("on", adultMode);
  }
  if (btnAdultMenu) {
    btnAdultMenu.textContent = adultMode ? "ADULT PACK ON" : "18+ UNLOCK ADULT";
    btnAdultMenu.classList.toggle("on", adultMode);
  }
  if (adultStatus) {
    adultStatus.textContent = adultMode
      ? "Adult-Pack aktiv. Nochmal tippen = zurück zu Hühnern."
      : "Standard: lustige Hühner. Adult-Pack nur nach Opt-in.";
  }
}

function requestAdultToggle() {
  if (adultMode) {
    setAdultMode(false);
    return;
  }
  if (adultConfirmed) {
    enableAdultPack();
    return;
  }
  adultWarn.classList.remove("hidden");
}

async function enableAdultPack() {
  adultConfirmed = true;
  if (adultStatus) adultStatus.textContent = "Lade Adult-Pack… Timeout 8s, dann Fallback.";
  await loadAdultAssets();
  setAdultMode(true);
}

function makeRacer(id) {
  const start = sampleTrack((track.length - id * 3.6) % track.length);
  const lane = (id - (RACER_COUNT - 1) / 2) * 1.4;
  const heading = Math.atan2(start.tx, start.tz);
  const root = new THREE.Group();
  const flame = makeFlame();
  flame.position.set(0, 0.28, 0.7);
  root.add(flame);
  scene.add(root);
  const r = {
    id,
    isPlayer: id === 0,
    name: HEN_PACK[id].name,
    color: COLORS[id],
    x: start.x + start.nx * lane,
    y: start.y,
    z: start.z + start.nz * lane,
    heading,
    speed: 0,
    vy: 0,
    boost: 1,
    boosting: false,
    stun: 0,
    lap: 0,
    progress: 0,
    finishTime: null,
    finished: false,
    place: id + 1,
    weapon: 0,
    fireCd: 0,
    muzzle: 0,
    root,
    kart: null,
    driver: null,
    flame,
    _lastS: start.s,
    safeS: start.s,
    offTimer: 0,
    steerVis: 0,
  };
  r.kart = makeKart(id);
  root.add(r.kart);
  applySkin(r);
  return r;
}

function resetRace() {
  for (const r of racers) {
    if (r.root) scene.remove(r.root);
  }
  clearShots();
  clearFx();
  racers.length = 0;
  for (let i = 0; i < RACER_COUNT; i++) racers.push(makeRacer(i));
  player = racers[0];
  raceTime = 0;
  countValue = 3;
  countTimer = 1;
  mode = "countdown";
  for (const b of itemBoxes) {
    b.taken = false;
    b.respawn = 0;
    if (b.mesh) b.mesh.visible = true;
  }
  updateHud();
  countdownEl.textContent = "3";
  countdownEl.classList.add("show");
  sfx("count");
  snapCamera(true);
}

function clearShots() {
  for (const s of shots) if (s.mesh) scene.remove(s.mesh);
  shots.length = 0;
}
function clearFx() {
  for (const p of fx) if (p.mesh) scene.remove(p.mesh);
  fx.length = 0;
}

function ordinal(n) {
  if (n === 1) return "1<span>st</span>";
  if (n === 2) return "2<span>nd</span>";
  if (n === 3) return "3<span>rd</span>";
  return n + "<span>th</span>";
}
function formatTime(t) {
  if (!finite(t)) t = 0;
  const m = (t / 60) | 0;
  const s = t - m * 60;
  const sec = s | 0;
  const ms = ((s - sec) * 1000) | 0;
  return m + ":" + String(sec).padStart(2, "0") + "." + String(ms).padStart(3, "0");
}

function showTaunt(text) {
  if (!tauntEl) return;
  tauntEl.textContent = text;
  tauntEl.classList.add("show");
  tauntTimer = 1.15;
}

function updateHud() {
  if (!player) return;
  placeEl.innerHTML = ordinal(player.place);
  lapEl.textContent = String(Math.min(TOTAL_LAPS, player.lap + 1));
  timerEl.textContent = formatTime(raceTime);
  speedEl.textContent = Math.round(Math.abs(player.speed) * 9.4) + " km/h";
  boostFill.style.transform = "scaleX(" + clamp(player.boost, 0, 1) + ")";
  const w = WEAPONS[player.weapon];
  weaponSlot.textContent = w.name;
  weaponMeta.textContent = player.fireCd > 0 ? player.fireCd.toFixed(1) + "s" : "RDY";
}

function burst(x, y, z, color, n) {
  const room = MAX_FX - fx.length;
  const c = Math.min(n, Math.max(0, room));
  for (let i = 0; i < c; i++) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 5, 5), new THREE.MeshBasicMaterial({ color }));
    mesh.position.set(x, y, z);
    scene.add(mesh);
    const a = rand(0, Math.PI * 2);
    const s = rand(2, 9);
    fx.push({ mesh, vx: Math.cos(a) * s, vy: rand(1, 7), vz: Math.sin(a) * s, life: rand(0.18, 0.42) });
  }
}

function spawnShot(owner, weapon, yawOff) {
  if (shots.length >= MAX_SHOTS) {
    const old = shots.shift();
    if (old.mesh) scene.remove(old.mesh);
  }
  const heading = owner.heading + yawOff;
  const sx = Math.sin(heading);
  const sz = Math.cos(heading);
  let mesh;
  if (weapon.id === "corn") {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.58, 8), mat(0xffc43d, { emissive: 0x664400, emissiveIntensity: 0.45 }));
    mesh.rotation.x = Math.PI / 2;
  } else if (weapon.id === "feather") {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.42), mat(0xf4f0e6, { emissive: 0x333333, emissiveIntensity: 0.2 }));
  } else {
    mesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), mat(0xfff4dc, { emissive: 0x443322, emissiveIntensity: 0.25 }));
  }
  mesh.position.set(owner.x + sx * 1.25, owner.y + 0.55, owner.z + sz * 1.25);
  scene.add(mesh);
  owner.muzzle = 0.08;
  shots.push({
    mesh,
    x: mesh.position.x,
    y: mesh.position.y,
    z: mesh.position.z,
    vx: sx * weapon.speed,
    vy: 0,
    vz: sz * weapon.speed,
    life: weapon.life,
    radius: weapon.radius,
    owner: owner.id,
    weapon: weapon.id,
    stun: weapon.stun,
    slow: weapon.slow,
    home: !!weapon.home,
  });
}

function fire(r) {
  if (!r || r.finished || r.stun > 0 || r.fireCd > 0) return;
  const w = WEAPONS[r.weapon];
  r.fireCd = w.cd;
  if (w.spray) {
    for (let i = -2; i <= 2; i++) spawnShot(r, w, i * 0.16);
  } else spawnShot(r, w, 0);
  sfx("shot");
}

function cycleWeapon(r) {
  r.weapon = (r.weapon + 1) % WEAPONS.length;
  if (r.isPlayer) {
    sfx("weapon");
    updateHud();
  }
}

function snapToCheckpoint(r) {
  const s = finite(r.safeS) ? r.safeS : 0;
  const samp = sampleTrack(s);
  r.x = samp.x;
  r.y = samp.y;
  r.z = samp.z;
  r.heading = Math.atan2(samp.tx, samp.tz);
  r.speed = 0;
  r.vy = 0;
  r.stun = 0.15;
  r.offTimer = 0;
  r._near = nearestOnTrack(r.x, r.z);
}

function sanitizeRacer(r) {
  if (!finite(r.x) || !finite(r.y) || !finite(r.z) || !finite(r.speed) || !finite(r.heading) || !finite(r.vy)) {
    snapToCheckpoint(r);
    return true;
  }
  if (Math.abs(r.x) > 220 || Math.abs(r.z) > 220 || r.y < -8 || r.y > 48) {
    snapToCheckpoint(r);
    return true;
  }
  return false;
}

function driveRacer(r, dt, steerIn, accelIn, brakeIn, boostHeld) {
  if (r.finished) {
    r.speed *= 0.98;
    return;
  }
  if (r.fireCd > 0) r.fireCd = Math.max(0, r.fireCd - dt);
  if (r.muzzle > 0) r.muzzle -= dt;
  if (r.stun > 0) {
    r.stun -= dt;
    r.speed *= 0.96;
  }

  const near = r._near || nearestOnTrack(r.x, r.z);
  const onTrack = Math.abs(near.lat) <= track.halfW + 0.4;
  const isPlayer = r.isPlayer;
  const baseMax = isPlayer ? 20.2 : 17.6 + r.id * 0.35;
  const maxSpeed = (onTrack ? baseMax : 7.2) * (r.boosting ? 1.4 : 1);
  const accel = onTrack ? (isPlayer ? 17.5 : 14.5) : 5;
  const brake = 22;
  const friction = onTrack ? 2.2 : 10;

  if (r.stun <= 0) {
    if (accelIn > 0) r.speed += accel * accelIn * dt;
    if (brakeIn > 0) {
      if (r.speed > 1.5) r.speed -= brake * brakeIn * dt;
      else r.speed -= accel * 0.4 * brakeIn * dt;
    }
  }
  r.speed -= Math.sign(r.speed) * friction * dt;
  if (Math.abs(r.speed) < 0.25 && accelIn <= 0 && brakeIn <= 0) r.speed = 0;

  if (boostHeld && r.boost > 0.08 && r.stun <= 0) {
    if (!r.boosting) sfx("boost");
    r.boosting = true;
    r.boost = Math.max(0, r.boost - dt * 0.52);
    r.speed = Math.max(r.speed, isPlayer ? 23.5 : 21.5);
  } else {
    r.boosting = false;
    r.boost = Math.min(1, r.boost + dt * 0.24);
  }
  r.speed = clamp(r.speed, -6, maxSpeed + (r.boosting ? 6.5 : 0));

  const turn = steerIn * (2.45 - clamp(Math.abs(r.speed) / 18, 0, 1) * 0.72);
  if (r.stun <= 0) r.heading += turn * (r.speed >= 0 ? 1 : -1) * dt;
  r.heading = angNorm(r.heading);
  r.steerVis = lerp(r.steerVis || 0, steerIn, 0.18);

  r.x += Math.sin(r.heading) * r.speed * dt;
  r.z += Math.cos(r.heading) * r.speed * dt;

  const n2 = nearestOnTrack(r.x, r.z);
  r._near = n2;

  if (Math.abs(n2.lat) > track.halfW) {
    const extra = Math.abs(n2.lat) - track.halfW;
    const dir = Math.sign(n2.lat) || 1;
    r.x -= n2.nx * dir * extra;
    r.z -= n2.nz * dir * extra;
    r.speed *= 0.88;
    r.vy -= 12 * dt;
    r.offTimer += dt;
  } else {
    r.offTimer = 0;
    const wantY = n2.y;
    if (r.y > wantY + 0.35) {
      r.vy -= 22 * dt;
      r.y += r.vy * dt;
      if (r.y < wantY) {
        r.y = wantY;
        r.vy = 0;
      }
    } else {
      r.vy = 0;
      r.y = wantY;
      r.safeS = n2.s;
    }
  }

  if (Math.abs(n2.lat) > track.halfW + 0.4) r.y += r.vy * dt;

  if (r.offTimer > 1.35 || n2.dist > 14 || r.y < n2.y - 3.5) snapToCheckpoint(r);
  sanitizeRacer(r);
}

function updateProgress(r) {
  const near = r._near || nearestOnTrack(r.x, r.z);
  if (r._lastS == null) r._lastS = near.s;
  const prev = r._lastS;
  const cur = near.s;
  if (!r.finished && r.speed > 2 && Math.abs(near.lat) < track.halfW + 1.2 && prev > track.length * 0.78 && cur < track.length * 0.22) {
    r.lap += 1;
    if (r.isPlayer) {
      sfx("lap");
      showTaunt("LAP " + Math.min(TOTAL_LAPS, r.lap));
    }
    if (r.lap >= TOTAL_LAPS) {
      r.finished = true;
      r.finishTime = raceTime;
      if (r.isPlayer) finishRace();
    }
  }
  r._lastS = cur;
  r.progress = r.lap * track.length + cur;
}

function rankRacers() {
  const order = racers.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  });
  for (let i = 0; i < order.length; i++) order[i].place = i + 1;
}

function updateAI(r, dt) {
  if (r.isPlayer || r.finished) return;
  const look = 12 + Math.abs(r.speed) * 0.35;
  const target = sampleTrack((r._near ? r._near.s : 0) + look);
  const lane = Math.sin(raceTime * (0.55 + r.id * 0.12) + r.id) * 1.15;
  const tx = target.x + target.nx * lane - r.x;
  const tz = target.z + target.nz * lane - r.z;
  const desired = Math.atan2(tx, tz);
  const steer = clamp(angNorm(desired - r.heading) * 1.5, -1, 1);
  let skill = 0.8 + r.id * 0.03;
  if (player) {
    if (r.place < player.place) skill *= 0.93;
    if (r.place > player.place) skill *= 1.04;
  }
  const boost = r.place > 1 && r.boost > 0.45 && Math.random() < dt * 0.28;
  driveRacer(r, dt, steer, skill, 0, boost);
  if (r.fireCd <= 0 && Math.random() < dt * 0.5) {
    for (const o of racers) {
      if (o.id === r.id || o.finished) continue;
      const dx = o.x - r.x;
      const dz = o.z - r.z;
      const d = Math.hypot(dx, dz);
      if (d < 14 && Math.abs(angNorm(Math.atan2(dx, dz) - r.heading)) < 0.45) {
        if (Math.random() < 0.3) r.weapon = (Math.random() * WEAPONS.length) | 0;
        fire(r);
        break;
      }
    }
  }
}

function updatePlayer(dt) {
  let steer = 0;
  if (input.left) steer -= 1;
  if (input.right) steer += 1;
  if (input.usingTouch) steer = clamp(steer + input.touchSteer, -1, 1);
  let accel = input.accel ? 1 : 0;
  let brake = input.brake ? 1 : 0;
  if (input.usingTouch) {
    if (input.touchAccel > 0.2) accel = Math.max(accel, input.touchAccel);
    if (input.touchAccel < -0.2) brake = Math.max(brake, -input.touchAccel);
  }
  driveRacer(player, dt, steer, accel, brake, input.boost);
  if (input.weaponPressed) {
    input.weaponPressed = false;
    cycleWeapon(player);
  }
  if (input.fire || input.firePressed) {
    input.firePressed = false;
    fire(player);
  }
}

function updatePickups(dt) {
  for (const b of itemBoxes) {
    if (b.taken) {
      b.respawn -= dt;
      if (b.respawn <= 0) {
        b.taken = false;
        if (b.mesh) b.mesh.visible = true;
      }
      continue;
    }
    if (b.mesh) {
      b.mesh.rotation.y += dt * 2.2;
      b.mesh.position.y = b.y + 0.62 + Math.sin(worldTime * 3 + b.s) * 0.12;
    }
    for (const r of racers) {
      if (r.finished) continue;
      if (Math.hypot(r.x - b.x, r.z - b.z) < 1.15) {
        b.taken = true;
        b.respawn = 4.2;
        if (b.mesh) b.mesh.visible = false;
        r.weapon = (Math.random() * WEAPONS.length) | 0;
        r.fireCd = 0;
        burst(b.x, b.y + 0.7, b.z, 0x39e7ff, 10);
        if (r.isPlayer) {
          sfx("item");
          showTaunt(WEAPONS[r.weapon].name + "!");
          updateHud();
        }
        break;
      }
    }
  }
  for (const p of boostPads) {
    p.mesh.material.emissiveIntensity = 0.45 + Math.sin(worldTime * 8) * 0.25;
    for (const r of racers) {
      if (r.finished) continue;
      if (Math.hypot(r.x - p.x, r.z - p.z) < 1.5) {
        r.speed = Math.max(r.speed, r.isPlayer ? 24 : 22);
        r.boost = Math.min(1, r.boost + dt * 0.8);
      }
    }
  }
}

function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.life -= dt;
    if (s.home) {
      let best = null;
      let bestD = 18;
      for (const r of racers) {
        if (r.id === s.owner || r.finished) continue;
        const d = Math.hypot(r.x - s.x, r.z - s.z);
        if (d < bestD) {
          bestD = d;
          best = r;
        }
      }
      if (best) {
        const desired = Math.atan2(best.x - s.x, best.z - s.z);
        const cur = Math.atan2(s.vx, s.vz);
        const next = cur + angNorm(desired - cur) * Math.min(1, dt * 4);
        const spd = Math.hypot(s.vx, s.vz) || 26;
        s.vx = Math.sin(next) * spd;
        s.vz = Math.cos(next) * spd;
      }
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt;
    if (s.mesh) {
      s.mesh.position.set(s.x, s.y, s.z);
      s.mesh.rotation.y += dt * 10;
    }
    let dead = s.life <= 0 || !finite(s.x);
    if (!dead) {
      for (const r of racers) {
        if (r.id === s.owner || r.finished) continue;
        if (Math.hypot(r.x - s.x, r.z - s.z) < 0.9 + s.radius) {
          r.stun = Math.max(r.stun, s.stun);
          r.speed *= s.slow;
          burst(s.x, s.y, s.z, 0xff7a1a, 12);
          sfx("hit");
          if (s.owner === 0) {
            const pack = adultMode ? ADULT_PACK : HEN_PACK;
            showTaunt(pack[r.id].taunt || (adultMode ? ADULT_TAUNTS : CHICKEN_TAUNTS)[r.id % 4]);
          } else if (r.isPlayer) {
            showTaunt(adultMode ? ADULT_TAUNTS[s.owner % 4] : CHICKEN_TAUNTS[s.owner % 4]);
          }
          dead = true;
          break;
        }
      }
    }
    if (dead) {
      if (s.mesh) scene.remove(s.mesh);
      shots.splice(i, 1);
    }
  }
}

function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const p = fx[i];
    p.life -= dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.vy -= 10 * dt;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      fx.splice(i, 1);
    }
  }
}

function separateRacers() {
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i];
      const b = racers[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz) || 0.001;
      if (d < 1.45) {
        const push = (1.45 - d) * 0.5;
        a.x -= (dx / d) * push;
        a.z -= (dz / d) * push;
        b.x += (dx / d) * push;
        b.z += (dz / d) * push;
      }
    }
  }
}

function poseRacer(r, dt) {
  if (!r.root) return;
  r.root.position.set(r.x, r.y, r.z);
  r.root.rotation.y = r.heading;
  r.root.rotation.z = -r.steerVis * 0.28;
  if (r.kart) r.kart.rotation.x = Math.sin(worldTime * 40) * 0.01 * clamp(Math.abs(r.speed) / 12, 0, 1);
  if (r.flame) {
    r.flame.visible = !!r.boosting;
    if (r.boosting) r.flame.scale.setScalar(0.9 + Math.sin(worldTime * 28) * 0.22);
  }
  if (r.muzzle > 0) {
    burst(r.x + Math.sin(r.heading) * 1.1, r.y + 0.5, r.z + Math.cos(r.heading) * 1.1, 0xffe08a, 2);
    r.muzzle = 0;
  }
  const ud = r.driver && r.driver.userData;
  if (ud && ud.mixer) {
    const moving = Math.abs(r.speed) > 2.2;
    if (ud.actions) {
      if (ud.actions.run && ud.actions.idle) {
        if (moving && !ud.actions.run.isRunning()) {
          ud.actions.run.reset().fadeIn(0.12).play();
          ud.actions.idle.fadeOut(0.12);
        } else if (!moving && !ud.actions.idle.isRunning()) {
          ud.actions.idle.reset().fadeIn(0.12).play();
          if (ud.actions.run) ud.actions.run.fadeOut(0.12);
        }
        if (ud.actions.run) ud.actions.run.setEffectiveTimeScale(0.7 + clamp(Math.abs(r.speed) / 16, 0, 1.4));
      }
    }
    ud.mixer.update(dt);
  } else if (r.driver) {
    const bob = Math.abs(Math.sin(worldTime * 14)) * 0.04 * clamp(Math.abs(r.speed) / 12, 0, 1);
    r.driver.position.y = (ud && ud.baseY != null ? ud.baseY : 0.3) + bob;
  }
  if (Math.abs(r.speed) > 8 && fx.length < MAX_FX - 4 && Math.random() < dt * 14) {
    const back = -0.7;
    burst(r.x + Math.sin(r.heading) * back, r.y + 0.12, r.z + Math.cos(r.heading) * back, 0xc4a070, 1);
  }
}

function snapCamera(hard) {
  if (!player || !camera) return;
  const spd = clamp(Math.abs(player.speed) / 22, 0, 1);
  const dist = 7.2 + spd * 2.6 + (player.boosting ? 1.5 : 0);
  const height = (adultMode ? 3.15 : 2.85) + spd * 0.45;
  const tx = player.x - Math.sin(player.heading) * dist;
  const tz = player.z - Math.cos(player.heading) * dist;
  const ty = player.y + height;
  if (hard || !finite(camera.position.x)) {
    camera.position.set(tx, ty, tz);
  } else {
    camera.position.x = lerp(camera.position.x, tx, 0.14);
    camera.position.y = lerp(camera.position.y, ty, 0.11);
    camera.position.z = lerp(camera.position.z, tz, 0.14);
  }
  const look = 3.4 + spd * 1.6;
  const lx = player.x + Math.sin(player.heading) * look;
  const lz = player.z + Math.cos(player.heading) * look;
  camera.lookAt(lx, player.y + 1.05, lz);
  const wantFov = player.boosting ? 70 : 55;
  if (Math.abs(camera.fov - wantFov) > 0.2) {
    camera.fov = lerp(camera.fov, wantFov, 0.14);
    camera.updateProjectionMatrix();
  }
  for (let i = 0; i < speedLines.length; i++) speedLines[i].visible = !!player.boosting;
  if (!finite(camera.position.x)) camera.position.set(player.x, player.y + 4, player.z + 8);
  if (sun) sun.position.set(player.x + 28, 42, player.z + 18);
}

function finishRace() {
  if (mode === "finish") return;
  mode = "finish";
  sfx("finish");
  for (const r of racers) {
    if (!r.finished) {
      r.finished = true;
      r.finishTime = raceTime + (5 - r.place) * 0.01;
    }
  }
  rankRacers();
  resultTitle.textContent = player.place === 1 ? "YOU WIN!" : "FINISH";
  standingsEl.innerHTML = "";
  const ordered = racers.slice().sort((a, b) => a.place - b.place);
  for (const r of ordered) {
    const li = document.createElement("li");
    if (r.isPlayer) li.className = "you";
    li.innerHTML =
      '<span class="who">' + r.place + ". " + r.name + '</span><span class="meta">' + formatTime(r.finishTime || raceTime) + "</span>";
    standingsEl.appendChild(li);
  }
  overlay.classList.remove("playing");
  menu.classList.add("hidden");
  results.classList.remove("hidden");
  hud.classList.add("hidden");
  countdownEl.classList.remove("show");
  hideMobilePad();
}

function update(dt) {
  worldTime += dt;
  if (tauntTimer > 0) {
    tauntTimer -= dt;
    if (tauntTimer <= 0 && tauntEl) tauntEl.classList.remove("show");
  }
  if (world) {
    world.traverse((o) => {
      if (o.userData && o.userData.mixer) o.userData.mixer.update(dt);
    });
  }
  if (mode === "menu") {
    if (racers.length) {
      for (const r of racers) poseRacer(r, dt);
      snapCamera(false);
    }
    updateFx(dt);
    return;
  }
  if (mode === "countdown") {
    countTimer -= dt;
    if (countTimer <= 0) {
      countValue -= 1;
      if (countValue > 0) {
        countdownEl.textContent = String(countValue);
        countTimer = 1;
        sfx("count");
      } else if (countValue === 0) {
        countdownEl.textContent = "GO";
        countTimer = 0.55;
        sfx("go");
      } else {
        countdownEl.classList.remove("show");
        mode = "race";
      }
    }
    for (const r of racers) poseRacer(r, dt);
    snapCamera(false);
    updateFx(dt);
    return;
  }
  if (mode === "finish") {
    for (const r of racers) poseRacer(r, dt);
    snapCamera(false);
    updateFx(dt);
    return;
  }

  raceTime += dt;
  updatePlayer(dt);
  for (const r of racers) {
    if (!r.isPlayer) updateAI(r, dt);
    updateProgress(r);
  }
  separateRacers();
  rankRacers();
  updatePickups(dt);
  updateShots(dt);
  updateFx(dt);
  for (const r of racers) poseRacer(r, dt);
  snapCamera(false);
  updateHud();
  if (racers.every((r) => r.finished)) finishRace();
}

function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6cb4d4);
  scene.fog = new THREE.Fog(0x6cb4d4, 48, 145);

  camera = new THREE.PerspectiveCamera(55, 1, 0.12, 280);
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x6cb4d4, 1);
  if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene.add(new THREE.AmbientLight(0xfff2d8, 0.32));
  const hemi = new THREE.HemisphereLight(0xc8e8ff, 0x3a6a28, 0.85);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff4dc, 1.15);
  sun.position.set(28, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 28;
  sun.shadow.camera.bottom = -28;
  scene.add(sun);

  const skyGeo = new THREE.SphereGeometry(200, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x3a8fd4) },
      bot: { value: new THREE.Color(0xe8f2c8) },
    },
    vertexShader: "varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: "varying vec3 vP; uniform vec3 top; uniform vec3 bot; void main(){ float h=clamp(vP.y/160.0+0.35,0.0,1.0); gl_FragColor=vec4(mix(bot,top,h),1.0); }",
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  for (let i = 0; i < 12; i++) {
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 1.5),
      new THREE.MeshBasicMaterial({ color: 0xfff4dc, transparent: true, opacity: 0.38 })
    );
    line.position.set(rand(-1.8, 1.8), rand(-0.9, 0.9), -2.2 - Math.random() * 3.4);
    line.visible = false;
    camera.add(line);
    speedLines.push(line);
  }
  scene.add(camera);

  buildTrackData();
  buildWorld();
  resize();
}

function resize() {
  W = Math.max(320, window.innerWidth || 800);
  H = Math.max(240, window.innerHeight || 600);
  if (!camera || !renderer) return;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(W, H, false);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
}

function isTouchUi() {
  return (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || Math.min(window.innerWidth, window.innerHeight) < 820;
}
function showMobilePad() {
  if (!mobilePad) return;
  if (isTouchUi()) {
    mobilePad.classList.remove("hidden");
    input.usingTouch = true;
  } else mobilePad.classList.add("hidden");
}
function hideMobilePad() {
  if (mobilePad) mobilePad.classList.add("hidden");
  input.touchSteer = 0;
  input.touchAccel = 0;
  input.accel = false;
  input.brake = false;
  input.boost = false;
  input.fire = false;
}

function startRace() {
  try {
    if (!audio.ctx) safeBeep(200, 0.01, "sine", 0.001, 0);
    if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();
  } catch (_) {}
  sfx("start");
  resetRace();
  overlay.classList.add("playing");
  menu.classList.add("hidden");
  results.classList.add("hidden");
  hud.classList.remove("hidden");
  showMobilePad();
}

function bindHold(el, onDown, onUp) {
  if (!el) return;
  const down = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onDown();
  };
  const up = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onUp();
  };
  el.addEventListener("touchstart", down, { passive: false });
  el.addEventListener("touchend", up, { passive: false });
  el.addEventListener("touchcancel", up, { passive: false });
  el.addEventListener("mousedown", down);
  el.addEventListener("mouseup", up);
  el.addEventListener("mouseleave", up);
}

function setupJoystick(root, knob) {
  if (!root || !knob) return;
  let active = null;
  const radius = 40;
  const setKnob = (dx, dy) => {
    knob.style.transform = "translate(" + dx + "px," + dy + "px)";
  };
  const handle = (clientX, clientY) => {
    const rect = root.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const d = Math.hypot(dx, dy) || 1;
    const mag = Math.min(1, d / radius);
    dx = (dx / d) * mag * radius;
    dy = (dy / d) * mag * radius;
    setKnob(dx, dy);
    input.touchSteer = dx / radius;
    input.touchAccel = -dy / radius;
    input.usingTouch = true;
  };
  root.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      active = e.changedTouches[0].identifier;
      handle(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    },
    { passive: false }
  );
  root.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      for (const t of e.changedTouches) {
        if (t.identifier === active) handle(t.clientX, t.clientY);
      }
    },
    { passive: false }
  );
  const end = (e) => {
    for (const t of e.changedTouches || []) {
      if (t.identifier === active) active = null;
    }
    if (active == null) {
      setKnob(0, 0);
      input.touchSteer = 0;
      input.touchAccel = 0;
    }
  };
  root.addEventListener("touchend", end, { passive: false });
  root.addEventListener("touchcancel", end, { passive: false });
}

setupJoystick(document.getElementById("joy-steer"), document.getElementById("joy-knob"));
bindHold(document.getElementById("btn-gas"), () => { input.accel = true; }, () => { input.accel = false; });
bindHold(document.getElementById("btn-brake"), () => { input.brake = true; }, () => { input.brake = false; });
bindHold(document.getElementById("btn-boost"), () => { input.boost = true; }, () => { input.boost = false; });
bindHold(
  document.getElementById("btn-shoot"),
  () => {
    input.fire = true;
    input.firePressed = true;
  },
  () => {
    input.fire = false;
  }
);
bindHold(document.getElementById("btn-weapon"), () => { input.weaponPressed = true; }, () => {});

function onKey(e, down) {
  const k = e.key;
  if (k === "ArrowLeft" || k === "a" || k === "A") input.left = down;
  else if (k === "ArrowRight" || k === "d" || k === "D") input.right = down;
  else if (k === "ArrowUp" || k === "w" || k === "W") {
    input.accel = down;
    if (down) e.preventDefault();
  } else if (k === "ArrowDown" || k === "s" || k === "S") {
    input.brake = down;
    if (down) e.preventDefault();
  } else if (k === " " || k === "Spacebar") {
    input.fire = down;
    if (down) {
      input.firePressed = true;
      e.preventDefault();
    }
  } else if (k === "q" || k === "Q") {
    if (down) {
      input.weaponPressed = true;
      e.preventDefault();
    }
  } else if (k === "Shift" || k === "e" || k === "E") {
    input.boost = down;
    if (down) e.preventDefault();
  }
  if (down && loaded && mode === "menu" && (k === "Enter" || k === " ")) startRace();
}

window.addEventListener("keydown", (e) => onKey(e, true));
window.addEventListener("keyup", (e) => onKey(e, false));
window.addEventListener("blur", () => {
  input.left = input.right = input.accel = input.brake = input.boost = input.fire = false;
});
canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

btnStart.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (loaded) startRace();
});
btnRetry.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (loaded) startRace();
});
btnAdultMenu.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  requestAdultToggle();
});
btnAdultHud.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  requestAdultToggle();
});
btnAdultCancel.addEventListener("click", (e) => {
  e.preventDefault();
  adultWarn.classList.add("hidden");
});
btnAdultConfirm.addEventListener("click", (e) => {
  e.preventDefault();
  adultWarn.classList.add("hidden");
  enableAdultPack();
});
window.addEventListener("resize", resize);

function unstickAll() {
  for (const r of racers) snapToCheckpoint(r);
  if (shots.length > MAX_SHOTS) shots.length = MAX_SHOTS;
  if (fx.length > MAX_FX) {
    while (fx.length > MAX_FX) {
      const p = fx.shift();
      if (p.mesh) scene.remove(p.mesh);
    }
  }
}

function frame(now) {
  try {
    const dt = clampDt((now - last) / 1000);
    last = now;
    update(dt);
    if (renderer && scene && camera) renderer.render(scene, camera);
  } catch (err) {
    console.error("SUPER CHICKEN frame error:", err);
    try {
      unstickAll();
    } catch (_) {}
  }
  requestAnimationFrame(frame);
}

function showMenuReady() {
  loaded = true;
  if (loadFill) {
    loadFill.setAttribute("data-done", "1");
    loadFill.style.width = "100%";
  }
  if (loaderEl) loaderEl.classList.add("hidden");
  if (menu) menu.classList.remove("hidden");
  syncAdultUi();
}

function startWorld() {
  initThree();
  racers.length = 0;
  racers.push(makeRacer(0));
  player = racers[0];
  snapCamera(true);
}

async function boot() {
  setLoad(0.06, "Lade Strecke… Timeout 8s, dann Fallback.");
  try {
    await Promise.race([
      loadBootAssets(),
      sleep(BOOT_DEADLINE_MS).then(() => {
        console.warn("CLUCK GP boot deadline — continuing with fallbacks");
      }),
    ]);
    setLoad(1, "Ready.");
    startWorld();
    showMenuReady();
    loadCrowdAssets();
  } catch (err) {
    console.error(err);
    try {
      startWorld();
      showMenuReady();
    } catch (err2) {
      console.error(err2);
      if (loadStatus) loadStatus.textContent = "3D-Init fehlgeschlagen. Seite neu laden.";
      if (adultStatus) adultStatus.textContent = "3D-Init fehlgeschlagen. Seite neu laden.";
    }
  }
  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(frame);
  });
}

boot();
