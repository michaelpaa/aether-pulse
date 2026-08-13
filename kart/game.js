(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const mini = document.getElementById("minimap");
  const mctx = mini.getContext("2d");

  const overlay = document.getElementById("overlay");
  const menu = document.getElementById("menu");
  const results = document.getElementById("results");
  const hud = document.getElementById("hud");
  const placeEl = document.getElementById("place");
  const lapEl = document.getElementById("lap");
  const lapsEl = document.getElementById("laps");
  const timerEl = document.getElementById("timer");
  const speedEl = document.getElementById("speed");
  const itemSlot = document.getElementById("item-slot");
  const countdownEl = document.getElementById("countdown");
  const standingsEl = document.getElementById("standings");
  const resultTitle = document.getElementById("result-title");
  const btnStart = document.getElementById("btn-start");
  const btnRetry = document.getElementById("btn-retry");

  const TOTAL_LAPS = 3;
  const KART_COUNT = 4;
  lapsEl.textContent = String(TOTAL_LAPS);

  const NAMES = ["YOU", "VOX", "RIFF", "NOVA"];
  const COLORS = ["#b6ff3b", "#39e7ff", "#ff4f8b", "#ffbf3c"];
  const ITEMS = ["boost", "shell", "banana", "bolt"];
  const ITEM_ICON = { boost: "🚀", shell: "🐚", banana: "🍌", bolt: "⚡" };

  let W = 800;
  let H = 600;
  let dpr = 1;
  let last = 0;
  let mode = "menu"; // menu | countdown | race | finish
  let raceTime = 0;
  let countValue = 3;
  let countTimer = 0;
  let camX = 0;
  let camY = 0;
  let camAng = 0;

  const input = {
    left: false,
    right: false,
    accel: false,
    brake: false,
    drift: false,
    itemPressed: false,
    fire: false,
    firePressed: false,
    touchSteer: 0,
    touchAccel: 0,
    usingTouch: false,
  };

  const audio = { ctx: null, master: null };
  const particles = [];
  const bananas = [];
  const shells = [];
  const shots = [];
  const itemBoxes = [];
  const sparks = [];
  const hitMeterEl = document.getElementById("hit-meter");
  let lastHitTarget = null;

  // Track centerline (closed loop), world units
  const track = {
    pts: [],
    normals: [],
    cum: [],
    length: 0,
    halfW: 78,
    checkpoints: [],
  };

  const karts = [];
  let player = null;

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
  function len(x, y) {
    return Math.hypot(x, y);
  }
  function roundRectPath(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
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
    else if (name === "item") safeBeep(520, 0.06, "square", 0.06, 200);
    else if (name === "use") safeBeep(300, 0.1, "triangle", 0.08, 160);
    else if (name === "hit") safeBeep(120, 0.16, "sawtooth", 0.1, -40);
    else if (name === "boost") safeBeep(180, 0.2, "sawtooth", 0.09, 260);
    else if (name === "lap") safeBeep(400, 0.12, "triangle", 0.08, 240);
    else if (name === "finish") {
      safeBeep(400, 0.12, "triangle", 0.09, 120);
      safeBeep(600, 0.18, "sine", 0.08, 180);
    } else if (name === "shot") safeBeep(780, 0.05, "square", 0.05, -240);
    else if (name === "slow") {
      safeBeep(160, 0.2, "sawtooth", 0.1, -50);
      safeBeep(90, 0.25, "triangle", 0.08, -20);
    }
  }

  function buildTrack() {
    // Interesting circuit: kidney + chicane vibe
    const shape = [];
    const N = 120;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const wobble = 0.18 * Math.sin(t * 3) + 0.1 * Math.sin(t * 5 + 0.4);
      const r = 520 + 160 * Math.cos(t * 2) + 90 * wobble;
      const x = Math.cos(t) * r + 70 * Math.sin(t * 2);
      const y = Math.sin(t) * (r * 0.72) + 50 * Math.cos(t * 3);
      shape.push({ x, y });
    }

    // Smooth once
    track.pts = shape.map((p, i) => {
      const a = shape[(i - 1 + N) % N];
      const b = shape[i];
      const c = shape[(i + 1) % N];
      return { x: (a.x + b.x * 2 + c.x) / 4, y: (a.y + b.y * 2 + c.y) / 4 };
    });

    track.normals = [];
    track.cum = [0];
    track.length = 0;
    for (let i = 0; i < track.pts.length; i++) {
      const a = track.pts[i];
      const b = track.pts[(i + 1) % track.pts.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      track.normals.push({ x: -dy / d, y: dx / d });
      track.length += d;
      track.cum.push(track.length);
    }

    track.checkpoints = [];
    const cpCount = 16;
    for (let i = 0; i < cpCount; i++) {
      const s = (i / cpCount) * track.length;
      const sample = sampleTrack(s);
      track.checkpoints.push({
        s,
        x: sample.x,
        y: sample.y,
        nx: sample.nx,
        ny: sample.ny,
        tx: sample.tx,
        ty: sample.ty,
      });
    }

    // Item boxes near checkpoints
    itemBoxes.length = 0;
    for (let i = 2; i < cpCount; i += 3) {
      const cp = track.checkpoints[i];
      for (let k = -1; k <= 1; k++) {
        itemBoxes.push({
          x: cp.x + cp.nx * k * 34,
          y: cp.y + cp.ny * k * 34,
          taken: 0,
          spin: rand(0, Math.PI * 2),
        });
      }
    }
  }

  function sampleTrack(s) {
    const L = track.length;
    s = ((s % L) + L) % L;
    let i = 0;
    while (i < track.cum.length - 1 && track.cum[i + 1] < s) i++;
    const s0 = track.cum[i];
    const s1 = track.cum[i + 1];
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const a = track.pts[i % track.pts.length];
    const b = track.pts[(i + 1) % track.pts.length];
    const x = lerp(a.x, b.x, t);
    const y = lerp(a.y, b.y, t);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const tx = dx / d;
    const ty = dy / d;
    return { x, y, tx, ty, nx: -ty, ny: tx, i, t, s };
  }

  function nearestOnTrack(x, y) {
    let best = 0;
    let bestD = Infinity;
    // coarse then refine
    const step = Math.max(8, (track.pts.length / 24) | 0);
    for (let i = 0; i < track.pts.length; i += step) {
      const p = track.pts[i];
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    let lo = best - step;
    let hi = best + step;
    for (let i = lo; i <= hi; i++) {
      const idx = ((i % track.pts.length) + track.pts.length) % track.pts.length;
      const p = track.pts[idx];
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bestD) {
        bestD = d;
        best = idx;
      }
    }
    const a = track.pts[best];
    const b = track.pts[(best + 1) % track.pts.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = x - a.x;
    const apy = y - a.y;
    const ab2 = abx * abx + aby * aby || 1;
    const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
    const px = a.x + abx * t;
    const py = a.y + aby * t;
    const dlen = Math.hypot(abx, aby) || 1;
    const tx = abx / dlen;
    const ty = aby / dlen;
    const nx = -ty;
    const ny = tx;
    const lat = (x - px) * nx + (y - py) * ny;
    const s = track.cum[best] + t * dlen;
    return { x: px, y: py, tx, ty, nx, ny, lat, s, dist: Math.hypot(x - px, y - py) };
  }

  function makeKart(id, isPlayer, color, name) {
    const start = sampleTrack(12 + id * 28);
    const lane = (id - (KART_COUNT - 1) / 2) * 26;
    return {
      id,
      isPlayer,
      name,
      color,
      x: start.x + start.nx * lane,
      y: start.y + start.ny * lane,
      angle: Math.atan2(start.ty, start.tx),
      speed: 0,
      steer: 0,
      drift: 0,
      driftCharge: 0,
      boost: 0,
      stun: 0,
      lap: 0,
      cp: 0,
      progress: 0,
      finishTime: null,
      finished: false,
      item: null,
      itemSpin: 0,
      place: id + 1,
      aiTargetS: 40 + id * 10,
      aiAggro: 0.55 + id * 0.06,
      smoke: 0,
      hitsTaken: 0,
      slowTimer: 0,
      fireCd: 0,
    };
  }

  function resetRace() {
    buildTrack();
    karts.length = 0;
    for (let i = 0; i < KART_COUNT; i++) {
      karts.push(makeKart(i, i === 0, COLORS[i], NAMES[i]));
    }
    player = karts[0];
    bananas.length = 0;
    shells.length = 0;
    shots.length = 0;
    particles.length = 0;
    sparks.length = 0;
    lastHitTarget = null;
    for (const b of itemBoxes) b.taken = 0;
    raceTime = 0;
    countValue = 3;
    countTimer = 1;
    mode = "countdown";
    const look = sampleTrack(80);
    camX = player.x;
    camY = player.y;
    camAng = player.angle;
    updateHud(true);
    countdownEl.textContent = "3";
    countdownEl.classList.add("show");
    sfx("count");
  }

  function ordinal(n) {
    if (n === 1) return "1<span>st</span>";
    if (n === 2) return "2<span>nd</span>";
    if (n === 3) return "3<span>rd</span>";
    return n + "<span>th</span>";
  }

  function formatTime(t) {
    const m = (t / 60) | 0;
    const s = t - m * 60;
    const sec = s | 0;
    const ms = ((s - sec) * 1000) | 0;
    return m + ":" + String(sec).padStart(2, "0") + "." + String(ms).padStart(3, "0");
  }

  function updateHud(forceItem) {
    placeEl.innerHTML = ordinal(player.place);
    lapEl.textContent = String(Math.min(TOTAL_LAPS, player.lap + 1));
    timerEl.textContent = formatTime(raceTime);
    speedEl.textContent = Math.round(Math.abs(player.speed) * 3.2) + " km/h";

    if (forceItem || true) {
      if (player.itemSpin > 0) {
        itemSlot.className = "item-slot spin";
        itemSlot.textContent = ITEM_ICON[ITEMS[(Math.random() * ITEMS.length) | 0]];
      } else if (player.item) {
        itemSlot.className = "item-slot";
        itemSlot.textContent = ITEM_ICON[player.item] || "?";
      } else {
        itemSlot.className = "item-slot empty";
        itemSlot.textContent = "?";
      }
    }
    if (hitMeterEl) {
      const t = lastHitTarget && !lastHitTarget.finished ? lastHitTarget : null;
      if (t) hitMeterEl.textContent = t.name + " " + t.hitsTaken + "/10";
      else hitMeterEl.textContent = "HITS 0/10";
    }
  }

  function burst(x, y, color, n, spd) {
    const room = 280 - particles.length;
    const c = Math.min(n, Math.max(0, room));
    for (let i = 0; i < c; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(spd * 0.2, spd);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.2, 0.55),
        color,
        size: rand(1.5, 3.5),
      });
    }
  }

  function giveItem(kart) {
    if (kart.item || kart.itemSpin > 0) return;
    kart.itemSpin = 0.9;
    sfx("item");
  }

  function registerHit(target, fromId) {
    if (!target || target.finished) return;
    target.hitsTaken += 1;
    lastHitTarget = target;
    burst(target.x, target.y, "#ff4f8b", 10, 180);
    sfx("hit");
    if (target.hitsTaken >= 10) {
      target.hitsTaken = 0;
      target.slowTimer = Math.max(target.slowTimer, 4.5);
      target.speed *= 0.45;
      sfx("slow");
      if (fromId === 0 || target.isPlayer) {
        // toast via countdown reuse is heavy; use item label flash
      }
      if (hitMeterEl) hitMeterEl.textContent = target.name + " SLOW!";
    }
  }

  function fireShot(kart) {
    if (!kart || kart.finished || kart.stun > 0 || kart.fireCd > 0) return;
    kart.fireCd = kart.isPlayer ? 0.22 : 0.45;
    shots.push({
      x: kart.x + Math.cos(kart.angle) * 26,
      y: kart.y + Math.sin(kart.angle) * 26,
      vx: Math.cos(kart.angle) * 520,
      vy: Math.sin(kart.angle) * 520,
      life: 1.1,
      owner: kart.id,
    });
    sfx("shot");
  }

  function useItem(kart) {
    if (!kart.item || kart.stun > 0) return;
    const item = kart.item;
    kart.item = null;
    sfx("use");
    if (item === "boost") {
      kart.boost = Math.max(kart.boost, 0.85);
      sfx("boost");
      burst(kart.x, kart.y, "#39e7ff", 18, 260);
    } else if (item === "banana") {
      bananas.push({
        x: kart.x - Math.cos(kart.angle) * 34,
        y: kart.y - Math.sin(kart.angle) * 34,
        life: 18,
        owner: kart.id,
      });
    } else if (item === "shell") {
      shells.push({
        x: kart.x + Math.cos(kart.angle) * 28,
        y: kart.y + Math.sin(kart.angle) * 28,
        angle: kart.angle,
        speed: 420,
        life: 3.2,
        owner: kart.id,
        target: null,
      });
    } else if (item === "bolt") {
      for (const k of karts) {
        if (k.id === kart.id || k.finished) continue;
        if (k.place < kart.place || (k.place === 1 && kart.place > 1)) {
          k.stun = Math.max(k.stun, 1.1);
          k.speed *= 0.35;
          burst(k.x, k.y, "#ffbf3c", 20, 220);
        }
      }
      // if player is first, hit everyone ahead doesn't apply — hit all others lightly
      if (kart.place === 1) {
        for (const k of karts) {
          if (k.id === kart.id || k.finished) continue;
          k.stun = Math.max(k.stun, 0.7);
          k.speed *= 0.5;
          burst(k.x, k.y, "#ffbf3c", 14, 180);
        }
      }
      sfx("hit");
    }
  }

  function updateProgress(kart) {
    const near = nearestOnTrack(kart.x, kart.y);
    kart._near = near;

    if (kart._lastS == null) kart._lastS = near.s;
    const prev = kart._lastS;
    const cur = near.s;
    const forwardSpeed = kart.speed > 30;

    // crossed start/finish forward
    if (
      !kart.finished &&
      forwardSpeed &&
      Math.abs(near.lat) < track.halfW + 25 &&
      prev > track.length * 0.78 &&
      cur < track.length * 0.22
    ) {
      kart.lap += 1;
      if (kart.isPlayer) sfx("lap");
      if (kart.lap >= TOTAL_LAPS) {
        kart.finished = true;
        kart.finishTime = raceTime;
        if (kart.isPlayer) finishRace();
      }
    }

    kart._lastS = cur;
    kart.progress = kart.lap * track.length + cur;
  }

  function rankKarts() {
    const order = karts.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    for (let i = 0; i < order.length; i++) order[i].place = i + 1;
  }

  function finishRace() {
    if (mode === "finish") return;
    mode = "finish";
    sfx("finish");
    // force remaining finish order by progress
    for (const k of karts) {
      if (!k.finished) {
        k.finished = true;
        k.finishTime = raceTime + (4 - k.place) * 0.01;
      }
    }
    rankKarts();
    const youPlace = player.place;
    resultTitle.textContent = youPlace === 1 ? "YOU WIN!" : "FINISH";
    standingsEl.innerHTML = "";
    const ordered = karts.slice().sort((a, b) => a.place - b.place);
    for (const k of ordered) {
      const li = document.createElement("li");
      if (k.isPlayer) li.className = "you";
      li.innerHTML =
        '<span class="who">' +
        k.place +
        ". " +
        k.name +
        '</span><span class="meta">' +
        formatTime(k.finishTime || raceTime) +
        "</span>";
      standingsEl.appendChild(li);
    }
    overlay.classList.remove("playing");
    menu.classList.add("hidden");
    results.classList.remove("hidden");
    hud.classList.add("hidden");
    countdownEl.classList.remove("show");
    if (typeof hideMobilePad === "function") hideMobilePad();
  }

  function steerKart(kart, dt, steerInput, accelInput, brakeInput, driftHeld) {
    if (kart.finished) {
      kart.speed *= 0.98;
      return;
    }
    if (kart.fireCd > 0) kart.fireCd -= dt;
    if (kart.slowTimer > 0) kart.slowTimer -= dt;

    if (!finite(kart.stun) || kart.stun < 0) kart.stun = 0;
    if (kart.stun > 0) {
      kart.stun -= dt;
      kart.speed *= 0.96;
      return;
    }

    const near = kart._near || nearestOnTrack(kart.x, kart.y);
    const onTrack = Math.abs(near.lat) <= track.halfW;
    const slowMul = kart.slowTimer > 0 ? 0.55 : 1;
    const maxSpeed = (onTrack ? 290 : 125) * (kart.boost > 0 ? 1.38 : 1) * slowMul;
    const accel = onTrack ? 260 : 95;
    const brake = 340;
    const friction = onTrack ? 32 : 120;

    if (accelInput > 0) kart.speed += accel * accelInput * dt;
    if (brakeInput > 0) {
      if (kart.speed > 20) kart.speed -= brake * brakeInput * dt;
      else kart.speed -= accel * 0.45 * brakeInput * dt;
    }
    kart.speed -= Math.sign(kart.speed) * friction * dt;
    if (Math.abs(kart.speed) < 3 && accelInput <= 0 && brakeInput <= 0) kart.speed = 0;
    kart.speed = clamp(kart.speed, -90, maxSpeed);

    if (kart.boost > 0) {
      kart.boost -= dt;
      kart.speed = Math.max(kart.speed, 300);
    }

    const speedFactor = clamp(Math.abs(kart.speed) / 260, 0, 1);
    let turn = steerInput * (2.55 - speedFactor * 0.9);

    if (driftHeld && Math.abs(kart.speed) > 90 && Math.abs(steerInput) > 0.15) {
      kart.drift = lerp(kart.drift, steerInput, 1 - Math.pow(0.01, dt));
      turn *= 1.35;
      kart.driftCharge = Math.min(1, kart.driftCharge + dt * 0.55);
      kart.smoke += dt;
      if (kart.smoke > 0.04) {
        kart.smoke = 0;
        sparks.push({
          x: kart.x - Math.cos(kart.angle) * 12,
          y: kart.y - Math.sin(kart.angle) * 12,
          life: 0.35,
          color: "#dfe7ff",
        });
      }
    } else {
      if (kart.driftCharge > 0.55 && !driftHeld) {
        kart.boost = Math.max(kart.boost, 0.35 + kart.driftCharge * 0.5);
        if (kart.isPlayer) sfx("boost");
      }
      kart.driftCharge = Math.max(0, kart.driftCharge - dt * 1.5);
      kart.drift = lerp(kart.drift, 0, 1 - Math.pow(0.001, dt));
    }

    kart.angle += turn * (kart.speed >= 0 ? 1 : -1) * dt;
    const slip = kart.drift * 0.55;
    const moveAng = kart.angle + slip;
    kart.x += Math.cos(moveAng) * kart.speed * dt;
    kart.y += Math.sin(moveAng) * kart.speed * dt;

    if (!finite(kart.x) || !finite(kart.y) || !finite(kart.speed) || !finite(kart.angle)) {
      snapKartToTrack(kart);
      return;
    }

    const n2 = nearestOnTrack(kart.x, kart.y);
    kart._near = n2;
    if (Math.abs(n2.lat) > track.halfW) {
      const extra = Math.abs(n2.lat) - track.halfW;
      const dir = Math.sign(n2.lat) || 1;
      kart.x -= n2.nx * dir * extra;
      kart.y -= n2.ny * dir * extra;
      kart.speed *= 0.88;
    }
    if (Math.abs(n2.lat) <= track.halfW + 6 && finite(kart.x)) {
      kart._safeX = kart.x;
      kart._safeY = kart.y;
      kart._safeA = kart.angle;
      kart._safeS = n2.s;
    }
    if (n2.dist > 160 || Math.abs(n2.lat) > track.halfW + 48) snapKartToTrack(kart);
  }

  function snapKartToTrack(kart) {
    const s = finite(kart._safeS) ? kart._safeS : kart._near && finite(kart._near.s) ? kart._near.s : 0;
    const sample = sampleTrack(s);
    kart.x = sample.x;
    kart.y = sample.y;
    kart.angle = Math.atan2(sample.ty, sample.tx);
    kart.speed = 0;
    kart.stun = 0;
    kart.vx = 0;
    kart.vy = 0;
    kart._near = nearestOnTrack(kart.x, kart.y);
  }

  function updateAI(kart, dt) {
    if (kart.isPlayer || kart.finished) return;
    const lookAhead = 140 + Math.abs(kart.speed) * 0.35;
    const target = sampleTrack((kart._near ? kart._near.s : 0) + lookAhead);
    const lane = Math.sin(raceTime * (0.7 + kart.id * 0.15) + kart.id) * 28;
    const tx = target.x + target.nx * lane;
    const ty = target.y + target.ny * lane;
    const desired = Math.atan2(ty - kart.y, tx - kart.x);
    let diff = angNorm(desired - kart.angle);
    const steer = clamp(diff * 1.4, -1, 1);

    // avoid bananas roughly
    let brake = 0;
    for (const b of bananas) {
      const d = Math.hypot(b.x - kart.x, b.y - kart.y);
      if (d < 70) brake = 0.4;
    }

    const accel = kart.stun > 0 ? 0 : 0.85 + kart.aiAggro * 0.15;
    const drift = Math.abs(diff) > 0.45 && Math.abs(kart.speed) > 120;
    steerKart(kart, dt, steer, accel, brake, drift);

    // AI item use
    if (kart.item && Math.random() < dt * 0.55) {
      if (kart.item === "boost") useItem(kart);
      else if (kart.item === "bolt" && kart.place > 1) useItem(kart);
      else if (kart.item === "shell" && kart.place > 1) useItem(kart);
      else if (kart.item === "banana" && Math.random() < 0.4) useItem(kart);
    }

    // AI guns — shoot toward nearby rivals ahead/behind
    if (Math.random() < dt * 0.7) {
      for (const other of karts) {
        if (other.id === kart.id || other.finished) continue;
        const dx = other.x - kart.x;
        const dy = other.y - kart.y;
        const d = Math.hypot(dx, dy);
        if (d < 220) {
          const ang = Math.atan2(dy, dx);
          if (Math.abs(angNorm(ang - kart.angle)) < 0.55) {
            fireShot(kart);
            break;
          }
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
      if (input.touchAccel > 0.15) accel = input.touchAccel;
      if (input.touchAccel < -0.15) brake = -input.touchAccel;
    }
    steerKart(player, dt, steer, accel, brake, input.drift);
    if (input.itemPressed) {
      input.itemPressed = false;
      useItem(player);
    }
    if (input.fire || input.firePressed) {
      input.firePressed = false;
      fireShot(player);
    }
  }

  function updateItems(dt) {
    for (const box of itemBoxes) {
      box.spin += dt * 3;
      if (box.taken > 0) box.taken -= dt;
      if (box.taken > 0) continue;
      for (const k of karts) {
        if (k.finished) continue;
        if (Math.hypot(k.x - box.x, k.y - box.y) < 26) {
          box.taken = 4.5;
          giveItem(k);
          burst(box.x, box.y, "#39e7ff", 10, 160);
        }
      }
    }

    for (const k of karts) {
      if (k.itemSpin > 0) {
        k.itemSpin -= dt;
        if (k.itemSpin <= 0) {
          k.itemSpin = 0;
          // worse place => better item odds
          const roll = Math.random() + (k.place - 1) * 0.08;
          if (roll > 1.1) k.item = "bolt";
          else if (roll > 0.75) k.item = "shell";
          else if (roll > 0.4) k.item = "boost";
          else k.item = "banana";
        }
      }
    }

    if (bananas.length > 16) bananas.splice(0, bananas.length - 16);
    if (shells.length > 10) shells.splice(0, shells.length - 10);
    if (shots.length > 40) shots.splice(0, shots.length - 40);

    for (let i = bananas.length - 1; i >= 0; i--) {
      const b = bananas[i];
      b.life -= dt;
      if (b.life <= 0) {
        bananas.splice(i, 1);
        continue;
      }
      for (const k of karts) {
        if (k.finished || k.id === b.owner) continue;
        if (Math.hypot(k.x - b.x, k.y - b.y) < 22) {
          k.stun = Math.max(k.stun, 0.9);
          k.speed *= 0.2;
          burst(k.x, k.y, "#ffbf3c", 16, 200);
          sfx("hit");
          bananas.splice(i, 1);
          break;
        }
      }
    }

    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i];
      s.life -= dt;
      // home toward next kart ahead of owner
      const owner = karts[s.owner];
      let target = null;
      let best = Infinity;
      for (const k of karts) {
        if (k.id === s.owner || k.finished) continue;
        if (k.progress > (owner ? owner.progress : 0)) {
          const d = Math.hypot(k.x - s.x, k.y - s.y);
          if (d < best) {
            best = d;
            target = k;
          }
        }
      }
      if (!target) {
        for (const k of karts) {
          if (k.id === s.owner || k.finished) continue;
          const d = Math.hypot(k.x - s.x, k.y - s.y);
          if (d < best) {
            best = d;
            target = k;
          }
        }
      }
      if (target) {
        const desired = Math.atan2(target.y - s.y, target.x - s.x);
        s.angle = s.angle + angNorm(desired - s.angle) * Math.min(1, dt * 5);
      }
      s.x += Math.cos(s.angle) * s.speed * dt;
      s.y += Math.sin(s.angle) * s.speed * dt;

      let hit = false;
      for (const k of karts) {
        if (k.id === s.owner || k.finished) continue;
        if (Math.hypot(k.x - s.x, k.y - s.y) < 24) {
          k.stun = Math.max(k.stun, 1.0);
          k.speed *= 0.15;
          burst(k.x, k.y, "#39e7ff", 22, 260);
          sfx("hit");
          hit = true;
          break;
        }
      }
      if (hit || s.life <= 0) shells.splice(i, 1);
    }

    for (let i = shots.length - 1; i >= 0; i--) {
      const sh = shots[i];
      sh.life -= dt;
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      let dead = sh.life <= 0;
      for (const k of karts) {
        if (k.id === sh.owner || k.finished) continue;
        if (Math.hypot(k.x - sh.x, k.y - sh.y) < 22) {
          registerHit(k, sh.owner);
          burst(sh.x, sh.y, "#b6ff3b", 8, 160);
          dead = true;
          break;
        }
      }
      if (dead) shots.splice(i, 1);
    }
  }

  function updateFx(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      sparks[i].life -= dt;
      if (sparks[i].life <= 0) sparks.splice(i, 1);
    }
  }

  function update(dt) {
    if (mode === "menu") {
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
          countTimer = 0.6;
          sfx("go");
        } else {
          countdownEl.classList.remove("show");
          mode = "race";
        }
      }
      // freeze karts but allow camera
      camX = lerp(camX, player.x, 1 - Math.pow(0.001, dt));
      camY = lerp(camY, player.y, 1 - Math.pow(0.001, dt));
      camAng = camAng + angNorm(player.angle - camAng) * (1 - Math.pow(0.05, dt));
      updateFx(dt);
      return;
    }

    if (mode === "finish") {
      updateFx(dt);
      return;
    }

    // race
    raceTime += dt;
    updatePlayer(dt);
    for (const k of karts) {
      if (!k.isPlayer) updateAI(k, dt);
      updateProgress(k);
    }
    rankKarts();
    for (let i = 0; i < karts.length; i++) {
      for (let j = i + 1; j < karts.length; j++) {
        const a = karts[i];
        const b = karts[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        if (d < 28) {
          const push = (28 - d) * 0.5;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
    updateItems(dt);
    updateFx(dt);

    // camera chase
    const look = 60 + Math.abs(player.speed) * 0.12;
    const tx = player.x + Math.cos(player.angle) * look;
    const ty = player.y + Math.sin(player.angle) * look;
    camX = lerp(camX, tx, 1 - Math.pow(0.02, dt));
    camY = lerp(camY, ty, 1 - Math.pow(0.02, dt));
    camAng = camAng + angNorm(player.angle - camAng) * (1 - Math.pow(0.04, dt));

    // tire smoke when player drifts
    if (input.drift && Math.abs(player.speed) > 100) {
      burst(
        player.x - Math.cos(player.angle) * 16,
        player.y - Math.sin(player.angle) * 16,
        "rgba(200,210,230,0.8)",
        2,
        40
      );
    }

    updateHud(false);

    // auto-finish if all done
    if (karts.every((k) => k.finished)) finishRace();
  }

  function drawKart(k) {
    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.rotate(k.angle);

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(3, 8, 20, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    // wheels
    ctx.fillStyle = "#1a1f2b";
    ctx.fillRect(-12, -15, 10, 6);
    ctx.fillRect(-12, 9, 10, 6);
    ctx.fillRect(6, -15, 10, 6);
    ctx.fillRect(6, 9, 10, 6);

    // body
    ctx.fillStyle = k.color;
    ctx.strokeStyle = "#0b1020";
    ctx.lineWidth = 2;
    roundRectPath(ctx, -14, -11, 30, 22, 5);
    ctx.fill();
    ctx.stroke();

    // nose
    ctx.beginPath();
    ctx.moveTo(16, -8);
    ctx.lineTo(24, 0);
    ctx.lineTo(16, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // cockpit
    ctx.fillStyle = "rgba(10,16,32,0.9)";
    roundRectPath(ctx, -2, -6, 12, 12, 3);
    ctx.fill();

    // number plate vibe
    ctx.fillStyle = "#f2f7ff";
    ctx.font = "bold 10px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(String(k.id + 1), 4, 3);

    // boost flame
    if (k.boost > 0 || (k.isPlayer && input.accel && Math.abs(k.speed) > 50)) {
      const flick = 8 + Math.random() * 10 + (k.boost > 0 ? 10 : 0);
      ctx.fillStyle = k.boost > 0 ? "#39e7ff" : "#ffbf3c";
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(-14 - flick, 6);
      ctx.lineTo(-14 - flick * 0.7, 0);
      ctx.lineTo(-14 - flick, -6);
      ctx.closePath();
      ctx.fill();
    }

    // player ring
    if (k.isPlayer) {
      ctx.strokeStyle = "rgba(182,255,59,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (k.slowTimer > 0) {
      ctx.strokeStyle = "rgba(255,79,139,0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.stroke();
    }
    // hit pips
    if (k.hitsTaken > 0) {
      ctx.fillStyle = "#ff4f8b";
      for (let i = 0; i < Math.min(10, k.hitsTaken); i++) {
        ctx.fillRect(-18 + i * 4, -28, 3, 3);
      }
    }
    ctx.restore();
  }

  function drawTrack() {
    // asphalt ribbon
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // outer grass already bg; draw asphalt
    ctx.beginPath();
    for (let i = 0; i < track.pts.length; i++) {
      const p = track.pts[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.strokeStyle = "#2a3348";
    ctx.lineWidth = track.halfW * 2 + 28;
    ctx.stroke();

    ctx.strokeStyle = "#3a455e";
    ctx.lineWidth = track.halfW * 2 + 10;
    ctx.stroke();

    ctx.strokeStyle = "#505c78";
    ctx.lineWidth = track.halfW * 2;
    ctx.stroke();

    // center dashed line
    ctx.save();
    ctx.setLineDash([18, 16]);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // red/white curb approx via small segments
    for (let i = 0; i < track.pts.length; i += 2) {
      const p = track.pts[i];
      const n = track.normals[i];
      const col = (i / 2) % 2 === 0 ? "#ff4f8b" : "#f2f7ff";
      ctx.strokeStyle = col;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(p.x + n.x * track.halfW, p.y + n.y * track.halfW);
      const p2 = track.pts[(i + 1) % track.pts.length];
      const n2 = track.normals[(i + 1) % track.pts.length];
      ctx.lineTo(p2.x + n2.x * track.halfW, p2.y + n2.y * track.halfW);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - n.x * track.halfW, p.y - n.y * track.halfW);
      ctx.lineTo(p2.x - n2.x * track.halfW, p2.y - n2.y * track.halfW);
      ctx.stroke();
    }

    // start/finish line
    const sf = track.checkpoints[0];
    ctx.save();
    ctx.translate(sf.x, sf.y);
    ctx.rotate(Math.atan2(sf.ty, sf.tx));
    for (let i = -4; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = ((i + j) & 1) === 0 ? "#111" : "#f2f7ff";
        ctx.fillRect(j * 10 - 10, i * (track.halfW / 4), 10, track.halfW / 4);
      }
    }
    ctx.restore();

    // neon roadside lamps
    for (let i = 0; i < track.pts.length; i += 6) {
      const p = track.pts[i];
      const n = track.normals[i];
      for (const side of [-1, 1]) {
        const lx = p.x + n.x * (track.halfW + 22) * side;
        const ly = p.y + n.y * (track.halfW + 22) * side;
        ctx.fillStyle = side > 0 ? "#39e7ff" : "#ff4f8b";
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.arc(lx, ly, 14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawWorld() {
    ctx.save();
    ctx.translate(W / 2, H / 2 + 40);
    const zoom = 1.35;
    ctx.scale(zoom, zoom);
    ctx.rotate(-camAng - Math.PI / 2);
    ctx.translate(-camX, -camY);

    // ground
    ctx.fillStyle = "#16301f";
    ctx.fillRect(camX - 2500, camY - 2500, 5000, 5000);
    // subtle grid
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let x = -2000; x <= 2000; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, -2000);
      ctx.lineTo(x, 2000);
      ctx.stroke();
    }
    for (let y = -2000; y <= 2000; y += 80) {
      ctx.beginPath();
      ctx.moveTo(-2000, y);
      ctx.lineTo(2000, y);
      ctx.stroke();
    }

    drawTrack();

    // item boxes
    for (const box of itemBoxes) {
      if (box.taken > 0) continue;
      ctx.save();
      ctx.translate(box.x, box.y);
      ctx.rotate(box.spin);
      ctx.fillStyle = "#39e7ff";
      ctx.globalAlpha = 0.9;
      ctx.fillRect(-11, -11, 22, 22);
      ctx.strokeStyle = "#f2f7ff";
      ctx.lineWidth = 2;
      ctx.strokeRect(-11, -11, 22, 22);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // bananas
    for (const b of bananas) {
      ctx.fillStyle = "#ffbf3c";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // shells
    for (const s of shells) {
      ctx.fillStyle = "#39e7ff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f2f7ff";
      ctx.stroke();
    }

    // gun shots
    for (const sh of shots) {
      ctx.save();
      ctx.translate(sh.x, sh.y);
      ctx.rotate(Math.atan2(sh.vy, sh.vx));
      ctx.fillStyle = "#b6ff3b";
      ctx.fillRect(-8, -2, 16, 4);
      ctx.restore();
    }

    // sparks / particles in world
    for (const s of sparks) {
      ctx.globalAlpha = Math.max(0, s.life * 2);
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x, s.y, 3, 3);
    }
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // karts back-to-front roughly by camera
    const sorted = karts.slice().sort((a, b) => {
      const da = (a.x - camX) * Math.cos(camAng) + (a.y - camY) * Math.sin(camAng);
      const db = (b.x - camX) * Math.cos(camAng) + (b.y - camY) * Math.sin(camAng);
      return da - db;
    });
    for (const k of sorted) drawKart(k);

    ctx.restore();
  }

  function drawMinimap() {
    const mw = mini.width;
    const mh = mini.height;
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = "rgba(8,12,24,0.2)";
    mctx.fillRect(0, 0, mw, mh);

    // fit track
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of track.pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const pad = 16;
    const sx = (mw - pad * 2) / (maxX - minX || 1);
    const sy = (mh - pad * 2) / (maxY - minY || 1);
    const sc = Math.min(sx, sy);
    const ox = pad + (mw - pad * 2 - (maxX - minX) * sc) / 2;
    const oy = pad + (mh - pad * 2 - (maxY - minY) * sc) / 2;
    const tx = (x) => ox + (x - minX) * sc;
    const ty = (y) => oy + (y - minY) * sc;

    mctx.beginPath();
    for (let i = 0; i < track.pts.length; i++) {
      const p = track.pts[i];
      if (i === 0) mctx.moveTo(tx(p.x), ty(p.y));
      else mctx.lineTo(tx(p.x), ty(p.y));
    }
    mctx.closePath();
    mctx.strokeStyle = "#505c78";
    mctx.lineWidth = 7;
    mctx.stroke();
    mctx.strokeStyle = "#39e7ff";
    mctx.lineWidth = 1.5;
    mctx.stroke();

    for (const k of karts) {
      mctx.fillStyle = k.color;
      mctx.beginPath();
      mctx.arc(tx(k.x), ty(k.y), k.isPlayer ? 4 : 3, 0, Math.PI * 2);
      mctx.fill();
    }
  }

  function draw() {
    // sky/background vignette in screen space
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#152038");
    g.addColorStop(1, "#0a1020");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (track.pts.length) {
      drawWorld();
      drawMinimap();
    }

    // screen vignette
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.85);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.4)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    // touch hints
    if ((mode === "race" || mode === "countdown") && input.usingTouch) {
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = "#39e7ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(80, H - 80, 48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(W - 80, H - 80, 48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function frame(now) {
    try {
      const raw = (now - last) / 1000;
      const dt = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 0.033) : 0.016;
      last = now;
      update(dt);
      draw();
    } catch (err) {
      console.error("NEON KART frame error:", err);
      try {
        if (player) snapKartToTrack(player);
      } catch (_) {}
    }
    requestAnimationFrame(frame);
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

  function finishRaceCleanupPad() {
    hideMobilePad();
  }

  function isTouchUi() {
    return (
      "ontouchstart" in window ||
      (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
      Math.min(window.innerWidth, window.innerHeight) < 820
    );
  }

  const mobilePad = document.getElementById("mobile-pad");
  const joySteer = document.getElementById("joy-steer");
  const joyKnob = document.getElementById("joy-knob");
  const btnGas = document.getElementById("btn-gas");
  const btnBrake = document.getElementById("btn-brake");
  const btnDrift = document.getElementById("btn-drift");
  const btnShoot = document.getElementById("btn-shoot");
  const btnItem = document.getElementById("btn-item");

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
    input.accel = false;
    input.brake = false;
    input.drift = false;
    input.fire = false;
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

  function setupJoystick(root, knob, onMove, onEnd) {
    if (!root || !knob) return;
    let active = null;
    const radius = 42;
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
      onMove(dx / radius, dy / radius);
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
        onEnd();
      }
    };
    root.addEventListener("touchend", end, { passive: false });
    root.addEventListener("touchcancel", end, { passive: false });
  }

  setupJoystick(
    joySteer,
    joyKnob,
    (x) => {
      input.touchSteer = x;
      input.usingTouch = true;
    },
    () => {
      input.touchSteer = 0;
    }
  );

  bindHold(btnGas, () => { input.accel = true; }, () => { input.accel = false; });
  bindHold(btnBrake, () => { input.brake = true; }, () => { input.brake = false; });
  bindHold(btnDrift, () => { input.drift = true; }, () => { input.drift = false; });
  bindHold(
    btnShoot,
    () => {
      input.fire = true;
      input.firePressed = true;
    },
    () => {
      input.fire = false;
    }
  );
  bindHold(
    btnItem,
    () => {
      input.itemPressed = true;
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
      input.drift = down;
      if (down) e.preventDefault();
    } else if (k === "e" || k === "E" || k === "f" || k === "F") {
      input.fire = down;
      if (down) {
        input.firePressed = true;
        e.preventDefault();
      }
    } else if (k === "Shift") {
      if (down) {
        input.itemPressed = true;
        e.preventDefault();
      }
    }
    if (down && mode === "menu" && (k === "Enter" || k === " ")) startRace();
  }

  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));
  window.addEventListener("blur", () => {
    input.left = input.right = input.accel = input.brake = input.drift = input.fire = false;
  });

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
      input.fire = true;
      input.firePressed = true;
    }
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) input.fire = false;
  });

  // Prevent iOS page scroll while racing; controls live on #mobile-pad
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
  // backup for stubborn mobile/webview click routing
  btnStart.onclick = (e) => {
    e.preventDefault();
    startRace();
  };
  btnRetry.onclick = (e) => {
    e.preventDefault();
    startRace();
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(320, window.innerWidth || 800);
    H = Math.max(240, window.innerHeight || 600);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", resize);
  resize();
  buildTrack();
  const start = sampleTrack(0);
  camX = start.x;
  camY = start.y;
  camAng = Math.atan2(start.ty, start.tx);

  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(frame);
  });
})();
