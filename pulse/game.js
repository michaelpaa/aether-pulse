(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const overlay = document.getElementById("overlay");
  const menu = document.getElementById("menu");
  const gameoverEl = document.getElementById("gameover");
  const hud = document.getElementById("hud");
  const scoreEl = document.getElementById("score");
  const waveEl = document.getElementById("wave");
  const bestEl = document.getElementById("best");
  const comboEl = document.getElementById("combo");
  const hpBar = document.getElementById("hp");
  const energyBar = document.getElementById("energy");
  const toastEl = document.getElementById("toast");
  const btnStart = document.getElementById("btn-start");
  const btnRetry = document.getElementById("btn-retry");
  const finalScoreEl = document.getElementById("final-score");
  const finalWaveEl = document.getElementById("final-wave");
  const finalComboEl = document.getElementById("final-combo");

  const TAU = Math.PI * 2;
  const BEST_KEY = "aether-pulse-best";
  const MAX_PARTICLES = 350;
  const MAX_BULLETS = 180;
  const MAX_ENEMIES = 40;

  function safeStorageGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }

  function safeStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  }

  let W = 800;
  let H = 600;
  let dpr = 1;
  let running = false;
  let last = 0;
  let shake = 0;
  let hitstop = 0;
  let flash = 0;
  let timeScale = 1;
  let toastTimer = 0;
  let waveDelay = 0;
  let pointerIdMove = null;
  let pointerIdAim = null;

  const input = {
    up: false,
    down: false,
    left: false,
    right: false,
    shoot: false,
    pulsePressed: false,
    mouseX: 0,
    mouseY: 0,
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,
    usingTouch: false,
    autoAim: false,
    moveX: 0,
    moveY: 0,
  };

  const audio = { ctx: null, master: null };

  const stars = [];
  const particles = [];
  const bullets = [];
  const enemies = [];
  const pickups = [];
  const rings = [];
  const floaters = [];

  const state = {
    score: 0,
    best: Number(safeStorageGet(BEST_KEY, "0")) || 0,
    wave: 1,
    combo: 1,
    comboTimer: 0,
    maxCombo: 1,
    toSpawn: 0,
    spawnTimer: 0,
    bossQueued: false,
    bossAlive: false,
  };

  const player = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    r: 14,
    hp: 100,
    maxHp: 100,
    energy: 100,
    maxEnergy: 100,
    fireCd: 0,
    invuln: 0,
    alive: true,
    trail: [],
    shield: 0,
    rapid: 0,
    magnet: 0,
  };

  bestEl.textContent = String(state.best);

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function len(x, y) {
    return Math.hypot(x, y);
  }

  function norm(x, y) {
    const d = Math.hypot(x, y);
    if (d < 1e-6) return { x: 0, y: 0 };
    return { x: x / d, y: y / d };
  }

  function pick(arr) {
    return arr[(Math.random() * arr.length) | 0];
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(320, window.innerWidth || 800);
    H = Math.max(240, window.innerHeight || 600);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seedStars();
    if (!running) {
      player.x = W * 0.5;
      player.y = H * 0.5;
    }
  }

  function seedStars() {
    stars.length = 0;
    const count = Math.min(160, Math.floor((W * H) / 12000));
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: 0.4 + Math.random() * 1.3,
        a: 0.25 + Math.random() * 0.7,
        tw: Math.random() * TAU,
      });
    }
  }

  function ensureAudio() {
    if (audio.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.18;
      audio.master.connect(audio.ctx.destination);
    } catch (_) {}
  }

  function beep(freq, dur, type, vol, slide) {
    if (!audio.ctx) return;
    try {
      if (audio.ctx.state === "suspended") audio.ctx.resume();
      const t0 = audio.ctx.currentTime;
      const osc = audio.ctx.createOscillator();
      const gain = audio.ctx.createGain();
      osc.type = type || "sine";
      const f0 = Math.max(40, freq);
      const f1 = Math.max(40, freq + (slide || 0));
      osc.frequency.setValueAtTime(f0, t0);
      if (slide) osc.frequency.linearRampToValueAtTime(f1, t0 + dur);
      const v = Math.max(0.0001, vol || 0.1);
      gain.gain.setValueAtTime(v, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.02, dur));
      osc.connect(gain);
      gain.connect(audio.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (_) {}
  }

  function sfx(name) {
    ensureAudio();
    switch (name) {
      case "shoot":
        beep(560, 0.05, "square", 0.05, -180);
        break;
      case "hit":
        beep(190, 0.06, "triangle", 0.07, -50);
        break;
      case "kill":
        beep(340, 0.09, "sawtooth", 0.07, 160);
        beep(680, 0.12, "sine", 0.05, 120);
        break;
      case "hurt":
        beep(120, 0.18, "sawtooth", 0.1, -40);
        break;
      case "pulse":
        beep(95, 0.28, "sine", 0.12, -30);
        beep(240, 0.2, "triangle", 0.07, 90);
        break;
      case "pickup":
        beep(700, 0.08, "sine", 0.08, 180);
        break;
      case "wave":
        beep(260, 0.16, "sine", 0.08, 240);
        break;
      case "boss":
        beep(80, 0.35, "sawtooth", 0.12, 20);
        break;
      case "die":
        beep(180, 0.4, "sawtooth", 0.12, -120);
        break;
      case "start":
        beep(300, 0.12, "triangle", 0.08, 200);
        break;
    }
  }

  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    toastTimer = ms || 1400;
  }

  function spawnBurst(x, y, color, n, speed, size) {
    const room = MAX_PARTICLES - particles.length;
    const count = Math.min(n || 12, Math.max(0, room));
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const s = rand((speed || 200) * 0.2, speed || 200);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.25, 0.7),
        max: 0.7,
        size: rand((size || 2.5) * 0.5, size || 2.5),
        color,
        drag: 0.9,
      });
    }
  }

  function spawnRing(x, y, color, maxR) {
    if (rings.length > 24) rings.shift();
    rings.push({ x, y, r: 4, maxR: maxR || 80, life: 1, color });
  }

  function floatText(x, y, text, color) {
    if (floaters.length > 30) floaters.shift();
    floaters.push({ x, y, text, color: color || "#ffb347", life: 1, vy: -42 });
  }

  function edgePoint() {
    const m = 50;
    const side = (Math.random() * 4) | 0;
    if (side === 0) return { x: rand(0, W), y: -m };
    if (side === 1) return { x: W + m, y: rand(0, H) };
    if (side === 2) return { x: rand(0, W), y: H + m };
    return { x: -m, y: rand(0, H) };
  }

  function resetGame() {
    state.score = 0;
    state.wave = 1;
    state.combo = 1;
    state.comboTimer = 0;
    state.maxCombo = 1;
    state.toSpawn = 0;
    state.spawnTimer = 0;
    state.bossQueued = false;
    state.bossAlive = false;
    waveDelay = 0;

    player.x = W * 0.5;
    player.y = H * 0.5;
    player.vx = 0;
    player.vy = 0;
    player.angle = -Math.PI / 2;
    player.hp = player.maxHp;
    player.energy = player.maxEnergy;
    player.fireCd = 0;
    player.invuln = 1.4;
    player.alive = true;
    player.trail.length = 0;
    player.shield = 0;
    player.rapid = 0;
    player.magnet = 0;

    bullets.length = 0;
    enemies.length = 0;
    pickups.length = 0;
    particles.length = 0;
    rings.length = 0;
    floaters.length = 0;
    shake = 0;
    hitstop = 0;
    flash = 0;
    timeScale = 1;

    input.pulsePressed = false;
    input.shoot = false;

    updateHud();
    beginWave();
  }

  function beginWave() {
    const wave = state.wave;
    state.toSpawn = Math.min(22, 5 + wave * 2);
    state.spawnTimer = 0.45;
    state.bossQueued = wave % 3 === 0;
    state.bossAlive = false;
    sfx("wave");
    toast("WAVE " + wave);
    spawnRing(player.x, player.y, "rgba(61,232,255,0.65)", 130);
  }

  function spawnEnemy(kind) {
    if (enemies.length >= MAX_ENEMIES) return;
    const p = edgePoint();
    const wave = state.wave;

    if (kind === "boss") {
      enemies.push({
        kind: "boss",
        x: p.x,
        y: p.y,
        vx: 0,
        vy: 0,
        r: 34,
        hp: 70 + wave * 22,
        maxHp: 70 + wave * 22,
        speed: 65 + wave * 2,
        damage: 18,
        score: 450 + wave * 35,
        color: "#ff4d6d",
        shootCd: 1.4,
        spin: 0,
      });
      state.bossAlive = true;
      sfx("boss");
      toast("CORE BREACH");
      return;
    }

    if (kind === "dart") {
      enemies.push({
        kind: "dart",
        x: p.x,
        y: p.y,
        vx: 0,
        vy: 0,
        r: 10,
        hp: 1,
        maxHp: 1,
        speed: 200 + wave * 7,
        damage: 9,
        score: 40,
        color: "#5dffb1",
        shootCd: 0,
        spin: rand(0, TAU),
      });
      return;
    }

    if (kind === "tank") {
      const hp = 6 + ((wave / 2) | 0);
      enemies.push({
        kind: "tank",
        x: p.x,
        y: p.y,
        vx: 0,
        vy: 0,
        r: 20,
        hp,
        maxHp: hp,
        speed: 50 + wave,
        damage: 16,
        score: 110,
        color: "#ffb347",
        shootCd: 0,
        spin: 0,
      });
      return;
    }

    const hp = 2 + ((wave / 3) | 0);
    enemies.push({
      kind: "drone",
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      r: 13,
      hp,
      maxHp: hp,
      speed: 90 + wave * 3.5,
      damage: 11,
      score: 65,
      color: "#3de8ff",
      shootCd: 0,
      spin: 0,
    });
  }

  function maybePickup(x, y) {
    if (Math.random() > 0.2 || pickups.length > 10) return;
    pickups.push({
      x,
      y,
      type: pick(["heal", "energy", "rapid", "shield", "magnet"]),
      r: 11,
      life: 11,
      bob: rand(0, TAU),
    });
  }

  function addScore(base, x, y) {
    const gained = Math.round(base * state.combo);
    state.score += gained;
    state.combo = Math.min(10, state.combo + 0.25);
    state.comboTimer = 2.2;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    if (x != null) floatText(x, y, "+" + gained, "#ffb347");
    updateHud();
  }

  function updateHud() {
    scoreEl.textContent = String(state.score | 0);
    waveEl.textContent = String(state.wave);
    bestEl.textContent = String(Math.max(state.best, state.score) | 0);
    hpBar.style.transform = "scaleX(" + clamp(player.hp / player.maxHp, 0, 1) + ")";
    energyBar.style.transform = "scaleX(" + clamp(player.energy / player.maxEnergy, 0, 1) + ")";
    const c = state.combo | 0;
    comboEl.textContent = "×" + Math.max(1, c);
    comboEl.classList.toggle("on", state.combo >= 2 && player.alive && running);
  }

  function hurtPlayer(dmg) {
    if (!player.alive || player.invuln > 0) return;
    if (player.shield > 0) {
      player.shield = 0;
      player.invuln = 0.55;
      spawnRing(player.x, player.y, "rgba(93,255,177,0.75)", 80);
      sfx("pickup");
      toast("SHIELD BREAK");
      return;
    }
    player.hp -= dmg;
    player.invuln = 0.8;
    shake = Math.max(shake, 12);
    flash = 0.28;
    hitstop = 0.05;
    sfx("hurt");
    spawnBurst(player.x, player.y, "#ff4d6d", 14, 240, 2.5);
    if (player.hp <= 0) {
      player.hp = 0;
      die();
    }
    updateHud();
  }

  function die() {
    if (!player.alive) return;
    player.alive = false;
    running = false;
    sfx("die");
    spawnBurst(player.x, player.y, "#3de8ff", 36, 380, 3.5);
    spawnBurst(player.x, player.y, "#ff4d6d", 20, 300, 3);
    spawnRing(player.x, player.y, "rgba(255,77,109,0.85)", 200);
    shake = 18;
    flash = 0.5;

    if (state.score > state.best) {
      state.best = state.score;
      safeStorageSet(BEST_KEY, String(state.best));
    }

    finalScoreEl.textContent = String(state.score | 0);
    finalWaveEl.textContent = String(state.wave);
    finalComboEl.textContent = "×" + Math.max(1, state.maxCombo | 0);

    window.setTimeout(() => {
      overlay.classList.remove("playing");
      menu.classList.add("hidden");
      gameoverEl.classList.remove("hidden");
      hud.classList.add("hidden");
      hideMobilePad();
    }, 650);
  }

  function aimPoint() {
    if (input.autoAim && enemies.length) {
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.hp <= 0 || e.dead) continue;
        const d = (e.x - player.x) * (e.x - player.x) + (e.y - player.y) * (e.y - player.y);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (best) return { x: best.x, y: best.y };
    }
    if (input.usingTouch && pointerIdAim != null) {
      return { x: input.aimX, y: input.aimY };
    }
    return { x: input.mouseX, y: input.mouseY };
  }

  function moveVector() {
    let mx = 0;
    let my = 0;
    if (input.up) my -= 1;
    if (input.down) my += 1;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;
    if (input.moveX || input.moveY) {
      mx += input.moveX;
      my += input.moveY;
    }
    if (!mx && !my) return { x: 0, y: 0 };
    return norm(mx, my);
  }

  function fire() {
    if (!player.alive || player.fireCd > 0) return;
    const rapid = player.rapid > 0;
    player.fireCd = rapid ? 0.08 : 0.15;
    const aim = aimPoint();
    const dir = norm(aim.x - player.x, aim.y - player.y);
    if (!dir.x && !dir.y) {
      dir.x = Math.cos(player.angle);
      dir.y = Math.sin(player.angle);
    }
    const speed = 600;
    const count = rapid ? 2 : 1;
    const spread = rapid ? 0.07 : 0;
    for (let i = 0; i < count; i++) {
      if (bullets.length >= MAX_BULLETS) break;
      const a = Math.atan2(dir.y, dir.x) + (count > 1 ? (i === 0 ? -spread : spread) : 0);
      bullets.push({
        x: player.x + Math.cos(a) * 16,
        y: player.y + Math.sin(a) * 16,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 1,
        r: 3.2,
        friendly: true,
        damage: rapid ? 1 : 1.3,
      });
    }
    player.vx -= dir.x * 14;
    player.vy -= dir.y * 14;
    sfx("shoot");
  }

  function doPulse() {
    if (!player.alive || player.energy < 35) return;
    player.energy -= 35;
    player.invuln = Math.max(player.invuln, 0.4);
    timeScale = 0.4;
    shake = Math.max(shake, 8);
    spawnRing(player.x, player.y, "rgba(255,179,71,0.8)", 220);
    spawnBurst(player.x, player.y, "#ffb347", 24, 420, 2.8);
    sfx("pulse");
    toast("PULSE");

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const d = len(e.x - player.x, e.y - player.y);
      if (d < 220) {
        const n = norm(e.x - player.x, e.y - player.y);
        e.vx += n.x * 480;
        e.vy += n.y * 480;
        damageEnemy(e, 3, false);
      }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      if (!bullets[i].friendly) {
        spawnBurst(bullets[i].x, bullets[i].y, "#ffb347", 4, 120, 1.8);
        bullets.splice(i, 1);
      }
    }
    updateHud();
  }

  function damageEnemy(e, dmg, fromBullet) {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    if (fromBullet) {
      sfx("hit");
      hitstop = Math.max(hitstop, 0.02);
    }
    spawnBurst(e.x, e.y, e.color, 4, 120, 1.8);
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    e.hp = 0;
    addScore(e.score, e.x, e.y - 8);
    sfx("kill");
    const big = e.kind === "boss";
    spawnBurst(e.x, e.y, e.color, big ? 40 : 16, big ? 420 : 260, 3);
    spawnRing(e.x, e.y, e.color, big ? 160 : 60);
    shake = Math.max(shake, big ? 14 : 5);
    player.energy = clamp(player.energy + (big ? 30 : 5), 0, player.maxEnergy);
    maybePickup(e.x, e.y);
    if (big) {
      state.bossAlive = false;
      addScore(250, e.x, e.y + 14);
      toast("CORE DESTROYED");
    }
  }

  function applyPickup(type) {
    sfx("pickup");
    spawnRing(player.x, player.y, "rgba(93,255,177,0.65)", 60);
    if (type === "heal") {
      player.hp = clamp(player.hp + 26, 0, player.maxHp);
      toast("REPAIR");
    } else if (type === "energy") {
      player.energy = clamp(player.energy + 40, 0, player.maxEnergy);
      toast("CHARGE");
    } else if (type === "rapid") {
      player.rapid = 5.5;
      toast("OVERCLOCK");
    } else if (type === "shield") {
      player.shield = 7;
      toast("AEGIS");
    } else if (type === "magnet") {
      player.magnet = 9;
      toast("ATTRACTOR");
    }
    updateHud();
  }

  function updateSpawns(dt) {
    if (waveDelay > 0) {
      waveDelay -= dt;
      if (waveDelay <= 0) {
        state.wave += 1;
        beginWave();
        updateHud();
      }
      return;
    }

    if (state.toSpawn > 0) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0 && enemies.length < 12) {
        state.spawnTimer = Math.max(0.32, 1.0 - state.wave * 0.035);
        const roll = Math.random();
        let kind = "drone";
        if (roll < 0.2) kind = "dart";
        else if (roll < 0.36) kind = "tank";
        spawnEnemy(kind);
        state.toSpawn -= 1;
      }
    }

    if (state.toSpawn <= 0 && state.bossQueued && !state.bossAlive) {
      const living = enemies.some((e) => e.hp > 0 && !e.dead);
      if (!living) {
        state.bossQueued = false;
        spawnEnemy("boss");
      }
    }

    if (state.toSpawn <= 0 && !state.bossQueued && !state.bossAlive) {
      const living = enemies.some((e) => e.hp > 0 && !e.dead);
      if (!living && waveDelay <= 0) {
        waveDelay = 1.0;
      }
    }
  }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.hp <= 0 || e.dead) {
        enemies.splice(i, 1);
        continue;
      }

      const to = norm(player.x - e.x, player.y - e.y);

      if (e.kind === "tank") {
        e.vx += to.x * e.speed * 0.7 * dt;
        e.vy += to.y * e.speed * 0.7 * dt;
        e.vx *= 0.98;
        e.vy *= 0.98;
      } else if (e.kind === "boss") {
        e.spin += dt;
        const orbit = Math.sin(e.spin * 1.3) * 0.5;
        e.vx += (to.x * (1 - Math.abs(orbit)) - to.y * orbit) * e.speed * dt;
        e.vy += (to.y * (1 - Math.abs(orbit)) + to.x * orbit) * e.speed * dt;
        e.vx *= 0.96;
        e.vy *= 0.96;
        e.shootCd -= dt;
        if (e.shootCd <= 0) {
          e.shootCd = Math.max(0.7, 1.35 - state.wave * 0.03);
          const shots = 6;
          for (let s = 0; s < shots; s++) {
            if (bullets.length >= MAX_BULLETS) break;
            const a = (TAU * s) / shots + e.spin;
            bullets.push({
              x: e.x,
              y: e.y,
              vx: Math.cos(a) * 220,
              vy: Math.sin(a) * 220,
              life: 2.6,
              r: 4.5,
              friendly: false,
              damage: 11,
            });
          }
          const a2 = Math.atan2(player.y - e.y, player.x - e.x);
          for (let k = -1; k <= 1; k++) {
            if (bullets.length >= MAX_BULLETS) break;
            bullets.push({
              x: e.x,
              y: e.y,
              vx: Math.cos(a2 + k * 0.1) * 300,
              vy: Math.sin(a2 + k * 0.1) * 300,
              life: 2.2,
              r: 4,
              friendly: false,
              damage: 12,
            });
          }
        }
      } else if (e.kind === "dart") {
        e.spin += dt * 7;
        const boost = 1.1 + Math.sin(e.spin) * 0.12;
        e.vx = to.x * e.speed * boost;
        e.vy = to.y * e.speed * boost;
      } else {
        e.vx = to.x * e.speed;
        e.vy = to.y * e.speed;
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;

      if (len(e.x - player.x, e.y - player.y) < e.r + player.r) {
        hurtPlayer(e.damage);
        const n = norm(player.x - e.x, player.y - e.y);
        player.vx += n.x * 220;
        player.vy += n.y * 220;
        e.vx -= n.x * 160;
        e.vy -= n.y * 160;
        if (e.kind !== "boss") damageEnemy(e, 1, false);
      }
    }
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.life <= 0 || b.x < -50 || b.y < -50 || b.x > W + 50 || b.y > H + 50) {
        bullets.splice(i, 1);
        continue;
      }

      if (b.friendly) {
        let hit = false;
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          if (e.hp <= 0 || e.dead) continue;
          if (len(e.x - b.x, e.y - b.y) < e.r + b.r) {
            damageEnemy(e, b.damage, true);
            hit = true;
            break;
          }
        }
        if (hit) bullets.splice(i, 1);
      } else if (player.alive && player.invuln <= 0) {
        if (len(player.x - b.x, player.y - b.y) < player.r + b.r) {
          hurtPlayer(b.damage);
          spawnBurst(b.x, b.y, "#ff4d6d", 5, 140, 1.8);
          bullets.splice(i, 1);
        }
      }
    }
  }

  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.life -= dt;
      p.bob += dt * 4;
      if (p.life <= 0) {
        pickups.splice(i, 1);
        continue;
      }
      if (player.magnet > 0) {
        const n = norm(player.x - p.x, player.y - p.y);
        p.x += n.x * 260 * dt;
        p.y += n.y * 260 * dt;
      }
      if (len(p.x - player.x, p.y - player.y) < player.r + p.r + 3) {
        applyPickup(p.type);
        pickups.splice(i, 1);
      }
    }
  }

  function updateFx(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= dt * 1.35;
      r.r += (r.maxR - r.r) * Math.min(1, dt * 5.5);
      if (r.life <= 0) rings.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt * 0.95;
      f.y += f.vy * dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }
  }

  function update(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt * 1000;
      if (toastTimer <= 0) toastEl.classList.remove("show");
    }

    if (hitstop > 0) {
      hitstop -= dt;
      updateFx(dt * 0.2);
      return;
    }

    if (timeScale < 1) timeScale = Math.min(1, timeScale + dt * 0.6);
    shake = Math.max(0, shake - dt * 26);
    flash = Math.max(0, flash - dt * 1.15);

    if (!running || !player.alive) {
      updateFx(dt);
      return;
    }

    const adt = dt * timeScale;

    if (state.comboTimer > 0) {
      state.comboTimer -= adt;
      if (state.comboTimer <= 0) {
        state.combo = 1;
        updateHud();
      }
    }

    player.invuln = Math.max(0, player.invuln - adt);
    player.fireCd = Math.max(0, player.fireCd - adt);
    player.rapid = Math.max(0, player.rapid - adt);
    player.shield = Math.max(0, player.shield - adt);
    player.magnet = Math.max(0, player.magnet - adt);
    player.energy = clamp(player.energy + adt * 4.2, 0, player.maxEnergy);

    const mv = moveVector();
    const accel = 960;
    player.vx += mv.x * accel * adt;
    player.vy += mv.y * accel * adt;
    const damp = Math.pow(0.86, adt * 60);
    player.vx *= damp;
    player.vy *= damp;
    player.x = clamp(player.x + player.vx * adt, 18, W - 18);
    player.y = clamp(player.y + player.vy * adt, 18, H - 18);

    const aim = aimPoint();
    player.angle = Math.atan2(aim.y - player.y, aim.x - player.x);

    player.trail.push({ x: player.x, y: player.y, life: 1 });
    if (player.trail.length > 14) player.trail.shift();
    for (let i = 0; i < player.trail.length; i++) player.trail[i].life -= adt * 2.4;

    if (input.shoot) fire();

    if (input.pulsePressed) {
      input.pulsePressed = false;
      doPulse();
    }

    updateSpawns(adt);
    updateEnemies(adt);
    updateBullets(adt);
    updatePickups(adt);
    updateFx(adt);
  }

  function drawShip(x, y, angle, thrust) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = "#0a1520";
    ctx.strokeStyle = "#3de8ff";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(17, 0);
    ctx.lineTo(-11, 10);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-11, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (thrust > 20) {
      ctx.fillStyle = "#ffb347";
      ctx.beginPath();
      ctx.moveTo(-11, 0);
      ctx.lineTo(-16 - Math.min(12, thrust * 0.03), 3.5);
      ctx.lineTo(-16 - Math.min(12, thrust * 0.03), -3.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    const sx = shake > 0.2 ? rand(-shake, shake) : 0;
    const sy = shake > 0.2 ? rand(-shake, shake) : 0;
    ctx.save();
    ctx.translate(sx, sy);

    const g = ctx.createRadialGradient(W * 0.5, H * 0.42, 30, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
    g.addColorStop(0, "#101a2e");
    g.addColorStop(0.5, "#080e1a");
    g.addColorStop(1, "#03050a");
    ctx.fillStyle = g;
    ctx.fillRect(-24, -24, W + 48, H + 48);

    ctx.globalAlpha = 0.16;
    const n1 = ctx.createRadialGradient(W * 0.22, H * 0.28, 8, W * 0.22, H * 0.28, W * 0.32);
    n1.addColorStop(0, "#1aa7c0");
    n1.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = n1;
    ctx.fillRect(0, 0, W, H);
    const n2 = ctx.createRadialGradient(W * 0.78, H * 0.72, 8, W * 0.78, H * 0.72, W * 0.34);
    n2.addColorStop(0, "#c07a1a");
    n2.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = n2;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    const t = performance.now() * 0.001;
    ctx.fillStyle = "#d7ecff";
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      ctx.globalAlpha = s.a * (0.55 + 0.45 * Math.sin(t * s.z + s.tw));
      ctx.fillRect(s.x, s.y, s.z, s.z);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(61,232,255,0.035)";
    ctx.lineWidth = 1;
    const grid = 72;
    const ox = (player.x * 0.12) % grid;
    const oy = (player.y * 0.12) % grid;
    ctx.beginPath();
    for (let x = -grid; x < W + grid; x += grid) {
      ctx.moveTo(x - ox, 0);
      ctx.lineTo(x - ox, H);
    }
    for (let y = -grid; y < H + grid; y += grid) {
      ctx.moveTo(0, y - oy);
      ctx.lineTo(W, y - oy);
    }
    ctx.stroke();

    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      ctx.globalAlpha = Math.max(0, r.life) * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const pickupColor = {
      heal: "#5dffb1",
      energy: "#ffb347",
      rapid: "#3de8ff",
      shield: "#9af3ff",
      magnet: "#ffd27a",
    };
    for (let i = 0; i < pickups.length; i++) {
      const p = pickups[i];
      const bob = Math.sin(p.bob) * 3;
      ctx.save();
      ctx.translate(p.x, p.y + bob);
      ctx.rotate(p.bob * 0.4);
      ctx.fillStyle = pickupColor[p.type] || "#fff";
      ctx.beginPath();
      ctx.moveTo(0, -p.r);
      ctx.lineTo(p.r, 0);
      ctx.lineTo(0, p.r);
      ctx.lineTo(-p.r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (b.friendly) continue;
      ctx.fillStyle = "#ff4d6d";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
    }

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.hp <= 0 || e.dead) continue;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.strokeStyle = e.color;
      ctx.fillStyle = "rgba(5,8,14,0.88)";
      ctx.lineWidth = 2;

      if (e.kind === "boss") {
        ctx.rotate(e.spin * 0.55);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (TAU * k) / 6;
          const rr = e.r * (k % 2 ? 0.7 : 1);
          const x = Math.cos(a) * rr;
          const y = Math.sin(a) * rr;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.rotate(-e.spin * 0.55);
        ctx.beginPath();
        ctx.strokeStyle = "#ff4d6d";
        ctx.lineWidth = 3;
        ctx.arc(0, 0, e.r + 9, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(e.hp / e.maxHp, 0, 1));
        ctx.stroke();
      } else if (e.kind === "tank") {
        ctx.beginPath();
        ctx.rect(-e.r, -e.r, e.r * 2, e.r * 2);
        ctx.fill();
        ctx.stroke();
      } else if (e.kind === "dart") {
        ctx.rotate(Math.atan2(player.y - e.y, player.x - e.x));
        ctx.beginPath();
        ctx.moveTo(e.r * 1.35, 0);
        ctx.lineTo(-e.r, e.r * 0.75);
        ctx.lineTo(-e.r * 0.35, 0);
        ctx.lineTo(-e.r, -e.r * 0.75);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, e.r, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    for (let i = 0; i < player.trail.length; i++) {
      const tr = player.trail[i];
      if (tr.life <= 0) continue;
      ctx.globalAlpha = tr.life * 0.3;
      ctx.fillStyle = "#3de8ff";
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, 2.5, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (player.alive) {
      if (!(player.invuln > 0 && ((performance.now() / 55) | 0) % 2 === 0)) {
        if (player.shield > 0) {
          ctx.beginPath();
          ctx.strokeStyle = "rgba(93,255,177,0.65)";
          ctx.lineWidth = 2;
          ctx.arc(player.x, player.y, player.r + 9, 0, TAU);
          ctx.stroke();
        }
        drawShip(player.x, player.y, player.angle, len(player.vx, player.vy));
      }
    }

    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.friendly) continue;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.fillStyle = "#e8fbff";
      ctx.fillRect(-5, -1.4, 10, 2.8);
      ctx.restore();
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    ctx.font = "600 13px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    for (let i = 0; i < floaters.length; i++) {
      const f = floaters[i];
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    const vig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.2, W * 0.5, H * 0.5, H * 0.82);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    if (flash > 0) {
      ctx.fillStyle = "rgba(255,77,109," + flash * 0.22 + ")";
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();

    if (running && input.usingTouch) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = "#3de8ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(86, H - 86, 50, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(W - 86, H - 86, 50, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  function frame(now) {
    try {
      const raw = (now - last) / 1000;
      const dt = raw > 0 && raw < 0.05 ? raw : 0.016;
      last = now;
      update(dt);
      draw();
    } catch (err) {
      console.error("AETHER PULSE frame error:", err);
    }
    requestAnimationFrame(frame);
  }

  function startGame() {
    ensureAudio();
    try {
      if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();
    } catch (_) {}
    sfx("start");
    resetGame();
    running = true;
    overlay.classList.add("playing");
    menu.classList.add("hidden");
    gameoverEl.classList.add("hidden");
    hud.classList.remove("hidden");
    showMobilePad();
  }

  function isTouchUi() {
    return (
      "ontouchstart" in window ||
      (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
      Math.min(window.innerWidth, window.innerHeight) < 820
    );
  }

  const mobilePad = document.getElementById("mobile-pad");
  const joyMove = document.getElementById("joy-move");
  const joyKnob = document.getElementById("joy-knob");
  const btnShoot = document.getElementById("btn-shoot");
  const btnPulse = document.getElementById("btn-pulse");

  function showMobilePad() {
    if (!mobilePad) return;
    if (isTouchUi()) {
      mobilePad.classList.remove("hidden");
      input.usingTouch = true;
      input.autoAim = true;
    } else {
      mobilePad.classList.add("hidden");
    }
  }
  function hideMobilePad() {
    if (mobilePad) mobilePad.classList.add("hidden");
    input.moveX = 0;
    input.moveY = 0;
    input.shoot = false;
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
    window.addEventListener("mouseup", up);
  }

  function setupJoystick(root, knob, onMove, onEnd) {
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
    joyMove,
    joyKnob,
    (x, y) => {
      input.moveX = x;
      input.moveY = y;
      input.usingTouch = true;
      input.autoAim = true;
    },
    () => {
      input.moveX = 0;
      input.moveY = 0;
    }
  );

  bindHold(
    btnShoot,
    () => {
      input.shoot = true;
      input.autoAim = true;
      input.usingTouch = true;
    },
    () => {
      input.shoot = false;
    }
  );
  bindHold(
    btnPulse,
    () => {
      input.pulsePressed = true;
    },
    () => {}
  );

  function onKey(e, down) {
    const k = e.key;
    if (k === "w" || k === "W" || k === "ArrowUp") input.up = down;
    else if (k === "s" || k === "S" || k === "ArrowDown") input.down = down;
    else if (k === "a" || k === "A" || k === "ArrowLeft") input.left = down;
    else if (k === "d" || k === "D" || k === "ArrowRight") input.right = down;
    else if (k === " " || k === "Spacebar" || k === "Space") {
      input.shoot = down;
      if (down) e.preventDefault();
    } else if (k === "Shift") {
      if (down) {
        input.pulsePressed = true;
        e.preventDefault();
      }
    }

    if (down && !running && (k === "Enter" || k === " ")) startGame();
  }

  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));
  window.addEventListener("blur", () => {
    input.up = input.down = input.left = input.right = false;
    input.shoot = false;
  });

  canvas.addEventListener("mousemove", (e) => {
    input.usingTouch = false;
    input.mouseX = e.clientX;
    input.mouseY = e.clientY;
  });
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
      input.shoot = true;
      input.mouseX = e.clientX;
      input.mouseY = e.clientY;
    }
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) input.shoot = false;
  });

  let lastTap = 0;
  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      input.usingTouch = true;
      ensureAudio();
      const now = performance.now();
      if (now - lastTap < 280) input.pulsePressed = true;
      lastTap = now;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.clientX < W * 0.5 && pointerIdMove == null) {
          pointerIdMove = t.identifier;
          input.moveX = 0;
          input.moveY = 0;
          input._moveOx = t.clientX;
          input._moveOy = t.clientY;
        } else if (pointerIdAim == null) {
          pointerIdAim = t.identifier;
          input.aimX = t.clientX;
          input.aimY = t.clientY;
          input.shoot = true;
        }
      }
    },
    { passive: false }
  );

  canvas.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === pointerIdMove) {
          const dx = t.clientX - input._moveOx;
          const dy = t.clientY - input._moveOy;
          const n = norm(dx, dy);
          const mag = clamp(len(dx, dy) / 52, 0, 1);
          input.moveX = n.x * mag;
          input.moveY = n.y * mag;
        } else if (t.identifier === pointerIdAim) {
          input.aimX = t.clientX;
          input.aimY = t.clientY;
        }
      }
    },
    { passive: false }
  );

  function endTouch(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === pointerIdMove) {
        pointerIdMove = null;
        input.moveX = 0;
        input.moveY = 0;
      }
      if (t.identifier === pointerIdAim) {
        pointerIdAim = null;
        input.shoot = false;
      }
    }
  }

  canvas.addEventListener("touchend", endTouch, { passive: false });
  canvas.addEventListener("touchcancel", endTouch, { passive: false });

  btnStart.addEventListener("click", (e) => {
    e.preventDefault();
    startGame();
  });
  btnRetry.addEventListener("click", (e) => {
    e.preventDefault();
    startGame();
  });

  window.addEventListener("resize", resize);
  resize();
  player.x = W * 0.5;
  player.y = H * 0.5;
  input.mouseX = player.x;
  input.mouseY = player.y;
  input.aimX = player.x;
  input.aimY = player.y;

  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(frame);
  });
})();
