// Astro Siege - canvas fixed-shooter. The leaderboard talks to the Spring Boot
// backend at the same origin; offline, it falls back to a local high score.

// Logical resolution; rendered at SCALE with smoothing off so pixels stay crisp.
const WIDTH = 224;
const HEIGHT = 256;
const SCALE = 3;

const canvas = document.getElementById("game");
canvas.width = WIDTH * SCALE;
canvas.height = HEIGHT * SCALE;
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

// Sprite bitmaps: '1' is a lit pixel. Each frame is baked to an offscreen canvas.
const SPRITES = {
  // Small orb (top row)
  orbSmall: [
    [
      "00111100",
      "01111110",
      "11111111",
      "11100111",
      "11100111",
      "11111111",
      "01111110",
      "01000010",
    ],
    [
      "00111100",
      "01111110",
      "11111111",
      "11100111",
      "11100111",
      "11111111",
      "11011011",
      "10100101",
    ],
  ],
  // Mid orb (middle rows)
  orbMid: [
    [
      "00011111000",
      "00111111100",
      "01111111110",
      "11111111111",
      "11110001111",
      "11111111111",
      "01111111110",
      "01100000110",
    ],
    [
      "00011111000",
      "00111111100",
      "01111111110",
      "11111111111",
      "11110001111",
      "11111111111",
      "11111111111",
      "10100000101",
    ],
  ],
  // Large orb (bottom rows)
  orbLarge: [
    [
      "000111111000",
      "001111111100",
      "011111111110",
      "111111111111",
      "111100001111",
      "111111111111",
      "011111111110",
      "110000000011",
    ],
    [
      "000111111000",
      "001111111100",
      "011111111110",
      "111111111111",
      "111100001111",
      "111111111111",
      "111111111111",
      "101100001101",
    ],
  ],
  // Player cannon (dome turret).
  player: [
    [
      "0000011100000",
      "0000111110000",
      "0001111111000",
      "0011111111100",
      "0111111111110",
      "1111111111111",
      "1111111111111",
      "0110000000110",
    ],
  ],
  ufo: [
    [
      "0000111111110000",
      "0011111111111100",
      "0111111111111110",
      "0110110110110110",
      "1111111111111111",
      "0011100110011100",
      "0010000000000100",
    ],
  ],
  // Explosion flash.
  boom: [
    [
      "0001000000100",
      "0010100001000",
      "0000010010000",
      "1100000000011",
      "0000010010000",
      "0010100001000",
      "0001000000100",
      "0000000000000",
    ],
  ],
  // Enemy bomb.
  bomb: [
    ["010", "100", "010", "001", "010", "100", "010"],
    ["010", "001", "010", "100", "010", "001", "010"],
  ],
};

const COLORS = {
  orbSmall: "#d96fff",
  orbMid: "#5ad1ff",
  orbLarge: "#4dff5a",
  player: "#4dff5a",
  ufo: "#ff4d4d",
  boom: "#ffffff",
  bomb: "#ffe14d",
};

const spriteCache = {};
function bakeSprite(rows, color) {
  const h = rows.length;
  const w = rows[0].length;
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const c = off.getContext("2d");
  c.fillStyle = color;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y][x] === "1") c.fillRect(x, y, 1, 1);
    }
  }
  return off;
}
for (const name in SPRITES) {
  SPRITES[name].forEach((frame, i) => {
    spriteCache[name + ":" + i] = bakeSprite(frame, COLORS[name]);
  });
}
function spriteW(name) { return SPRITES[name][0][0].length; }
function spriteH(name) { return SPRITES[name][0].length; }
function centerPlayerX() { return WIDTH / 2 - spriteW("player") / 2; }
function drawSprite(name, frame, x, y) {
  ctx.drawImage(spriteCache[name + ":" + (frame || 0)], Math.round(x), Math.round(y));
}

// Tunables
const PLAYER_SPEED = 96;        // px/sec
const PLAYER_BULLET_SPEED = 300; // px/sec, upward
const BOMB_SPEED = 110;          // px/sec, downward
const PLAYER_Y = HEIGHT - 20;    // top of the cannon
const GROUND_Y = HEIGHT - 10;    // green floor line
const UFO_Y = 16;                // row the saucer flies along
const FLEET_COLS = 11;
const FLEET_ROWS = 5;
const COL_SPACING = 16;
const ROW_SPACING = 14;
const STEP_DX = 2;               // horizontal hop per fleet step
const DROP_DY = 8;               // drop when the fleet reverses
const FLEET_MARGIN = 10;         // how close to the wall the fleet may get
const MAX_BOMBS = 3;
const START_LIVES = 3;

function rowType(row) {
  if (row === 0) return "orbSmall";
  if (row === 1 || row === 2) return "orbMid";
  return "orbLarge";
}
function typePoints(type) {
  return type === "orbSmall" ? 30 : type === "orbMid" ? 20 : 10;
}

// State
const state = {
  mode: "menu",        // menu | playing | dying | gameover
  score: 0,
  hiScore: 0,
  wave: 1,
  lives: START_LIVES,
  startedAt: 0,
  player: { x: centerPlayerX() },
  bullet: null,        // { x, y } single shot
  bombs: [],           // [{ x, y, frame, anim }]
  enemies: [],        // [{ col, row, type, alive }]
  fleetX: 0,           // top-left origin of the formation grid
  fleetY: 0,
  fleetDir: 1,         // 1 right, -1 left
  fleetFrame: 0,
  stepAccum: 0,
  pendingDrop: false,
  bombAccum: 0,
  bombInterval: 1.1,   // seconds between enemy bombs (recomputed per wave)
  ufo: null,           // { x, dir, points }
  ufoAccum: 0,
  ufoInterval: 22,     // seconds between saucers
  booms: [],           // [{ x, y, t }] transient explosion flashes
  floatTexts: [],      // [{ x, y, text, t }] saucer bonus popups
  dieTimer: 0,
  invul: 0,
};

try { state.hiScore = parseInt(localStorage.getItem("astro-siege.hiScore") || "0", 10) || 0; } catch (_) {}

// Bunkers: each is its own pixel canvas so it can be carved away on hits.
let bunkers = [];
function buildBunkers() {
  bunkers = [];
  const count = 4;
  const bw = 24;
  const bh = 16;
  const y = PLAYER_Y - 24;
  const gap = (WIDTH - count * bw) / (count + 1);
  for (let i = 0; i < count; i++) {
    const x = Math.round(gap + i * (bw + gap));
    bunkers.push(makeBunker(x, y, bw, bh));
  }
}
function makeBunker(x, y, w, h) {
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const c = off.getContext("2d");
  c.fillStyle = COLORS.player;
  c.fillRect(0, 0, w, h);
  // Battlement: cut embrasures along the top and a doorway in the base.
  c.clearRect(4, 0, 6, 3);
  c.clearRect(w - 10, 0, 6, 3);
  c.clearRect(w / 2 - 3, h - 5, 7, 5);
  return { x, y, w, h, canvas: off, ctx: c };
}
// Carve a small hole; returns true if any lit pixel was actually there.
function damageBunker(b, px, py, r) {
  const lx = Math.floor(px - b.x);
  const ly = Math.floor(py - b.y);
  if (lx < -r || ly < -r || lx > b.w + r || ly > b.h + r) return false;
  if (!bunkerHit(b, px, py)) return false;
  b.ctx.save();
  b.ctx.globalCompositeOperation = "destination-out";
  b.ctx.beginPath();
  b.ctx.arc(lx, ly, r, 0, Math.PI * 2);
  b.ctx.fill();
  b.ctx.restore();
  return true;
}
// Is there a lit bunker pixel at world (px,py)?
function bunkerHit(b, px, py) {
  const lx = Math.floor(px - b.x);
  const ly = Math.floor(py - b.y);
  if (lx < 0 || ly < 0 || lx >= b.w || ly >= b.h) return false;
  const a = b.ctx.getImageData(lx, ly, 1, 1).data[3];
  return a > 16;
}

// Fleet
function buildFleet() {
  state.enemies = [];
  for (let row = 0; row < FLEET_ROWS; row++) {
    for (let col = 0; col < FLEET_COLS; col++) {
      state.enemies.push({ col, row, type: rowType(row), alive: true });
    }
  }
  state.fleetDir = 1;
  state.fleetFrame = 0;
  state.stepAccum = 0;
  state.pendingDrop = false;
  state.fleetX = 24;
  // Each wave starts a little lower, capped so it stays playable.
  state.fleetY = 32 + Math.min(state.wave - 1, 6) * 8;
  // Bombs fall a touch more often each wave.
  state.bombInterval = Math.max(0.45, 1.1 - (state.wave - 1) * 0.08);
}

function enemyBox(enemy) {
  const w = spriteW(enemy.type);
  const cellX = state.fleetX + enemy.col * COL_SPACING;
  const x = cellX + (COL_SPACING - w) / 2;
  const y = state.fleetY + enemy.row * ROW_SPACING;
  return { x, y, w, h: spriteH(enemy.type) };
}

function aliveEnemies() {
  return state.enemies.filter((i) => i.alive);
}

// Horizontal extent of the living fleet, for wall detection.
function fleetExtent() {
  let min = Infinity;
  let max = -Infinity;
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const b = enemyBox(enemy);
    if (b.x < min) min = b.x;
    if (b.x + b.w > max) max = b.x + b.w;
  }
  return { min, max };
}

// Step interval shrinks as the fleet thins and waves climb, so it speeds up.
function stepInterval() {
  const alive = aliveEnemies().length;
  const total = FLEET_COLS * FLEET_ROWS;
  const MAX = 0.7;
  const MIN = 0.06;
  const base = MIN + (MAX - MIN) * ((alive - 1) / (total - 1));
  const waveFactor = Math.max(0.5, 1 - (state.wave - 1) * 0.06);
  return base * waveFactor;
}

// Input
const keys = new Set();
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (["arrowleft", "arrowright", "arrowup", " ", "spacebar"].includes(k)) {
    e.preventDefault();
  }
  keys.add(k);
  if (k === " " || k === "spacebar") keys.add("space");
  if ((k === " " || k === "enter") && (state.mode === "menu" || state.mode === "gameover")) {
    startGame();
  }
  // ESC toggles pause; ignore key-repeat so a held key can't flicker.
  if (k === "escape" && !e.repeat) {
    if (state.mode === "playing") pauseGame();
    else if (state.mode === "paused") resumeGame();
  }
});
window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (k === " " || k === "spacebar") keys.delete("space");
});

function leftHeld() { return keys.has("arrowleft") || keys.has("a"); }
function rightHeld() { return keys.has("arrowright") || keys.has("d"); }
function fireHeld() { return keys.has("space") || keys.has("arrowup"); }

// Game flow
function pauseGame() {
  state.mode = "paused";
  stopUfoSound(); // silence the saucer drone while paused
}
function resumeGame() {
  state.mode = "playing";
  lastT = performance.now(); // don't let the paused span become one huge dt step
  if (state.ufo) startUfoSound();
  canvas.focus();
}

function startGame() {
  state.mode = "playing";
  state.score = 0;
  state.wave = 1;
  state.lives = START_LIVES;
  state.bullet = null;
  state.bombs = [];
  state.booms = [];
  state.floatTexts = [];
  state.ufo = null;
  state.ufoAccum = 0;
  stopUfoSound();
  beatIndex = 0;
  state.bombAccum = 0;
  state.player.x = centerPlayerX();
  state.invul = 0;
  state.startedAt = performance.now();
  scoreAlreadySubmitted = false;
  buildFleet();
  buildBunkers();
  hideOverlay();
  pauseMusic();
  updateHud();
  canvas.focus();
}

function nextWave() {
  state.wave++;
  state.bullet = null;
  state.bombs = [];
  state.ufo = null;
  buildFleet();
  buildBunkers();
  updateHud();
}

function loseLife() {
  state.lives--;
  stopUfoSound();
  updateHud();
  if (state.lives <= 0) {
    gameOver();
  } else {
    state.mode = "dying";
    state.dieTimer = 1.0;
    state.bombs = [];
    state.bullet = null;
  }
}

function gameOver() {
  state.mode = "gameover";
  stopUfoSound();
  if (state.score > state.hiScore) {
    state.hiScore = state.score;
    try { localStorage.setItem("astro-siege.hiScore", String(state.hiScore)); } catch (_) {}
  }
  lastRunDurationSeconds = Math.max(0, Math.round((performance.now() - state.startedAt) / 1000));
  showGameOverOverlay();
  playMenuMusic();
  updateHud();
}

function addScore(n) {
  state.score += n;
  if (state.score > state.hiScore) state.hiScore = state.score;
  updateHud();
}

// Update
function update(dt) {
  if (state.mode === "dying") {
    state.dieTimer -= dt;
    state.booms.forEach((b) => (b.t -= dt));
    state.booms = state.booms.filter((b) => b.t > 0);
    if (state.dieTimer <= 0) {
      state.mode = "playing";
      state.invul = 1.5;
      state.player.x = centerPlayerX();
    }
    return;
  }
  if (state.mode !== "playing") return;

  if (state.invul > 0) state.invul -= dt;

  // Player movement
  const pw = spriteW("player");
  if (leftHeld()) state.player.x -= PLAYER_SPEED * dt;
  if (rightHeld()) state.player.x += PLAYER_SPEED * dt;
  state.player.x = Math.max(2, Math.min(WIDTH - pw - 2, state.player.x));

  // Fire (one shot at a time)
  if (fireHeld() && !state.bullet) {
    state.bullet = { x: state.player.x + pw / 2, y: PLAYER_Y - 4 };
    playSfx("shoot");
  }

  // Player bullet
  if (state.bullet) {
    const prevY = state.bullet.y;
    state.bullet.y -= PLAYER_BULLET_SPEED * dt;
    // Sweep the whole path, not just the endpoint, so a fast bullet can't tunnel.
    resolveBullet(prevY);
    if (state.bullet && state.bullet.y < 8) state.bullet = null;
  }

  // Fleet stepping
  state.stepAccum += dt;
  const interval = stepInterval();
  while (state.stepAccum >= interval) {
    state.stepAccum -= interval;
    stepFleet();
  }

  // Enemy bombs
  state.bombAccum += dt;
  if (state.bombAccum >= state.bombInterval && state.bombs.length < MAX_BOMBS) {
    state.bombAccum = 0;
    dropBomb();
  }
  updateBombs(dt);

  // Saucer
  updateUfo(dt);

  // Transient effects
  state.booms.forEach((b) => (b.t -= dt));
  state.booms = state.booms.filter((b) => b.t > 0);
  state.floatTexts.forEach((f) => { f.t -= dt; f.y -= 8 * dt; });
  state.floatTexts = state.floatTexts.filter((f) => f.t > 0);

  // Wave cleared
  if (aliveEnemies().length === 0) {
    nextWave();
  }
}

function stepFleet() {
  // Flip the 2-frame animation each hop.
  state.fleetFrame ^= 1;
  playBeat();

  if (state.pendingDrop) {
    state.fleetY += DROP_DY;
    state.fleetDir *= -1;
    state.pendingDrop = false;
    // Reaching the bunker/player line ends the game immediately.
    if (fleetBottom() >= PLAYER_Y - 2) {
      gameOver();
    }
    return;
  }

  state.fleetX += STEP_DX * state.fleetDir;
  const ext = fleetExtent();
  if (state.fleetDir > 0 && ext.max >= WIDTH - FLEET_MARGIN) {
    state.pendingDrop = true;
  } else if (state.fleetDir < 0 && ext.min <= FLEET_MARGIN) {
    state.pendingDrop = true;
  }
}

function fleetBottom() {
  let max = -Infinity;
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const b = enemyBox(enemy);
    if (b.y + b.h > max) max = b.y + b.h;
  }
  return max;
}

function dropBomb() {
  // Pick a random column that still has enemies; bomb comes from its lowest one.
  const colsAlive = [];
  for (let c = 0; c < FLEET_COLS; c++) {
    let lowest = null;
    for (const enemy of state.enemies) {
      if (enemy.alive && enemy.col === c) {
        if (!lowest || enemy.row > lowest.row) lowest = enemy;
      }
    }
    if (lowest) colsAlive.push(lowest);
  }
  if (!colsAlive.length) return;
  const enemy = colsAlive[Math.floor(Math.random() * colsAlive.length)];
  const b = enemyBox(enemy);
  state.bombs.push({ x: b.x + b.w / 2, y: b.y + b.h, frame: 0, anim: 0 });
}

function updateBombs(dt) {
  const pw = spriteW("player");
  const ph = spriteH("player");
  for (const bomb of state.bombs) {
    bomb.y += BOMB_SPEED * dt;
    bomb.anim += dt;
    if (bomb.anim > 0.1) { bomb.anim = 0; bomb.frame ^= 1; }

    let absorbed = false;
    for (const bk of bunkers) {
      if (damageBunker(bk, bomb.x, bomb.y + 3, 3)) { absorbed = true; break; }
    }
    if (absorbed) { bomb.dead = true; continue; }

    if (state.invul <= 0 &&
        bomb.x >= state.player.x && bomb.x <= state.player.x + pw &&
        bomb.y + 6 >= PLAYER_Y && bomb.y <= PLAYER_Y + ph) {
      bomb.dead = true;
      addBoom(state.player.x + pw / 2 - 6, PLAYER_Y - 2);
      playSfx("explosion");
      loseLife();
      return;
    }
    if (bomb.y > GROUND_Y) bomb.dead = true;
  }
  state.bombs = state.bombs.filter((b) => !b.dead);
}

// The bullet sweeps the segment [yTop, yBot] at x=bx (it only travels up).
function resolveBullet(prevY) {
  const bx = state.bullet.x;
  const yTop = state.bullet.y;                                  // higher edge
  const yBot = prevY === undefined ? state.bullet.y : prevY;    // lower edge

  if (state.ufo) {
    const uw = spriteW("ufo");
    const uh = spriteH("ufo");
    if (bx >= state.ufo.x && bx <= state.ufo.x + uw &&
        yTop <= UFO_Y + uh && yBot >= UFO_Y) {
      addScore(state.ufo.points);
      addBoom(state.ufo.x + uw / 2 - 6, UFO_Y);
      state.floatTexts.push({ x: state.ufo.x, y: UFO_Y, text: String(state.ufo.points), t: 1.2 });
      playSfx("ufoKilled");
      stopUfoSound();
      state.ufo = null;
      state.bullet = null;
      return;
    }
  }

  // Enemies: the bullet moves up, so hit the lowest one its path crosses.
  let target = null;
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const b = enemyBox(enemy);
    if (bx >= b.x && bx <= b.x + b.w && yTop <= b.y + b.h && yBot >= b.y) {
      if (!target || b.y > target.box.y) target = { enemy, box: b };
    }
  }
  if (target) {
    target.enemy.alive = false;
    addScore(typePoints(target.enemy.type));
    addBoom(target.box.x + target.box.w / 2 - 6, target.box.y);
    playSfx("enemyKilled");
    state.bullet = null;
    return;
  }

  // Bunkers: sample along the swept path (lowest point first) so a fast bullet
  // can't tunnel through the shield either.
  for (let y = yBot; y >= yTop; y -= 2) {
    for (const bk of bunkers) {
      if (damageBunker(bk, bx, y, 3)) {
        state.bullet = null;
        return;
      }
    }
  }
}

function updateUfo(dt) {
  if (state.ufo) {
    state.ufo.x += state.ufo.dir * 40 * dt;
    const uw = spriteW("ufo");
    if (state.ufo.x > WIDTH + 2 || state.ufo.x + uw < -2) { state.ufo = null; stopUfoSound(); }
    return;
  }
  // Don't bother launching a saucer once the fleet is nearly gone.
  state.ufoAccum += dt;
  if (state.ufoAccum >= state.ufoInterval && aliveEnemies().length > 6) {
    state.ufoAccum = 0;
    const fromLeft = Math.random() < 0.5;
    const choices = [50, 100, 150, 300];
    const points = choices[Math.floor(Math.random() * choices.length)];
    state.ufo = {
      x: fromLeft ? -spriteW("ufo") : WIDTH,
      dir: fromLeft ? 1 : -1,
      points,
    };
    startUfoSound();
  }
}

function addBoom(x, y) {
  state.booms.push({ x, y, t: 0.3 });
}

// Render
function render() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = COLORS.player;
  ctx.fillRect(0, GROUND_Y, WIDTH, 1);

  for (const bk of bunkers) ctx.drawImage(bk.canvas, bk.x, bk.y);

  if (state.ufo) drawSprite("ufo", 0, state.ufo.x, UFO_Y);

  if (state.mode !== "menu") {
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      const b = enemyBox(enemy);
      drawSprite(enemy.type, state.fleetFrame, b.x, b.y);
    }
  }

  // Player (blinks briefly after a hit).
  if (state.mode === "playing" || state.mode === "gameover") {
    const blink = state.invul > 0 && Math.floor(state.invul * 10) % 2 === 0;
    if (!blink) drawSprite("player", 0, state.player.x, PLAYER_Y);
  }

  if (state.bullet) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(Math.round(state.bullet.x), Math.round(state.bullet.y), 1, 4);
  }

  for (const bomb of state.bombs) {
    drawSprite("bomb", bomb.frame, bomb.x - 1, bomb.y);
  }

  for (const bm of state.booms) drawSprite("boom", 0, bm.x, bm.y);

  ctx.fillStyle = COLORS.ufo;
  ctx.font = "8px monospace";
  for (const f of state.floatTexts) {
    ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
  }

  if (state.mode === "paused") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.player;
    ctx.font = "16px monospace";
    ctx.fillText("PAUSED", WIDTH / 2, HEIGHT / 2 - 4);
    ctx.fillStyle = "#e6e6e6";
    ctx.font = "8px monospace";
    ctx.fillText("Press ESC to resume", WIDTH / 2, HEIGHT / 2 + 12);
    ctx.textAlign = "left";
  }
}

// Main loop
let lastT = performance.now();
function frame(now) {
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > 0.05) dt = 0.05; // clamp after tab switches
  update(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// HUD
const scoreValue = document.getElementById("score-value");
const hiScoreValue = document.getElementById("hiscore-value");
const waveValue = document.getElementById("wave-value");
const livesEl = document.getElementById("lives");

// Cannon icon for the lives row, baked once to a data URL.
const lifeIconUrl = (() => {
  const off = bakeSprite(SPRITES.player[0], COLORS.player);
  const big = document.createElement("canvas");
  big.width = off.width * 2;
  big.height = off.height * 2;
  const c = big.getContext("2d");
  c.imageSmoothingEnabled = false;
  c.drawImage(off, 0, 0, big.width, big.height);
  return big.toDataURL();
})();

function updateHud() {
  scoreValue.textContent = state.score;
  hiScoreValue.textContent = state.hiScore;
  waveValue.textContent = state.wave;
  let html = "";
  for (let i = 0; i < state.lives; i++) {
    html += `<img class="life-icon" src="${lifeIconUrl}" alt="life">`;
  }
  livesEl.innerHTML = html;
}
updateHud();

// Overlay + leaderboard
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const overlayButton = document.getElementById("overlay-button");
const scoreForm = document.getElementById("score-form");
const playerNameInput = document.getElementById("player-name");
const submitScoreButton = document.getElementById("submit-score-button");
const leaderboardList = document.getElementById("leaderboard-list");
const remixButton = document.getElementById("remix-button");
const mainMenuButton = document.getElementById("main-menu-button");
const instructionsCol = document.getElementById("instructions-col");
const remixLeaderboardList = document.getElementById("remix-leaderboard-list");

let lastRunDurationSeconds = 0;
let scoreAlreadySubmitted = false;
// Set from POST /api/game/start so the server can time the run. Sent with the score.
let gameSessionId = null;

overlayButton.addEventListener("click", startGame);
submitScoreButton.addEventListener("click", submitScore);
if (mainMenuButton) mainMenuButton.addEventListener("click", showMainMenu);

function hideOverlay() {
  overlay.classList.add("hidden");
}
function showGameOverOverlay() {
  overlayTitle.textContent = "GAME OVER";
  if (instructionsCol) instructionsCol.classList.add("hidden");
  overlay.classList.add("gameover");
  if (remixButton) remixButton.classList.add("hidden");
  if (mainMenuButton) mainMenuButton.classList.remove("hidden");
  overlayText.innerHTML = `You scored <b>${state.score}</b> and reached <b>wave ${state.wave}</b>.`;
  overlayButton.textContent = "Play again";
  scoreForm.classList.remove("hidden");
  submitScoreButton.disabled = false;
  submitScoreButton.textContent = "Submit score";
  try {
    const saved = localStorage.getItem("astro-siege.playerName");
    if (saved) playerNameInput.value = saved;
  } catch (_) {}
  overlay.classList.remove("hidden");
  refreshLeaderboard();
}

// Return to the menu in-app (no reload) so the menu music keeps playing.
function showMainMenu() {
  state.mode = "menu";
  state.enemies = [];
  bunkers = [];
  state.bullet = null;
  state.bombs = [];
  state.ufo = null;
  state.booms = [];
  state.floatTexts = [];
  stopUfoSound();

  overlay.classList.remove("gameover");
  overlayTitle.textContent = "ASTRO SIEGE";
  overlayText.innerHTML = "";
  scoreForm.classList.add("hidden");
  overlayButton.textContent = "Classic";
  if (instructionsCol) instructionsCol.classList.remove("hidden");
  if (remixButton) remixButton.classList.remove("hidden");
  if (mainMenuButton) mainMenuButton.classList.add("hidden");
  overlay.classList.remove("hidden");

  scoreAlreadySubmitted = false;
  if (music && music.paused) playMenuMusic();
  refreshLeaderboard();
}

async function refreshLeaderboard() {
  try {
    const res = await fetch("api/scores/top?limit=10");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const scores = await res.json();
    renderBoard(leaderboardList, scores, null);
  } catch (err) {
    console.warn("Leaderboard fetch failed:", err);
    renderBoard(leaderboardList, [], "Leaderboard offline - run the backend to submit scores.");
  }
}

function renderBoard(listEl, scores, note) {
  if (!listEl) return;
  const list = scores || [];
  let html = "";
  for (let i = 0; i < 10; i++) {
    const s = list[i];
    html +=
      `<li>` +
      `<span class="rank">${i + 1}.</span>` +
      `<span class="name">${s ? escapeHtml(s.name || "Anonymous") : ""}</span>` +
      `<span class="points">${s ? s.points : ""}</span>` +
      `<span class="wave">${s ? "W" + s.wave : ""}</span>` +
      `</li>`;
  }
  if (note) html += `<div class="leaderboard-offline">${note}</div>`;
  listEl.innerHTML = html;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function submitScore() {
  if (scoreAlreadySubmitted) return;
  const name = (playerNameInput.value || "").trim();
  if (!name) return;
  try { localStorage.setItem("astro-siege.playerName", name); } catch (_) {}
  submitScoreButton.disabled = true;
  submitScoreButton.textContent = "Submitting...";
  try {
    const res = await fetch("api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        points: state.score,
        wave: state.wave,
        durationSeconds: lastRunDurationSeconds,
        sessionId: gameSessionId,
      }),
    });
    if (res.status === 400) {
      let msg = "Name not allowed.";
      try { const body = await res.json(); if (body && body.message) msg = body.message; } catch (_) {}
      submitScoreButton.disabled = false;
      submitScoreButton.textContent = msg;
      return;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    scoreAlreadySubmitted = true;
    submitScoreButton.textContent = "Submitted";
    await refreshLeaderboard();
  } catch (err) {
    console.warn("Score submit failed:", err);
    submitScoreButton.disabled = false;
    submitScoreButton.textContent = "Submit score";
  }
}

// Open a server-timed session at load (best-effort; the game plays regardless).
fetch("api/game/start", { method: "POST" })
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => { if (d) gameSessionId = d.sessionId; })
  .catch(() => {});

// Paint both boards' blank rows synchronously first so the Classic board fills in
// place when the fetch resolves, instead of popping in from an empty (zero-height) state.
renderBoard(leaderboardList, [], null);
renderBoard(remixLeaderboardList, [], null);
refreshLeaderboard();

// Audio: SFX synthesised via Web Audio, the accelerating march beat, the saucer
// drone, looping menu music, and HUD mute/volume controls for music and SFX.
const musicMuteBtn = document.getElementById("music-mute-btn");
const musicSlider = document.getElementById("music-slider");
const sfxMuteBtn = document.getElementById("sfx-mute-btn");
const sfxSlider = document.getElementById("sfx-slider");

let musicVolume = 0.1, musicMuted = false, sfxVolume = 0.1, sfxMuted = false;
try {
  const p = JSON.parse(localStorage.getItem("astro-siege.audio") || "{}");
  if (typeof p.musicVolume === "number") musicVolume = p.musicVolume;
  if (typeof p.sfxVolume === "number") sfxVolume = p.sfxVolume;
  if (typeof p.musicMuted === "boolean") musicMuted = p.musicMuted;
  if (typeof p.sfxMuted === "boolean") sfxMuted = p.sfxMuted;
} catch (_) {}
if (musicSlider) musicSlider.value = Math.round(musicVolume * 100);
if (sfxSlider) sfxSlider.value = Math.round(sfxVolume * 100);

// Menu music: plays while the overlay is up, pauses during gameplay.
const MUSIC_SRC = "audio/menu-theme.mp3";
const MUSIC_GAIN = 0.3;
let music = null;
if (MUSIC_SRC && typeof Audio !== "undefined") { music = new Audio(MUSIC_SRC); music.loop = true; }

function effMusic() { return musicMuted ? 0 : musicVolume * MUSIC_GAIN; }
function applyMusicVol() { if (music) music.volume = effMusic(); }
function playMenuMusic() { if (music) { music.volume = effMusic(); music.play().catch(() => {}); } }
function pauseMusic() { if (music) music.pause(); }
function effSfx() { return sfxMuted ? 0 : sfxVolume; }

function saveAudioPrefs() {
  try {
    localStorage.setItem("astro-siege.audio",
      JSON.stringify({ musicVolume, sfxVolume, musicMuted, sfxMuted }));
  } catch (_) {}
}
function updateMuteIcons() {
  if (musicMuteBtn) musicMuteBtn.textContent = (musicMuted || musicVolume === 0) ? "\u{1F507}" : "\u{1F50A}";
  if (sfxMuteBtn) sfxMuteBtn.textContent = (sfxMuted || sfxVolume === 0) ? "\u{1F507}" : "\u{1F50A}";
}
if (musicSlider) musicSlider.addEventListener("input", () => {
  musicVolume = Number(musicSlider.value) / 100;
  if (musicVolume > 0) musicMuted = false;
  applyMusicVol(); updateMuteIcons(); saveAudioPrefs();
});
if (musicMuteBtn) musicMuteBtn.addEventListener("click", () => {
  musicMuted = !musicMuted; applyMusicVol(); updateMuteIcons(); saveAudioPrefs();
});
if (sfxSlider) sfxSlider.addEventListener("input", () => {
  sfxVolume = Number(sfxSlider.value) / 100;
  if (sfxVolume > 0) sfxMuted = false;
  updateMuteIcons(); saveAudioPrefs();
});
if (sfxMuteBtn) sfxMuteBtn.addEventListener("click", () => {
  sfxMuted = !sfxMuted; updateMuteIcons(); saveAudioPrefs();
});
updateMuteIcons();

const SFX_GAIN = 0.7;
let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctor({ latencyHint: "interactive" });
    } catch (_) { audioCtx = null; }
  }
  return audioCtx;
}

// SFX are synthesised at runtime: oscillators and filtered noise shaped by gain
// envelopes, no audio files.
function sfxLevel() { return Math.max(0, effSfx()) * SFX_GAIN; }

// Pitched blip: an oscillator with an optional sweep and a quick decay.
function blip(o) {
  const ctx = audioCtx;
  if (!ctx) return;
  const lvl = sfxLevel();
  if (lvl <= 0) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = o.type || "square";
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
  const g = ctx.createGain();
  const peak = (o.gain || 0.4) * lvl;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.008, o.dur * 0.25));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

// A filtered noise burst that darkens as it fades (hits and explosions).
function noiseBurst(o) {
  const ctx = audioCtx;
  if (!ctx) return;
  const lvl = sfxLevel();
  if (lvl <= 0) return;
  const t = ctx.currentTime;
  const n = Math.max(1, Math.floor(ctx.sampleRate * o.dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  const cut = o.cutoff || 2000;
  filt.frequency.setValueAtTime(cut, t);
  filt.frequency.exponentialRampToValueAtTime(Math.max(120, cut * 0.25), t + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime((o.gain || 0.5) * lvl, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(filt).connect(g).connect(ctx.destination);
  src.start(t);
  src.stop(t + o.dur + 0.02);
}

// Low-frequency body for hits: a fast downward pitch sweep with a punchy attack.
function thump(o) {
  const ctx = audioCtx;
  if (!ctx) return;
  const lvl = sfxLevel();
  if (lvl <= 0) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = o.type || "triangle";
  osc.frequency.setValueAtTime(o.f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime((o.gain || 0.6) * lvl, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

// Four descending steps of the marching beat.
const BEAT_FREQS = [233, 207, 185, 165];

function playSfx(name) {
  if (!audioCtx) return;
  switch (name) {
    case "shoot":
      blip({ type: "square", f0: 900, f1: 170, dur: 0.16, gain: 0.3 });
      break;
    case "enemyKilled":
      noiseBurst({ dur: 0.16, cutoff: 2600, gain: 0.42 });
      thump({ type: "square", f0: 210, f1: 70, dur: 0.13, gain: 0.4 });
      break;
    case "explosion":
      noiseBurst({ dur: 0.55, cutoff: 1100, gain: 0.6 });
      thump({ type: "triangle", f0: 140, f1: 28, dur: 0.5, gain: 0.75 });
      blip({ type: "sawtooth", f0: 200, f1: 45, dur: 0.4, gain: 0.16 });
      break;
    case "ufoKilled":
      blip({ type: "sawtooth", f0: 760, f1: 80, dur: 0.3, gain: 0.3 });
      thump({ type: "square", f0: 260, f1: 60, dur: 0.24, gain: 0.42 });
      noiseBurst({ dur: 0.2, cutoff: 2200, gain: 0.3 });
      break;
    case "beat1":
    case "beat2":
    case "beat3":
    case "beat4":
      blip({ type: "square", f0: BEAT_FREQS[Number(name.slice(4)) - 1], dur: 0.1, gain: 0.32 });
      break;
  }
}

// Looping warble while the saucer crosses (an LFO bending the pitch).
let ufoNodes = null;
function startUfoSound() {
  const ctx = audioCtx;
  if (!ctx) return;
  const lvl = sfxLevel();
  if (lvl <= 0) return;
  stopUfoSound();
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 620;
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 11;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 130;
  lfo.connect(lfoGain).connect(osc.frequency);
  const g = ctx.createGain();
  g.gain.value = 0.15 * lvl;
  osc.connect(g).connect(ctx.destination);
  osc.start();
  lfo.start();
  ufoNodes = { osc, lfo };
}
function stopUfoSound() {
  if (ufoNodes) {
    try { ufoNodes.osc.stop(); ufoNodes.lfo.stop(); } catch (_) {}
    ufoNodes = null;
  }
}

// Four-step march, one note per fleet step. Speeds up as the steps get closer.
let beatIndex = 0;
function playBeat() {
  playSfx("beat" + (beatIndex + 1));
  beatIndex = (beatIndex + 1) % 4;
}

// Browsers block audio until a user gesture, so resume/start on first input.
function unlockAudio() {
  const ctx = ensureAudioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  if (music && music.paused && (state.mode === "menu" || state.mode === "gameover")) playMenuMusic();
}
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

// Auto-pause when the window loses focus. A hidden tab suspends the loop and would
// otherwise jump the run clock on return. visibilitychange covers tab switches, blur
// covers other windows; resume with ESC.
function autoPauseOnLeave() {
  if (state.mode === "playing") pauseGame();
}
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("visibilitychange", () => { if (document.hidden) autoPauseOnLeave(); });
}
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("blur", autoPauseOnLeave);
}

// Fit the canvas into the stage between the bars, keeping the 224:256 aspect.
const stageEl = (typeof document.querySelector === "function") ? document.querySelector(".stage") : null;
function fitCanvas() {
  if (!stageEl || typeof getComputedStyle !== "function") return;
  const cs = getComputedStyle(stageEl);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const border = 4; // canvas border, 2px each side
  const availW = stageEl.clientWidth - padX - border;
  const availH = stageEl.clientHeight - padY - border;
  if (availW <= 0 || availH <= 0) return;
  const ratio = WIDTH / HEIGHT;
  // Prefer height (landscape); fall back to width when the stage is narrow.
  let h = availH;
  let w = h * ratio;
  if (w > availW) { w = availW; h = w / ratio; }
  canvas.style.width = Math.floor(w) + "px";
  canvas.style.height = Math.floor(h) + "px";
}
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("resize", fitCanvas);
  window.addEventListener("orientationchange", fitCanvas);
  window.addEventListener("load", fitCanvas);
}
fitCanvas();
