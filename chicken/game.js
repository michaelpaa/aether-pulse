(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const overlay = document.getElementById("overlay");
  const menu = document.getElementById("menu");
  const results = document.getElementById("results");
  const hud = document.getElementById("hud");
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
  const MAX_FX = 80;
  const HALF_W = 4.35;
  lapsEl.textContent = String(TOTAL_LAPS);

  const WEAPONS = [
    { id: "egg", name: "EGG", cd: 0.32, speed: 34, life: 1.15, radius: 0.38, stun: 0.55, slow: 0.55 },
    { id: "corn", name: "CORN", cd: 0.85, speed: 26, life: 1.8, radius: 0.42, stun: 1.05, slow: 0.35, home: true },
    { id: "feather", name: "FEATHER", cd: 0.48, speed: 30, life: 0.42, radius: 0.22, stun: 0.28, slow: 0.78, spray: true },
  ];

  const HEN_PACK = [
    { name: "YOU", body: 0xfff4dc, accent: 0xffc43d, comb: 0xe23d3d, beak: 0xff8a1a },
    { name: "CLUCK", body: 0xc4783a, accent: 0x8b4518, comb: 0xd43535, beak: 0xff8a1a },
    { name: "PECK", body: 0xf2ece4, accent: 0x2a2a2a, comb: 0xe23d3d, beak: 0xff8a1a },
    { name: "WATTLE", body: 0xe8a54b, accent: 0xb85c1a, comb: 0xe23d3d, beak: 0xff8a1a },
  ];
  const ADULT_PACK = [
    { name: "YOU", skin: 0xe8b89a, hair: 0x2b1a12 },
    { name: "VENUS", skin: 0xc88f6e, hair: 0xc45c2a },
    { name: "IVY", skin: 0xf0c4a8, hair: 0x1a1a1a },
    { name: "SIENNA", skin: 0xd4a07a, hair: 0xd8b056 },
  ];
  const COLORS = ["#ffc43d", "#39e7ff", "#ff6b9d", "#b6ff3b"];

  if (typeof THREE === "undefined") {
    if (adultStatus) adultStatus.textContent = "Three.js konnte nicht laden. Netz prüfen, neu laden.";
    return;
  }

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
  const track = { pts: [], cum: [], length: 0, halfW: HALF_W, checkpoints: [] };
  const racers = [];
  const shots = [];
  const fx = [];
  let player = null;
  let scene = null;
  let camera = null;
  let renderer = null;
  let world = null;
  let speedLines = [];

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
    else if (name === "finish") {
      safeBeep(400, 0.12, "triangle", 0.09, 120);
      safeBeep(600, 0.18, "sine", 0.08, 180);
    }
  }

  function mat(color, extra) {
    return new THREE.MeshStandardMaterial(
      Object.assign({ color: color, roughness: 0.62, metalness: 0.04 }, extra || {})
    );
  }

  function buildTrackData() {
    const N = 96;
    const raw = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = 46 + 11 * Math.cos(2 * a) + 5.5 * Math.sin(3 * a + 0.35);
      const x = Math.cos(a) * r + 5 * Math.sin(2 * a);
      const z = Math.sin(a) * r * 0.74 + 3.5 * Math.cos(3 * a);
      const y = 0.8 + 2.1 * Math.sin(2 * a) + 0.7 * Math.cos(4 * a);
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
      const nx = -tz;
      const nz = tx;
      const ty = dy / d;
      track.pts.push({ x: a.x, y: a.y, z: a.z, tx, ty, tz, nx, nz });
      track.length += Math.hypot(dx, dy, dz) || 1;
      track.cum.push(track.length);
    }
    track.checkpoints = [];
    const cpCount = 12;
    for (let i = 0; i < cpCount; i++) {
      const s = (i / cpCount) * track.length;
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
    const idx = [];
    const hw = track.halfW;
    for (let i = 0; i <= n; i++) {
      const p = track.pts[i % n];
      pos.push(p.x + p.nx * hw, p.y + 0.04, p.z + p.nz * hw);
      pos.push(p.x - p.nx * hw, p.y + 0.04, p.z - p.nz * hw);
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
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat(0x5c5348, { roughness: 0.88 }));
    mesh.receiveShadow = false;
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
        pos.push(p.x + ox, p.y + 0.02, p.z + oz);
        pos.push(p.x + ox + p.nx * 0.28 * side, p.y + 0.38, p.z + oz + p.nz * 0.28 * side);
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
      group.add(new THREE.Mesh(geo, mat(side > 0 ? 0xffc43d : 0xe23d3d, { roughness: 0.5 })));
    }
  }

  function buildWorld() {
    if (world) scene.remove(world);
    world = new THREE.Group();
    scene.add(world);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 48), mat(0x3f8a38, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.4;
    world.add(ground);

    world.add(makeRoadMesh());
    addCurbs(world);

    const lineMat = mat(0xffe08a, { roughness: 0.4 });
    for (let i = 0; i < track.pts.length; i += 2) {
      const p = track.pts[i];
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 1.1), lineMat);
      dash.position.set(p.x, p.y + 0.08, p.z);
      dash.rotation.y = Math.atan2(p.tx, p.tz);
      world.add(dash);
    }

    const start = sampleTrack(0);
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.14, 3.2, 6);
    const poleMat = mat(0xf2f2f2);
    for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(start.x + start.nx * HALF_W * s, start.y + 1.6, start.z + start.nz * HALF_W * s);
      world.add(pole);
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2.1, 0.55, 0.08), mat(0xff7a1a));
    banner.position.set(start.x, start.y + 3.05, start.z);
    banner.rotation.y = Math.atan2(start.tx, start.tz);
    world.add(banner);

    for (let i = 1; i < track.checkpoints.length; i += 2) {
      const cp = track.checkpoints[i];
      const arch = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.07, 6, 14, Math.PI), mat(0x39e7ff));
      arch.position.set(cp.x, cp.y + 1.15, cp.z);
      arch.rotation.y = Math.atan2(cp.tx, cp.tz);
      arch.rotation.z = Math.PI;
      world.add(arch);
    }

    const trunkMat = mat(0x6b3f1f);
    const leafMat = mat(0x2f6b28);
    for (let i = 0; i < 22; i++) {
      const p = track.pts[(i * 7) % track.pts.length];
      const side = i % 2 === 0 ? 1 : -1;
      const dist = HALF_W + 6 + (i % 5);
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 5), trunkMat);
      trunk.position.y = 0.8;
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.15, 2.2, 6), leafMat);
      leaf.position.y = 2.3;
      tree.add(trunk, leaf);
      tree.position.set(p.x + p.nx * dist * side, p.y - 0.2, p.z + p.nz * dist * side);
      world.add(tree);
    }

    const sun = new THREE.Mesh(new THREE.SphereGeometry(3.2, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    sun.position.set(40, 38, -28);
    world.add(sun);
  }

  function makeChicken(pack) {
    const g = new THREE.Group();
    const bodyM = mat(pack.body);
    const accM = mat(pack.accent);
    const combM = mat(pack.comb);
    const beakM = mat(pack.beak);
    const eyeM = mat(0x1a120c);

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 10), bodyM);
    body.scale.set(1.15, 0.9, 1);
    body.position.set(0, 0.55, 0);
    g.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), bodyM);
    head.position.set(0, 0.95, 0.32);
    g.add(head);

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 6), beakM);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.9, 0.56);
    g.add(beak);

    for (let i = -1; i <= 1; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.06), combM);
      c.position.set(i * 0.07, 1.18, 0.3);
      g.add(c);
    }

    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), eyeM);
    eyeL.position.set(-0.1, 0.98, 0.5);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.1;
    g.add(eyeL, eyeR);

    const wingL = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), accM);
    wingL.scale.set(0.35, 0.7, 1.1);
    wingL.position.set(-0.42, 0.58, 0);
    const wingR = wingL.clone();
    wingR.position.x = 0.42;
    g.add(wingL, wingR);

    const legM = mat(0xffb020);
    for (const x of [-0.12, 0.12]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.32, 5), legM);
      leg.position.set(x, 0.2, 0);
      g.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.18), legM);
      foot.position.set(x, 0.04, 0.04);
      g.add(foot);
    }

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.38, 6), accM);
    tail.rotation.x = -0.9;
    tail.position.set(0, 0.7, -0.42);
    g.add(tail);

    const flame = makeFlame();
    flame.position.set(0, 0.35, -0.55);
    flame.visible = false;
    g.add(flame);
    g.userData = { wingL, wingR, flame, kind: "chicken" };
    return g;
  }

  function makeAdult(pack) {
    const g = new THREE.Group();
    const skin = mat(pack.skin, { roughness: 0.52 });
    const hairM = mat(pack.hair, { roughness: 0.7 });

    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), skin);
    hips.scale.set(1.42, 0.88, 1.08);
    hips.position.y = 0.78;
    g.add(hips);

    const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.22, 8), skin);
    waist.position.y = 0.98;
    g.add(waist);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.32, 8), skin);
    torso.position.y = 1.22;
    g.add(torso);

    const breastGeo = new THREE.SphereGeometry(0.105, 8, 8);
    const bL = new THREE.Mesh(breastGeo, skin);
    bL.position.set(-0.09, 1.26, 0.12);
    const bR = bL.clone();
    bR.position.x = 0.09;
    g.add(bL, bR);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6), skin);
    neck.position.y = 1.42;
    g.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 10, 10), skin);
    head.position.y = 1.56;
    g.add(head);

    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), hairM);
    hair.scale.set(1.08, 0.72, 1.12);
    hair.position.set(0, 1.62, -0.02);
    g.add(hair);
    const pony = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.38, 6), hairM);
    pony.position.set(0, 1.38, -0.18);
    pony.rotation.x = 0.55;
    g.add(pony);

    const armGeo = new THREE.CylinderGeometry(0.04, 0.045, 0.46, 6);
    const armL = new THREE.Mesh(armGeo, skin);
    armL.position.set(-0.24, 1.12, 0);
    armL.rotation.z = 0.28;
    const armR = armL.clone();
    armR.position.x = 0.24;
    armR.rotation.z = -0.28;
    g.add(armL, armR);

    const thighGeo = new THREE.CylinderGeometry(0.095, 0.07, 0.4, 8);
    const tL = new THREE.Mesh(thighGeo, skin);
    tL.position.set(-0.11, 0.5, 0);
    const tR = tL.clone();
    tR.position.x = 0.11;
    g.add(tL, tR);

    const calfGeo = new THREE.CylinderGeometry(0.055, 0.042, 0.36, 6);
    const cL = new THREE.Mesh(calfGeo, skin);
    cL.position.set(-0.11, 0.16, 0);
    const cR = cL.clone();
    cR.position.x = 0.11;
    g.add(cL, cR);

    const flame = makeFlame();
    flame.position.set(0, 0.4, -0.4);
    flame.visible = false;
    g.add(flame);
    g.userData = { armL, armR, flame, kind: "adult" };
    return g;
  }

  function makeFlame() {
    const g = new THREE.Group();
    const m1 = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 6), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
    m1.rotation.x = Math.PI;
    const m2 = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 5), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    m2.rotation.x = Math.PI;
    m2.position.y = -0.05;
    g.add(m1, m2);
    return g;
  }

  function applySkin(r) {
    if (r.mesh) scene.remove(r.mesh);
    if (adultMode) {
      if (!r.adultMesh) r.adultMesh = makeAdult(ADULT_PACK[r.id]);
      r.mesh = r.adultMesh;
      r.name = ADULT_PACK[r.id].name;
    } else {
      if (!r.chickenMesh) r.chickenMesh = makeChicken(HEN_PACK[r.id]);
      r.mesh = r.chickenMesh;
      r.name = HEN_PACK[r.id].name;
    }
    scene.add(r.mesh);
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
        : "Standard: Hühner. Adult-Pack nur nach Opt-in.";
    }
  }

  function requestAdultToggle() {
    if (adultMode) {
      setAdultMode(false);
      return;
    }
    if (adultConfirmed) {
      setAdultMode(true);
      return;
    }
    adultWarn.classList.remove("hidden");
  }

  function makeRacer(id) {
    const start = sampleTrack((track.length - id * 3.4) % track.length);
    const lane = (id - (RACER_COUNT - 1) / 2) * 1.35;
    const heading = Math.atan2(start.tx, start.tz);
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
      cp: 0,
      progress: 0,
      finishTime: null,
      finished: false,
      place: id + 1,
      weapon: 0,
      fireCd: 0,
      mesh: null,
      chickenMesh: null,
      adultMesh: null,
      _lastS: start.s,
      safeS: start.s,
      offTimer: 0,
    };
    applySkin(r);
    return r;
  }

  function resetRace() {
    for (const r of racers) {
      if (r.mesh) scene.remove(r.mesh);
      if (r.chickenMesh && r.chickenMesh !== r.mesh) scene.remove(r.chickenMesh);
      if (r.adultMesh && r.adultMesh !== r.mesh) scene.remove(r.adultMesh);
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
    updateHud();
    countdownEl.textContent = "3";
    countdownEl.classList.add("show");
    sfx("count");
    snapCamera(true);
  }

  function clearShots() {
    for (const s of shots) {
      if (s.mesh) scene.remove(s.mesh);
    }
    shots.length = 0;
  }
  function clearFx() {
    for (const p of fx) {
      if (p.mesh) scene.remove(p.mesh);
    }
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

  function updateHud() {
    if (!player) return;
    placeEl.innerHTML = ordinal(player.place);
    lapEl.textContent = String(Math.min(TOTAL_LAPS, player.lap + 1));
    timerEl.textContent = formatTime(raceTime);
    speedEl.textContent = Math.round(Math.abs(player.speed) * 9.2) + " km/h";
    boostFill.style.transform = "scaleX(" + clamp(player.boost, 0, 1) + ")";
    const w = WEAPONS[player.weapon];
    weaponSlot.textContent = w.name;
    weaponMeta.textContent = player.fireCd > 0 ? player.fireCd.toFixed(1) + "s" : "RDY";
  }

  function burst(x, y, z, color, n) {
    const room = MAX_FX - fx.length;
    const c = Math.min(n, Math.max(0, room));
    for (let i = 0; i < c; i++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 5), new THREE.MeshBasicMaterial({ color }));
      mesh.position.set(x, y, z);
      scene.add(mesh);
      const a = rand(0, Math.PI * 2);
      const s = rand(2, 8);
      fx.push({
        mesh,
        vx: Math.cos(a) * s,
        vy: rand(1, 6),
        vz: Math.sin(a) * s,
        life: rand(0.2, 0.45),
      });
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
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.55, 6), mat(0xffc43d));
      mesh.rotation.x = Math.PI / 2;
    } else if (weapon.id === "feather") {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.28), mat(0xf4f0e6));
    } else {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), mat(0xfff4dc));
    }
    mesh.position.set(owner.x + sx * 1.1, owner.y + 0.7, owner.z + sz * 1.1);
    scene.add(mesh);
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
    if (Math.abs(r.x) > 220 || Math.abs(r.z) > 220 || r.y < -8 || r.y > 40) {
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
    if (r.stun > 0) {
      r.stun -= dt;
      r.speed *= 0.96;
    }

    const near = r._near || nearestOnTrack(r.x, r.z);
    const onTrack = Math.abs(near.lat) <= track.halfW + 0.35;
    const maxSpeed = (onTrack ? 18.5 : 7.5) * (r.boosting ? 1.42 : 1);
    const accel = onTrack ? 16 : 5;
    const brake = 22;
    const friction = onTrack ? 2.4 : 10;

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
      r.boost = Math.max(0, r.boost - dt * 0.55);
      r.speed = Math.max(r.speed, 22);
    } else {
      r.boosting = false;
      r.boost = Math.min(1, r.boost + dt * 0.22);
    }
    r.speed = clamp(r.speed, -6, maxSpeed + (r.boosting ? 6 : 0));

    const turn = steerIn * (2.35 - clamp(Math.abs(r.speed) / 18, 0, 1) * 0.7);
    if (r.stun <= 0) r.heading += turn * (r.speed >= 0 ? 1 : -1) * dt;
    r.heading = angNorm(r.heading);

    r.x += Math.sin(r.heading) * r.speed * dt;
    r.z += Math.cos(r.heading) * r.speed * dt;

    const n2 = nearestOnTrack(r.x, r.z);
    r._near = n2;

    if (Math.abs(n2.lat) > track.halfW) {
      const extra = Math.abs(n2.lat) - track.halfW;
      const dir = Math.sign(n2.lat) || 1;
      r.x -= n2.nx * dir * extra;
      r.z -= n2.nz * dir * extra;
      r.speed *= 0.9;
      r.vy -= 12 * dt;
      r.offTimer += dt;
    } else {
      r.vy = 0;
      r.offTimer = 0;
      r.y = n2.y;
      r.safeS = n2.s;
    }

    if (Math.abs(n2.lat) > track.halfW + 0.4) {
      r.y += r.vy * dt;
    } else {
      r.y = n2.y;
    }

    if (r.offTimer > 1.4 || n2.dist > 14 || r.y < n2.y - 3.5) snapToCheckpoint(r);
    sanitizeRacer(r);
  }

  function updateProgress(r) {
    const near = r._near || nearestOnTrack(r.x, r.z);
    if (r._lastS == null) r._lastS = near.s;
    const prev = r._lastS;
    const cur = near.s;
    if (
      !r.finished &&
      r.speed > 2 &&
      Math.abs(near.lat) < track.halfW + 1.2 &&
      prev > track.length * 0.78 &&
      cur < track.length * 0.22
    ) {
      r.lap += 1;
      if (r.isPlayer) sfx("lap");
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
    const lane = Math.sin(raceTime * (0.6 + r.id * 0.14) + r.id) * 1.2;
    const tx = target.x + target.nx * lane - r.x;
    const tz = target.z + target.nz * lane - r.z;
    const desired = Math.atan2(tx, tz);
    const steer = clamp(angNorm(desired - r.heading) * 1.5, -1, 1);
    const boost = r.place > 1 && r.boost > 0.4 && Math.random() < dt * 0.35;
    driveRacer(r, dt, steer, 0.92, 0, boost);
    if (r.fireCd <= 0 && Math.random() < dt * 0.55) {
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
        s.mesh.rotation.y += dt * 8;
      }
      let dead = s.life <= 0 || !finite(s.x);
      if (!dead) {
        for (const r of racers) {
          if (r.id === s.owner || r.finished) continue;
          if (Math.hypot(r.x - s.x, r.z - s.z) < 0.85 + s.radius) {
            r.stun = Math.max(r.stun, s.stun);
            r.speed *= s.slow;
            burst(s.x, s.y, s.z, 0xff7a1a, 8);
            sfx("hit");
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
      p.x = (p.mesh.position.x += p.vx * dt);
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
        if (d < 1.35) {
          const push = (1.35 - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
        }
      }
    }
  }

  function poseRacer(r, dt) {
    if (!r.mesh) return;
    r.mesh.position.set(r.x, r.y, r.z);
    r.mesh.rotation.y = r.heading;
    const bob = Math.abs(Math.sin(worldTime * 14)) * 0.05 * clamp(Math.abs(r.speed) / 12, 0, 1);
    r.mesh.position.y = r.y + bob;
    const ud = r.mesh.userData || {};
    if (ud.wingL && ud.wingR) {
      const flap = Math.sin(worldTime * 18) * 0.35 * clamp(Math.abs(r.speed) / 10, 0.2, 1);
      ud.wingL.rotation.z = 0.2 + flap;
      ud.wingR.rotation.z = -0.2 - flap;
    }
    if (ud.armL && ud.armR) {
      const sw = Math.sin(worldTime * 10) * 0.35 * clamp(Math.abs(r.speed) / 10, 0, 1);
      ud.armL.rotation.x = sw;
      ud.armR.rotation.x = -sw;
    }
    if (ud.flame) {
      ud.flame.visible = !!r.boosting;
      if (r.boosting) ud.flame.scale.setScalar(0.9 + Math.sin(worldTime * 28) * 0.2);
    }
  }

  function snapCamera(hard) {
    if (!player || !camera) return;
    const dist = 8.6;
    const height = adultMode ? 3.7 : 3.25;
    const tx = player.x - Math.sin(player.heading) * dist;
    const tz = player.z - Math.cos(player.heading) * dist;
    const ty = player.y + height;
    if (hard || !finite(camera.position.x)) {
      camera.position.set(tx, ty, tz);
    } else {
      camera.position.x = lerp(camera.position.x, tx, 0.12);
      camera.position.y = lerp(camera.position.y, ty, 0.1);
      camera.position.z = lerp(camera.position.z, tz, 0.12);
    }
    const lx = player.x + Math.sin(player.heading) * 3.2;
    const lz = player.z + Math.cos(player.heading) * 3.2;
    camera.lookAt(lx, player.y + 1.05, lz);
    const wantFov = player.boosting ? 68 : 56;
    if (Math.abs(camera.fov - wantFov) > 0.2) {
      camera.fov = lerp(camera.fov, wantFov, 0.12);
      camera.updateProjectionMatrix();
    }
    for (let i = 0; i < speedLines.length; i++) {
      speedLines[i].visible = !!player.boosting;
    }
    if (!finite(camera.position.x)) {
      camera.position.set(player.x, player.y + 4, player.z + 8);
    }
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
        '<span class="who">' +
        r.place +
        ". " +
        r.name +
        '</span><span class="meta">' +
        formatTime(r.finishTime || raceTime) +
        "</span>";
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
    scene.fog = new THREE.Fog(0x6cb4d4, 42, 130);

    camera = new THREE.PerspectiveCamera(56, 1, 0.1, 260);
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setClearColor(0x6cb4d4, 1);
    if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    scene.add(new THREE.AmbientLight(0xfff2d8, 0.45));
    const hemi = new THREE.HemisphereLight(0xfff0cc, 0x3a6a28, 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4dc, 1.05);
    sun.position.set(28, 42, 18);
    scene.add(sun);

    for (let i = 0; i < 10; i++) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.02, 1.4),
        new THREE.MeshBasicMaterial({ color: 0xfff4dc, transparent: true, opacity: 0.35 })
      );
      line.position.set(rand(-1.6, 1.6), rand(-0.8, 0.8), -2.4 - Math.random() * 3);
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
  }

  function isTouchUi() {
    return (
      (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
      Math.min(window.innerWidth, window.innerHeight) < 820
    );
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
  bindHold(
    document.getElementById("btn-weapon"),
    () => {
      input.weaponPressed = true;
    },
    () => {}
  );

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
    if (down && mode === "menu" && (k === "Enter" || k === " ")) startRace();
  }

  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));
  window.addEventListener("blur", () => {
    input.left = input.right = input.accel = input.brake = input.boost = input.fire = false;
  });

  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );

  btnStart.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startRace();
  });
  btnRetry.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startRace();
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
    adultConfirmed = true;
    setAdultMode(true);
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

  try {
    initThree();
    racers.length = 0;
    racers.push(makeRacer(0));
    player = racers[0];
    snapCamera(true);
  } catch (err) {
    console.error(err);
    if (adultStatus) adultStatus.textContent = "3D-Init fehlgeschlagen. Seite neu laden.";
  }

  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(frame);
  });
})();
