(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const overlay = document.getElementById("overlay");
  const menu = document.getElementById("menu");
  const results = document.getElementById("results");
  const hud = document.getElementById("hud");
  const hp1El = document.getElementById("hp1");
  const hp2El = document.getElementById("hp2");
  const rounds1El = document.getElementById("rounds1");
  const rounds2El = document.getElementById("rounds2");
  const timerEl = document.getElementById("timer");
  const announceEl = document.getElementById("announce");
  const resultTitle = document.getElementById("result-title");
  const btnStart = document.getElementById("btn-start");
  const btnRetry = document.getElementById("btn-retry");
  const touchUI = document.getElementById("touch");

  let W = 800;
  let H = 600;
  let dpr = 1;
  let last = 0;
  let mode = "menu"; // menu | intro | fight | roundend | matchend
  let round = 1;
  let roundTime = 60;
  let introTimer = 0;
  let endTimer = 0;
  let shake = 0;
  let hitstop = 0;
  let announceTimer = 0;

  const groundY = () => H * 0.78;
  const audio = { ctx: null };

  const input = {
    left: false,
    right: false,
    jump: false,
    jumpPressed: false,
    punch: false,
    punchPressed: false,
    kick: false,
    kickPressed: false,
    special: false,
    specialPressed: false,
    block: false,
  };

  const p1 = makeFighter(true, "#39e7ff", "YOU");
  const p2 = makeFighter(false, "#ff4f8b", "RAGE");
  const fx = [];

  function makeFighter(isPlayer, color, name) {
    return {
      isPlayer,
      name,
      color,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      facing: isPlayer ? 1 : -1,
      w: 46,
      h: 110,
      hp: 100,
      maxHp: 100,
      rounds: 0,
      state: "idle", // idle, walk, jump, punch, kick, special, block, hit, ko
      stateT: 0,
      attackHit: false,
      stun: 0,
      invuln: 0,
      specialCd: 0,
      onGround: true,
      combo: 0,
    };
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function beep(freq, dur, type, vol, slide) {
    try {
      if (!audio.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audio.ctx = new AC();
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
      g.connect(audio.ctx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch (_) {}
  }

  function sfx(name) {
    if (name === "punch") beep(220, 0.06, "square", 0.07, -80);
    else if (name === "kick") beep(160, 0.08, "sawtooth", 0.08, -60);
    else if (name === "special") {
      beep(120, 0.18, "sawtooth", 0.1, 180);
      beep(320, 0.16, "triangle", 0.07, 120);
    } else if (name === "hit") beep(90, 0.1, "sawtooth", 0.1, -40);
    else if (name === "block") beep(400, 0.05, "triangle", 0.06, 0);
    else if (name === "ko") {
      beep(180, 0.25, "sawtooth", 0.12, -100);
      beep(90, 0.35, "triangle", 0.1, -40);
    } else if (name === "start") beep(300, 0.12, "triangle", 0.08, 200);
    else if (name === "round") beep(440, 0.1, "square", 0.07, 120);
  }

  function announce(msg, ms) {
    announceEl.textContent = msg;
    announceTimer = ms || 1200;
  }

  function spawnFx(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 220;
      fx.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.25 + Math.random() * 0.35,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  function resetFighter(f, side) {
    f.x = side < 0 ? W * 0.28 : W * 0.72;
    f.y = groundY();
    f.vx = 0;
    f.vy = 0;
    f.facing = side < 0 ? 1 : -1;
    f.hp = f.maxHp;
    f.state = "idle";
    f.stateT = 0;
    f.attackHit = false;
    f.stun = 0;
    f.invuln = 0.4;
    f.specialCd = 0;
    f.onGround = true;
    f.combo = 0;
  }

  function startMatch() {
    try {
      if (!audio.ctx) beep(200, 0.01, "sine", 0.001, 0);
    } catch (_) {}
    sfx("start");
    p1.rounds = 0;
    p2.rounds = 0;
    round = 1;
    startRound();
    overlay.classList.add("playing");
    menu.classList.add("hidden");
    results.classList.add("hidden");
    hud.classList.remove("hidden");
    if ("ontouchstart" in window) touchUI.classList.remove("hidden");
  }

  function startRound() {
    resetFighter(p1, -1);
    resetFighter(p2, 1);
    roundTime = 60;
    mode = "intro";
    introTimer = 1.6;
    endTimer = 0;
    announce("ROUND " + round, 1400);
    sfx("round");
    updateHud();
  }

  function updateHud() {
    hp1El.style.transform = "scaleX(" + clamp(p1.hp / p1.maxHp, 0, 1) + ")";
    hp2El.style.transform = "scaleX(" + clamp(p2.hp / p2.maxHp, 0, 1) + ")";
    rounds1El.textContent = "●".repeat(p1.rounds) + "○".repeat(Math.max(0, 2 - p1.rounds));
    rounds2El.textContent = "●".repeat(p2.rounds) + "○".repeat(Math.max(0, 2 - p2.rounds));
    timerEl.textContent = String(Math.max(0, Math.ceil(roundTime)));
  }

  function setState(f, state, dur) {
    f.state = state;
    f.stateT = dur;
    f.attackHit = false;
  }

  function canAct(f) {
    return (
      f.stun <= 0 &&
      f.state !== "hit" &&
      f.state !== "ko" &&
      f.state !== "punch" &&
      f.state !== "kick" &&
      f.state !== "special"
    );
  }

  function attackBox(f) {
    if (f.state === "punch") {
      return {
        x: f.x + f.facing * 38,
        y: f.y - 78,
        w: 42,
        h: 28,
        dmg: 8,
        knock: 180,
        kind: "punch",
      };
    }
    if (f.state === "kick") {
      return {
        x: f.x + f.facing * 44,
        y: f.y - 48,
        w: 50,
        h: 26,
        dmg: 12,
        knock: 260,
        kind: "kick",
      };
    }
    if (f.state === "special") {
      return {
        x: f.x + f.facing * 30,
        y: f.y - 90,
        w: 70,
        h: 70,
        dmg: 18,
        knock: 420,
        kind: "special",
      };
    }
    return null;
  }

  function bodyBox(f) {
    return { x: f.x - f.w * 0.35, y: f.y - f.h, w: f.w * 0.7, h: f.h };
  }

  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function hurt(target, atk, attacker) {
    if (target.invuln > 0 || target.state === "ko") return;
    if (target.state === "block" && Math.sign(attacker.x - target.x) === target.facing * -1) {
      // facing attacker
    }
    const blocking =
      target.state === "block" &&
      ((attacker.x >= target.x && target.facing === 1) || (attacker.x < target.x && target.facing === -1));

    if (blocking) {
      target.hp -= atk.dmg * 0.2;
      target.vx -= Math.sign(attacker.x - target.x) * 80;
      sfx("block");
      spawnFx(target.x, target.y - 60, "#f2f7ff", 6);
      hitstop = 0.04;
      return;
    }

    target.hp -= atk.dmg;
    target.vx = Math.sign(target.x - attacker.x) * atk.knock;
    target.vy = atk.kind === "special" ? -320 : -120;
    target.onGround = false;
    setState(target, "hit", 0.35);
    target.stun = 0.35;
    target.invuln = 0.12;
    attacker.combo += 1;
    shake = Math.max(shake, atk.kind === "special" ? 12 : 7);
    hitstop = atk.kind === "special" ? 0.1 : 0.06;
    sfx("hit");
    spawnFx(target.x, target.y - 60, target.color, 14);
    if (target.hp <= 0) {
      target.hp = 0;
      setState(target, "ko", 2);
      sfx("ko");
      endRound(attacker);
    }
    updateHud();
  }

  function endRound(winner) {
    if (mode === "roundend" || mode === "matchend") return;
    mode = "roundend";
    endTimer = 2.2;
    winner.rounds += 1;
    announce((winner.isPlayer ? "YOU" : "RAGE") + " WINS ROUND", 2000);
    updateHud();
    if (winner.rounds >= 2) {
      endTimer = 2.4;
      mode = "matchend";
      announce(winner.isPlayer ? "YOU WIN" : "YOU LOSE", 2200);
    }
  }

  function finishMatch() {
    mode = "menu";
    overlay.classList.remove("playing");
    menu.classList.add("hidden");
    results.classList.remove("hidden");
    hud.classList.add("hidden");
    touchUI.classList.add("hidden");
    resultTitle.textContent = p1.rounds > p2.rounds ? "YOU WIN" : "K.O.";
  }

  function controlPlayer(dt) {
    const f = p1;
    if (f.state === "ko") return;

    // face opponent
    f.facing = p2.x >= f.x ? 1 : -1;

    if (f.specialCd > 0) f.specialCd -= dt;

    if (canAct(f) || f.state === "walk" || f.state === "idle" || f.state === "block" || f.state === "jump") {
      if (input.block && f.onGround) {
        setState(f, "block", 0.05);
        f.vx *= 0.7;
      } else if (input.specialPressed && f.specialCd <= 0 && f.onGround) {
        input.specialPressed = false;
        setState(f, "special", 0.45);
        f.specialCd = 2.4;
        f.vx = f.facing * 120;
        sfx("special");
      } else if (input.punchPressed) {
        input.punchPressed = false;
        if (f.onGround) {
          setState(f, "punch", 0.22);
          sfx("punch");
        }
      } else if (input.kickPressed) {
        input.kickPressed = false;
        if (f.onGround) {
          setState(f, "kick", 0.3);
          sfx("kick");
        }
      } else if (!input.block) {
        let move = 0;
        if (input.left) move -= 1;
        if (input.right) move += 1;
        if (f.onGround) {
          f.vx = move * 220;
          if (move !== 0 && f.state !== "jump") setState(f, "walk", 0.1);
          else if (move === 0 && f.state === "walk") setState(f, "idle", 0.1);
        } else {
          f.vx += move * 520 * dt;
          f.vx = clamp(f.vx, -260, 260);
        }
        if (input.jumpPressed && f.onGround) {
          input.jumpPressed = false;
          f.vy = -520;
          f.onGround = false;
          setState(f, "jump", 0.5);
        }
      }
    }
  }

  function controlAI(dt) {
    const f = p2;
    const enemy = p1;
    if (f.state === "ko") return;
    f.facing = enemy.x >= f.x ? 1 : -1;
    if (f.specialCd > 0) f.specialCd -= dt;

    if (!(canAct(f) || f.state === "walk" || f.state === "idle" || f.state === "block" || f.state === "jump")) return;

    const dist = Math.abs(enemy.x - f.x);
    const wantBlock = enemy.state === "special" || (enemy.state === "kick" && dist < 90);

    if (wantBlock && f.onGround && Math.random() < 0.7) {
      setState(f, "block", 0.1);
      f.vx *= 0.5;
      return;
    }

    if (dist > 130) {
      f.vx = f.facing * 190;
      if (f.onGround) setState(f, "walk", 0.1);
    } else if (dist < 55) {
      f.vx = -f.facing * 140;
      if (f.onGround) setState(f, "walk", 0.1);
    } else {
      f.vx *= 0.85;
    }

    if (f.onGround && Math.random() < dt * 1.6) {
      if (dist < 100 && f.specialCd <= 0 && Math.random() < 0.25) {
        setState(f, "special", 0.45);
        f.specialCd = 2.8;
        f.vx = f.facing * 100;
        sfx("special");
      } else if (dist < 85 && Math.random() < 0.55) {
        setState(f, "kick", 0.3);
        sfx("kick");
      } else if (dist < 75) {
        setState(f, "punch", 0.22);
        sfx("punch");
      } else if (Math.random() < 0.15) {
        f.vy = -500;
        f.onGround = false;
        setState(f, "jump", 0.5);
      }
    }
  }

  function integrate(f, dt) {
    if (f.state === "ko") {
      f.vx *= 0.9;
    }

    if (f.stun > 0) f.stun -= dt;
    if (f.invuln > 0) f.invuln -= dt;

    if (f.stateT > 0) {
      f.stateT -= dt;
      if (f.stateT <= 0) {
        if (f.state === "punch" || f.state === "kick" || f.state === "special" || f.state === "hit") {
          f.state = f.onGround ? "idle" : "jump";
        }
      }
    }

    // gravity
    if (!f.onGround || f.vy < 0) {
      f.vy += 1400 * dt;
    }

    f.x += f.vx * dt;
    f.y += f.vy * dt;

    const gy = groundY();
    if (f.y >= gy) {
      f.y = gy;
      f.vy = 0;
      if (!f.onGround) {
        f.onGround = true;
        if (f.state === "jump") setState(f, "idle", 0.1);
      }
    } else {
      f.onGround = false;
    }

    f.x = clamp(f.x, 40, W - 40);

    // separate bodies lightly
  }

  function resolveCombat() {
    // keep facing
    if (p1.state !== "ko") p1.facing = p2.x >= p1.x ? 1 : -1;
    if (p2.state !== "ko") p2.facing = p1.x >= p2.x ? 1 : -1;

    for (const pair of [
      [p1, p2],
      [p2, p1],
    ]) {
      const atk = pair[0];
      const def = pair[1];
      const box = attackBox(atk);
      if (!box || atk.attackHit) continue;
      // active frames
      const active =
        (atk.state === "punch" && atk.stateT < 0.16 && atk.stateT > 0.05) ||
        (atk.state === "kick" && atk.stateT < 0.22 && atk.stateT > 0.08) ||
        (atk.state === "special" && atk.stateT < 0.35 && atk.stateT > 0.12);
      if (!active) continue;
      if (overlap(box, bodyBox(def))) {
        atk.attackHit = true;
        hurt(def, box, atk);
      }
    }

    // push apart if overlapping
    const a = bodyBox(p1);
    const b = bodyBox(p2);
    if (overlap(a, b)) {
      const mid = (p1.x + p2.x) / 2;
      if (p1.x < p2.x) {
        p1.x = mid - 28;
        p2.x = mid + 28;
      } else {
        p2.x = mid - 28;
        p1.x = mid + 28;
      }
    }
  }

  function update(dt) {
    if (announceTimer > 0) {
      announceTimer -= dt * 1000;
      if (announceTimer <= 0) announceEl.textContent = "";
    }
    shake = Math.max(0, shake - dt * 25);

    if (mode === "menu") return;

    if (hitstop > 0) {
      hitstop -= dt;
      return;
    }

    if (mode === "intro") {
      introTimer -= dt;
      if (introTimer <= 0) {
        mode = "fight";
        announce("FIGHT", 700);
      }
      return;
    }

    if (mode === "roundend" || mode === "matchend") {
      endTimer -= dt;
      integrate(p1, dt);
      integrate(p2, dt);
      if (endTimer <= 0) {
        if (mode === "matchend") finishMatch();
        else {
          round += 1;
          startRound();
        }
      }
      return;
    }

    // fight
    roundTime -= dt;
    if (roundTime <= 0) {
      roundTime = 0;
      const winner = p1.hp >= p2.hp ? p1 : p2;
      if (p1.hp === p2.hp) {
        // draw — slight edge to less damage taken already equal, give to higher hp already handled
      }
      endRound(winner);
      updateHud();
      return;
    }

    controlPlayer(dt);
    controlAI(dt);
    integrate(p1, dt);
    integrate(p2, dt);
    resolveCombat();
    updateHud();

    // clear edge-triggered buffers if not consumed
    input.jumpPressed = false;
    input.punchPressed = false;
    input.kickPressed = false;
    input.specialPressed = false;

    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) fx.splice(i, 1);
    }
  }

  function drawFighter(f) {
    const flash = f.invuln > 0 && ((performance.now() / 50) | 0) % 2 === 0;
    if (flash) return;

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.facing, 1);

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 4, 28, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // legs
    ctx.fillStyle = f.color;
    ctx.fillRect(-14, -42, 12, 42);
    ctx.fillRect(2, -42, 12, 42);

    // torso
    ctx.fillRect(-18, -92, 36, 54);

    // head
    ctx.beginPath();
    ctx.arc(0, -108, 16, 0, Math.PI * 2);
    ctx.fill();

    // arms by state
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    if (f.state === "punch") {
      ctx.beginPath();
      ctx.moveTo(8, -75);
      ctx.lineTo(48, -70);
      ctx.stroke();
    } else if (f.state === "kick") {
      ctx.fillRect(8, -40, 46, 12);
    } else if (f.state === "special") {
      ctx.beginPath();
      ctx.moveTo(-10, -80);
      ctx.lineTo(40, -100);
      ctx.lineTo(55, -60);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,191,60,0.7)";
      ctx.beginPath();
      ctx.arc(50, -80, 18, 0, Math.PI * 2);
      ctx.fill();
    } else if (f.state === "block") {
      ctx.fillRect(10, -88, 10, 40);
      ctx.fillRect(20, -88, 10, 40);
    } else {
      ctx.beginPath();
      ctx.moveTo(10, -80);
      ctx.lineTo(22, -50);
      ctx.moveTo(-8, -80);
      ctx.lineTo(-18, -52);
      ctx.stroke();
    }

    // hit outline
    if (f.state === "hit") {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(-20, -124, 40, 124);
    }

    ctx.restore();

    // attack helper debug off — draw impact spark already in fx
  }

  function draw() {
    const sx = shake > 0.2 ? (Math.random() - 0.5) * shake : 0;
    const sy = shake > 0.2 ? (Math.random() - 0.5) * shake : 0;
    ctx.save();
    ctx.translate(sx, sy);

    // arena background
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2a1020");
    g.addColorStop(0.55, "#1a0c16");
    g.addColorStop(1, "#0e070c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // neon side lights
    ctx.fillStyle = "rgba(57,231,255,0.08)";
    ctx.fillRect(0, 0, 40, H);
    ctx.fillStyle = "rgba(255,79,139,0.08)";
    ctx.fillRect(W - 40, 0, 40, H);

    // crowd silhouette
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    for (let i = 0; i < 24; i++) {
      const x = 50 + i * ((W - 100) / 24);
      ctx.fillRect(x, H * 0.42, 18, H * 0.2);
    }

    // floor
    const gy = groundY();
    ctx.fillStyle = "#241018";
    ctx.fillRect(0, gy, W, H - gy);
    ctx.strokeStyle = "rgba(255,79,139,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(40, gy);
    ctx.lineTo(W - 40, gy);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(W * 0.5, gy);
    ctx.lineTo(W * 0.5, gy + 80);
    ctx.stroke();

    drawFighter(p1);
    drawFighter(p2);

    for (const p of fx) {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function frame(now) {
    try {
      const raw = (now - last) / 1000;
      const dt = raw > 0 && raw < 0.05 ? raw : 0.016;
      last = now;
      update(dt);
      draw();
    } catch (err) {
      console.error("IRON FIST frame error:", err);
    }
    requestAnimationFrame(frame);
  }

  function onKey(e, down) {
    const k = e.key;
    if (k === "a" || k === "A" || k === "ArrowLeft") input.left = down;
    else if (k === "d" || k === "D" || k === "ArrowRight") input.right = down;
    else if (k === "w" || k === "W" || k === "ArrowUp") {
      if (down && !input.jump) input.jumpPressed = true;
      input.jump = down;
      if (down) e.preventDefault();
    } else if (k === "s" || k === "S" || k === "ArrowDown") {
      input.block = down;
      if (down) e.preventDefault();
    } else if (k === "j" || k === "J") {
      if (down && !input.punch) input.punchPressed = true;
      input.punch = down;
    } else if (k === "k" || k === "K") {
      if (down && !input.kick) input.kickPressed = true;
      input.kick = down;
    } else if (k === "l" || k === "L" || k === "u" || k === "U") {
      if (down && !input.special) input.specialPressed = true;
      input.special = down;
    }
    if (down && mode === "menu" && (k === "Enter" || k === " ")) startMatch();
  }

  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));

  touchUI.querySelectorAll("button").forEach((btn) => {
    const act = btn.getAttribute("data-act");
    const set = (down) => {
      if (act === "left") input.left = down;
      if (act === "right") input.right = down;
      if (act === "jump") {
        if (down && !input.jump) input.jumpPressed = true;
        input.jump = down;
      }
      if (act === "block") input.block = down;
      if (act === "punch") {
        if (down && !input.punch) input.punchPressed = true;
        input.punch = down;
      }
      if (act === "kick") {
        if (down && !input.kick) input.kickPressed = true;
        input.kick = down;
      }
      if (act === "special") {
        if (down && !input.special) input.specialPressed = true;
        input.special = down;
      }
    };
    btn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      set(true);
    }, { passive: false });
    btn.addEventListener("touchend", (e) => {
      e.preventDefault();
      set(false);
    }, { passive: false });
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      set(true);
    });
    btn.addEventListener("mouseup", () => set(false));
    btn.addEventListener("mouseleave", () => set(false));
  });

  btnStart.addEventListener("click", (e) => {
    e.preventDefault();
    startMatch();
  });
  btnRetry.addEventListener("click", (e) => {
    e.preventDefault();
    startMatch();
  });
  btnStart.onclick = (e) => {
    e.preventDefault();
    startMatch();
  };
  btnRetry.onclick = (e) => {
    e.preventDefault();
    startMatch();
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
    if (mode === "menu") {
      p1.x = W * 0.35;
      p2.x = W * 0.65;
      p1.y = p2.y = groundY();
    }
  }
  window.addEventListener("resize", resize);
  resize();

  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(frame);
  });
})();
