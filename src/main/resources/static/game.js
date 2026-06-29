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
function typingInField(e) {
  const el = e.target;
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}
window.addEventListener("keydown", (e) => {
  if (typingInField(e)) return; // let the name field handle Space/Enter while it has focus
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
  if (gameMode === "remix") stopRemixMusic();
}
function resumeGame() {
  state.mode = "playing";
  lastT = performance.now(); // don't let the paused span become one huge dt step
  if (state.ufo) startUfoSound();
  if (gameMode === "remix") resumeRemixMusic();
  canvas.focus();
}

function startGame() {
  gameMode = selectedMode;
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
  // Fresh server-timed session per run, so each run can submit its own score.
  fetch("api/game/start", { method: "POST" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d) gameSessionId = d.sessionId; })
    .catch(() => {});
  if (gameMode === "remix") {
    startRemix();
  } else {
    buildFleet();
    buildBunkers();
  }
  hideOverlay();
  pauseMusic();
  if (gameMode === "remix") startRemixMusic();
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
  stopRemixMusic();
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
      if (state.ufo) startUfoSound(); // the saucer kept crossing; bring its drone back
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

// Shared scrolling starfield: the background for the menu and both game modes.
const starfield = [];
for (let i = 0; i < 64; i++) {
  starfield.push({ x: Math.random() * WIDTH, y: Math.random() * HEIGHT, s: 5 + Math.random() * 18, bright: Math.random() < 0.3 });
}
function updateStarfield(dt) {
  for (const st of starfield) {
    st.y += st.s * dt;
    if (st.y > HEIGHT) { st.y = 0; st.x = Math.random() * WIDTH; }
  }
}
function drawStars() {
  for (const st of starfield) {
    ctx.fillStyle = st.bright ? "#ffffff" : "#6f7d6f";
    ctx.fillRect(Math.round(st.x), Math.round(st.y), 1, 1);
  }
}

// Eye/visor gap per classic orb type, punched crisp and dark on top of the glow.
const CLASSIC_EYE = {
  orbSmall: { x: 3, y: 3, w: 2, h: 2 },
  orbMid: { x: 4, y: 4, w: 3, h: 1 },
  orbLarge: { x: 4, y: 4, w: 4, h: 1 },
};

// Fully-enclosed holes of a sprite (a 0 with a lit pixel in all four directions), e.g.
// the UFO windows, so the glow can be punched out of them. Open gaps like the leg gap
// underneath the saucer and the outer edges are excluded.
function interiorHoles(bitmap) {
  const holes = [];
  const h = bitmap.length;
  for (let y = 1; y < h - 1; y++) {
    const row = bitmap[y];
    for (let x = 1; x < row.length - 1; x++) {
      if (row[x] !== "0") continue;
      let left = false, right = false, up = false, down = false;
      for (let i = 0; i < x; i++) if (row[i] === "1") { left = true; break; }
      for (let i = x + 1; i < row.length; i++) if (row[i] === "1") { right = true; break; }
      for (let j = 0; j < y; j++) if (bitmap[j][x] === "1") { up = true; break; }
      for (let j = y + 1; j < h; j++) if (bitmap[j][x] === "1") { down = true; break; }
      if (left && right && up && down) holes.push({ x, y });
    }
  }
  return holes;
}
const UFO_HOLES = interiorHoles(SPRITES.ufo[0]);

// Render
function render() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawStars();
  if (state.mode === "menu") return; // stars-only behind the menu overlay

  ctx.fillStyle = COLORS.player;
  ctx.fillRect(0, GROUND_Y, WIDTH, 1);

  // Glow the structures and ships (kept off the bullets/bombs below).
  ctx.shadowBlur = 6;

  ctx.shadowColor = COLORS.player;
  for (const bk of bunkers) ctx.drawImage(bk.canvas, bk.x, bk.y);

  if (state.ufo) { ctx.shadowColor = COLORS.ufo; drawSprite("ufo", 0, state.ufo.x, UFO_Y); }

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const b = enemyBox(enemy);
    ctx.shadowColor = COLORS[enemy.type];
    drawSprite(enemy.type, state.fleetFrame, b.x, b.y);
  }

  // Player (blinks briefly after a hit).
  if (state.mode === "playing" || state.mode === "gameover") {
    const blink = state.invul > 0 && Math.floor(state.invul * 10) % 2 === 0;
    if (!blink) { ctx.shadowColor = COLORS.player; drawSprite("player", 0, state.player.x, PLAYER_Y); }
  }

  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  // Keep each enemy's eye/visor crisp and dark on top of the glow.
  ctx.fillStyle = "#000";
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const e = CLASSIC_EYE[enemy.type];
    if (!e) continue;
    const b = enemyBox(enemy);
    ctx.fillRect(Math.round(b.x) + e.x, Math.round(b.y) + e.y, e.w, e.h);
  }

  // Keep the UFO windows dark on top of the glow.
  if (state.ufo) {
    ctx.fillStyle = "#000";
    for (const h of UFO_HOLES) ctx.fillRect(Math.round(state.ufo.x) + h.x, UFO_Y + h.y, 1, 1);
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
  updateStarfield(dt); // stars scroll on the menu and in both modes
  if (gameMode === "remix") {
    remixUpdate(dt);
    remixRender();
  } else {
    update(dt);
    render();
  }
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

let hudLives = -1;
function updateHud() {
  scoreValue.textContent = state.score;
  hiScoreValue.textContent = state.hiScore;
  waveValue.textContent = state.wave;
  if (state.lives === hudLives) return; // only rebuild the icons when the count changes
  let html = "";
  for (let i = 0; i < state.lives; i++) {
    html += `<img class="life-icon" src="${lifeIconUrl}" alt="life">`;
  }
  livesEl.innerHTML = html;
  hudLives = state.lives;
}
updateHud();

// Overlay + leaderboard
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const startButton = document.getElementById("start-button");
const playAgainButton = document.getElementById("play-again-button");
const scoreForm = document.getElementById("score-form");
const playerNameInput = document.getElementById("player-name");
const submitScoreButton = document.getElementById("submit-score-button");
const leaderboardList = document.getElementById("leaderboard-list");
const modeClassicButton = document.getElementById("mode-classic");
const modeRemixButton = document.getElementById("mode-remix");
const mainMenuButton = document.getElementById("main-menu-button");
const remixLeaderboardList = document.getElementById("remix-leaderboard-list");

let lastRunDurationSeconds = 0;
let scoreAlreadySubmitted = false;
// Set from POST /api/game/start so the server can time the run. Sent with the score.
let gameSessionId = null;
// Picked on the menu. Choosing a mode only highlights it; Start (or Enter/Space)
// begins the run.
let selectedMode = "classic";
let gameMode = "classic"; // the mode the current run is actually using

// The instructions panel shows the controls for the currently selected mode.
const menuControlsEl = document.querySelector("#instructions-col .menu-controls");
const INSTRUCTIONS = {
  classic:
    '<span class="mc-keys"><span class="key-cap">A</span><span class="key-cap">D</span><span class="key-sep">/</span><span class="key-cap">&larr;</span><span class="key-cap">&rarr;</span></span>' +
    '<span class="mc-label">Move</span>' +
    '<span class="mc-keys"><span class="key-cap">Space</span><span class="key-sep">/</span><span class="key-cap">&uarr;</span></span>' +
    '<span class="mc-label">Shoot</span>' +
    '<span class="mc-keys"><span class="key-cap">Esc</span></span>' +
    '<span class="mc-label">Pause</span>',
  remix:
    '<span class="mc-keys"><span class="key-cap">Mouse</span></span>' +
    '<span class="mc-label">Aim</span>' +
    '<span class="mc-keys"><span class="key-cap">Hold click</span></span>' +
    '<span class="mc-label">Fire</span>' +
    '<span class="mc-keys"><span class="key-cap">Esc</span></span>' +
    '<span class="mc-label">Pause</span>',
};
// The always-visible bottom control bar mirrors the selected mode too.
const hudControlsEl = document.querySelector(".hud-controls");
const HUD_HINTS = {
  classic:
    '<span class="key-hint"><span class="key-cap">A</span><span class="key-cap">D</span><span class="key-sep">/</span><span class="key-cap">&larr;</span><span class="key-cap">&rarr;</span><span class="kh-word">Move</span></span>' +
    '<span class="key-hint"><span class="key-cap">Space</span><span class="key-sep">/</span><span class="key-cap">&uarr;</span><span class="kh-word">Shoot</span></span>' +
    '<span class="key-hint"><span class="key-cap">Esc</span><span class="kh-word">Pause</span></span>',
  remix:
    '<span class="key-hint"><span class="key-cap">Mouse</span><span class="kh-word">Aim</span></span>' +
    '<span class="key-hint"><span class="key-cap">Hold click</span><span class="kh-word">Fire</span></span>' +
    '<span class="key-hint"><span class="key-cap">Esc</span><span class="kh-word">Pause</span></span>',
};
function updateInstructions() {
  if (menuControlsEl) menuControlsEl.innerHTML = INSTRUCTIONS[selectedMode] || INSTRUCTIONS.classic;
  if (hudControlsEl) hudControlsEl.innerHTML = HUD_HINTS[selectedMode] || HUD_HINTS.classic;
}

function selectMode(mode) {
  if (mode !== "classic" && mode !== "remix") return;
  selectedMode = mode;
  modeClassicButton.classList.toggle("selected", mode === "classic");
  if (modeRemixButton) modeRemixButton.classList.toggle("selected", mode === "remix");
  updateInstructions();
}

startButton.addEventListener("click", () => { playMenuSfx(); startGame(); });
if (playAgainButton) playAgainButton.addEventListener("click", () => { playMenuSfx(); startGame(); });
submitScoreButton.addEventListener("click", submitScore);
modeClassicButton.addEventListener("click", () => { playMenuSfx(); selectMode("classic"); });
if (modeRemixButton) modeRemixButton.addEventListener("click", () => { playMenuSfx(); selectMode("remix"); });
if (mainMenuButton) mainMenuButton.addEventListener("click", () => { playMenuSfx(); showMainMenu(); });

function hideOverlay() {
  overlay.classList.add("hidden");
}
function showGameOverOverlay() {
  overlayTitle.textContent = "GAME OVER";
  // The .gameover class swaps the menu columns for the game-over panel via CSS.
  overlay.classList.add("gameover");
  overlayText.innerHTML = `You scored <b>${state.score}</b> and reached <b>wave ${state.wave}</b>.`;
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
  selectMode("classic");
  overlay.classList.remove("hidden");

  scoreAlreadySubmitted = false;
  stopRemixMusic();
  if (music && music.paused) playMenuMusic();
  refreshLeaderboard();
}

async function refreshLeaderboard() {
  await Promise.all([
    loadBoard("classic", leaderboardList),
    loadBoard("remix", remixLeaderboardList),
  ]);
}

async function loadBoard(mode, listEl) {
  try {
    const res = await fetch("api/scores/top?limit=10&mode=" + mode);
    if (!res.ok) throw new Error("HTTP " + res.status);
    renderBoard(listEl, await res.json(), null);
  } catch (err) {
    console.warn("Leaderboard fetch failed (" + mode + "):", err);
    renderBoard(listEl, [], "Leaderboard offline - run the backend to submit scores.");
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
        mode: gameMode,
      }),
    });
    if (res.status === 400) {
      let msg = "Score rejected.";
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

// Remix-only background music: three tracks played in a fresh random order each run,
// then looped. Shares the music volume/mute controls.
const REMIX_TRACKS = [
  "audio/bransboynd-retro-game-402454.mp3",
  "audio/dopestuff-neon-gaming-128925.mp3",
  "audio/music_unlimited-stranger-things-124008.mp3",
];
let remixMusic = null;
let remixOrder = [];
let remixTrack = 0;
if (typeof Audio !== "undefined") {
  remixMusic = new Audio();
  remixMusic.addEventListener("ended", () => {
    remixTrack = (remixTrack + 1) % remixOrder.length; // advance and loop the shuffled order
    remixMusic.src = remixOrder[remixTrack];
    remixMusic.volume = effMusic();
    remixMusic.play().catch(() => {});
  });
}
function startRemixMusic() {
  if (!remixMusic) return;
  remixOrder = REMIX_TRACKS.slice();
  for (let i = remixOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remixOrder[i], remixOrder[j]] = [remixOrder[j], remixOrder[i]];
  }
  remixTrack = 0;
  remixMusic.src = remixOrder[0];
  remixMusic.volume = effMusic();
  remixMusic.play().catch(() => {});
}
function resumeRemixMusic() { if (remixMusic && remixMusic.src) remixMusic.play().catch(() => {}); }
function stopRemixMusic() { if (remixMusic) remixMusic.pause(); }
function applyRemixMusicVol() { if (remixMusic) remixMusic.volume = effMusic(); }

function effSfx() { return sfxMuted ? 0 : sfxVolume; }

// One-shot menu click sound (the card-select SFX reused from Ranger Survivor),
// gated by the SFX volume and mute. Cloned per play so quick clicks can overlap.
const MENU_SFX_SRC = "audio/card_select.mp3";
let menuSfx = null;
if (typeof Audio !== "undefined") { menuSfx = new Audio(MENU_SFX_SRC); menuSfx.preload = "auto"; }
function playMenuSfx() {
  if (!menuSfx) return;
  const lvl = effSfx();
  if (lvl <= 0) return;
  const s = menuSfx.cloneNode();
  s.volume = Math.min(1, lvl);
  s.play().catch(() => {});
}

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
  applyMusicVol(); applyRemixMusicVol(); updateMuteIcons(); saveAudioPrefs();
});
if (musicMuteBtn) musicMuteBtn.addEventListener("click", () => {
  musicMuted = !musicMuted; applyMusicVol(); applyRemixMusicVol(); updateMuteIcons(); saveAudioPrefs();
});
if (sfxSlider) sfxSlider.addEventListener("input", () => {
  sfxVolume = Number(sfxSlider.value) / 100;
  if (sfxVolume > 0) sfxMuted = false;
  updateMuteIcons(); saveAudioPrefs(); applyUfoVolume();
});
if (sfxMuteBtn) sfxMuteBtn.addEventListener("click", () => {
  sfxMuted = !sfxMuted; updateMuteIcons(); saveAudioPrefs(); applyUfoVolume();
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

// A one-shot whirring tone (fast vibrato that decays): the boomerang spin.
function whirl(o) {
  const ctx = audioCtx;
  if (!ctx) return;
  const lvl = sfxLevel();
  if (lvl <= 0) return;
  const t = ctx.currentTime;
  const dur = o.dur || 0.4;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(o.f0 || 500, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1 || 720), t + dur);
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = o.rate || 30;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = o.depth || 240;
  lfo.connect(lfoGain).connect(osc.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime((o.gain || 0.25) * lvl, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  lfo.start(t);
  osc.stop(t + dur + 0.02);
  lfo.stop(t + dur + 0.02);
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
    case "bomb":
      // A deep boom that rumbles for the full ~3s the blast takes to expand.
      noiseBurst({ dur: 2.9, cutoff: 900, gain: 0.62 });
      thump({ type: "triangle", f0: 130, f1: 18, dur: 2.7, gain: 0.72 });
      blip({ type: "sawtooth", f0: 170, f1: 28, dur: 0.9, gain: 0.16 });
      break;
    case "boomerang":
      // A sustained spinning whoosh that lasts while the boomerangs are in flight.
      whirl({ f0: 460, f1: 700, dur: 1.2, rate: 30, depth: 240, gain: 0.26 });
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
  // Always create the node (even at gain 0 when muted) so the drone can be raised
  // or lowered live as the SFX slider/mute changes while the saucer is on screen.
  const g = ctx.createGain();
  g.gain.value = 0.15 * sfxLevel();
  osc.connect(g).connect(ctx.destination);
  osc.start();
  lfo.start();
  ufoNodes = { osc, lfo, gain: g };
}
function stopUfoSound() {
  if (ufoNodes) {
    try { ufoNodes.osc.stop(); ufoNodes.lfo.stop(); } catch (_) {}
    ufoNodes = null;
  }
}
// Track the live saucer drone to the SFX slider/mute while it is playing.
function applyUfoVolume() {
  if (ufoNodes && ufoNodes.gain && audioCtx) {
    ufoNodes.gain.gain.setTargetAtTime(0.15 * sfxLevel(), audioCtx.currentTime, 0.01);
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

// The game viewport (canvas + menu overlay) is a fixed-size box scaled uniformly
// to fit the stage between the full-width HUD bars. The bars stay edge-to-edge and
// size themselves to the window; only this middle box is letterboxed, so the menu
// spacing is identical at every screen size.
// APP_W:APP_H must match the canvas aspect (224:256). Keep in sync with .play-area
// width/height in styles.css.
const APP_W = 700;
const APP_H = 800;
const stageEl = (typeof document.querySelector === "function") ? document.querySelector(".stage") : null;
const appEl = (typeof document.getElementById === "function") ? document.getElementById("app") : null;
function fitApp() {
  if (!stageEl || !appEl || typeof getComputedStyle !== "function") return;
  const cs = getComputedStyle(stageEl);
  const availW = stageEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = stageEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (availW <= 0 || availH <= 0) return;
  appEl.style.transform = "scale(" + Math.min(availW / APP_W, availH / APP_H) + ")";
}
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("resize", fitApp);
  window.addEventListener("orientationchange", fitApp);
  window.addEventListener("load", fitApp);
}
fitApp();

// ===================================================================================
// Remix mode: a mouse-aimed gallery shooter sharing the canvas, HUD, overlay, audio,
// and leaderboard with Classic. Two bottom turrets auto-fire at the crosshair while
// the button is held. Big orbs split into four smalls when hit. Enemies never shoot;
// the run ends the instant any orb reaches the bottom line.
// ===================================================================================
const RX_BOTTOM = HEIGHT - 18;          // lose line: an orb reaching it ends the run
const RX_TURRET_Y = HEIGHT - 14;
const RX_T1X = 28;
const RX_T2X = WIDTH - 28 - spriteW("player");
const RX_FIRE_INTERVAL = 0.08;          // hold-to-fire cadence
const RX_HIT_PAD = 6;                    // aim forgiveness added to a target's radius
const RX_MINI_R = 4;                     // the splits a boss drops
const RX_UFO_R = 11;                     // bonus craft
const RX_COL = 16;                       // fleet grid cell spacing (same as Classic)
const RX_ROW = 14;
const RX_STEP_DX = 3;                    // horizontal hop per fleet step
const RX_DROP_DY = 8;                    // drop when a fleet reverses at a wall
// Per orb type: hit radius (RX_HIT_PAD added for aim forgiveness), points, and the
// particle colour. Rows run purple, blue, green, yellow, orange, red top to bottom.
const RX_TYPE_R = { orbSmall: 5, orbMid: 6, orbLarge: 7, yellow: 8, orange: 9, red: 10, boss: 9 };
const RX_POINTS = { orbSmall: 60, orbMid: 50, orbLarge: 40, yellow: 30, orange: 20, red: 10 };
const RX_COLOR = {
  orbSmall: COLORS.orbSmall, orbMid: COLORS.orbMid, orbLarge: COLORS.orbLarge,
  yellow: "#f5ff36", orange: "#ff8a2b", red: "#ff3b3b",
};

// Two-frame orb shapes for the Remix rows; the legs shift between frames for a wiggle.
const RX_TALL_0 = ["0001111111000","0011111111100","0111111111110","1111111111111","1111100011111","1111100011111","0111111111110","0011111111100","0110000000110"];
const RX_TALL_1 = ["0001111111000","0011111111100","0111111111110","1111111111111","1111100011111","1111100011111","0111111111110","0011111111100","1010000000101"];
const RX_BIG_0 = ["00000111111100000","00001111111110000","00011111111111000","00111111111111100","01111111111111110","11111110001111111","11111110001111111","01111111111111110","00111111111111100","01100000000000110"];
const RX_BIG_1 = ["00000111111100000","00001111111110000","00011111111111000","00111111111111100","01111111111111110","11111110001111111","11111110001111111","01111111111111110","00111111111111100","10100000000000101"];
const RX_WIDE_0 = ["00000111111100000","00001111111110000","00011111111111000","00111111111111100","01111111111111110","11111100000111111","11111111111111111","01111111111111110","00111111111111100","01100000000000110"];
const RX_WIDE_1 = ["00000111111100000","00001111111110000","00011111111111000","00111111111111100","01111111111111110","11111100000111111","11111111111111111","01111111111111110","00111111111111100","10100000000000101"];
const RX_BOSS_0 = ["0001111111000","0011111111100","0111111111110","1111111111111","1111000001111","1111111111111","1111111111111","0111111111110","0011111111100","0110000000110"];
const RX_BOSS_1 = ["0001111111000","0011111111100","0111111111110","1111111111111","1111000001111","1111111111111","1111111111111","0111111111110","0011111111100","1010000000101"];

const RX_BOSS_COLOR = "#ff3b3b"; // boss splits and area bursts
const RX_RAINBOW = ["#ff3b3b", "#ff8a2b", "#f5ff36", "#4dff5a", "#36e0ff", "#5a7bff", "#d96fff"];

// Sprite frames per row type (purple/blue reuse the classic sprites via spriteCache).
const RX_GREEN = [bakeSprite(RX_TALL_0, RX_COLOR.orbLarge), bakeSprite(RX_TALL_1, RX_COLOR.orbLarge)];
const RX_YEL = [bakeSprite(SPRITES.orbLarge[0], RX_COLOR.yellow), bakeSprite(SPRITES.orbLarge[1], RX_COLOR.yellow)];
const RX_ORG = [bakeSprite(RX_BIG_0, RX_COLOR.orange), bakeSprite(RX_BIG_1, RX_COLOR.orange)];
const RX_RED = [bakeSprite(RX_WIDE_0, RX_COLOR.red), bakeSprite(RX_WIDE_1, RX_COLOR.red)];
const RX_BOSS_RAINBOW = RX_RAINBOW.map((col) => [bakeSprite(RX_BOSS_0, col), bakeSprite(RX_BOSS_1, col)]);
const RX_MINI_RAINBOW = RX_RAINBOW.map((col) => bakeSprite(SPRITES.orbSmall[0], col));
const RX_DRAWSCALE = { orbSmall: 1, orbMid: 1, orbLarge: 0.96, yellow: 1.17, orange: 0.94, red: 1.03, boss: 1.6 };

const RX_UFO_IMG = spriteCache["ufo:0"];
const RX_UFO_WHITE = bakeSprite(SPRITES.ufo[0], "#ffffff");
// A black mask the size of the UFO with a pixel at each window. Drawn on top of the
// saucer with the same transform, so the windows stay dark and aligned at any scale.
const RX_UFO_WINDOWS = (() => {
  const grid = SPRITES.ufo[0].map((row) => row.split("").fill("0"));
  for (const h of UFO_HOLES) grid[h.y][h.x] = "1";
  return bakeSprite(grid.map((row) => row.join("")), "#000");
})();
const RX_UFO_SPEED = 300;

// Bomb/boomerang drops: 2% each per kill; they drift, bounce twice, then despawn.
const RX_DROP_CHANCE = 0.02;
const RX_DROP_SPEED = 70;
const RX_DROP_R = 8;
const RX_BLAST_MAX = 50;
const RX_BLAST_GROW = 16.7;     // ~3s from a pixel to the cap
const RX_BIG_BOOM_SPEED = 150;
const RX_BIG_BOOM_R = 16;
const RX_BOMB_BITS = ["000110000","001111100","011011110","110111111","111111111","111111111","011111110","001111100","000000000"];
const RX_BOOM_BITS = ["100000001","110000011","011000110","001101100","000111000","000010000"];
const RX_BOMB_RAINBOW = RX_RAINBOW.map((col) => bakeSprite(RX_BOMB_BITS, col));
const RX_BOOM_RAINBOW = RX_RAINBOW.map((col) => bakeSprite(RX_BOOM_BITS, col));

const rx = {
  fleets: [],                // each is an independent classic-style stepping fleet
  minis: [],                 // free-falling orbs dropped by a shot boss
  shuttles: [],
  particles: [],
  floats: [],                // floating score popups (e.g. the UFO bonus)
  drops: [],                 // bouncing bomb / boomerang pickups
  blasts: [],                // expanding bomb kill-circles
  boomerangs: [],            // big boomerangs fired when a boomerang drop is shot
  forts: [],                 // carve-able bunkers along the bottom
  crosshair: { x: WIDTH / 2, y: HEIGHT / 2 },
  firing: false,
  fireCooldown: 0,
  elapsed: 0,                // seconds since the run started, drives the spawn ramp
  spawnTimer: 0,
  shuttleTimer: 0,
  bossTimer: 0,
  nextWaveId: 1,
  spawnsSinceFull: 0,        // forces a full 6-row wave at least every 4 spawns
  waveCount: 0,              // scheduled waves; the enemy floor rises every 5 of these
  ufoSound: false,
};

function startRemix() {
  rx.fleets = [];
  rx.minis = [];
  rx.shuttles = [];
  rx.particles = [];
  rx.floats = [];
  rx.drops = [];
  rx.blasts = [];
  rx.boomerangs = [];
  rx.firing = false;
  rx.fireCooldown = 0;
  rx.elapsed = 0;
  rx.spawnTimer = 4 + Math.random() * 1.2; // first wave is solo for a few seconds
  rx.shuttleTimer = 6;
  rx.bossTimer = 5 + Math.random() * 6;
  rx.nextWaveId = 1;
  rx.spawnsSinceFull = 0;
  rx.waveCount = 0;
  rx.ufoSound = false;
  rx.crosshair.x = WIDTH / 2;
  rx.crosshair.y = HEIGHT / 2;
  state.lives = 1; // instant game over when a wave reaches the bottom
  rxBuildForts();
  spawnWave();
  canvas.style.cursor = "none";
}

const RX_ROW_ORDER = ["orbSmall", "orbMid", "orbLarge", "yellow", "orange", "red"]; // top -> bottom
// Weighted partial-wave row count: 1=5% 2=10% 3=20% 4=25% 5=22% 6=18%.
function rxRandomRowCount() {
  const r = Math.random() * 100;
  if (r < 5) return 1;
  if (r < 15) return 2;
  if (r < 35) return 3;
  if (r < 60) return 4;
  if (r < 82) return 5;
  return 6;
}
function spawnWave() {
  const id = rx.nextWaveId++;
  const cs = 18, rs = 15;
  const maxCols = Math.min(9, Math.floor((WIDTH - 8) / cs));
  const colT = (Math.random() + Math.random() + Math.random()) / 3; // bell-curved, peaks mid-range
  const cols = 5 + Math.round(colT * (maxCols - 5));

  let rows, fy;
  if (id <= 2) {
    rows = RX_ROW_ORDER.slice(); // first two waves: full formation at the top
    fy = 6 + Math.random() * 16;
  } else {
    // Contiguous row slice, forced full every 4th spawn, snapped to a top-half lane.
    const rowCount = rx.spawnsSinceFull >= 3 ? 6 : rxRandomRowCount();
    const start = Math.floor(Math.random() * (RX_ROW_ORDER.length - rowCount + 1));
    rows = RX_ROW_ORDER.slice(start, start + rowCount);
    const lanes = Math.floor((HEIGHT / 2) / rs);
    const maxLane = Math.max(0, lanes - rows.length);
    fy = Math.floor(Math.random() * (maxLane + 1)) * rs;
  }
  rx.spawnsSinceFull = rows.length === 6 ? 0 : rx.spawnsSinceFull + 1;

  const gridW = cols * cs;
  const cells = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols; c++) cells.push({ col: c, row: r, type: rows[r], alive: true });
  }
  rx.fleets.push({
    id,
    fx: 4 + Math.random() * Math.max(1, WIDTH - gridW - 8),
    fy,
    dir: Math.random() < 0.5 ? -1 : 1,
    stepAccum: 0,
    frame: 0,
    pendingDrop: false,
    cells,
    total: cells.length,
    alive: cells.length,
    cs,
    rs,
    baseInterval: 0.044 + Math.random() * 0.08,
  });
  state.wave = id;
}

// Spawn gap shrinks over the run, clamped to a 1.4s floor.
function rxSpawnInterval() {
  const base = Math.max(1.4, 4.2 - rx.elapsed * 0.045);
  return base + Math.random() * 1.0;
}

// Live enemies on screen (fleet orbs still alive, plus free-falling boss splits).
function rxEnemyCount() {
  let n = rx.minis.length;
  for (const f of rx.fleets) n += f.alive;
  return n;
}

// Forts along the bottom. Reuses the Classic carve-able pixel bunker.
function rxBuildForts() {
  rx.forts = [];
  const count = 4, bw = 24, bh = 14;
  const y = RX_BOTTOM - 30;
  const gap = (WIDTH - count * bw) / (count + 1);
  for (let i = 0; i < count; i++) {
    rx.forts.push(makeBunker(Math.round(gap + i * (bw + gap)), y, bw, bh));
  }
}

// Bosses are their own object: a small 1x1, 1x2, or 2x2 cluster of boss orbs
// that steps in like any fleet, separate from the regular waves.
function spawnBoss() {
  const shapes = [[1, 1], [1, 2], [2, 1], [2, 2]];
  const [cols, rows] = shapes[Math.floor(Math.random() * shapes.length)];
  const cs = 22, rs = 20;
  const gridW = cols * cs;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push({ col: c, row: r, type: "boss", alive: true });
  }
  rx.fleets.push({
    id: rx.nextWaveId++,
    fx: 6 + Math.random() * Math.max(1, WIDTH - gridW - 12),
    fy: 6 + Math.random() * 14,
    dir: Math.random() < 0.5 ? -1 : 1,
    stepAccum: 0,
    frame: 0,
    pendingDrop: false,
    cells,
    total: cells.length,
    alive: cells.length,
    cs,
    rs,
    baseInterval: 0.07 + Math.random() * 0.1,
  });
}

function rxCellPos(f, cell) {
  const cs = f.cs || RX_COL, rs = f.rs || RX_ROW;
  return { x: f.fx + cell.col * cs + cs / 2, y: f.fy + cell.row * rs + rs / 2 };
}

function rxFleetExtent(f) {
  const cs = f.cs || RX_COL;
  let min = Infinity, max = -Infinity;
  for (const c of f.cells) {
    if (!c.alive) continue;
    const x = f.fx + c.col * cs;
    if (x < min) min = x;
    if (x + cs > max) max = x + cs;
  }
  return { min, max };
}

function rxFleetBottom(f) {
  const rs = f.rs || RX_ROW;
  let max = -Infinity;
  for (const c of f.cells) {
    if (!c.alive) continue;
    const y = f.fy + c.row * rs + rs;
    if (y > max) max = y;
  }
  return max;
}

// Steps speed up as the fleet thins. Clamp to [0,1]: a cleared fleet (alive 0) gives a
// negative fraction that would make the interval <= 0 and hang the step loop.
function rxStepInterval(f) {
  const frac = f.total > 1 ? Math.max(0, Math.min(1, (f.alive - 1) / (f.total - 1))) : 0;
  return f.baseInterval * (0.2 + 0.8 * frac);
}

// One fleet step. Returns true if it ended the run (reached the bottom).
function rxStepFleet(f) {
  f.frame ^= 1;
  if (f.pendingDrop) {
    f.fy += RX_DROP_DY;
    f.dir *= -1;
    f.pendingDrop = false;
    if (rxFleetBottom(f) >= RX_BOTTOM) { playSfx("explosion"); gameOver(); return true; }
    return false;
  }
  f.fx += RX_STEP_DX * f.dir;
  const ext = rxFleetExtent(f);
  if (f.dir > 0 && ext.max >= WIDTH - 4) f.pendingDrop = true;
  else if (f.dir < 0 && ext.min <= 4) f.pendingDrop = true;
  return false;
}

function spawnShuttle() {
  rx.shuttles.push({
    x: Math.random() < 0.5 ? -16 : WIDTH + 16,
    y: 16 + Math.random() * 70,
    tx: 24 + Math.random() * (WIDTH - 48), // random spot to dart to
    ty: 18 + Math.random() * 90,
    st: "in",
    timer: 0,
    flash: 0,
    age: 0,
  });
}

function rxBurst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 150;
    rx.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.5 + Math.random() * 0.7,
      max: 1.2,
      size: Math.random() < 0.35 ? 2 : 1,
      color,
    });
  }
}

function rxDist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

// Move o toward (tx, ty) by step px. Returns true once it arrives.
function rxMoveToward(o, tx, ty, step) {
  const dx = tx - o.x, dy = ty - o.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= step || dist === 0) { o.x = tx; o.y = ty; return true; }
  o.x += (dx / dist) * step;
  o.y += (dy / dist) * step;
  return false;
}

function rxDrawSpin(img, cx, cy, scale, angle) {
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.drawImage(img, Math.round(-w / 2), Math.round(-h / 2), w, h);
  ctx.restore();
}

function rxSpawnDrop(kind, x, y) {
  const a = Math.random() * Math.PI * 2;
  rx.drops.push({ kind, x, y, vx: Math.cos(a) * RX_DROP_SPEED, vy: Math.sin(a) * RX_DROP_SPEED, bounces: 0, spin: 0 });
}

// 2% each per enemy kill, rolled independently.
function rxRollDrops(x, y) {
  if (Math.random() < RX_DROP_CHANCE) rxSpawnDrop("bomb", x, y);
  if (Math.random() < RX_DROP_CHANCE) rxSpawnDrop("boomerang", x, y);
}

function rxTriggerBomb(x, y) {
  rx.blasts.push({ x, y, r: 0 });
  playSfx("bomb");
}

function rxTriggerBoomerang(x, y) {
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * Math.PI * 2;
    rx.boomerangs.push({ x, y, vx: Math.cos(a) * RX_BIG_BOOM_SPEED, vy: Math.sin(a) * RX_BIG_BOOM_SPEED, spin: Math.random() * 6, bounces: 0 });
  }
  playSfx("boomerang");
}

// Destroy every enemy whose centre is within radius of (cx, cy). Silent: the bomb and
// boomerang play their own sound while they're active.
function rxDamageArea(cx, cy, radius) {
  const r2 = radius * radius;
  let killed = 0;
  for (const f of rx.fleets) {
    for (const c of f.cells) {
      if (!c.alive) continue;
      const p = rxCellPos(f, c);
      if (rxDist2(cx, cy, p.x, p.y) <= r2) {
        c.alive = false;
        f.alive--;
        addScore(c.type === "boss" ? 15 : (RX_POINTS[c.type] || 10));
        rxBurst(p.x, p.y, c.type === "boss" ? RX_BOSS_COLOR : (RX_COLOR[c.type] || "#ffffff"), 12);
        killed++;
      }
    }
  }
  for (const m of rx.minis) {
    if (m.dead) continue;
    if (rxDist2(cx, cy, m.x, m.y) <= r2) {
      m.dead = true; killed++;
      addScore(10);
      rxBurst(m.x, m.y, RX_BOSS_COLOR, 8);
    }
  }
  if (killed) rx.minis = rx.minis.filter((mm) => !mm.dead);
}

function rxFireTick() {
  const cx = rx.crosshair.x, cy = rx.crosshair.y;

  // Bomb / boomerang pickups take priority when the crosshair is on one.
  let drop = null, dropBest = Infinity;
  for (const d of rx.drops) {
    if (d.dead) continue;
    const rr = RX_DROP_R + RX_HIT_PAD;
    const dd = rxDist2(cx, cy, d.x, d.y);
    if (dd <= rr * rr && dd < dropBest) { dropBest = dd; drop = d; }
  }
  if (drop) {
    drop.dead = true;
    if (drop.kind === "bomb") rxTriggerBomb(drop.x, drop.y);
    else rxTriggerBoomerang(drop.x, drop.y);
    rx.drops = rx.drops.filter((d) => !d.dead);
    return;
  }

  let ufo = null, best = Infinity;
  for (const s of rx.shuttles) {
    if (s.dead) continue;
    const rr = RX_UFO_R + RX_HIT_PAD;
    const d = rxDist2(cx, cy, s.x, s.y);
    if (d <= rr * rr && d < best) { best = d; ufo = s; }
  }
  if (ufo) {
    ufo.dead = true;
    // Faster kill, more points (by how long the saucer has been up).
    let pts = 1000;
    if (ufo.age < 1) pts = 2500;
    else if (ufo.age < 2) pts = 2000;
    else if (ufo.age < 3) pts = 1500;
    addScore(pts);
    rxBurst(ufo.x, ufo.y, COLORS.ufo, 40);
    rx.floats.push({ x: ufo.x, y: ufo.y - 10, text: String(pts), t: 1.5 });
    playSfx("ufoKilled");
    rx.shuttles = rx.shuttles.filter((s) => !s.dead);
    return;
  }

  // Otherwise kill every enemy overlapping the crosshair this tick (stacks pop together).
  let killedAny = false;

  // Minis first, so a boss split created below this tick isn't instantly destroyed.
  for (const m of rx.minis) {
    if (m.dead) continue;
    const rr = RX_MINI_R + RX_HIT_PAD;
    if (rxDist2(cx, cy, m.x, m.y) <= rr * rr) {
      m.dead = true;
      addScore(10);
      rxBurst(m.x, m.y, RX_BOSS_COLOR, 18);
      rxRollDrops(m.x, m.y);
      killedAny = true;
    }
  }

  for (const f of rx.fleets) {
    for (const c of f.cells) {
      if (!c.alive) continue;
      const p = rxCellPos(f, c);
      const rr = RX_TYPE_R[c.type] + RX_HIT_PAD;
      if (rxDist2(cx, cy, p.x, p.y) > rr * rr) continue;
      c.alive = false;
      f.alive--;
      if (c.type === "boss") {
        addScore(15);
        rxBurst(p.x, p.y, RX_BOSS_COLOR, 34);
        const spread = [[-1, -0.4], [1, -0.4], [-1, 0.6], [1, 0.6]];
        for (const [sx, sy] of spread) {
          rx.minis.push({ x: p.x, y: p.y, vx: sx * 30, vy: 16 + Math.random() * 14 + sy * 8, r: RX_MINI_R });
        }
      } else {
        addScore(RX_POINTS[c.type] || 10);
        rxBurst(p.x, p.y, RX_COLOR[c.type] || "#ffffff", 18);
      }
      rxRollDrops(p.x, p.y);
      killedAny = true;
    }
  }

  if (killedAny) {
    rx.minis = rx.minis.filter((m) => !m.dead);
    playSfx("shoot");
  }
}

function remixUpdate(dt) {
  if (state.mode !== "playing") {
    if (rx.ufoSound) { stopUfoSound(); rx.ufoSound = false; }
    return; // frozen while paused or on the overlay
  }

  rx.elapsed += dt;
  const waveBefore = state.wave;

  rx.spawnTimer -= dt;
  if (rx.spawnTimer <= 0) { spawnWave(); rx.waveCount++; rx.spawnTimer = rxSpawnInterval(); }

  // After the intro waves keep the screen busy. The floor starts at 25 and rises by
  // 5 every 5 scheduled waves.
  if (rx.nextWaveId > 2) {
    const minEnemies = 25 + 5 * Math.floor(rx.waveCount / 5);
    let guard = 0;
    while (rxEnemyCount() <= minEnemies && guard < 30) { spawnWave(); guard++; }
  }
  if (state.wave !== waveBefore) updateHud(); // one HUD update per frame, not per spawn

  rx.bossTimer -= dt;
  if (rx.bossTimer <= 0) { spawnBoss(); rx.bossTimer = 6 + Math.random() * 8; }

  rx.shuttleTimer -= dt;
  if (rx.shuttleTimer <= 0) { spawnShuttle(); rx.shuttleTimer = 8 + Math.random() * 7; }
  for (const s of rx.shuttles) {
    s.flash += dt;
    s.age += dt;
    if (s.st === "in") {
      if (rxMoveToward(s, s.tx, s.ty, RX_UFO_SPEED * dt)) { s.st = "sit"; s.timer = 1 + Math.random() * 3; }
    } else if (s.st === "sit") {
      s.timer -= dt;
      if (s.timer <= 0) {
        s.st = "out";
        s.tx = Math.random() < 0.5 ? -40 : WIDTH + 40; // zoom off a random side
        s.ty = s.y + (Math.random() * 80 - 40);
      }
    } else {
      rxMoveToward(s, s.tx, s.ty, RX_UFO_SPEED * dt);
      if (s.x < -24 || s.x > WIDTH + 24 || s.y < -24 || s.y > HEIGHT + 24) s.dead = true;
    }
  }
  rx.shuttles = rx.shuttles.filter((s) => !s.dead);

  // Drone the classic UFO sound while a bonus craft is on screen.
  const anyUfo = rx.shuttles.length > 0;
  if (anyUfo && !rx.ufoSound) { startUfoSound(); rx.ufoSound = true; }
  else if (!anyUfo && rx.ufoSound) { stopUfoSound(); rx.ufoSound = false; }

  // Each fleet steps on its own clock, accelerating as it thins (classic mechanic).
  for (const f of rx.fleets) {
    if (f.alive <= 0) continue;
    f.stepAccum += dt;
    const interval = rxStepInterval(f);
    while (f.stepAccum >= interval) {
      f.stepAccum -= interval;
      if (rxStepFleet(f)) return; // reached the bottom: run over
    }
  }
  rx.fleets = rx.fleets.filter((f) => f.alive > 0);

  // Free-falling boss splits.
  for (const m of rx.minis) {
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.vy += 10 * dt;
    if (m.x < m.r) { m.x = m.r; m.vx = Math.abs(m.vx); }
    if (m.x > WIDTH - m.r) { m.x = WIDTH - m.r; m.vx = -Math.abs(m.vx); }
    if (m.y + m.r >= RX_BOTTOM) { playSfx("explosion"); gameOver(); return; }
  }

  // Enemies crashing into a fort die (pixels fly) and gouge a chunk out of it.
  if (rx.forts.length) {
    for (const f of rx.fleets) {
      for (const c of f.cells) {
        if (!c.alive) continue;
        const p = rxCellPos(f, c);
        const carve = RX_TYPE_R[c.type] || 6;
        for (const fort of rx.forts) {
          if (damageBunker(fort, p.x, p.y, carve)) {
            c.alive = false;
            f.alive--;
            rxBurst(p.x, p.y, c.type === "boss" ? RX_BOSS_COLOR : (RX_COLOR[c.type] || "#ffffff"), 16);
            break;
          }
        }
      }
    }
    let any = false;
    for (const m of rx.minis) {
      if (m.dead) continue;
      for (const fort of rx.forts) {
        if (damageBunker(fort, m.x, m.y, 5)) {
          m.dead = true;
          any = true;
          rxBurst(m.x, m.y, RX_BOSS_COLOR, 10);
          break;
        }
      }
    }
    if (any) rx.minis = rx.minis.filter((m) => !m.dead);
  }

  // Bouncing pickups: bounce off two walls, despawn on the third.
  for (const d of rx.drops) {
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.spin += dt * 5;
    // Comet stream: scattered rainbow pixels left behind the object.
    rx.particles.push({
      x: d.x + (Math.random() * 6 - 3),
      y: d.y + (Math.random() * 6 - 3),
      vx: -d.vx * 0.12 + (Math.random() * 24 - 12),
      vy: -d.vy * 0.12 + (Math.random() * 24 - 12),
      life: 0.35 + Math.random() * 0.35,
      max: 0.7,
      size: Math.random() < 0.4 ? 3 : 2,
      color: RX_RAINBOW[Math.floor(Math.random() * RX_RAINBOW.length)],
    });
    let wall = false;
    if (d.x < RX_DROP_R) { d.x = RX_DROP_R; d.vx = Math.abs(d.vx); wall = true; }
    else if (d.x > WIDTH - RX_DROP_R) { d.x = WIDTH - RX_DROP_R; d.vx = -Math.abs(d.vx); wall = true; }
    if (d.y < RX_DROP_R) { d.y = RX_DROP_R; d.vy = Math.abs(d.vy); wall = true; }
    else if (d.y > HEIGHT - RX_DROP_R) { d.y = HEIGHT - RX_DROP_R; d.vy = -Math.abs(d.vy); wall = true; }
    if (wall) { d.bounces++; if (d.bounces >= 3) d.dead = true; } // bounce off 2 edges, despawn on the 3rd
  }
  rx.drops = rx.drops.filter((d) => !d.dead);

  // Bomb blasts: a slowly expanding kill-circle.
  for (const bl of rx.blasts) {
    bl.r += RX_BLAST_GROW * dt;
    rxDamageArea(bl.x, bl.y, bl.r);
    if (bl.r >= RX_BLAST_MAX) bl.dead = true;
  }
  rx.blasts = rx.blasts.filter((bl) => !bl.dead);

  // Big boomerangs: fly straight, killing enemies, until off screen.
  for (const b of rx.boomerangs) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.spin += dt * 12;
    rxDamageArea(b.x, b.y, RX_BIG_BOOM_R);
    let wall = false;
    if (b.x < RX_BIG_BOOM_R) { b.x = RX_BIG_BOOM_R; b.vx = Math.abs(b.vx); wall = true; }
    else if (b.x > WIDTH - RX_BIG_BOOM_R) { b.x = WIDTH - RX_BIG_BOOM_R; b.vx = -Math.abs(b.vx); wall = true; }
    if (b.y < RX_BIG_BOOM_R) { b.y = RX_BIG_BOOM_R; b.vy = Math.abs(b.vy); wall = true; }
    else if (b.y > HEIGHT - RX_BIG_BOOM_R) { b.y = HEIGHT - RX_BIG_BOOM_R; b.vy = -Math.abs(b.vy); wall = true; }
    if (wall) { b.bounces++; if (b.bounces >= 2) b.dead = true; }
  }
  rx.boomerangs = rx.boomerangs.filter((b) => !b.dead);

  if (rx.firing) {
    rx.fireCooldown -= dt;
    if (rx.fireCooldown <= 0) { rx.fireCooldown = RX_FIRE_INTERVAL; rxFireTick(); }
  } else {
    rx.fireCooldown = 0; // ready to fire on the next press
  }

  for (const p of rx.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 30 * dt;
    p.life -= dt;
  }
  rx.particles = rx.particles.filter((p) => p.life > 0);

  for (const fl of rx.floats) fl.t -= dt;
  rx.floats = rx.floats.filter((fl) => fl.t > 0);
}

function rxBeam(mx, my, alpha, width) {
  ctx.strokeStyle = COLORS.player;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(rx.crosshair.x, rx.crosshair.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
}

function rxDrawImg(img, cx, cy, scale) {
  const w = img.width * scale, h = img.height * scale;
  ctx.drawImage(img, Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h));
}

// The eye/visor gap (col,row,w,h in sprite pixels) for each orb type, so it can be
// kept crisp and dark on top of the glow.
const RX_EYE = {
  orbSmall: { x: 3, y: 3, w: 2, h: 2 },
  orbMid: { x: 4, y: 4, w: 3, h: 1 },
  orbLarge: { x: 5, y: 4, w: 3, h: 2 },
  yellow: { x: 4, y: 4, w: 4, h: 1 },
  orange: { x: 7, y: 5, w: 3, h: 2 },
  red: { x: 6, y: 5, w: 5, h: 1 },
  boss: { x: 4, y: 4, w: 5, h: 1 },
};

// Glow the body, redraw it sharp, then punch the eye/visor dark so it stays prominent.
function rxDrawOrb(img, glow, type, cx, cy, scale) {
  ctx.shadowColor = glow;
  ctx.shadowBlur = 6;
  rxDrawImg(img, cx, cy, scale);
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  rxDrawImg(img, cx, cy, scale);
  const e = RX_EYE[type];
  if (e) {
    const ox = Math.round(cx - (img.width * scale) / 2);
    const oy = Math.round(cy - (img.height * scale) / 2);
    ctx.fillStyle = "#000";
    ctx.fillRect(ox + Math.round(e.x * scale), oy + Math.round(e.y * scale),
      Math.ceil(e.w * scale), Math.ceil(e.h * scale));
  }
}

function remixRender() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawStars();
  if (state.mode === "menu") return; // stars-only behind the menu overlay
  canvas.style.cursor = state.mode === "playing" ? "none" : "default";
  const rainbowIdx = Math.floor(performance.now() / 80) % RX_RAINBOW.length;

  ctx.fillStyle = COLORS.player;
  ctx.fillRect(0, RX_BOTTOM, WIDTH, 1);

  // Forts, with a green glow.
  ctx.shadowColor = COLORS.player;
  ctx.shadowBlur = 6;
  for (const fort of rx.forts) ctx.drawImage(fort.canvas, fort.x, fort.y);
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  // Enemies get a colour-matched body glow, with the eye/visor kept crisp on top.
  for (const f of rx.fleets) {
    for (const c of f.cells) {
      if (!c.alive) continue;
      const p = rxCellPos(f, c);
      let img, glow;
      if (c.type === "boss") {
        img = RX_BOSS_RAINBOW[rainbowIdx][f.frame];
        glow = RX_RAINBOW[rainbowIdx];
      } else if (c.type === "orbLarge") { img = RX_GREEN[f.frame]; glow = RX_COLOR.orbLarge; }
      else if (c.type === "yellow") { img = RX_YEL[f.frame]; glow = RX_COLOR.yellow; }
      else if (c.type === "orange") { img = RX_ORG[f.frame]; glow = RX_COLOR.orange; }
      else if (c.type === "red") { img = RX_RED[f.frame]; glow = RX_COLOR.red; }
      else { img = spriteCache[c.type + ":" + f.frame]; glow = RX_COLOR[c.type]; }
      rxDrawOrb(img, glow, c.type, p.x, p.y, RX_DRAWSCALE[c.type] || 1);
    }
  }
  for (const m of rx.minis) {
    rxDrawOrb(RX_MINI_RAINBOW[rainbowIdx], RX_RAINBOW[rainbowIdx], "orbSmall", m.x, m.y, 1.2);
  }
  // The UFO glows white, then a matching black mask keeps the windows dark on top.
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 6;
  for (const s of rx.shuttles) {
    const img = Math.floor(s.flash / 0.1) % 2 === 0 ? RX_UFO_IMG : RX_UFO_WHITE;
    rxDrawImg(img, s.x, s.y, 1.2);
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  for (const s of rx.shuttles) rxDrawImg(RX_UFO_WINDOWS, s.x, s.y, 1.2);

  // Bomb blasts: an expanding ring that flashes through neon rainbow colours.
  for (const bl of rx.blasts) {
    const a = Math.max(0, 1 - bl.r / RX_BLAST_MAX);
    const hue = Math.floor((performance.now() * 0.6 + bl.r * 6) % 360);
    const col = "hsl(" + hue + ", 100%, 58%)";
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.5 + 0.4 * a;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bl.x, bl.y, bl.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(bl.x, bl.y, bl.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;

  // Pickups and big boomerangs, with a glow. Both flash rainbow. (The comet stream
  // behind a pickup is emitted into the particles above.)
  ctx.shadowBlur = 6;
  const bcol = RX_RAINBOW[rainbowIdx];
  const bimg = RX_BOOM_RAINBOW[rainbowIdx];
  for (const d of rx.drops) {
    if (d.kind === "bomb") { ctx.shadowColor = bcol; rxDrawImg(RX_BOMB_RAINBOW[rainbowIdx], d.x, d.y, 1.95); }
    else { ctx.shadowColor = bcol; rxDrawSpin(bimg, d.x, d.y, 1.95, d.spin); }
  }
  ctx.shadowColor = bcol;
  for (const b of rx.boomerangs) rxDrawSpin(bimg, b.x, b.y, 3.4, b.spin);
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  for (const p of rx.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    const ps = p.size || 1;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), ps, ps);
  }
  ctx.globalAlpha = 1;

  ctx.shadowColor = COLORS.player;
  ctx.shadowBlur = 6;
  drawSprite("player", 0, RX_T1X, RX_TURRET_Y);
  drawSprite("player", 0, RX_T2X, RX_TURRET_Y);
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  const pw = spriteW("player");
  const m1x = RX_T1X + pw / 2, m2x = RX_T2X + pw / 2, my = RX_TURRET_Y;
  rxBeam(m1x, my, 0.22, 1);
  rxBeam(m2x, my, 0.22, 1);
  if (rx.firing && state.mode === "playing") {
    // Flash the firing beams on and off while the button is held.
    const flash = Math.floor(performance.now() / 60) % 2 === 0 ? 0.95 : 0.3;
    rxBeam(m1x, my, flash, 1.5);
    rxBeam(m2x, my, flash, 1.5);
  }

  const cx = rx.crosshair.x, cy = rx.crosshair.y;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.moveTo(cx - 7, cy); ctx.lineTo(cx - 2, cy);
  ctx.moveTo(cx + 2, cy); ctx.lineTo(cx + 7, cy);
  ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy - 2);
  ctx.moveTo(cx, cy + 2); ctx.lineTo(cx, cy + 7);
  ctx.stroke();

  // Score popups (the UFO bonus): large red text fixed where it was killed.
  if (rx.floats.length) {
    const fcol = Math.floor(performance.now() / 100) % 2 === 0 ? "#ff4d4d" : "#ffffff";
    ctx.fillStyle = fcol;
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.shadowColor = fcol;
    ctx.shadowBlur = 4;
    for (const fl of rx.floats) ctx.fillText(fl.text, Math.round(fl.x), Math.round(fl.y));
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.textAlign = "left";
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

// Mouse aiming and hold-to-fire. Harmless in Classic (the crosshair just tracks).
function rxMouse(e) {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  rx.crosshair.x = Math.max(0, Math.min(WIDTH, (e.clientX - r.left) / r.width * WIDTH));
  rx.crosshair.y = Math.max(0, Math.min(HEIGHT, (e.clientY - r.top) / r.height * HEIGHT));
}
canvas.addEventListener("mousemove", rxMouse);
canvas.addEventListener("mousedown", (e) => { if (e.button === 0) { rx.firing = true; rxMouse(e); } });
window.addEventListener("mouseup", (e) => { if (e.button === 0) rx.firing = false; });
canvas.addEventListener("contextmenu", (e) => { if (gameMode === "remix") e.preventDefault(); });
