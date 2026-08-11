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

  const TAU = Math.PI * 2;
  const BEST_KEY = "aether-pulse-best";

  let W = 0;
  let H = 0;
  let dpr = 1;
  let running = false;
  let last = 0;
  let shake = 0;
  let hitstop = 0;
  let flash = 0;
  let timeScale = 1;
  let toastTimer = 0;

  const input = {
    keys: new Set(),
    mouse: { x: 0, y: 0, down: false },
    shoot: false,
    pulse: false,
    touchMove: null,
    touchAim: null,
  };

  const audio = {
    ctx: null,
    master: null,
    ready: false,
  };

  const stars = [];
  const particles = [];
  const bullets = [];
  const enemies = [];
  const pickups = [];
  const rings = [];
  const floaters = [];

  const state = {
    score: 0,
    best: Number(localStorage.getItem(BEST_KEY) || 0),
    wave: 1,
    combo: 1,
    comboTimer: 0,
    maxCombo: 1,
    spawnTimer: 0,
    waveTimer: 0,
    enemiesLeft: 0,
    bossAlive: false,
    kills: 0,
  };

  const player = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
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

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seedStars();
  }

  function seedStars() {
    stars.length = 0;
    const count = Math.floor((W * H) / 9000);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: 0.3 + Math.random() * 1.4,
        a: 0.25 + Math.random() * 0.75,
        tw: Math.random() * TAU,
      });
    }
  }

  function ensureAudio() {
    if (audio.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio.ctx = new AC();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.22;
    audio.master.connect(audio.ctx.destination);
    audio.ready = true;
  }

  function tone(freq, dur, type = "sine", gain = 0.2, slide = 0) {
    if (!audio.ready) return;
    const t0 = audio.ctx.currentTime;
    const o = audio.ctx.createOscillator();
    const g = audio.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(audio.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur = 0.12, gain = 0.15) {
    if (!audio.ready) return;
    const t0 = audio.ctx.currentTime;
    const n = Math.floor(audio.ctx.sampleRate * dur);
    const buf = audio.ctx.createBuffer(1, n, audio.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = audio.ctx.createBufferSource();
    const g = audio.ctx.createGain();
    const f = audio.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 900;
    src.buffer = buf;
    g.gain.value = gain;
    src.connect(f);
    f.connect(g);
    g.connect(audio.master);
    src.start(t0);
  }

  function sfx(name) {
    ensureAudio();
    if (!audio.ready) return;
    if (audio.ctx.state === "suspended") audio.ctx.resume();
    switch (name) {
      case "shoot":
        tone(520, 0.06, "square", 0.07, -220);
        break;
      case "hit":
        tone(180, 0.08, "triangle", 0.1, -80);
        noiseBurst(0.05, 0.08);
        break;
      case "kill":
        tone(320, 0.1, "sawtooth", 0.09, 180);
        tone(640, 0.14, "sine", 0.06, 260);
        break;
      case "hurt":
        tone(110, 0.2, "sawtooth", 0.14, -60);
        noiseBurst(0.15, 0.12);
        break;
      case "pulse":
        tone(90, 0.35, "sine", 0.18, -40);
        tone(220, 0.25, "triangle", 0.1, 120);
        noiseBurst(0.2, 0.1);
        break;
      case "pickup":
        tone(660, 0.08, "sine", 0.1, 200);
        tone(990, 0.12, "triangle", 0.08, 120);
        break;
      case "wave":
        tone(240, 0.18, "sine", 0.1, 320);
        tone(480, 0.22, "triangle", 0.07, 200);
        break;
      case "boss":
        tone(70, 0.4, "sawtooth", 0.16, 30);
        tone(140, 0.5, "triangle", 0.1, 80);
        break;
      case "die":
        tone(200, 0.5, "sawtooth", 0.16, -160);
        noiseBurst(0.4, 0.18);
        break;
      case "start":
        tone(280, 0.15, "triangle", 0.1, 220);
        tone(420, 0.2, "sine", 0.08, 280);
        break;
    }
  }

  function toast(msg, ms = 1400) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    toastTimer = ms;
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function pick(arr) {
    return arr[(Math.random() * arr.length) | 0];
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function len(x, y) {
    return Math.hypot(x, y);
  }

  function norm(x, y) {
    const d = Math.hypot(x, y) || 1;
    return { x: x / d, y: y / d };
  }

  function spawnBurst(x, y, color, n = 16, speed = 220, life = 3) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const s = rand(speed * 0.2, speed);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.3, 0.9),
        max: 0.9,
        size: rand(size * 0.5, size),
        color,
        drag: 0.92,
      });
    }
  }

  function spawnRing(x, y, color, maxR = 80) {
    rings.push({ x, y, r: 4, maxR, life: 1, color });
  }

  function floatText(x, y, text, color = "#ffb347") {
    floaters.push({ x, y, text, color, life: 1, vy: -40 });
  }

  function resetGame() {
    Object.assign(state, {
      score: 0,
      wave: 1,
      combo: 1,
      comboTimer: 0,
      maxCombo: 1,
      spawnTimer: 0.6,
      waveTimer: 0,
      enemiesLeft: 0,
      bossAlive: false,
      kills: 0,
    });
    Object.assign(player, {
      x: W * 0.5,
      y: H * 0.5,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      hp: player.maxHp,
      energy: player.maxEnergy,
      fireCd: 0,
      invuln: 1.2,
      alive: true,
      trail: [],
      shield: 0,
      rapid: 0,
      magnet: 0,
    });
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
    updateHud();
    planWave();
  }

  function planWave() {
    const base = 4 + state.wave * 2;
    state.enemiesLeft = Math.min(28, base);
    state.spawnTimer = 0.35;
    state.waveTimer = 0;
    state.bossAlive = false;
    sfx("wave");
    toast(`WAVE ${state.wave}`);
    spawnRing(player.x, player.y, "rgba(61,232,255,0.7)", 140);
  }

  function edgeSpawn() {
    const side = (Math.random() * 4) | 0;
    const m = 40;
    if (side === 0) return { x: rand(-m, W + m), y: -m };
    if (side === 1) return { x: W + m, y: rand(-m, H + m) };
    if (side === 2) return { x: rand(-m, W + m), y: H + m };
    return { x: -m, y: rand(-m, H + m) };
  }

  function spawnEnemy(kind) {
    const p = edgeSpawn();
    const wave = state.wave;
    let e;
    if (kind === "boss") {
      e = {
        kind: "boss",
        x: p.x, y: p.y,
        vx: 0, vy: 0,
        r: 36,
        hp: 80 + wave * 25,
        maxHp: 80 + wave * 25,
        speed: 70 + wave * 2,
        damage: 22,
        score: 500 + wave * 40,
        color: "#ff4d6d",
        shootCd: 1.2,
        spin: 0,
      };
      state.bossAlive = true;
      sfx("boss");
      toast("CORE BREACH");
    } else if (kind === "dart") {
      e = {
        kind: "dart",
        x: p.x, y: p.y,
        vx: 0, vy: 0,
        r: 10,
        hp: 1,
        maxHp: 1,
        speed: 210 + wave * 8,
        damage: 10,
        score: 40,
        color: "#5dffb1",
        shootCd: 0,
        spin: rand(0, TAU),
      };
    } else if (kind === "tank") {
      e = {
        kind: "tank",
        x: p.x, y: p.y,
        vx: 0, vy: 0,
        r: 22,
        hp: 8 + Math.floor(wave / 2),
        maxHp: 8 + Math.floor(wave / 2),
        speed: 55 + wave,
        damage: 18,
        score: 120,
        color: "#ffb347",
        shootCd: 0,
        spin: 0,
      };
    } else {
      e = {
        kind: "drone",
        x: p.x, y: p.y,
        vx: 0, vy: 0,
        r: 14,
        hp: 3 + Math.floor(wave / 3),
        maxHp: 3 + Math.floor(wave / 3),
        speed: 95 + wave * 4,
        damage: 12,
        score: 70,
        color: "#3de8ff",
        shootCd: 0,
        spin: 0,
      };
    }
    enemies.push(e);
  }

  function maybeSpawnPickup(x, y) {
    if (Math.random() > 0.22) return;
    const type = pick(["heal", "energy", "rapid", "shield", "magnet"]);
    pickups.push({
      x, y,
      type,
      r: 11,
      life: 12,
      bob: rand(0, TAU),
    });
  }

  function addScore(n, x, y) {
    const gained = Math.round(n * state.combo);
    state.score += gained;
    state.combo = Math.min(12, state.combo + 0.25);
    state.comboTimer = 2.4;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    if (x != null) floatText(x, y, `+${gained}`, "#ffb347");
    updateHud();
  }

  function updateHud() {
    scoreEl.textContent = String(state.score);
    waveEl.textContent = String(state.wave);
    bestEl.textContent = String(Math.max(state.best, state.score));
    hpBar.style.transform = `scaleX(${clamp(player.hp / player.maxHp, 0, 1)})`;
    energyBar.style.transform = `scaleX(${clamp(player.energy / player.maxEnergy, 0, 1)})`;
    const c = Math.floor(state.combo);
    comboEl.textContent = `×${c}`;
    comboEl.classList.toggle("on", state.combo >= 2 && player.alive);
  }

  function hurtPlayer(dmg) {
    if (player.invuln > 0 || !player.alive) return;
    if (player.shield > 0) {
      player.shield = 0;
      player.invuln = 0.6;
      spawnRing(player.x, player.y, "rgba(93,255,177,0.8)", 90);
      sfx("pickup");
      toast("SHIELD BREAK");
      return;
    }
    player.hp -= dmg;
    player.invuln = 0.85;
    shake = Math.max(shake, 14);
    flash = 0.35;
    hitstop = 0.08;
    sfx("hurt");
    spawnBurst(player.x, player.y, "#ff4d6d", 20, 280, 3);
    if (player.hp <= 0) {
      player.hp = 0;
      die();
    }
    updateHud();
  }

  function die() {
    player.alive = false;
    running = false;
    sfx("die");
    spawnBurst(player.x, player.y, "#3de8ff", 50, 420, 4);
    spawnBurst(player.x, player.y, "#ff4d6d", 30, 360, 3);
    spawnRing(player.x, player.y, "rgba(255,77,109,0.9)", 220);
    shake = 22;
    flash = 0.6;
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem(BEST_KEY, String(state.best));
    }
    document.getElementById("final-score").textContent = String(state.score);
    document.getElementById("final-wave").textContent = String(state.wave);
    document.getElementById("final-combo").textContent = `×${Math.floor(state.maxCombo)}`;
    setTimeout(() => {
      overlay.classList.remove("playing");
      menu.classList.add("hidden");
      gameoverEl.classList.remove("hidden");
      hud.classList.add("hidden");
    }, 700);
  }

  function fire() {
    if (player.fireCd > 0 || !player.alive) return;
    const rapid = player.rapid > 0;
    player.fireCd = rapid ? 0.07 : 0.14;
    const aim = aimPoint();
    const dir = norm(aim.x - player.x, aim.y - player.y);
    const speed = 620;
    const spread = rapid ? 0.08 : 0.02;
    const count = rapid ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const a = Math.atan2(dir.y, dir.x) + (i === 0 ? -spread : spread) * (count > 1 ? 1 : 0);
      bullets.push({
        x: player.x + Math.cos(a) * 18,
        y: player.y + Math.sin(a) * 18,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 1.1,
        r: 3.5,
        friendly: true,
        damage: rapid ? 1 : 1.35,
      });
    }
    player.vx -= dir.x * 18;
    player.vy -= dir.y * 18;
    sfx("shoot");
  }

  function doPulse() {
    if (!player.alive || player.energy < 35) return;
    player.energy -= 35;
    player.invuln = Math.max(player.invuln, 0.45);
    timeScale = 0.35;
    shake = Math.max(shake, 10);
    spawnRing(player.x, player.y, "rgba(255,179,71,0.85)", 260);
    spawnBurst(player.x, player.y, "#ffb347", 36, 500, 3);
    sfx("pulse");
    for (const e of enemies) {
      const d = len(e.x - player.x, e.y - player.y);
      if (d < 240) {
        const n = norm(e.x - player.x, e.y - player.y);
        e.vx += n.x * 520;
        e.vy += n.y * 520;
        damageEnemy(e, 4, false);
      }
    }
    for (const b of bullets) {
      if (!b.friendly) {
        b.life = 0;
        spawnBurst(b.x, b.y, "#ffb347", 6, 160, 2);
      }
    }
    updateHud();
    toast("PULSE");
  }

  function damageEnemy(e, dmg, fromBullet = true) {
    e.hp -= dmg;
    if (fromBullet) {
      sfx("hit");
      hitstop = Math.max(hitstop, 0.025);
    }
    spawnBurst(e.x, e.y, e.color, 6, 140, 2);
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    e.hp = -999;
    state.kills++;
    addScore(e.score, e.x, e.y - 10);
    sfx("kill");
    spawnBurst(e.x, e.y, e.color, e.kind === "boss" ? 60 : 24, e.kind === "boss" ? 480 : 300, 3.5);
    spawnRing(e.x, e.y, e.color, e.kind === "boss" ? 180 : 70);
    shake = Math.max(shake, e.kind === "boss" ? 18 : 6);
    player.energy = clamp(player.energy + (e.kind === "boss" ? 35 : 6), 0, player.maxEnergy);
    maybeSpawnPickup(e.x, e.y);
    if (e.kind === "boss") {
      state.bossAlive = false;
      addScore(300, e.x, e.y + 16);
      toast("CORE DESTROYED");
    }
  }

  function aimPoint() {
    if (input.touchAim) return { x: input.touchAim.x, y: input.touchAim.y };
    return { x: input.mouse.x, y: input.mouse.y };
  }

  function moveVector() {
    let mx = 0;
    let my = 0;
    if (input.keys.has("w") || input.keys.has("arrowup")) my -= 1;
    if (input.keys.has("s") || input.keys.has("arrowdown")) my += 1;
    if (input.keys.has("a") || input.keys.has("arrowleft")) mx -= 1;
    if (input.keys.has("d") || input.keys.has("arrowright")) mx += 1;
    if (input.touchMove) {
      mx += input.touchMove.x;
      my += input.touchMove.y;
    }
    if (mx || my) {
      const n = norm(mx, my);
      return n;
    }
    return { x: 0, y: 0 };
  }

  function update(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt * 1000;
      if (toastTimer <= 0) toastEl.classList.remove("show");
    }

    if (hitstop > 0) {
      hitstop -= dt;
      return;
    }

    const ts = timeScale;
    if (timeScale < 1) timeScale = Math.min(1, timeScale + dt * 0.55);

    shake = Math.max(0, shake - dt * 28);
    flash = Math.max(0, flash - dt * 1.2);

    // ambient particles
    if (Math.random() < 0.35) {
      particles.push({
        x: rand(0, W),
        y: rand(0, H),
        vx: rand(-8, 8),
        vy: rand(-8, 8),
        life: rand(0.6, 1.4),
        max: 1.4,
        size: rand(0.6, 1.6),
        color: "rgba(61,232,255,0.35)",
        drag: 0.99,
      });
    }

    if (!running || !player.alive) {
      updateFx(dt);
      return;
    }

    const adt = dt * ts;

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
    player.energy = clamp(player.energy + adt * 4.5, 0, player.maxEnergy);

    const mv = moveVector();
    const accel = 980;
    player.vx += mv.x * accel * adt;
    player.vy += mv.y * accel * adt;
    player.vx *= Math.pow(0.86, adt * 60);
    player.vy *= Math.pow(0.86, adt * 60);
    player.x += player.vx * adt;
    player.y += player.vy * adt;
    player.x = clamp(player.x, 20, W - 20);
    player.y = clamp(player.y, 20, H - 20);

    const aim = aimPoint();
    player.angle = Math.atan2(aim.y - player.y, aim.x - player.x);

    player.trail.push({ x: player.x, y: player.y, life: 1 });
    if (player.trail.length > 18) player.trail.shift();
    for (const t of player.trail) t.life -= adt * 2.5;

    if (input.mouse.down || input.shoot || input.keys.has(" ") || input.keys.has("space")) fire();
    if (input.pulse || input.keys.has("shift")) {
      input.pulse = false;
      doPulse();
    }

    // waves / spawns
    state.waveTimer += adt;
    const aliveEnemies = enemies.filter((e) => e.hp > 0).length;

    if (!state.bossAlive && state.enemiesLeft > 0) {
      state.spawnTimer -= adt;
      if (state.spawnTimer <= 0 && aliveEnemies < 14) {
        state.spawnTimer = Math.max(0.28, 1.05 - state.wave * 0.04);
        const roll = Math.random();
        let kind = "drone";
        if (roll < 0.22) kind = "dart";
        else if (roll < 0.38) kind = "tank";
        spawnEnemy(kind);
        state.enemiesLeft--;
        if (state.enemiesLeft === 0 && state.wave % 3 === 0) {
          spawnEnemy("boss");
        }
      }
    }

    updateEnemies(adt);
    updateBullets(adt);
    updatePickups(adt);
    updateFx(adt);
    updateHud();
  }

  let awaitingNextWave = false;

  function checkWaveClear() {
    const alive = enemies.some((e) => e.hp > 0);
    if (state.enemiesLeft <= 0 && !alive && !state.bossAlive && !awaitingNextWave && player.alive) {
      awaitingNextWave = true;
      setTimeout(() => {
        if (!player.alive) return;
        state.wave++;
        awaitingNextWave = false;
        planWave();
        updateHud();
      }, 900);
    }
  }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.hp <= 0) {
        enemies.splice(i, 1);
        continue;
      }

      const to = norm(player.x - e.x, player.y - e.y);
      let speed = e.speed;
      if (e.kind === "dart") {
        e.spin += dt * 8;
        speed *= 1.15 + Math.sin(e.spin) * 0.15;
      }
      if (e.kind === "tank") {
        e.vx += to.x * speed * 0.6 * dt;
        e.vy += to.y * speed * 0.6 * dt;
        e.vx *= 0.98;
        e.vy *= 0.98;
      } else if (e.kind === "boss") {
        e.spin += dt;
        const orbit = Math.sin(e.spin * 1.4) * 0.55;
        e.vx += (to.x * (1 - Math.abs(orbit)) + -to.y * orbit) * speed * dt;
        e.vy += (to.y * (1 - Math.abs(orbit)) + to.x * orbit) * speed * dt;
        e.vx *= 0.96;
        e.vy *= 0.96;
        e.shootCd -= dt;
        if (e.shootCd <= 0) {
          e.shootCd = Math.max(0.55, 1.3 - state.wave * 0.04);
          const shots = 8;
          for (let s = 0; s < shots; s++) {
            const a = (TAU * s) / shots + e.spin;
            bullets.push({
              x: e.x,
              y: e.y,
              vx: Math.cos(a) * 240,
              vy: Math.sin(a) * 240,
              life: 3,
              r: 5,
              friendly: false,
              damage: 12,
            });
          }
          // aimed volley
          const a2 = Math.atan2(player.y - e.y, player.x - e.x);
          for (let k = -1; k <= 1; k++) {
            bullets.push({
              x: e.x,
              y: e.y,
              vx: Math.cos(a2 + k * 0.12) * 320,
              vy: Math.sin(a2 + k * 0.12) * 320,
              life: 2.5,
              r: 4,
              friendly: false,
              damage: 14,
            });
          }
        }
      } else {
        e.vx = to.x * speed;
        e.vy = to.y * speed;
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;

      const d = len(e.x - player.x, e.y - player.y);
      if (d < e.r + player.r) {
        hurtPlayer(e.damage);
        const n = norm(player.x - e.x, player.y - e.y);
        player.vx += n.x * 260;
        player.vy += n.y * 260;
        e.vx -= n.x * 180;
        e.vy -= n.y * 180;
        if (e.kind !== "boss") damageEnemy(e, 1, false);
      }
    }
    checkWaveClear();
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.life <= 0 || b.x < -40 || b.y < -40 || b.x > W + 40 || b.y > H + 40) {
        bullets.splice(i, 1);
        continue;
      }

      if (b.friendly) {
        for (const e of enemies) {
          if (e.hp <= 0) continue;
          if (len(e.x - b.x, e.y - b.y) < e.r + b.r) {
            damageEnemy(e, b.damage, true);
            b.life = 0;
            break;
          }
        }
      } else if (player.alive && player.invuln <= 0) {
        if (len(player.x - b.x, player.y - b.y) < player.r + b.r) {
          hurtPlayer(b.damage);
          b.life = 0;
          spawnBurst(b.x, b.y, "#ff4d6d", 8, 180, 2);
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
        p.x += n.x * 280 * dt;
        p.y += n.y * 280 * dt;
      }
      if (len(p.x - player.x, p.y - player.y) < player.r + p.r + 4) {
        applyPickup(p.type);
        pickups.splice(i, 1);
      }
    }
  }

  function applyPickup(type) {
    sfx("pickup");
    spawnRing(player.x, player.y, "rgba(93,255,177,0.7)", 70);
    switch (type) {
      case "heal":
        player.hp = clamp(player.hp + 28, 0, player.maxHp);
        toast("REPAIR");
        break;
      case "energy":
        player.energy = clamp(player.energy + 40, 0, player.maxEnergy);
        toast("CHARGE");
        break;
      case "rapid":
        player.rapid = 6;
        toast("OVERCLOCK");
        break;
      case "shield":
        player.shield = 8;
        toast("AEGIS");
        break;
      case "magnet":
        player.magnet = 10;
        toast("ATTRACTOR");
        break;
    }
    updateHud();
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
      r.life -= dt * 1.4;
      r.r += (r.maxR - r.r) * Math.min(1, dt * 6);
      if (r.life <= 0) rings.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt * 0.9;
      f.y += f.vy * dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }
  }

  function draw() {
    const sx = shake ? rand(-shake, shake) : 0;
    const sy = shake ? rand(-shake, shake) : 0;
    ctx.save();
    ctx.translate(sx, sy);

    // background
    const g = ctx.createRadialGradient(W * 0.5, H * 0.42, 40, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    g.addColorStop(0, "#101a2e");
    g.addColorStop(0.45, "#080e1a");
    g.addColorStop(1, "#03050a");
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // nebula washes
    ctx.globalAlpha = 0.18;
    const n1 = ctx.createRadialGradient(W * 0.2, H * 0.25, 10, W * 0.2, H * 0.25, W * 0.35);
    n1.addColorStop(0, "#1aa7c0");
    n1.addColorStop(1, "transparent");
    ctx.fillStyle = n1;
    ctx.fillRect(0, 0, W, H);
    const n2 = ctx.createRadialGradient(W * 0.8, H * 0.7, 10, W * 0.8, H * 0.7, W * 0.4);
    n2.addColorStop(0, "#c07a1a");
    n2.addColorStop(1, "transparent");
    ctx.fillStyle = n2;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    const t = performance.now() / 1000;
    for (const s of stars) {
      const a = s.a * (0.55 + 0.45 * Math.sin(t * s.z + s.tw));
      ctx.globalAlpha = a;
      ctx.fillStyle = "#d7ecff";
      ctx.fillRect(s.x, s.y, s.z, s.z);
    }
    ctx.globalAlpha = 1;

    // soft grid
    ctx.strokeStyle = "rgba(61,232,255,0.04)";
    ctx.lineWidth = 1;
    const grid = 64;
    const ox = (player.x * 0.15) % grid;
    const oy = (player.y * 0.15) % grid;
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

    // rings
    for (const r of rings) {
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = Math.max(0, r.life);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // pickups
    for (const p of pickups) {
      const bob = Math.sin(p.bob) * 3;
      const colors = {
        heal: "#5dffb1",
        energy: "#ffb347",
        rapid: "#3de8ff",
        shield: "#9af3ff",
        magnet: "#ffd27a",
      };
      ctx.save();
      ctx.translate(p.x, p.y + bob);
      ctx.rotate(p.bob * 0.5);
      ctx.shadowColor = colors[p.type];
      ctx.shadowBlur = 16;
      ctx.fillStyle = colors[p.type];
      ctx.beginPath();
      ctx.moveTo(0, -p.r);
      ctx.lineTo(p.r, 0);
      ctx.lineTo(0, p.r);
      ctx.lineTo(-p.r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // enemy bullets
    for (const b of bullets) {
      if (b.friendly) continue;
      ctx.beginPath();
      ctx.fillStyle = "#ff4d6d";
      ctx.shadowColor = "#ff4d6d";
      ctx.shadowBlur = 12;
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // enemies
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = e.color;
      ctx.fillStyle = "rgba(5,8,14,0.85)";
      ctx.lineWidth = 2;
      if (e.kind === "boss") {
        ctx.rotate(e.spin * 0.6);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (TAU * i) / 6;
          const r = e.r * (i % 2 ? 0.72 : 1);
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // hp arc
        ctx.rotate(-e.spin * 0.6);
        ctx.beginPath();
        ctx.strokeStyle = "#ff4d6d";
        ctx.lineWidth = 3;
        ctx.arc(0, 0, e.r + 10, -Math.PI / 2, -Math.PI / 2 + TAU * (e.hp / e.maxHp));
        ctx.stroke();
      } else if (e.kind === "tank") {
        ctx.beginPath();
        ctx.rect(-e.r, -e.r, e.r * 2, e.r * 2);
        ctx.fill();
        ctx.stroke();
      } else if (e.kind === "dart") {
        ctx.rotate(Math.atan2(player.y - e.y, player.x - e.x));
        ctx.beginPath();
        ctx.moveTo(e.r * 1.4, 0);
        ctx.lineTo(-e.r, e.r * 0.8);
        ctx.lineTo(-e.r * 0.4, 0);
        ctx.lineTo(-e.r, -e.r * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, e.r, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.arc(0, 0, e.r * 0.45, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    // player trail
    for (let i = 0; i < player.trail.length; i++) {
      const tr = player.trail[i];
      if (tr.life <= 0) continue;
      ctx.globalAlpha = tr.life * 0.35;
      ctx.fillStyle = "#3de8ff";
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, 3 + i * 0.15, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // player
    if (player.alive || flash > 0) {
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(player.angle);
      if (player.invuln > 0 && Math.floor(performance.now() / 60) % 2 === 0) ctx.globalAlpha = 0.45;
      if (player.shield > 0) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(93,255,177,0.7)";
        ctx.lineWidth = 2;
        ctx.shadowColor = "#5dffb1";
        ctx.shadowBlur = 16;
        ctx.arc(0, 0, player.r + 10, 0, TAU);
        ctx.stroke();
      }
      ctx.shadowColor = "#3de8ff";
      ctx.shadowBlur = 20;
      ctx.fillStyle = "#0a1520";
      ctx.strokeStyle = "#3de8ff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(-12, 11);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-12, -11);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // engine
      const thrust = len(player.vx, player.vy);
      ctx.fillStyle = "#ffb347";
      ctx.shadowColor = "#ffb347";
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(-18 - Math.min(16, thrust * 0.04), 4);
      ctx.lineTo(-18 - Math.min(16, thrust * 0.04), -4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // friendly bullets
    for (const b of bullets) {
      if (!b.friendly) continue;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.shadowColor = "#9af3ff";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#e8fbff";
      ctx.fillRect(-6, -1.5, 12, 3);
      ctx.restore();
    }
    ctx.shadowBlur = 0;

    // particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // floaters
    ctx.font = "600 14px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    // vignette
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,77,109,${flash * 0.25})`;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();

    // touch joysticks hint while playing on touch
    if (running && ("ontouchstart" in window)) drawTouchHints();
  }

  function drawTouchHints() {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#3de8ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(90, H - 90, 54, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W - 90, H - 90, 54, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000 || 0.016);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function startGame() {
    ensureAudio();
    if (audio.ready && audio.ctx.state === "suspended") audio.ctx.resume();
    sfx("start");
    resetGame();
    awaitingNextWave = false;
    running = true;
    overlay.classList.add("playing");
    menu.classList.add("hidden");
    gameoverEl.classList.add("hidden");
    hud.classList.remove("hidden");
  }

  // input
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    input.keys.add(k);
    if (k === " " || k === "space") e.preventDefault();
    if (k === "shift") {
      e.preventDefault();
      input.pulse = true;
    }
    if (!running && (k === "enter" || k === " ")) startGame();
  });
  window.addEventListener("keyup", (e) => {
    input.keys.delete(e.key.toLowerCase());
  });

  canvas.addEventListener("mousemove", (e) => {
    input.mouse.x = e.clientX;
    input.mouse.y = e.clientY;
  });
  canvas.addEventListener("mousedown", (e) => {
    input.mouse.down = true;
    input.mouse.x = e.clientX;
    input.mouse.y = e.clientY;
  });
  window.addEventListener("mouseup", () => {
    input.mouse.down = false;
  });

  const touches = new Map();
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    ensureAudio();
    for (const t of e.changedTouches) {
      touches.set(t.identifier, { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY });
      if (t.clientX < W * 0.5) {
        input.touchMove = { x: 0, y: 0, id: t.identifier, ox: t.clientX, oy: t.clientY };
      } else {
        input.touchAim = { x: t.clientX, y: t.clientY, id: t.identifier };
        input.shoot = true;
      }
    }
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const rec = touches.get(t.identifier);
      if (!rec) continue;
      if (input.touchMove && input.touchMove.id === t.identifier) {
        const dx = t.clientX - input.touchMove.ox;
        const dy = t.clientY - input.touchMove.oy;
        const n = norm(dx, dy);
        const mag = clamp(len(dx, dy) / 55, 0, 1);
        input.touchMove.x = n.x * mag;
        input.touchMove.y = n.y * mag;
      }
      if (input.touchAim && input.touchAim.id === t.identifier) {
        input.touchAim.x = t.clientX;
        input.touchAim.y = t.clientY;
      }
    }
  }, { passive: false });

  canvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const rec = touches.get(t.identifier);
      if (rec) {
        const dist = len(t.clientX - rec.sx, t.clientY - rec.sy);
        const durOk = true;
        if (dist < 12 && durOk && t.clientX > W * 0.5) {
          // quick tap on right = pulse chance via double handled separately
        }
        touches.delete(t.identifier);
      }
      if (input.touchMove && input.touchMove.id === t.identifier) input.touchMove = null;
      if (input.touchAim && input.touchAim.id === t.identifier) {
        input.touchAim = null;
        input.shoot = false;
      }
    }
  }, { passive: false });

  let lastTap = 0;
  canvas.addEventListener("touchstart", (e) => {
    const now = performance.now();
    if (now - lastTap < 280) {
      input.pulse = true;
    }
    lastTap = now;
  }, { passive: true });

  btnStart.addEventListener("click", startGame);
  btnRetry.addEventListener("click", startGame);

  window.addEventListener("resize", resize);
  resize();
  player.x = W / 2;
  player.y = H / 2;
  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(frame);
  });
})();
