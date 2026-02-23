(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Load custom title font
  const titleFont = new FontFace('Antique33', 'url(assets/Antique33.woff)');
  titleFont.load().then(f => document.fonts.add(f)).catch(() => {});

  // Load balloon SVG
  const balloonImg = new Image();
  balloonImg.src = 'assets/balloon.svg';
  let balloonLoaded = false;
  balloonImg.onload = () => { balloonLoaded = true; };

  // Load achievements icon SVG
  const achIconImg = new Image();
  achIconImg.src = 'assets/Acheivements.svg';
  let achIconLoaded = false;
  achIconImg.onload = () => { achIconLoaded = true; };

  // Load leaderboard icon SVG
  const lbIconImg = new Image();
  lbIconImg.src = 'assets/Leaderboard.svg';
  let lbIconLoaded = false;
  lbIconImg.onload = () => { lbIconLoaded = true; };

  // Load medal icon SVG
  const medalImg = new Image();
  medalImg.src = 'assets/medal.svg';
  let medalLoaded = false;
  medalImg.onload = () => { medalLoaded = true; };


  const perchedBirdImg = new Image();
  perchedBirdImg.src = 'assets/perched-bird.svg';
  let perchedBirdLoaded = false;
  perchedBirdImg.onload = () => { perchedBirdLoaded = true; };


  let W, H;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  // =========================================================
  //  CONFIG
  // =========================================================
  const LIFT_ACCEL = -0.52;
  const GRAVITY = 0.39;
  const MAX_RISE = -5.5;
  const MAX_FALL = 7.5;
  const BASE_SPEED = 14;
  const MAX_SPEED = 30;
  const SPEED_INCREASE = 0.00035;
  const POLE_WIDTH = 10;
  const WIRE_SAG_BASE = 0.06;
  const WIRE_TOP_OFFSET = 10;
  const MIN_POLE_H = 316;
  const MAX_POLE_H_RATIO = 0.45;
  const MAX_POLE_DELTA = 80;
  const HIT_R = 25;
  const BIRD_SCALE = 1.69;
  const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

  /* BIRD FLAP MODE (preserved for revert):
     const FLAP_STRENGTH = -6.2;
     const GRAVITY_BIRD = 0.28;
     const MAX_FALL_BIRD = 10;
     function flapBird() {
       if (!bird.alive) return;
       bird.vy = FLAP_STRENGTH;
       bird.flapTimer = 14;
     }
     In update: bird.vy = Math.min(bird.vy + GRAVITY_BIRD * dt, MAX_FALL_BIRD); (always)
     Input: call flapBird() on Space/click instead of setting inputHeld
  */

  function getPoleSpacing() { return Math.max(1400, W * 1.6); }

  // =========================================================
  //  SKY PHASES (6 phases: sunset → dusk → night → late night → pre-dawn → dawn)
  // =========================================================
  const SKY_STOPS = [0, 0.15, 0.35, 0.50, 0.65, 0.82, 1.0];
  const SKY = [
    { c: [[30,100,100],[45,130,112],[200,155,75],[232,128,48],[242,78,38],[218,38,28],[55,18,22]] },  // sunset
    { c: [[18,45,78],[38,48,88],[118,58,78],[178,68,55],[198,78,38],[175,38,38],[38,14,18]] },        // dusk
    { c: [[28,22,62],[38,28,72],[75,38,72],[110,48,58],[130,45,50],[95,30,42],[32,16,28]] },          // deep dusk
    { c: [[22,28,65],[35,32,75],[68,42,78],[95,52,65],[115,50,55],[82,35,48],[28,18,32]] },           // late dusk
    { c: [[14,18,52],[32,22,68],[128,48,88],[198,78,78],[218,118,68],[228,168,78],[95,58,38]] },      // pre-dawn
    { c: [[58,55,118],[98,78,128],[195,118,108],[228,158,98],[238,178,68],[238,198,98],[115,78,48]] }, // dawn
  ];
  const PHASE_DUR = 2400;
  const DARK_MAP = [0, 0.3, 0.55, 0.5, 0.3, 0];

  // =========================================================
  //  UTILITY
  // =========================================================
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpC(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function rgb(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // sample sky background color at a given Y (0..H) → [r, g, b]
  function getSkyColorAt(y) {
    const phase = (skyFrame / PHASE_DUR) % SKY.length;
    const idx = phase | 0, t = phase - idx, st = t * t * (3 - 2 * t);
    const a = SKY[idx], b = SKY[(idx + 1) % SKY.length];
    const norm = clamp(y / H, 0, 1);
    // find which gradient stops we're between
    let si = 0;
    for (let i = 1; i < SKY_STOPS.length; i++) {
      if (norm <= SKY_STOPS[i]) { si = i - 1; break; }
    }
    const s0 = SKY_STOPS[si], s1 = SKY_STOPS[si + 1];
    const st2 = (norm - s0) / (s1 - s0);
    const c0 = lerpC(a.c[si], b.c[si], st);
    const c1 = lerpC(a.c[si + 1], b.c[si + 1], st);
    return lerpC(c0, c1, st2);
  }

  // get luminance (0-255) of an RGB color
  function luminance(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

  // adjust a color [r,g,b] to always contrast strongly against bg [r,g,b]
  function contrastColor(baseR, baseG, baseB, bgR, bgG, bgB) {
    const bgLum = luminance(bgR, bgG, bgB);
    // dark background → push toward white
    if (bgLum < 80) {
      const t = bgLum / 80; // 0 = very dark, 1 = threshold
      const r = baseR + (255 - baseR) * (1 - t) * 0.7;
      const g = baseG + (255 - baseG) * (1 - t) * 0.7;
      const b = baseB + (255 - baseB) * (1 - t) * 0.7;
      return `rgb(${clamp(r, 0, 255) | 0},${clamp(g, 0, 255) | 0},${clamp(b, 0, 255) | 0})`;
    }
    // bright background → darken aggressively
    if (bgLum > 140) {
      const t = (bgLum - 140) / 115; // 0 = threshold, 1 = white
      const factor = Math.max(0.2, 1 - t * 0.8);
      return `rgb(${(baseR * factor) | 0},${(baseG * factor) | 0},${(baseB * factor) | 0})`;
    }
    // mid-range — ensure minimum contrast by checking per-channel closeness
    const dr = Math.abs(baseR - bgR), dg = Math.abs(baseG - bgG), db = Math.abs(baseB - bgB);
    const totalDiff = dr + dg + db;
    if (totalDiff < 180) {
      // too similar — shift away from bg
      const r = bgLum > 110 ? Math.max(0, baseR - 80) : Math.min(255, baseR + 80);
      const g = bgLum > 110 ? Math.max(0, baseG - 80) : Math.min(255, baseG + 80);
      const b = bgLum > 110 ? Math.max(0, baseB - 80) : Math.min(255, baseB + 80);
      return `rgb(${r | 0},${g | 0},${b | 0})`;
    }
    return `rgb(${baseR | 0},${baseG | 0},${baseB | 0})`;
  }

  function getDarkness() {
    const phase = (skyFrame / PHASE_DUR) % SKY.length;
    const idx = phase | 0, t = phase - idx;
    const st = t * t * (3 - 2 * t);
    return lerp(DARK_MAP[idx], DARK_MAP[(idx + 1) % SKY.length], st);
  }

  // circle vs line-segment collision
  function circleSegment(cx, cy, cr, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return (cx - x1) * (cx - x1) + (cy - y1) * (cy - y1) < cr * cr;
    let t = ((cx - x1) * dx + (cy - y1) * dy) / lenSq;
    t = clamp(t, 0, 1);
    const nearX = x1 + t * dx, nearY = y1 + t * dy;
    const distSq = (cx - nearX) * (cx - nearX) + (cy - nearY) * (cy - nearY);
    return distSq < cr * cr;
  }

  // kite string points (angled + undulating)
  function getKiteStringPts(ox, startY, phase, angle) {
    const pts = [{ x: ox, y: startY }];
    const numSegs = 14;
    const totalLen = H - startY;
    const drift = -Math.sin(angle) * totalLen; // string trails left (holder is downwind-left)
    for (let i = 1; i <= numSegs; i++) {
      const t = i / numSegs;
      const y = startY + t * totalLen;
      const baseX = ox + t * drift;
      const amp = t * t * 10;
      const x = baseX + Math.sin(t * Math.PI * 3 + phase) * amp;
      pts.push({ x, y });
    }
    return pts;
  }

  // =========================================================
  //  STATE
  // =========================================================
  const STATE = { HOME: 0, PLAY: 1, PAUSE: 2, DEAD: 3, LEADERBOARD: 4, ACHIEVEMENTS: 5 };
  let state = STATE.HOME;
  let speed, distance, highDist = +localStorage.getItem('nf_hi') || 0;
  let rawScores = JSON.parse(localStorage.getItem('nf_scores') || '[]');
  // migrate: old format was number[], new format is {name,dist}[]
  let scores = rawScores.map(s => typeof s === 'number' ? { name: 'Pilot', dist: s } : s);

  // =========================================================
  //  ACHIEVEMENTS
  // =========================================================
  const ACHIEVEMENTS = [
    { id: 'first_flight',    name: 'First Flight',    desc: 'Travel 100 m in one run',           icon: 'rocket' },
    { id: 'sky_wanderer',    name: 'Sky Wanderer',    desc: 'Travel 500 m without stopping',    icon: 'compass' },
    { id: 'mile_high',       name: 'Mile High',       desc: 'Travel 1 km in a single flight',   icon: 'mountain' },
    { id: 'marathon',        name: 'Marathon',         desc: 'Travel 5 km across the sky',       icon: 'map' },
    { id: 'into_sunset',     name: 'Into the Sunset', desc: 'Travel 10 km into the horizon',    icon: 'navigation' },
    { id: 'point_collector', name: 'Point Collector',  desc: 'Score 100 pts in one run',         icon: 'star' },
    { id: 'high_roller',     name: 'High Roller',      desc: 'Score 500 pts in a single flight', icon: 'gem' },
    { id: 'thousand_club',   name: 'Thousand Club',    desc: 'Score 1,000 pts or more',          icon: 'crown' },
    { id: 'bullseye',        name: 'Bullseye',         desc: 'Fly through 50 hoops total',       icon: 'target' },
    { id: 'hoop_streak',     name: 'Hoop Streak',      desc: 'Hit 15 hoops in a row',            icon: 'flame' },
    { id: 'golden_touch',    name: 'Golden Touch',     desc: 'Nail 10 small hoops in a row',     icon: 'sparkles' },
    { id: 'big_scorer',      name: 'Big Scorer',       desc: 'Score 2,500 pts in one run',       icon: 'x' },
    { id: 'acrobat',         name: 'Acrobat',          desc: 'Pull off 5 barrel rolls in one run', icon: 'shield' },
    { id: 'double_trouble',  name: 'Double Trouble',   desc: 'Grab both powerups at once',       icon: 'stars' },
    { id: 'night_owl',       name: 'Night Owl',        desc: 'Survive long enough to see night', icon: 'moon' },
    { id: 'dawn_patrol',     name: 'Dawn Patrol',      desc: 'Survive all the way to dawn',      icon: 'sunrise' },
    { id: 'close_call',      name: 'Close Call',       desc: 'Near-miss an obstacle and survive', icon: 'alert-triangle' },
    { id: 'wire_walker',     name: 'Wire Walker',      desc: 'Skim a wire dangerously close',    icon: 'zap' },
    { id: 'persistence',     name: 'Persistence',      desc: 'Play 10 runs and keep going',      icon: 'hourglass' },
    { id: 'centurion',       name: 'Centurion',        desc: 'Play 100 runs like a true rider',  icon: 'award' },
  ];
  let unlockedAch = JSON.parse(localStorage.getItem('nf_achievements') || '{}');
  let runCount = +localStorage.getItem('nf_run_count') || 0;
  let toastQueue = [];
  let activeToast = null; // { id, name, icon, timer, slideIn }
  let hoopsThisRun = 0;
  let hoopStreak = 0;
  let goldStreak = 0;
  let lastHoopX = 0; // track missed hoops
  let lastHoopTime = 0;
  let rapidHoopStreak = 0;
  let barrelRollsThisRun = 0;
  let nextFormationId = 1;
  const formationHits = {}; // formationId → count of collected hoops
  let nearMissTimer = 0;  // counts down from 120 (2s); if survives, unlock
  let nearMissId = null;  // 'close_call' or 'wire_walker'
  let nightReached = false;
  let dawnReached = false;
  let medalHoverT = 0; // smooth hover transition for achievements icon (0→1)
  let backHoverT = 0;  // smooth hover transition for back button (0→1)
  let achTransition = 0; // 0 = no transition, counts up to 1
  let achTransDir = 0;   // 1 = opening achievements, -1 = closing back to home
  let lbHoverT = 0;    // smooth hover transition for leaderboard icon (0→1)
  let titleHoverT = 0; // smooth hover transition for title (0→1)
  let zenMode = false; // zen mode — no death, fly forever
  let zenT = 0; // smooth transition for zen toggle (0→1)
  let barrelRolling = false;
  let barrelRollTimer = 0;
  const BARREL_ROLL_DUR = 36; // 0.6s at 60fps
  let barrelRollBoost = 0; // smooth speed boost decay (1→0)
  let rollCharges = 0;        // stored barrel roll charges (max 3)
  let rollPowerups = [];       // world instances
  let rollCooldown = 900;      // spawn cooldown
  let rollTutorialShown = !!localStorage.getItem('nf_rollTutorial');
  let rollTutorialActive = false;
  let rollTutorialDelay = 0; // countdown before tutorial pause activates


  function unlockAchievement(id) {
    if (zenMode) return;
    if (unlockedAch[id]) return;
    unlockedAch[id] = { time: Date.now() };
    localStorage.setItem('nf_achievements', JSON.stringify(unlockedAch));
    const ach = ACHIEVEMENTS.find(a => a.id === id);
    if (ach) toastQueue.push({ id, name: ach.name, icon: ach.icon });
  }

  // ---- Lucide icon loading ----
  const lucideImgs = {};
  const _lucideCvs = document.createElement('canvas');
  const _lucideCtx = _lucideCvs.getContext('2d');

  // Build unique icon set from ACHIEVEMENTS + UI icons
  const lucideIconNames = [...new Set(ACHIEVEMENTS.map(a => a.icon)), 'volume-2', 'volume-x'];
  for (const name of lucideIconNames) {
    lucideImgs[name] = { img: null, loaded: false };
    fetch(`https://unpkg.com/lucide-static/icons/${name}.svg`)
      .then(r => r.text())
      .then(svgText => {
        // replace currentColor with black so it renders in <img>
        const fixed = svgText.replace(/currentColor/g, '#000');
        const blob = new Blob([fixed], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { lucideImgs[name].img = img; lucideImgs[name].loaded = true; };
        img.src = url;
      });
  }

  const ACH_HOVER_COLOR = '#ffdd44';

  function drawAchievementIcon(iconType, cx, cy, size, unlocked, tintColor) {
    const entry = lucideImgs[iconType];
    if (!entry || !entry.loaded) return;
    ctx.save();
    if (!unlocked) ctx.globalAlpha *= 0.6;
    const color = tintColor || '#ffffff';
    // tint via offscreen canvas at DPR resolution for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    const s = Math.ceil(size * dpr);
    _lucideCvs.width = s;
    _lucideCvs.height = s;
    _lucideCtx.clearRect(0, 0, s, s);
    _lucideCtx.drawImage(entry.img, 0, 0, s, s);
    _lucideCtx.globalCompositeOperation = 'source-in';
    _lucideCtx.fillStyle = color;
    _lucideCtx.fillRect(0, 0, s, s);
    _lucideCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(_lucideCvs, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
  }
  let skyFrame, frameCount;
  let freezeTimer, shakeTimer, shakeX, shakeY;
  let displayDist = 0;
  let musicOn = true;
  // const TRACKS = ['music.m4a', 'music2.mp3', 'music3.mp3', 'music4.mp3', 'music5.mp3'];
  // let currentTrack = 0;
  let skylineOffset = 0;
  let inputHeld = false;
  let wingState = 0.8; // smoothed wing position (lerps between -3.5 and 0.8)
  let homePhase = 0; // 0 = title, 1 = instructions
  let homePhaseTimer = 0; // for fade transitions
  let titleFadeOut = 0; // countdown for title fade-out when leaving phase 0
  let perchTimer = 0;
  let perchHeadAngle = 0;
  let launchTimer = 0; // 0 = not launching, counts up to ~180 (3 seconds)
  const LAUNCH_DUR = 180;
  let launchGrace = 0; // collision immunity after takeoff

  // ---- ambient audio on home screen ----
  let ambientBuffer = null;
  let ambientSource = null;
  let ambientGain = null;
  let ambientLoaded = false;

  async function loadAmbientBuffers() {
    if (ambientLoaded) return;
    const ac = getSfx();
    try {
      const resp = await fetch('assets/bird-sounds.mp3');
      if (!resp.ok) return;
      const buf = await resp.arrayBuffer();
      ambientBuffer = await ac.decodeAudioData(buf);
    } catch (_) { /* file not found — skip silently */ }
    ambientLoaded = true;
  }

  function startAmbientSounds() {
    if (!musicOn || !ambientBuffer) return;
    // already playing — just restore home-screen volume
    if (ambientSource) {
      if (ambientGain) {
        const ac = getSfx();
        ambientGain.gain.cancelScheduledValues(ac.currentTime);
        ambientGain.gain.setValueAtTime(ambientGain.gain.value, ac.currentTime);
        ambientGain.gain.linearRampToValueAtTime(0.09, ac.currentTime + 1.5);
      }
      return;
    }
    const ac = getSfx();
    ambientSource = ac.createBufferSource();
    ambientGain = ac.createGain();
    ambientSource.buffer = ambientBuffer;
    ambientSource.loop = true;
    // filter chain: highpass (cut rumble) → lowpass (cut hiss) → gain
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 300;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3500;
    ambientSource.connect(hp);
    hp.connect(lp);
    lp.connect(ambientGain);
    ambientGain.connect(ac.destination);
    ambientGain.gain.setValueAtTime(0, ac.currentTime);
    ambientGain.gain.linearRampToValueAtTime(0.09, ac.currentTime + 2.5);
    ambientSource.start(0);
  }

  // ---- wind gust sound ----
  async function loadWindSound() {
    const ac = getSfx();
    try {
      const resp = await fetch('assets/wind.mp3');
      if (!resp.ok) return;
      const buf = await resp.arrayBuffer();
      windBuffer = await ac.decodeAudioData(buf);
    } catch (_) { /* file not found — skip silently */ }
  }

  function playWindGust() {
    if (!musicOn || !windBuffer) return;
    const ac = getSfx();
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    src.buffer = windBuffer;
    // slow playback to stretch duration by ~0.5s
    const dur = windBuffer.duration;
    src.playbackRate.value = dur / (dur + 0.5);
    src.connect(gain);
    gain.connect(ac.destination);
    gain.gain.setValueAtTime(0.21, ac.currentTime);
    src.start(0);
  }

  function stopAmbientSounds(fadeDuration) {
    if (!ambientSource) return;
    const ac = getSfx();
    const now = ac.currentTime;
    ambientGain.gain.cancelScheduledValues(now);
    ambientGain.gain.setValueAtTime(ambientGain.gain.value, now);
    ambientGain.gain.linearRampToValueAtTime(0.0001, now + fadeDuration);
    const src = ambientSource;
    try { src.stop(now + fadeDuration + 0.05); } catch (_) {}
    ambientSource = null;
    ambientGain = null;
  }

  // ---- ambient life on home screen ----
  let ambientBirds = [];
  let ambientTimer = 0;

  function updateAmbientLife(dt) {
    ambientTimer += dt;
    // spawn birds intermittently
    if (ambientBirds.length < 12 && Math.random() < 0.004 * dt) {
      const fromLeft = Math.random() > 0.3;
      const count = 2 + Math.floor(Math.random() * 3);
      let baseY = H * 0.02 + Math.random() * H * 0.96;
      const spd = 0.4 + Math.random() * 3.6;
      for (let i = 0; i < count; i++) {
        ambientBirds.push({
          x: fromLeft ? -20 - i * 14 : W + 20 + i * 14,
          y: baseY + (Math.random() - 0.5) * 30,
          vx: fromLeft ? spd : -spd,
          wingPhase: Math.random() * Math.PI * 2,
          size: 3.2 + Math.random() * 1.8,
        });
      }
    }
    // update birds
    for (let i = ambientBirds.length - 1; i >= 0; i--) {
      const b = ambientBirds[i];
      b.x += b.vx * dt;
      b.wingPhase += 0.15 * dt;
      if (b.x < -60 || b.x > W + 60) ambientBirds.splice(i, 1);
    }
  }

  function drawAmbientLife() {
    ctx.fillStyle = '#000';
    for (const b of ambientBirds) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.scale(b.vx > 0 ? 1 : -1, 1);
      const wingY = Math.sin(b.wingPhase) * b.size * 0.8;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-b.size, -wingY);
      ctx.moveTo(0, 0);
      ctx.lineTo(-b.size, wingY);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  const bird = { x: 0, y: 0, vy: 0, rot: 0, flapTimer: 0, alive: true };
  let poles = [];
  let obstacles = [];
  let obsCooldown = 0;
  let lastObsType = '';

  // ---- hoops (collectible rings) ----
  let points = 0;
  let hoops = [];
  let hoopCooldown = 0;

  // ---- multiplier powerup ----
  let multiplier = 1;
  let multiplierTimer = 0;
  let powerups = [];
  let powerupCooldown = 0;

  // ---- invincibility powerup ----
  let invincible = false;
  let invincibleTimer = 0;
  const INVINCIBLE_DUR = 600; // ~10 seconds at 60fps
  let shieldPowerups = [];
  let shieldCooldown = 0;
  let sparkles = []; // white sparkle particles on tail

  // ---- wind gust speed boost ----
  let gustKm = 0;          // last km milestone crossed
  let gustTimer = 0;       // visual effect countdown
  let gustStreaks = [];     // horizontal wind streak particles
  let gustSpeedMult = 1;   // cumulative speed multiplier (doubles each km)
  let windBuffer = null;   // decoded AudioBuffer for wind.mp3

  // ---- wind trail ----
  const TRAIL_LEN = 60;
  let trail = [];

  // ---- particles (collection effects) ----
  let particles = [];
  let pointPopups = []; // floating "+50" text above collected hoops
  function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const spd = 1.5 + Math.random() * 3;
      particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 18 + Math.random() * 12,
        maxLife: 30,
        color,
        size: 1.5 + Math.random() * 2,
      });
    }
  }

  // ---- lightning (standalone, no rain) ----
  let lightningFlash = 0;
  let lightningBolt = [];
  let lightningTimer = 400 + Math.random() * 800;

  // ---- stars ----
  let stars = [];
  function generateStars() {
    stars = [];
    for (let i = 0; i < 160; i++)
      stars.push({ x: Math.random(), y: Math.random() * 0.6, r: Math.random() * 1.5 + 0.5, flicker: Math.random() * Math.PI * 2 });
  }
  generateStars();

  // ---- large amorphous clouds (2-4 always visible) ----
  let clouds = [];
  function generateClouds() {
    clouds = [];
    const count = 3 + Math.floor(Math.random() * 2); // 3-4 clouds
    const totalSpan = W * 2;
    for (let i = 0; i < count; i++) {
      const numNodes = 10 + Math.floor(Math.random() * 4);
      const nodes = [];
      for (let k = 0; k < numNodes; k++) {
        nodes.push({
          a: (k / numNodes) * Math.PI * 2 + (Math.random() - 0.5) * 0.25,
          r: 0.5 + Math.random() * 0.8,
        });
      }
      clouds.push({
        x: (i / count) * totalSpan + Math.random() * (totalSpan / count),
        y: H * (0.65 + Math.random() * 0.16),
        rx: 250 + Math.random() * 300,
        ry: 18 + Math.random() * 20,
        nodes,
      });
    }
  }

  // =========================================================
  //  STREAMING SKYLINE (city only)
  // =========================================================
  let skylineFar = [];
  let skylineNear = [];
  let skylineFarEdge = 0;
  let skylineNearEdge = 0;
  const SKYLINE_FAR_SPEED = 0.15;
  const SKYLINE_NEAR_SPEED = 0.3;

  const BIOME_CYCLE = 4000; // total cycle length in meters
  function getCurrentBiome() {
    const pos = distance % BIOME_CYCLE;
    if (pos < 1000) return 'city';
    if (pos < 2000) return 'mountains';
    if (pos < 3000) return 'desert';
    return 'volcanic';
  }

  function makeWindows(w, h, cellW, cellH, chance) {
    const wins = [];
    const margin = 24;
    const cols = Math.floor((w - margin * 2) / cellW);
    const rows = Math.floor((h - margin * 2) / cellH);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (Math.random() < chance) {
          wins.push({
            cx: margin + Math.floor(cellW * 0.5) + c * cellW,
            cy: margin + Math.floor(cellH * 0.4) + r * cellH,
            onDark: 0.3 + Math.random() * 0.6,
          });
        }
      }
    }
    return wins;
  }

  // seeded PRNG (mulberry32) for deterministic skyline
  function mulberry32(seed) {
    return function() {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  let rng = Math.random; // swapped to seeded during initSkyline

  function spawnCityShape(arr, x, layer) {
    if (layer === 'far') {
      const w = 20 + rng() * 60;
      const h = 47 + rng() * 164;
      arr.push({
        x, w, h, type: 'building', shape: 'building', style: rng(),
        antenna: rng() < 0.25 ? 8 + rng() * 20 : 0,
        windows: null, // far layer: no lights
      });
      return x + w + rng() * 10;
    }
    const w = 30 + rng() * 80;
    const h = (60 + rng() * 180) * 0.8;
    arr.push({
      x, w, h, type: 'building', shape: 'building', style: rng(),
      antenna: rng() < 0.2 ? 10 + rng() * 25 : 0,
      waterTower: w > 45 && h > 80 && rng() < 0.08,
      windows: makeWindows(w, h, 10, 14, 0.3),
    });
    return x + w + rng() * 8;
  }

  function spawnMountainShape(arr, x, layer) {
    if (layer === 'far') {
      const w = 250 + Math.random() * 300;
      const h = 156 + Math.random() * 234;
      const peakOffset = 0.35 + Math.random() * 0.3;
      arr.push({
        x, w, h, type: 'mountain', peakOffset,
        ridge: Math.random() < 0.5 ? {
          offset: 0.1 + Math.random() * 0.3,
          height: 0.5 + Math.random() * 0.35,
        } : null,
      });
      return x + w * (0.3 + Math.random() * 0.2);
    }
    const w = 15 + Math.random() * 30;
    const h = 30 + Math.random() * 60;
    arr.push({
      x, w, h, type: 'tree',
      treeType: Math.random(),
      trunkH: 5 + Math.random() * 10,
    });
    return x + w * (0.3 + Math.random() * 0.4);
  }

  function spawnDesertShape(arr, x, layer) {
    if (layer === 'far') {
      const w = 200 + Math.random() * 300;
      const h = 195 + Math.random() * 195;
      arr.push({
        x, w, h, type: 'dune',
        cp1: 0.2 + Math.random() * 0.15,
        cp2: 0.6 + Math.random() * 0.15,
        rise1: 0.7 + Math.random() * 0.3,
        rise2: 0.5 + Math.random() * 0.5,
      });
      // heavy overlap so dunes merge into each other
      return x + w * (0.25 + Math.random() * 0.15);
    }
    const w = 15 + Math.random() * 25;
    const h = 40 + Math.random() * 80;
    const trunkW = 4 + Math.random() * 4;
    const arms = [];
    if (Math.random() < 0.7) arms.push({
      side: -1, y: 0.3 + Math.random() * 0.3, len: 0.2 + Math.random() * 0.3,
    });
    if (Math.random() < 0.7) arms.push({
      side: 1, y: 0.3 + Math.random() * 0.3, len: 0.2 + Math.random() * 0.3,
    });
    arr.push({ x, w, h, type: 'cactus', arms, trunkW });
    return x + 100 + Math.random() * 140;
  }

  function spawnVolcanicShape(arr, x, layer) {
    if (layer === 'far') {
      const isVolcano = Math.random() < 0.15;
      const w = isVolcano ? 200 + Math.random() * 150 : 60 + Math.random() * 120;
      const h = isVolcano ? 195 + Math.random() * 195 : 78 + Math.random() * 156;
      arr.push({
        x, w, h, type: 'volcano', isVolcano,
        craterW: isVolcano ? 0.15 + Math.random() * 0.15 : 0,
        peakOffset: 0.4 + Math.random() * 0.2,
      });
      return x + w * (0.5 + Math.random() * 0.3);
    }
    const ruinType = Math.random();
    const w = 20 + Math.random() * 50;
    const h = 30 + Math.random() * 70;
    arr.push({
      x, w, h, type: 'ruin', ruinType,
      breakHeight: 0.4 + Math.random() * 0.5,
      columns: ruinType < 0.33 ? Math.floor(1 + Math.random() * 3) : 0,
      hasArch: ruinType >= 0.33 && ruinType < 0.66 && Math.random() < 0.3,
    });
    return x + w + Math.random() * 20;
  }

  function spawnSkylineShape(arr, x, layer) {
    const biome = getCurrentBiome();
    switch (biome) {
      case 'mountains': return spawnMountainShape(arr, x, layer);
      case 'desert':    return spawnDesertShape(arr, x, layer);
      case 'volcanic':  return spawnVolcanicShape(arr, x, layer);
      default:          return spawnCityShape(arr, x, layer);
    }
  }

  function initSkyline() {
    skylineFar = [];
    skylineNear = [];
    skylineFarEdge = -50;
    skylineNearEdge = -50;
    rng = mulberry32(42);
    while (skylineFarEdge < W + 300) {
      skylineFarEdge = spawnSkylineShape(skylineFar, skylineFarEdge, 'far');
    }
    while (skylineNearEdge < W + 300) {
      skylineNearEdge = spawnSkylineShape(skylineNear, skylineNearEdge, 'near');
    }
    rng = Math.random;
  }

  function updateSkylineStream(scrollSpeed, dt) {
    const farDx = scrollSpeed * SKYLINE_FAR_SPEED * dt;
    const nearDx = scrollSpeed * SKYLINE_NEAR_SPEED * dt;

    for (const b of skylineFar) b.x -= farDx;
    for (const b of skylineNear) b.x -= nearDx;
    skylineFarEdge -= farDx;
    skylineNearEdge -= nearDx;

    while (skylineFar.length && skylineFar[0].x + (skylineFar[0].w || 60) < -300) skylineFar.shift();
    while (skylineNear.length && skylineNear[0].x + (skylineNear[0].w || 60) < -300) skylineNear.shift();

    while (skylineFarEdge < W + 300) {
      skylineFarEdge = spawnSkylineShape(skylineFar, skylineFarEdge, 'far');
    }
    while (skylineNearEdge < W + 300) {
      skylineNearEdge = spawnSkylineShape(skylineNear, skylineNearEdge, 'near');
    }
  }

  // =========================================================
  //  AUDIO
  // =========================================================
  let audioStarted = false;
  let bgMusic = null;
  let sfxCtx = null;
  function getSfx() {
    if (!sfxCtx) sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
    return sfxCtx;
  }

  let hoopFlourishTimer = null;
  let hoopFlourishStreak = 0;

  function playHoopFlourish() {
    if (!musicOn) return;
    const ac = getSfx();
    const t = ac.currentTime;
    // Cmaj9 resolve — warm, sparkly
    [523, 659, 784, 988, 1175].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain); gain.connect(ac.destination);
      osc.type = 'sine';
      const st = t + i * 0.06;
      osc.frequency.setValueAtTime(freq, st);
      gain.gain.setValueAtTime(0.05, st);
      gain.gain.linearRampToValueAtTime(0.07, st + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, st + 0.6);
      osc.start(st); osc.stop(st + 0.65);
    });
  }

  function playHoopSound(pts, rapid) {
    if (!musicOn) return;
    const ac = getSfx();
    const t = ac.currentTime;
    if (rapid > 1) {
      // ascending chord tones — Cmaj7 voicing (C E G B D)
      const chord = [262, 330, 392, 494, 587, 659, 784, 880, 988, 1047, 1175, 1319];
      const idx = Math.min(rapid, chord.length - 1);
      const root = chord[idx];
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain); gain.connect(ac.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(root, t);
      gain.gain.setValueAtTime(0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.start(t); osc.stop(t + 0.55);
      // soft fifth harmonic for warmth
      const h1 = ac.createOscillator();
      const h1g = ac.createGain();
      h1.connect(h1g); h1g.connect(ac.destination);
      h1.type = 'sine';
      h1.frequency.setValueAtTime(root * 1.5, t);
      h1g.gain.setValueAtTime(0.025, t);
      h1g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      h1.start(t); h1.stop(t + 0.4);
      // flourish is now triggered by formation completion, not rapid streak
    } else {
      // default hoop sound — ascending major triad
      const root = pts >= 50 ? 330 : pts >= 25 ? 312 : 294;
      [root, root * 1.25, root * 1.5].forEach((freq, i) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain); gain.connect(ac.destination);
        osc.type = 'sine';
        const st = t + i * 0.06;
        osc.frequency.setValueAtTime(freq, st);
        gain.gain.setValueAtTime(0.06, st);
        gain.gain.linearRampToValueAtTime(0.08, st + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, st + 0.3);
        osc.start(st); osc.stop(st + 0.35);
      });
    }
  }

  function playUIClick() {
    if (!musicOn) return;
    const ac = getSfx();
    const t = ac.currentTime;
    // warm soft "pop" — two sine tones a fifth apart
    const osc1 = ac.createOscillator();
    const g1 = ac.createGain();
    osc1.connect(g1); g1.connect(ac.destination);
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(440, t);
    g1.gain.setValueAtTime(0.036, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc1.start(t); osc1.stop(t + 0.15);

    const osc2 = ac.createOscillator();
    const g2 = ac.createGain();
    osc2.connect(g2); g2.connect(ac.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(660, t + 0.02);
    g2.gain.setValueAtTime(0.024, t + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc2.start(t + 0.02); osc2.stop(t + 0.18);
  }

  function playStartGliss() {
    if (!musicOn) return;
    const ac = getSfx();
    const t = ac.currentTime;
    // Part 1: ascending C major arpeggio that hangs on the dominant — tension
    const notes = [523, 659, 784]; // C5 E5 G5 — ends unresolved on the 5th
    const step = 0.04;
    for (let i = 0; i < notes.length; i++) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.connect(g); g.connect(ac.destination);
      osc.type = 'sine';
      const start = t + i * step;
      osc.frequency.setValueAtTime(notes[i], start);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.033 - i * 0.0048, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
      osc.start(start);
      osc.stop(start + 0.17);
    }
  }

  function playLaunchGliss() {
    if (!musicOn) return;
    const ac = getSfx();
    const t = ac.currentTime;
    // Part 2: picks up from the dominant and resolves to the octave — release
    const notes = [784, 880, 1047]; // G5 A5 C6 — resolves up to tonic
    const step = 0.035;
    for (let i = 0; i < notes.length; i++) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.connect(g); g.connect(ac.destination);
      osc.type = 'sine';
      const start = t + i * step;
      osc.frequency.setValueAtTime(notes[i], start);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.033 - i * 0.0048, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
      osc.start(start);
      osc.stop(start + 0.17);
    }
  }

  function playPauseGliss() {
    if (!musicOn) return;
    const ac = getSfx();
    const t = ac.currentTime;
    // descending pentatonic gliss — settling down
    const notes = [880, 784, 659, 587, 523]; // A5 G5 E5 D5 C5
    const step = 0.035;
    for (let i = 0; i < notes.length; i++) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.connect(g); g.connect(ac.destination);
      osc.type = 'sine';
      const start = t + i * step;
      osc.frequency.setValueAtTime(notes[i], start);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.033 - i * 0.0036, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
      osc.start(start);
      osc.stop(start + 0.15);
    }
  }

  function playUnpauseGliss() {
    if (!musicOn) return;
    const ac = getSfx();
    const t = ac.currentTime;
    // ascending pentatonic gliss — lifting back up
    const notes = [523, 587, 659, 784, 880]; // C5 D5 E5 G5 A5
    const step = 0.035;
    for (let i = 0; i < notes.length; i++) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.connect(g); g.connect(ac.destination);
      osc.type = 'sine';
      const start = t + i * step;
      osc.frequency.setValueAtTime(notes[i], start);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.033 - i * 0.0036, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
      osc.start(start);
      osc.stop(start + 0.15);
    }
  }

  function playZenToggle() {
    if (!musicOn) return;
    const ac = getSfx();
    const t = ac.currentTime;
    // softer, lower pop — two tones a major third apart
    const osc1 = ac.createOscillator();
    const g1 = ac.createGain();
    osc1.connect(g1); g1.connect(ac.destination);
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(330, t);
    g1.gain.setValueAtTime(0.03, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc1.start(t); osc1.stop(t + 0.17);

    const osc2 = ac.createOscillator();
    const g2 = ac.createGain();
    osc2.connect(g2); g2.connect(ac.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(415, t + 0.03);
    g2.gain.setValueAtTime(0.021, t + 0.03);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc2.start(t + 0.03); osc2.stop(t + 0.19);
  }

  function playMultiplierSound() {
    if (!musicOn) return;
    const ac = getSfx();
    [262, 330, 392, 440].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain); gain.connect(ac.destination);
      osc.type = 'sine';
      const t = ac.currentTime + i * 0.09;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.linearRampToValueAtTime(freq * 1.02, t + 0.15);
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t); osc.stop(t + 0.45);
    });
  }

  function playInvincibleSound() {
    if (!musicOn) return;
    const ac = getSfx();
    // shimmering ascending arpeggio
    [392, 494, 587, 784].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain); gain.connect(ac.destination);
      osc.type = 'sine';
      const t = ac.currentTime + i * 0.07;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.linearRampToValueAtTime(0.09, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.start(t); osc.stop(t + 0.55);
    });
  }

  function playBarrelRollSound() {
    if (!musicOn) return;
    const ac = getSfx();
    const t = ac.currentTime;
    // soft, dreamy whoosh — low frequencies, long tail, reverb-like
    // 1) warm low sweep — the body
    const o1 = ac.createOscillator();
    const g1 = ac.createGain();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(120, t);
    o1.frequency.exponentialRampToValueAtTime(220, t + 0.8);
    o1.frequency.exponentialRampToValueAtTime(160, t + 1.3);
    g1.gain.setValueAtTime(0.06, t);
    g1.gain.linearRampToValueAtTime(0.08, t + 0.15);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    o1.connect(g1); g1.connect(ac.destination);
    o1.start(t); o1.stop(t + 1.55);
    // 2) soft filtered noise — airy wash
    const buf = ac.createBuffer(1, ac.sampleRate * 1.7, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = buf;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.linearRampToValueAtTime(600, t + 0.2);
    lp.frequency.exponentialRampToValueAtTime(200, t + 1.4);
    lp.Q.value = 1;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.04, t);
    ng.gain.linearRampToValueAtTime(0.06, t + 0.15);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    noise.connect(lp); lp.connect(ng); ng.connect(ac.destination);
    noise.start(t); noise.stop(t + 1.6);
    // 3) shimmer overtone — gentle fifth that fades in then out
    const o2 = ac.createOscillator();
    const g2 = ac.createGain();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(330, t + 0.1);
    o2.frequency.exponentialRampToValueAtTime(247, t + 1.3);
    g2.gain.setValueAtTime(0.001, t);
    g2.gain.linearRampToValueAtTime(0.035, t + 0.25);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    o2.connect(g2); g2.connect(ac.destination);
    o2.start(t); o2.stop(t + 1.45);
    // 4) sub-bass thud for weight
    const o3 = ac.createOscillator();
    const g3 = ac.createGain();
    o3.type = 'sine';
    o3.frequency.value = 65;
    g3.gain.setValueAtTime(0.07, t);
    g3.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o3.connect(g3); g3.connect(ac.destination);
    o3.start(t); o3.stop(t + 0.95);
  }

  function playRollPickupSound() {
    if (!musicOn) return;
    const ac = getSfx();
    // deep rich ascending sweep (lower octave)
    [262, 330, 392, 523].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain); gain.connect(ac.destination);
      osc.type = 'triangle';
      const t = ac.currentTime + i * 0.05;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.linearRampToValueAtTime(0.1, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.start(t); osc.stop(t + 0.35);
    });
  }

  function startAudio() {
    if (audioStarted) return;
    audioStarted = true;
    getSfx(); // warm up audio context
    bgMusic = new Audio('music.m4a');
    bgMusic.loop = true;
    bgMusic.volume = 0.25;
    // don't auto-play — music starts when the run begins
  }

  /* skip track — disabled until additional tracks are added
  function skipTrack() {
    if (!bgMusic) return;
    const wasPlaying = !bgMusic.paused;
    bgMusic.pause();
    currentTrack = (currentTrack + 1) % TRACKS.length;
    bgMusic = new Audio(TRACKS[currentTrack]);
    bgMusic.loop = true;
    bgMusic.volume = 0.25;
    if (wasPlaying && musicOn) bgMusic.play().catch(() => {});
  }
  */

  function fadeMusic(duration) {
    if (!bgMusic) return;
    const startVol = bgMusic.volume;
    const step = startVol / (duration / 16);
    const fade = setInterval(() => {
      bgMusic.volume = Math.max(0, bgMusic.volume - step);
      if (bgMusic.volume <= 0) {
        clearInterval(fade);
        bgMusic.pause();
        bgMusic.volume = startVol;
      }
    }, 16);
  }

  function toggleMusic() {
    // play toggle sound before muting (so it's audible on mute)
    if (musicOn) playZenToggle();
    musicOn = !musicOn;
    if (musicOn) {
      playZenToggle();
      if (state === STATE.PLAY && bgMusic) bgMusic.play().catch(() => {});
    } else {
      if (bgMusic) bgMusic.pause();
    }
  }

  // =========================================================
  //  RESET
  // =========================================================
  function resetGame() {
    const spacing = getPoleSpacing();
    speed = BASE_SPEED; distance = 0; displayDist = 0; skyFrame = 0; frameCount = 0;
    freezeTimer = 0; shakeTimer = 0; shakeX = 0; shakeY = 0;
    skylineOffset = 0;
    inputHeld = false;

    launchTimer = 0; launchGrace = 0; launchFlyIn = false; launchFlyInTimer = 0;
    bird.x = W * 0.22; bird.y = H * 0.35; bird.vy = 0; bird.rot = 0;
    bird.flapTimer = 0; bird.alive = true;

    poles = []; obstacles = []; obsCooldown = 0; lastObsType = '';
    points = 0; hoops = []; hoopCooldown = 900;
    multiplier = 1; multiplierTimer = 0; powerups = []; powerupCooldown = 900;
    invincible = false; invincibleTimer = 0; shieldPowerups = []; shieldCooldown = 900; sparkles = [];
    barrelRolling = false; barrelRollTimer = 0; barrelRollBoost = 0;
    rollCharges = 0; rollPowerups = []; rollCooldown = 900;
    particles = []; trail = []; pointPopups = [];
    gustKm = 0; gustTimer = 0; gustStreaks = []; gustSpeedMult = 1;
    hoopsThisRun = 0; hoopStreak = 0; goldStreak = 0; lastHoopX = 0; lastHoopTime = 0; rapidHoopStreak = 0; barrelRollsThisRun = 0; nextFormationId = 1; for (const k in formationHits) delete formationHits[k];
    nearMissTimer = 0; nearMissId = null;
    nightReached = false; dawnReached = false;
    rng = mulberry32(7);
    let nextX = -POLE_WIDTH * 2, lastH = MIN_POLE_H + 104;
    while (nextX < W + spacing * 2) { lastH = spawnPole(nextX, lastH, true); nextX += spacing; }
    rng = Math.random;

    lightningFlash = 0; lightningBolt = [];
    lightningTimer = 400 + Math.random() * 800;

    homePhase = 0; homePhaseTimer = 0; titleFadeOut = 0;
    ambientBirds = []; ambientTimer = 0;
    // seed one flock from the left within the first second
    const seedY = H * 0.15 + Math.random() * H * 0.5;
    const seedSpd = 1.5 + Math.random() * 1.5;
    const seedCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < seedCount; i++) {
      ambientBirds.push({
        x: -10 - i * 14,
        y: seedY + (Math.random() - 0.5) * 25,
        vx: seedSpd,
        wingPhase: Math.random() * Math.PI * 2,
        size: 3.2 + Math.random() * 1.8,
      });
    }

    initSkyline();
    generateClouds();

    if (bgMusic) { bgMusic.pause(); bgMusic.currentTime = 0; }
  }


  let launchFlyIn = false;   // new bird flying in from left edge
  let launchFlyInTimer = 0;
  let perchBirdX = 0, perchBirdY = 0; // saved perch position during fly-in

  function setupPerch() {
    // position bird on top wire
    perchTimer = 0;
    perchHeadAngle = 0;
    perchBlinkTimer = 0;

    bird.x = 288;
    if (poles.length >= 2) {
      const p1 = poles[0], p2 = poles[1];
      const wd = WIRE_DEFS[0];
      const p1Top = H - p1.h + p1.wireOffset + WIRE_TOP_OFFSET;
      const p2Top = H - p2.h + p2.wireOffset + WIRE_TOP_OFFSET;
      const span = p2.x - p1.x;
      const perchT = clamp((bird.x - p1.x) / span, 0.02, 0.98);
      const y1 = p1Top + wd.offL, y2 = p2Top + wd.offR;
      const baseSag = span * WIRE_SAG_BASE * p2.sagMult;
      const ctrlY = Math.max(y1, y2) + baseSag * wd.sagMul;
      const wireY = (1 - perchT) * (1 - perchT) * y1 + 2 * (1 - perchT) * perchT * ctrlY + perchT * perchT * y2;
      // position so SVG bottom sits on wire
      bird.y = wireY;
    } else {
      bird.y = H * 0.35;
    }
    bird.vy = 0;
    bird.rot = 0;
    wingState = 0.8;
  }

  function launchFromPerch() {
    if (homePhaseTimer < 30) return; // don't allow instant launch after phase change
    playLaunchGliss();
    state = STATE.PLAY;
    launchTimer = 1;
    launchGrace = 300; // ~5s collision immunity (covers 4s fly-in)

    // save perch position — perched bird stays on wire during fly-in
    perchBirdX = bird.x;
    perchBirdY = bird.y;
    // new bird enters from upper-left, loops, then settles
    launchFlyIn = true;
    launchFlyInTimer = 240; // 4 seconds: 1s delay + 3s animation
    bird.x = -80;
    bird.y = H * 0.1;
    bird.vy = 0;
    bird.rot = 0.3;
    wingState = -3.0;
    if (bgMusic && musicOn) bgMusic.play().catch(() => {});
  }

  function spawnPole(x, prevH, easy) {
    const maxH = H * MAX_POLE_H_RATIO;
    const delta = easy ? MAX_POLE_DELTA * 0.4 : MAX_POLE_DELTA;
    let h = prevH + (rng() - 0.5) * 2 * delta;
    h = clamp(h, MIN_POLE_H, maxH);
    const sagMult = 0.6 + rng() * 1.0;
    const wireOffset = (rng() - 0.5) * 12;
    const perchedBirds = [];
    if (!easy && poles.length >= 1) {
      const count = Math.floor(rng() * 4);
      for (let b = 0; b < count; b++) {
        perchedBirds.push({
          t: 0.15 + rng() * 0.7,
          wireIdx: Math.floor(rng() * WIRE_DEFS.length),
          facing: rng() < 0.5 ? -1 : 1,
        });
      }
    }
    poles.push({ x, h, sagMult, wireOffset, perchedBirds });
    return h;
  }

  function spawnObstacle() {
    let r = Math.random();
    let type;
    if (r < 0.32) type = 'bird';
    else if (r < 0.52) type = 'kite';
    else if (r < 0.68) type = 'balloon';
    else if (r < 0.84) type = 'flock';
    else if (r < 0.946) type = 'paperplane';
    else type = 'bird';
    // never spawn two paper airplanes in a row
    if (type === 'paperplane' && lastObsType === 'paperplane') type = 'bird';
    lastObsType = type;

    const ob = { type, x: W + 80 };

    if (type === 'bird') {
      ob.y = 40 + Math.random() * (H * 0.55);
      ob.vx = -(3 + Math.random() * 4);
      ob.vy = (Math.random() - 0.5) * 0.3;
      ob.wingPhase = Math.random() * Math.PI * 2;
      ob.size = 24 + Math.random() * 15;
      ob.hitR = ob.size * 0.65;
      if (Math.random() < 0.3) {
        ob.sinusoidal = true;
        ob.baseY = ob.y;
        ob.sinAmp = 30 + Math.random() * 40;
        ob.sinPhase = Math.random() * Math.PI * 2;
      }
    } else if (type === 'kite') {
      ob.y = H * 0.2 + Math.random() * (H * 0.53);
      ob.baseY = ob.y;
      ob.vx = 0;
      ob.vy = 0;
      ob.phase = Math.random() * Math.PI * 2;
      ob.size = 62 + Math.random() * 34;
      ob.hitR = ob.size * 0.55;
      ob.stringPhase = Math.random() * Math.PI * 2;
    } else if (type === 'balloon') {
      ob.x = W + 200;
      ob.y = H * 0.1 + Math.random() * (H * 0.8);
      ob.vx = Math.random() * 0.5;
      ob.vy = -(0.8 + Math.random() * 0.6);
      ob.size = 362;
      ob.hitR = ob.size * 0.55;
    } else if (type === 'flock') {
      // 5 birds in V formation, V pointing left (leader at front-left)
      ob.y = 60 + Math.random() * (H * 0.4);
      ob.vx = -(2.5 + Math.random() * 2);
      ob.vy = (Math.random() - 0.5) * 0.2;
      ob.wingPhase = Math.random() * Math.PI * 2;
      ob.size = 26;
      ob.hitR = 39;
      ob.birds = [];
      for (let fi = 0; fi < 7; fi++) {
        // leader at left tip, trailing birds fan out to the right
        const side = fi === 0 ? 0 : (fi % 2 === 1 ? -1 : 1);
        const rank = fi === 0 ? 0 : Math.ceil(fi / 2);
        ob.birds.push({
          ox: rank * 70,
          oy: side * rank * 55,
          wingOffset: Math.random() * Math.PI * 2,
        });
      }
    } else if (type === 'paperplane') {
      // paper airplane — natural glide from right side at random height
      ob.x = W + 80;
      const zone = Math.random();
      if (zone < 0.33) ob.y = H * 0.05 + Math.random() * H * 0.2;       // top quarter
      else if (zone < 0.66) ob.y = H * 0.3 + Math.random() * H * 0.25;  // center
      else ob.y = H * 0.6 + Math.random() * H * 0.2;                     // bottom quarter
      ob.vx = -(1.4 + Math.random() * 0.8);
      ob.vy = (Math.random() - 0.4) * 0.3;
      ob.gravity = 0.002 + Math.random() * 0.002;
      ob.wobblePhase = Math.random() * Math.PI * 2;
      ob.wobbleFreq = 0.025 + Math.random() * 0.01;
      ob.wobbleAmp = 0.12 + Math.random() * 0.06;
      ob.size = (14 + Math.random() * 9) * 1.797;
      ob.hitR = ob.size * 0.7;
    } else if (type === 'flag') {
      // large silhouetted flag on a pole — foreground obstacle (closer to camera = bigger)
      ob.x = W + 200;
      ob.y = H;                          // pole base at ground
      ob.poleH = H * 0.7 + Math.random() * H * 0.15; // very tall pole
      ob.flagW = 180 + Math.random() * 60;  // wide flag cloth
      ob.flagH = 90 + Math.random() * 30;   // tall flag
      ob.vx = 0;
      ob.vy = 0;
      ob.phase = Math.random() * Math.PI * 2;
      ob.hitR = 0; // collision handled via flag bounds
      ob.size = ob.flagW;
    }

    obstacles.push(ob);
  }

  // =========================================================
  //  INPUT (hold to rise, release to fall)
  // =========================================================
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (rollTutorialActive) { rollTutorialActive = false; return; }
    if (e.code === 'Space') {
      e.preventDefault();
      if (state === STATE.HOME) {
        startAudio();
        if (homePhase === 0) { playStartGliss(); homePhase = 1; homePhaseTimer = 0; titleFadeOut = 30; return; }
        launchFromPerch(); inputHeld = true; return;
      }
      if (state === STATE.ACHIEVEMENTS) { playUIClick(); state = STATE.HOME; startAmbientSounds(); achTransition = 0; achTransDir = -1; return; }
      if (state === STATE.DEAD) { playUIClick(); resetGame(); setupPerch(); state = STATE.HOME; startAmbientSounds(); return; }
      if (state === STATE.PLAY) { inputHeld = true; return; }
    }
    if (e.code === 'Escape') {
      if (state === STATE.ACHIEVEMENTS) { playUIClick(); state = STATE.HOME; startAmbientSounds(); achTransition = 0; achTransDir = -1; return; }
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === STATE.PLAY) {
        playPauseGliss();
        state = STATE.PAUSE;
        inputHeld = false;
        if (bgMusic && musicOn) fadeMusic(800);
      } else if (state === STATE.PAUSE) {
        playUnpauseGliss();
        state = STATE.PLAY;
        if (bgMusic && musicOn) bgMusic.play().catch(() => {});
      }
    }
    if (e.code === 'KeyR' && state === STATE.PAUSE) {
      playUIClick(); resetGame(); setupPerch(); state = STATE.HOME; startAmbientSounds(); return;
    }
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && state === STATE.PLAY && !barrelRolling && rollCharges > 0) {
      rollCharges--;
      barrelRolling = true;
      barrelRollTimer = BARREL_ROLL_DUR;
      barrelRollBoost = 1;
      playBarrelRollSound();
      barrelRollsThisRun++;
      if (barrelRollsThisRun >= 9) unlockAchievement('acrobat');
    }
    if (e.code === 'KeyM') toggleMusic();
  });

  window.addEventListener('keyup', e => {
    if (e.code === 'Space') inputHeld = false;
  });

  let mouseX = -1, mouseY = -1;
  canvas.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
  canvas.addEventListener('mouseleave', () => { mouseX = -1; mouseY = -1; });

  canvas.addEventListener('mousedown', e => {
    const mx = e.clientX, my = e.clientY;
    if (rollTutorialActive) { rollTutorialActive = false; return; }
    if (mx > W - 56 && my > H - 48) { toggleMusic(); return; }
    // if (mx > W - 100 && mx < W - 56 && my > H - 48) { skipTrack(); return; }

    if (state === STATE.HOME) {
      startAudio();
      // Zen toggle click (bottom-center)
      if (mx > W / 2 - 40 && mx < W / 2 + 40 && my > H - 48) { playZenToggle(); zenMode = !zenMode; return; }
      // Achievements icon click (top-right) — works in both phases
      if (mx > W - 68 && my < 58) { playUIClick(); state = STATE.ACHIEVEMENTS; achTransition = 0; achTransDir = 1; return; }
      // // Leaderboard icon click (below achievements icon) — works in both phases
      // if (mx > W - 68 && my >= 58 && my < 112) { state = STATE.LEADERBOARD; return; }
      if (homePhase === 0) { playStartGliss(); homePhase = 1; homePhaseTimer = 0; titleFadeOut = 30; return; }
      // Phase 1: click launches — keep input held so bird continues rising
      launchFromPerch(); inputHeld = true; return;
    }

    if (state === STATE.ACHIEVEMENTS) {
      // back arrow button (top-left)
      if (mx < 60 && my < 60) { playUIClick(); state = STATE.HOME; startAmbientSounds(); achTransition = 0; achTransDir = -1; return; }
      return;
    }

    if (state === STATE.LEADERBOARD) {
      // back arrow button (top-left)
      if (mx < 60 && my < 60) { playUIClick(); state = STATE.HOME; startAmbientSounds(); return; }
      return;
    }

    if (state === STATE.PLAY) {
      inputHeld = true; return;
    }

    if (state === STATE.PAUSE) {
      playUnpauseGliss();
      state = STATE.PLAY;
      if (bgMusic && musicOn) bgMusic.play().catch(() => {});
      return;
    }

    if (state === STATE.DEAD) { playUIClick(); resetGame(); setupPerch(); state = STATE.HOME; startAmbientSounds(); return; }
  });



  canvas.addEventListener('mouseup', () => { inputHeld = false; });

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.touches[0];
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY }));
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    inputHeld = false;
  }, { passive: false });

  // =========================================================
  //  LIGHTNING (standalone — occasional flash, no rain)
  // =========================================================
  function updateLightning(dt) {
    if (lightningFlash > 0) lightningFlash -= dt;
    const dark = getDarkness();
    if (dark < 0.4) { lightningTimer = 400 + Math.random() * 800; return; }
    lightningTimer -= dt;
    if (lightningTimer <= 0) {
      lightningFlash = 10;
      lightningBolt = [];
      let bx = W * (0.2 + Math.random() * 0.6), by = 0;
      while (by < H * 0.6) {
        bx += (Math.random() - 0.5) * 40;
        by += 15 + Math.random() * 25;
        lightningBolt.push({ x: bx, y: by });
      }
      lightningTimer = 400 + Math.random() * 800;
    }
  }

  // =========================================================
  //  UPDATE
  // =========================================================
  function update(dt) {
    frameCount++;
    if (state !== STATE.PLAY) return;
    if (freezeTimer > 0) { freezeTimer -= dt; return; }

    if (shakeTimer > 0) {
      shakeTimer -= dt;
      shakeX = (Math.random() - 0.5) * 6 * (shakeTimer / 12);
      shakeY = (Math.random() - 0.5) * 6 * (shakeTimer / 12);
    } else { shakeX = 0; shakeY = 0; }

    const dark = getDarkness();
    skyFrame += dt * (dark > 0.4 ? 2.0 : dark < 0.1 ? 0.667 : 1.0);

    // advance launch transition
    if (launchTimer > 0 && launchTimer < LAUNCH_DUR) launchTimer += dt;
    if (launchTimer >= LAUNCH_DUR) launchTimer = LAUNCH_DUR;
    if (launchGrace > 0) launchGrace -= dt;

    speed = (BASE_SPEED + distance * SPEED_INCREASE) * gustSpeedMult;
    // ease into full speed over first 180 frames (~3s)
    const SPEED_RAMP_DUR = 180;
    if (launchTimer > 0 && launchTimer < SPEED_RAMP_DUR) {
      const p = clamp(launchTimer / SPEED_RAMP_DUR, 0, 1);
      const ease = p * p * (3 - 2 * p); // smoothstep
      speed *= 0.4 + 0.6 * ease;
    }
    skylineOffset += speed * dt;

    const targetX = W * 0.22;

    if (launchFlyIn) {
      launchFlyInTimer -= dt;
      // first 1s (60 frames): bird off-screen, world scrolls
      if (launchFlyInTimer > 180) {
        bird.x = -80;
        bird.y = H * 0.41;
        wingState += (-3.5 - wingState) * 0.06 * dt;
      } else {
        // remaining 3s: smooth arc animation
        const p = clamp(1 - launchFlyInTimer / 180, 0, 1);
        const ease = p * p * (3 - 2 * p);
        bird.x = -20 + (targetX + 20) * ease;
        bird.y = H * 0.41 + (H / 2 - H * 0.41) * ease - Math.sin(p * Math.PI) * H * 0.15;
        bird.rot = -Math.cos(p * Math.PI) * 0.25;
        const flapTarget = p < 0.55 ? -5.0 : 0.8;
        wingState += (flapTarget - wingState) * 0.1 * dt;
      }
      perchBirdX -= speed * dt;
      if (launchFlyInTimer <= 0) {
        launchFlyIn = false;
        bird.x = targetX;
        bird.y = H / 2;
        // match the arc's downward velocity for seamless transition to gravity
        bird.vy = inputHeld ? -0.5 : Math.PI * H * 0.15 / 180;
        // let rot continue naturally — don't snap
        bird.rot = clamp(bird.vy * 0.08, -0.4, 0.8);
      }
    } else {
      // normal x approach
      if (Math.abs(bird.x - targetX) > 1) {
        bird.x += (targetX - bird.x) * 0.025 * dt;
      } else {
        bird.x = targetX;
      }
      // flight physics
      if (inputHeld) {
        bird.vy += LIFT_ACCEL * dt;
        if (bird.vy < MAX_RISE) bird.vy = MAX_RISE;
      } else {
        bird.vy += GRAVITY * dt;
        if (bird.vy > MAX_FALL) bird.vy = MAX_FALL;
      }
      bird.y += bird.vy * dt;
      const targetRot = clamp(bird.vy * 0.08, -0.4, 0.8);
      bird.rot += (targetRot - bird.rot) * 0.08 * dt;
      const wTarget = inputHeld ? -5.0 : 0.8;
      wingState += (wTarget - wingState) * 0.12 * dt;
    }

    if (!launchFlyIn) {
      if (bird.y < HIT_R) { bird.y = HIT_R; bird.vy = 0; }
      if (bird.y + HIT_R >= H) { die(); bird.y = H - HIT_R; return; }
    }

    // record trail from wing tips — shift old points left
    const drift = speed * dt;
    for (const tp of trail) { tp.ux -= drift; tp.lx -= drift; }
    // wing tip positions in local coords: (-20, -4.5 + w*0.7) and (-20, 4.5 - w*0.7)
    const w = wingState;
    const tipLX = -20 * BIRD_SCALE, tipUY = (-4.5 + w * 0.7) * BIRD_SCALE, tipLY = (4.5 - w * 0.7) * BIRD_SCALE;
    const cosR = Math.cos(bird.rot), sinR = Math.sin(bird.rot);
    trail.unshift({
      ux: bird.x + tipLX * cosR - tipUY * sinR,
      uy: bird.y + tipLX * sinR + tipUY * cosR,
      lx: bird.x + tipLX * cosR - tipLY * sinR,
      ly: bird.y + tipLX * sinR + tipLY * cosR,
    });
    if (trail.length > TRAIL_LEN) trail.length = TRAIL_LEN;
    // cull off-screen points
    while (trail.length && trail[trail.length - 1].ux < -50) trail.pop();

    distance += speed * dt * 0.01;
    displayDist += (distance - displayDist) * 0.12 * dt;

    // ---- wind gust speed boost at each 1km ----
    const currentKm = Math.floor(distance / 1000);
    if (currentKm > gustKm) {
      gustKm = currentKm;
      gustSpeedMult *= 1.1;
      gustTimer = 60;
      playWindGust();
      // spawn wind streaks behind bird
      for (let i = 0; i < 20; i++) {
        gustStreaks.push({
          x: bird.x - 10 - Math.random() * 30,
          y: bird.y + (Math.random() - 0.5) * 80,
          vx: -(4 + Math.random() * 8),
          len: 30 + Math.random() * 50,
          life: 40 + Math.random() * 20,
          maxLife: 40 + Math.random() * 20,
        });
      }
    }
    // update gust streaks
    if (gustTimer > 0) gustTimer -= dt;
    for (let i = gustStreaks.length - 1; i >= 0; i--) {
      const s = gustStreaks[i];
      s.x += s.vx * dt;
      s.life -= dt;
      if (s.life <= 0 || s.x + s.len < -50) { gustStreaks.splice(i, 1); }
    }

    // poles
    const spacing = getPoleSpacing();
    for (let i = 0; i < poles.length; i++) poles[i].x -= speed * dt;
    while (poles.length > 0 && poles[0].x < -spacing) poles.shift();
    while (poles.length > 0 && poles[poles.length - 1].x < W + spacing) {
      const lp = poles[poles.length - 1];
      spawnPole(lp.x + spacing, lp.h, false);
    }

    // obstacles
    if (obsCooldown > 0) obsCooldown -= dt;
    if (obsCooldown <= 0 && distance > 50 && Math.random() < 0.018 * dt) {
      obsCooldown = 55 + Math.random() * 35;
      spawnObstacle();
    }
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const ob = obstacles[i];
      ob.x -= speed * dt;
      ob.x += ob.vx * dt;
      ob.y += ob.vy * dt;
      if (ob.type === 'bird') {
        ob.wingPhase += 0.2 * dt;
        if (ob.sinusoidal) {
          ob.sinPhase += 0.08 * dt;
          ob.y = ob.baseY + Math.sin(ob.sinPhase) * ob.sinAmp;
        }
      }
      if (ob.type === 'kite') {
        ob.phase += 0.04 * dt;
        ob.stringPhase += 0.012 * dt;
      }
      if (ob.type === 'flock') {
        ob.wingPhase += 0.18 * dt;
      }
      if (ob.type === 'paperplane') {
        // natural glide — gentle descent with increasing gravity, subtle pitch wobble
        ob.vy += ob.gravity * dt;
        ob.vy = Math.min(ob.vy, 1.8);
        const wireFloor = H - MIN_POLE_H + WIRE_TOP_OFFSET - 30;
        if (ob.y > wireFloor) {
          ob.vy -= 0.02 * dt;
          if (ob.vy > 0) ob.vy *= 0.92;
        }
        ob.y += ob.vy * dt;
        ob.wobblePhase += ob.wobbleFreq * dt;
      }
      if (ob.type === 'flag') {
        ob.phase += 0.03 * dt;
      }
      if (ob.x < -400 || ob.y < -400 || ob.y > H + 400) obstacles.splice(i, 1);
    }

    // helper: check if y is blocked by obstacles or vertically stacked with existing items
    function spawnYBlocked(y, margin) {
      if (obstacles.some(ob => ob.x > W * 0.5 && Math.abs(ob.y - y) < margin)) return true;
      if (hoops.some(h => h.x > W * 0.5 && Math.abs(h.y - y) < margin)) return true;
      if (powerups.some(p => p.x > W * 0.5 && Math.abs(p.y - y) < margin)) return true;
      if (shieldPowerups.some(p => !p.collected && p.x > W * 0.5 && Math.abs(p.y - y) < margin)) return true;
      return false;
    }

    // hoops (varied sizes — bigger = fewer points)
    if (hoopCooldown > 0) hoopCooldown -= dt;
    if (hoopCooldown <= 0 && Math.random() < 0.01 * dt) {
      // chance for a fun formation instead of a single hoop
      const formationRoll = Math.random();
      if (formationRoll < 0.12) {
        // horizontal row of 3-5 large hoops (10pt, progressively smaller)
        const count = 3 + Math.floor(Math.random() * 3);
        const hy = H * 0.15 + Math.random() * (H * 0.35);
        const spacing = 85 + Math.random() * 35;
        if (!spawnYBlocked(hy, 70)) {
          hoopCooldown = 200 + count * 40;
          const syncRot = Math.random() * Math.PI * 2;
          const fid = nextFormationId++;
          for (let fi = 0; fi < count; fi++) {
            const shrink = 1 - fi * 0.04; // each hoop ~4% smaller
            const baseR = (48 + Math.random() * 8) * shrink;
            hoops.push({
              x: W + baseR + 20 + fi * spacing, y: hy,
              radius: baseR, pts: 10,
              rot: syncRot,
              color: '#00ff88',
              collected: false, collectTimer: 0,
              formationId: fid, formationTotal: count,
            });
          }
        }
      } else if (formationRoll < 0.22) {
        // small upward arc of 3-5 tiny hoops (50pt)
        const count = 3 + Math.floor(Math.random() * 3);
        const centerY = H * 0.2 + Math.random() * (H * 0.3);
        const arcSpanX = 100 + Math.random() * 40;
        const arcHeight = 40 + Math.random() * 30;
        let blocked = false;
        for (let fi = 0; fi < count; fi++) {
          const t = fi / (count - 1);
          const ay = centerY - Math.sin(t * Math.PI) * arcHeight;
          if (spawnYBlocked(ay, 50)) { blocked = true; break; }
        }
        if (!blocked) {
          hoopCooldown = 180 + count * 30;
          const syncRot2 = Math.random() * Math.PI * 2;
          const fid = nextFormationId++;
          for (let fi = 0; fi < count; fi++) {
            const t = fi / (count - 1);
            const ax = W + 40 + fi * arcSpanX;
            const ay = centerY - Math.sin(t * Math.PI) * arcHeight;
            const baseR = (22 + Math.random() * 4) * 2.03;
            hoops.push({
              x: ax, y: ay,
              radius: baseR, pts: 50,
              rot: syncRot2,
              color: '#e8a835',
              collected: false, collectTimer: 0,
              formationId: fid, formationTotal: count,
            });
          }
        }
      } else {
        // normal single hoop
        let baseR = 22 + Math.random() * 34;
        const hy = H * 0.1 + Math.random() * (H * 0.45);
        if (!spawnYBlocked(hy, 70)) {
          hoopCooldown = 80 + Math.random() * 70;
          const pts = baseR < 30 ? 50 : baseR < 44 ? 25 : 10;
          if (pts === 10) baseR *= 1.5625;
          else if (pts === 25) baseR *= 1.3;
          else baseR *= 1.69;
          hoops.push({
            x: W + baseR + 20, y: hy,
            radius: baseR, pts,
            rot: Math.random() * Math.PI * 2,
            color: pts === 50 ? '#e8a835' : pts === 25 ? '#44bbff' : '#00ff88',
            collected: false, collectTimer: 0,
          });
        }
      }
    }

    // rare under-wire 100pt hoops (5% chance per pole pair, 2-4 hoops)
    if (poles.length >= 2) {
      const lastP1 = poles[poles.length - 2], lastP2 = poles[poles.length - 1];
      // only attempt once per new pole pair (pole just appeared at right edge)
      if (lastP2.x > W - speed * dt * 2 && lastP2.x <= W + speed * dt * 2 + 50 && Math.random() < 0.05) {
        const count = 3 + Math.floor(Math.random() * 2); // 3-4 hoops
        const span = lastP2.x - lastP1.x;
        const fid = nextFormationId++;
        for (let ui = 0; ui < count; ui++) {
          const t = (ui + 1) / (count + 1); // evenly spaced along wire
          const wireX = lastP1.x + span * t;
          // find lowest wire Y at this t
          const p1Top = H - lastP1.h + lastP1.wireOffset + WIRE_TOP_OFFSET;
          const p2Top = H - lastP2.h + lastP2.wireOffset + WIRE_TOP_OFFSET;
          const baseSag = span * WIRE_SAG_BASE * lastP2.sagMult;
          let lowestWireY = 0;
          for (let wdi = 0; wdi < WIRE_DEFS.length; wdi++) {
            const wd = WIRE_DEFS[wdi];
            const y1 = p1Top + wd.offL, y2 = p2Top + wd.offR;
            const ctrlY = Math.max(y1, y2) + baseSag * wd.sagMul;
            const wy = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * ctrlY + t * t * y2;
            if (wy > lowestWireY) lowestWireY = wy;
          }
          // place hoop below the lowest wire
          const hoopY = lowestWireY + 50 + Math.random() * 40;
          if (hoopY < H - 60) { // don't place below ground
            hoops.push({
              x: wireX, y: hoopY,
              radius: 24 + Math.random() * 4, pts: 100,
              rot: Math.random() * Math.PI * 2,
              color: '#ff44cc',
              collected: false, collectTimer: 0,
              formationId: fid, formationTotal: count,
            });
          }
        }
      }
    }

    for (let i = hoops.length - 1; i >= 0; i--) {
      const h = hoops[i];
      h.x -= speed * dt;
      h.rot += 0.025 * dt;
      if (h.collected) {
        h.collectTimer -= dt;
        if (h.collectTimer <= 0) { hoops.splice(i, 1); continue; }
      } else if (Math.abs(h.x - bird.x) < HIT_R + 18) {
        const dy = Math.abs(bird.y - h.y);
        if (dy < h.radius * 1.1) {
          h.collected = true;
          h.collectTimer = 14;
          points += h.pts * multiplier;
          spawnParticles(h.x, h.y, h.color, 12);
          hoopsThisRun++;
          hoopStreak++;
          const now = performance.now();
          if (now - lastHoopTime < 1500) rapidHoopStreak++;
          else rapidHoopStreak = 1;
          lastHoopTime = now;
          pointPopups.push({ x: h.x, y: h.y - h.radius - 5, text: '+' + (h.pts * multiplier), life: 40, color: h.color });
          playHoopSound(h.pts, rapidHoopStreak);
          // check if all hoops in this formation are collected → flourish
          if (h.formationId) {
            const fid = h.formationId;
            formationHits[fid] = (formationHits[fid] || 0) + 1;
            if (formationHits[fid] === h.formationTotal) {
              if (hoopFlourishTimer) clearTimeout(hoopFlourishTimer);
              hoopFlourishTimer = setTimeout(() => { hoopFlourishTimer = null; playHoopFlourish(); }, 500);
              delete formationHits[fid];
            }
          }
          if (h.pts === 50) goldStreak++; else goldStreak = 0;
          if (hoopsThisRun >= 50) unlockAchievement('bullseye');
          if (hoopStreak >= 15) unlockAchievement('hoop_streak');
          if (goldStreak >= 10) unlockAchievement('golden_touch');
        }
      }
      if (h.x < -100) {
        if (!h.collected) { hoopStreak = 0; goldStreak = 0; }
        hoops.splice(i, 1);
      }
    }

    // multiplier powerup
    if (multiplierTimer > 0) {
      multiplierTimer -= dt;
      if (multiplierTimer <= 0) multiplier = 1;
    }
    if (powerupCooldown > 0) powerupCooldown -= dt;
    if (powerupCooldown <= 0 && Math.random() < 0.003 * dt) {
      const py = H * 0.12 + Math.random() * (H * 0.42);
      if (!spawnYBlocked(py, 70)) {
        powerupCooldown = 500 + Math.random() * 400;
        powerups.push({
          x: W + 30, y: py, size: 39, rot: 0, collected: false, collectTimer: 0,
        });
      }
    }
    for (let i = powerups.length - 1; i >= 0; i--) {
      const pu = powerups[i];
      pu.x -= speed * dt;
      pu.rot += 0.04 * dt;
      if (pu.collected) {
        pu.collectTimer -= dt;
        if (pu.collectTimer <= 0) { powerups.splice(i, 1); continue; }
      } else if (Math.abs(pu.x - bird.x) < HIT_R + 8) {
        const dy = Math.abs(bird.y - pu.y);
        if (dy < pu.size + HIT_R * 0.5) {
          pu.collected = true;
          pu.collectTimer = 18;
          multiplier = 2;
          multiplierTimer = 1200;
          spawnParticles(pu.x, pu.y, '#ffdd44', 18);
          pointPopups.push({ x: pu.x, y: pu.y - pu.size - 8, text: 'Multiplier', life: 40, color: '#ffdd44' });
          playMultiplierSound();
          if (invincible) unlockAchievement('double_trouble');
        }
      }
      if (pu.x < -100) { powerups.splice(i, 1); }
    }

    // invincibility powerup
    if (invincibleTimer > 0) {
      invincibleTimer -= dt;
      if (invincibleTimer <= 0) { invincible = false; }
    }
    // barrel roll
    if (barrelRolling) {
      barrelRollTimer -= dt;
      if (barrelRollTimer <= 0) { barrelRolling = false; barrelRollTimer = 0; }
    }
    if (barrelRollBoost > 0.01) barrelRollBoost *= (1 - 0.06 * dt); else barrelRollBoost = 0;
    // deferred near-miss achievements — only unlock if you survive 2s after the event
    if (nearMissTimer > 0) {
      nearMissTimer -= dt;
      if (nearMissTimer <= 0 && nearMissId) { unlockAchievement(nearMissId); nearMissId = null; }
    }
    if (shieldCooldown > 0) shieldCooldown -= dt;
    if (shieldCooldown <= 0 && Math.random() < 0.002 * dt) {
      // ensure no other powerups or obstacles are nearby
      const sy = H * 0.12 + Math.random() * (H * 0.42);
      const tooClose = powerups.some(p => p.x > W * 0.5) || shieldPowerups.some(p => !p.collected && p.x > W * 0.3);
      if (!tooClose && !spawnYBlocked(sy, 70)) {
        shieldCooldown = 800 + Math.random() * 600;
        shieldPowerups.push({
          x: W + 30,
          y: sy,
          size: 37,
          rot: 0,
          collected: false,
          collectTimer: 0,
        });
      }
    }
    for (let i = shieldPowerups.length - 1; i >= 0; i--) {
      const sp = shieldPowerups[i];
      sp.x -= speed * dt;
      sp.rot += 0.03 * dt;
      if (sp.collected) {
        sp.collectTimer -= dt;
        if (sp.collectTimer <= 0) { shieldPowerups.splice(i, 1); continue; }
      } else if (Math.abs(sp.x - bird.x) < HIT_R + 8) {
        const dy = Math.abs(bird.y - sp.y);
        if (dy < sp.size + HIT_R * 0.5) {
          sp.collected = true;
          sp.collectTimer = 18;
          invincible = true;
          invincibleTimer = INVINCIBLE_DUR;
          spawnParticles(sp.x, sp.y, '#ffffff', 18);
          pointPopups.push({ x: sp.x, y: sp.y - sp.size - 8, text: 'Invincible', life: 40, color: '#ffffff' });
          playInvincibleSound();
          if (multiplier > 1) unlockAchievement('double_trouble');
        }
      }
      if (sp.x < -100) { shieldPowerups.splice(i, 1); }
    }
    // ---- roll powerup spawning & collection ----
    if (rollCooldown > 0) rollCooldown -= dt;
    if (rollCooldown <= 0 && Math.random() < 0.002 * dt) {
      const ry = H * 0.12 + Math.random() * (H * 0.42);
      const tooClose = powerups.some(p => p.x > W * 0.5) || shieldPowerups.some(p => !p.collected && p.x > W * 0.3) || rollPowerups.some(p => !p.collected && p.x > W * 0.3);
      if (!tooClose && !spawnYBlocked(ry, 70)) {
        rollCooldown = 700 + Math.random() * 400;
        rollPowerups.push({ x: W + 30, y: ry, size: 46, rot: Math.PI, collected: false, collectTimer: 0 });
      }
    }
    for (let i = rollPowerups.length - 1; i >= 0; i--) {
      const rp = rollPowerups[i];
      rp.x -= speed * dt;
      rp.rot += 0.035 * dt;
      if (rp.collected) {
        rp.collectTimer -= dt;
        if (rp.collectTimer <= 0) { rollPowerups.splice(i, 1); continue; }
      } else if (Math.abs(rp.x - bird.x) < HIT_R + 8) {
        const dy = Math.abs(bird.y - rp.y);
        if (dy < rp.size + HIT_R * 0.5) {
          rp.collected = true;
          rp.collectTimer = 18;
          rollCharges = Math.min(rollCharges + 3, 9);
          spawnParticles(rp.x, rp.y, '#00ddff', 18);
          pointPopups.push({ x: rp.x, y: rp.y - rp.size - 8, text: 'Barrel Roll', life: 40, color: '#00ddff' });
          playRollPickupSound();
          if (!rollTutorialShown) {
            rollTutorialShown = true;
            rollTutorialDelay = 90; // 1.5s before pausing
            localStorage.setItem('nf_rollTutorial', '1');
          }
        }
      }
      if (rp.x < -100) { rollPowerups.splice(i, 1); }
    }

    // roll tutorial delay — pause after 1.5s
    if (rollTutorialDelay > 0) {
      rollTutorialDelay -= dt;
      if (rollTutorialDelay <= 0) { rollTutorialActive = true; }
    }

    // spawn white sparkles on tail when invincible
    if (invincible) {
      const cosR = Math.cos(bird.rot), sinR = Math.sin(bird.rot);
      const tailX = bird.x + (-12 * BIRD_SCALE) * cosR;
      const tailY = bird.y + (-12 * BIRD_SCALE) * sinR;
      if (frameCount % 2 === 0) {
        sparkles.push({
          x: tailX + (Math.random() - 0.5) * 8,
          y: tailY + (Math.random() - 0.5) * 8,
          life: 15 + Math.random() * 10,
          size: 1 + Math.random() * 2.5,
        });
      }
    }
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const s = sparkles[i];
      s.x -= speed * dt * 0.5;
      s.life -= dt;
      if (s.life <= 0) sparkles.splice(i, 1);
    }

    // speed boost when invincible or barrel rolling
    if (invincible) speed = speed * 2;
    if (barrelRollBoost > 0) speed = speed * (1 + 4 * barrelRollBoost);

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // point popups — slide left with world and fade
    for (let i = pointPopups.length - 1; i >= 0; i--) {
      const pp = pointPopups[i];
      pp.x -= speed * dt;
      pp.y -= 0.5 * dt;
      pp.life -= dt;
      if (pp.life <= 0) pointPopups.splice(i, 1);
    }

    // night/dawn achievement checks
    if (!nightReached && getDarkness() > 0.45) { nightReached = true; unlockAchievement('night_owl'); }
    if (!dawnReached && nightReached) {
      const phase = (skyFrame / PHASE_DUR) % SKY.length;
      if (phase > 4.5 || phase < 0.5) { dawnReached = true; unlockAchievement('dawn_patrol'); }
    }

    updateSkylineStream(speed, dt);
    updateLightning(dt);
    checkCollision();
  }

  // =========================================================
  //  COLLISION
  // =========================================================
  function circleRect(cx, cy, cr, rx, ry, rw, rh) {
    const nearX = clamp(cx, rx, rx + rw), nearY = clamp(cy, ry, ry + rh);
    const dx = cx - nearX, dy = cy - nearY;
    return dx * dx + dy * dy < cr * cr;
  }

  function checkCollision() {
    if (invincible || launchGrace > 0 || barrelRolling) return;
    const bx = bird.x, by = bird.y, r = HIT_R;

    // poles are non-lethal — only wires kill
    for (let i = 0; i < poles.length - 1; i++) {
      const p1 = poles[i], p2 = poles[i + 1];
      if (bx + r <= p1.x || bx - r >= p2.x) continue;
      const p1Top = H - p1.h + p1.wireOffset + WIRE_TOP_OFFSET;
      const p2Top = H - p2.h + p2.wireOffset + WIRE_TOP_OFFSET;
      const t = clamp((bx - p1.x) / (p2.x - p1.x), 0, 1);
      const span = p2.x - p1.x;
      const baseSag = span * WIRE_SAG_BASE * p2.sagMult;
      for (let wdi = 0; wdi < WIRE_DEFS.length; wdi++) {
        const wd = WIRE_DEFS[wdi];
        const y1 = p1Top + wd.offL, y2 = p2Top + wd.offR;
        const windOff = Math.sin(frameCount * 0.008 + p1.x * 0.003 + wdi * 1.5) * 2.5;
        const ctrlY = Math.max(y1, y2) + baseSag * wd.sagMul + windOff;
        const wireY = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * ctrlY + t * t * y2;
        if (Math.abs(by - wireY) < r + wd.thick * 0.5) { die(); return; }
      }
    }

    for (const ob of obstacles) {
      if (ob.type === 'kite') {
        const ky = ob.baseY + Math.sin(ob.phase) * 45;
        const s = ob.size;
        const kiteAngle = 0.436 + Math.sin(ob.phase * 1.3) * 0.15;
        // kite body
        const dx = bx - ob.x, dy = by - ky;
        if (dx * dx + dy * dy < (ob.hitR + r) * (ob.hitR + r)) { die(); return; }
        // kite string (undulating, from rotated bottom point to screen bottom)
        const strStartX = ob.x - s * Math.sin(kiteAngle);
        const strStartY = ky + s * Math.cos(kiteAngle);
        const pts = getKiteStringPts(strStartX, strStartY, ob.stringPhase, kiteAngle);
        for (let p = 0; p < pts.length - 1; p++) {
          if (circleSegment(bx, by, r, pts[p].x, pts[p].y, pts[p + 1].x, pts[p + 1].y)) { die(); return; }
        }
      } else if (ob.type === 'flock') {
        for (const fb of ob.birds) {
          const fx = ob.x + fb.ox, fy = ob.y + fb.oy;
          const dx = bx - fx, dy = by - fy;
          const dist = ob.size * 0.65 + r;
          if (dx * dx + dy * dy < dist * dist) { die(); return; }
          const nearDist = dist + 12;
          if (dx * dx + dy * dy < nearDist * nearDist) { nearMissId = 'close_call'; nearMissTimer = 120; }
        }
      } else if (ob.type === 'flag') {
        // pole collision (thick vertical line)
        const poleTop = ob.y - ob.poleH;
        if (Math.abs(bx - ob.x) < r + 4 && by > poleTop - r && by < ob.y + r) { die(); return; }
        // flag cloth collision (rectangle at top of pole, extending right)
        const flagTop = poleTop - 10; // account for ripple
        const flagBot = poleTop + ob.flagH + 10;
        if (bx + r > ob.x && bx - r < ob.x + ob.flagW && by + r > flagTop && by - r < flagBot) { die(); return; }
      } else {
        const oy = ob.y;
        const dx = bx - ob.x, dy = by - oy;
        const dist = ob.hitR + r;
        if (dx * dx + dy * dy < dist * dist) { die(); return; }
        // near-miss detection
        const nearDist = ob.hitR + r + 12;
        if (dx * dx + dy * dy < nearDist * nearDist) { nearMissId = 'close_call'; nearMissTimer = 120; }
      }
    }

    // wire near-miss detection
    for (let i = 0; i < poles.length - 1; i++) {
      const p1 = poles[i], p2 = poles[i + 1];
      if (bx + r <= p1.x || bx - r >= p2.x) continue;
      const p1Top = H - p1.h + p1.wireOffset + WIRE_TOP_OFFSET;
      const p2Top = H - p2.h + p2.wireOffset + WIRE_TOP_OFFSET;
      const t = clamp((bx - p1.x) / (p2.x - p1.x), 0, 1);
      const span = p2.x - p1.x;
      const baseSag = span * WIRE_SAG_BASE * p2.sagMult;
      for (let wdi = 0; wdi < WIRE_DEFS.length; wdi++) {
        const wd = WIRE_DEFS[wdi];
        const y1 = p1Top + wd.offL, y2 = p2Top + wd.offR;
        const windOff = Math.sin(frameCount * 0.008 + p1.x * 0.003 + wdi * 1.5) * 2.5;
        const ctrlY = Math.max(y1, y2) + baseSag * wd.sagMul + windOff;
        const wireY = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * ctrlY + t * t * y2;
        const gap = Math.abs(by - wireY);
        if (gap < r + wd.thick * 0.5 + 8 && gap >= r + wd.thick * 0.5) { nearMissId = 'wire_walker'; nearMissTimer = 120; }
      }
    }

  }

  function die() {
    if (zenMode) return;
    if (!bird.alive) return;
    nearMissTimer = 0; nearMissId = null; // cancel pending near-miss
    bird.alive = false;
    state = STATE.DEAD;
    inputHeld = false;
    displayDist = distance;
    const distInt = distance | 0;
    if (distInt > highDist) highDist = distInt;
    scores.push({ name: 'Run ' + (runCount + 1), dist: distInt });
    scores.sort((a, b) => b.dist - a.dist);
    scores = scores.slice(0, 20);
    localStorage.setItem('nf_hi', highDist);
    localStorage.setItem('nf_scores', JSON.stringify(scores));
    if (bgMusic && musicOn) fadeMusic(1500);
    // achievement checks on death
    runCount++;
    localStorage.setItem('nf_run_count', runCount);
    if (distance >= 100) unlockAchievement('first_flight');
    if (distance >= 500) unlockAchievement('sky_wanderer');
    if (distance >= 1000) unlockAchievement('mile_high');
    if (distance >= 5000) unlockAchievement('marathon');
    if (distance >= 10000) unlockAchievement('into_sunset');
    if (points >= 100) unlockAchievement('point_collector');
    if (points >= 500) unlockAchievement('high_roller');
    if (points >= 1000) unlockAchievement('thousand_club');
    if (points >= 2500) unlockAchievement('big_scorer');
    if (runCount >= 10) unlockAchievement('persistence');
    if (runCount >= 100) unlockAchievement('centurion');
  }

  // =========================================================
  //  RENDER
  // =========================================================
  function render() {
    ctx.save();
    if (shakeTimer > 0) ctx.translate(shakeX, shakeY);
    drawSky();
    drawStars();
    drawCelestial();
    // drawClouds(); // disabled for FPS
    if (lightningFlash > 0) drawLightning();
    drawSkyline();
    drawAmbientLife();
    if (state === STATE.HOME || state === STATE.ACHIEVEMENTS || state === STATE.LEADERBOARD) {
      drawPoles();
      drawWires();
      drawPerchingBird();
    }
    if (state === STATE.PLAY || state === STATE.PAUSE || state === STATE.DEAD) {
      drawPoles();
      drawWires();
      drawPerchedBirds();
      if (launchFlyIn) drawStaticPerchBird();
      drawObstacles();
      drawHoops();
      drawPowerups();
      drawShieldPowerups();
      drawRollPowerups();
      drawTrail();
      drawGustStreaks();
      drawSparkles();
      drawPlayer();
      drawParticles();
      drawPointPopups();
    }
    drawVignette();
    ctx.restore();
    drawUI();
  }

  function drawSky() {
    const phase = (skyFrame / PHASE_DUR) % SKY.length;
    const idx = phase | 0, t = phase - idx, st = t * t * (3 - 2 * t);
    const a = SKY[idx], b = SKY[(idx + 1) % SKY.length];
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    for (let i = 0; i < SKY_STOPS.length; i++) {
      grad.addColorStop(SKY_STOPS[i], rgb(lerpC(a.c[i], b.c[i], st)));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  function drawStars() {
    const dark = getDarkness();
    if (dark <= 0.05) return;
    const alpha = dark * 0.5;
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      ctx.globalAlpha = alpha * (Math.sin(frameCount * 0.02 + s.flicker) * 0.3 + 0.7) * 0.6;
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---- CELESTIAL (sun and moon sequential, both slow) ----
  function drawCelestial() {
    const dark = getDarkness();

    // Sun: visible when dark < 0.22, sinks slowly toward horizon
    if (dark < 0.22) {
      const t = dark / 0.22;
      const sunAlpha = 1 - t;
      const cx = W * 0.68;
      const cy = lerp(H * 0.18, H * 0.85, t);
      const r = lerp(48, 22, t);

      ctx.save();
      ctx.globalAlpha = sunAlpha;
      const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 4);
      glow.addColorStop(0, 'rgba(255,220,140,0.25)');
      glow.addColorStop(0.5, 'rgba(255,180,100,0.08)');
      glow.addColorStop(1, 'rgba(255,160,80,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,235,160,0.9)';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // Moon: visible when dark > 0.22, arcs smoothly across sky
    if (dark > 0.22) {
      // compute moon progress from sky phase (night spans ~phases 1.3–4.7)
      const phase = (skyFrame / PHASE_DUR) % SKY.length;
      const nightStart = 0.7, nightEnd = 4.2;
      const nightLen = nightEnd - nightStart;
      let moonPhase = phase >= nightStart ? phase - nightStart : phase + SKY.length - nightStart;
      const mt = clamp(moonPhase / nightLen, 0, 1); // 0 = horizon rise, 1 = horizon set
      const moonAlpha = 0.85;
      // arc path: sine curve for height, linear for x — starts below screen
      const mx = lerp(W * 0.75, W * 0.25, mt);
      const my = lerp(H * 1.15, H * 0.12, Math.sin(mt * Math.PI)); // rises from below skyline
      const mr = lerp(18, 55, Math.sin(mt * Math.PI));

      ctx.save();
      ctx.globalAlpha = moonAlpha;

      // White glow
      const glow = ctx.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 2.5);
      glow.addColorStop(0, 'rgba(255,255,255,0.08)');
      glow.addColorStop(0.6, 'rgba(255,255,255,0.02)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // Moon — simple white circle
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // ---- CITY SKYLINE (no window lights) ----
  function drawSkyline() {
    ctx.fillStyle = '#000';
    ctx.globalAlpha = 0.35;
    for (const b of skylineFar) {
      if (b.x > W + 200 || b.x + b.w < -200) continue;
      drawSkylineShape(b);
    }
    ctx.globalAlpha = 1;
    for (const b of skylineNear) {
      if (b.x > W + 200 || b.x + b.w < -200) continue;
      drawSkylineShape(b);
    }
  }

  function drawSkylineShape(b) {
    switch (b.type) {
      case 'mountain': drawMountain(b); break;
      case 'tree':     drawTree(b); break;
      case 'dune':     drawDune(b); break;
      case 'cactus':   drawCactus(b); break;
      case 'volcano':  drawVolcano(b); break;
      case 'ruin':     drawRuin(b); break;
      default:         drawBuilding(b); break;
    }
  }

  function drawBuilding(b) {
    const top = H - b.h * 0.9;
    ctx.fillStyle = '#000';
    ctx.fillRect(b.x, top, b.w, b.h);
    if (b.style < 0.15) {
      ctx.beginPath();
      ctx.moveTo(b.x, top);
      ctx.lineTo(b.x + b.w / 2, top - b.w * 0.4);
      ctx.lineTo(b.x + b.w, top);
      ctx.fill();
    } else if (b.style < 0.3) {
      const stepW = b.w * 0.6;
      const stepH = b.h * 0.12;
      ctx.fillRect(b.x + (b.w - stepW) / 2, top - stepH, stepW, stepH);
    }
    if (b.antenna) ctx.fillRect(b.x + b.w / 2 - 1, top - b.antenna, 2, b.antenna);
    // water tower — squat and wide
    if (b.waterTower) {
      const tw = 29, th = 17, legH = 18;
      const tx = b.x + b.w * 0.3 - 4;
      const ty = top - legH - th;
      // legs (4 stilts)
      ctx.fillRect(tx + 2, ty + th, 3, legH);
      ctx.fillRect(tx + tw - 5, ty + th, 3, legH);
      ctx.fillRect(tx + 8, ty + th, 2, legH);
      ctx.fillRect(tx + tw - 10, ty + th, 2, legH);
      // tank — barrel shape
      ctx.beginPath();
      ctx.moveTo(tx, ty + th);
      ctx.lineTo(tx - 2, ty + th * 0.3);
      ctx.quadraticCurveTo(tx + tw / 2, ty - 3, tx + tw + 2, ty + th * 0.3);
      ctx.lineTo(tx + tw, ty + th);
      ctx.closePath();
      ctx.fill();
      // conical roof
      ctx.beginPath();
      ctx.moveTo(tx - 2, ty + th * 0.3);
      ctx.lineTo(tx + tw / 2, ty - 7);
      ctx.lineTo(tx + tw + 2, ty + th * 0.3);
      ctx.fill();
    }
    // Window lights — snap on one by one as darkness increases (no glow)
    if (b.windows) {
      const dark = getDarkness();
      for (const win of b.windows) {
        if (dark >= win.onDark) {
          ctx.fillStyle = 'rgba(255,220,130,0.8)';
          ctx.fillRect(b.x + win.cx - 2, top + win.cy - 3, 4, 6);
        }
      }
    }
  }

  function drawMountain(b) {
    const base = H;
    const top = H - b.h * 0.9;
    const peakX = b.x + b.w * b.peakOffset;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(b.x, base);
    // curved left slope
    ctx.quadraticCurveTo(b.x + (peakX - b.x) * 0.3, base - b.h * 0.2, peakX, top);
    // curved right slope
    ctx.quadraticCurveTo(b.x + b.w - (b.x + b.w - peakX) * 0.3, base - b.h * 0.2, b.x + b.w, base);
    ctx.closePath();
    ctx.fill();
    if (b.ridge) {
      const ridgeX = peakX + b.w * b.ridge.offset;
      const ridgeTop = H - b.h * b.ridge.height * 0.9;
      const ridgeW = b.w * 0.35;
      ctx.beginPath();
      ctx.moveTo(ridgeX - ridgeW, base);
      ctx.quadraticCurveTo(ridgeX - ridgeW * 0.3, base - (base - ridgeTop) * 0.3, ridgeX, ridgeTop);
      ctx.quadraticCurveTo(ridgeX + ridgeW * 0.3, base - (base - ridgeTop) * 0.3, ridgeX + ridgeW, base);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawTree(b) {
    const base = H;
    const trunkTop = H - b.trunkH;
    const cx = b.x + b.w / 2;
    ctx.fillStyle = '#000';
    if (b.treeType < 0.5) {
      // conifer
      ctx.beginPath();
      ctx.moveTo(cx - 2, base);
      ctx.lineTo(cx + 2, base);
      ctx.lineTo(cx + 2, trunkTop);
      ctx.lineTo(cx + b.w / 2, trunkTop);
      ctx.lineTo(cx, H - b.h * 0.9);
      ctx.lineTo(cx - b.w / 2, trunkTop);
      ctx.lineTo(cx - 2, trunkTop);
      ctx.closePath();
      ctx.fill();
    } else {
      // deciduous
      ctx.fillRect(cx - 2, trunkTop, 4, b.trunkH);
      const canopyR = b.w / 2;
      const canopyY = trunkTop - canopyR * 0.3;
      ctx.beginPath(); ctx.arc(cx, canopyY, canopyR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx - canopyR * 0.4, canopyY + canopyR * 0.2, canopyR * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + canopyR * 0.4, canopyY + canopyR * 0.2, canopyR * 0.7, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawDune(b) {
    const base = H;
    const top = H - b.h * 0.9;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(b.x, base);
    ctx.bezierCurveTo(
      b.x + b.w * b.cp1, top + b.h * (1 - b.rise1) * 0.9,
      b.x + b.w * b.cp2, top + b.h * (1 - b.rise2) * 0.9,
      b.x + b.w, base
    );
    ctx.closePath();
    ctx.fill();
  }

  function drawCactus(b) {
    const base = H;
    const top = H - b.h * 0.9;
    const cx = b.x + b.w / 2;
    const tw = b.trunkW;
    ctx.fillStyle = '#000';
    // main trunk with rounded top
    ctx.beginPath();
    ctx.moveTo(cx - tw / 2, base);
    ctx.lineTo(cx - tw / 2, top + tw / 2);
    ctx.arc(cx, top + tw / 2, tw / 2, Math.PI, 0);
    ctx.lineTo(cx + tw / 2, base);
    ctx.closePath();
    ctx.fill();
    // arms
    for (const arm of b.arms) {
      const armY = H - b.h * arm.y * 0.9;
      const armLen = b.h * arm.len * 0.9;
      const armW = tw * 0.7;
      const dir = arm.side;
      const elbowX = cx + dir * (tw / 2 + armLen * 0.4);
      const tipY = armY - armLen;
      // horizontal segment
      ctx.fillRect(
        Math.min(cx + dir * tw / 2, elbowX), armY - armW / 2,
        Math.abs(elbowX - (cx + dir * tw / 2)), armW
      );
      // vertical segment going up
      ctx.beginPath();
      ctx.moveTo(elbowX - armW / 2, armY);
      ctx.lineTo(elbowX - armW / 2, tipY + armW / 2);
      ctx.arc(elbowX, tipY + armW / 2, armW / 2, Math.PI, 0);
      ctx.lineTo(elbowX + armW / 2, armY);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawVolcano(b) {
    const base = H;
    const top = H - b.h * 0.9;
    const peakX = b.x + b.w * b.peakOffset;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(b.x, base);
    if (b.isVolcano && b.craterW > 0) {
      const craterHalfW = b.w * b.craterW / 2;
      // left slope bows outward
      ctx.quadraticCurveTo(b.x + (peakX - craterHalfW - b.x) * 0.35, base - b.h * 0.15, peakX - craterHalfW, top);
      // crater dip
      ctx.quadraticCurveTo(peakX, top + b.h * 0.08, peakX + craterHalfW, top);
      // right slope bows outward
      ctx.quadraticCurveTo(b.x + b.w - (b.x + b.w - peakX - craterHalfW) * 0.35, base - b.h * 0.15, b.x + b.w, base);
    } else {
      // non-volcano mountain with bowed sides
      ctx.quadraticCurveTo(b.x + (peakX - b.x) * 0.35, base - b.h * 0.15, peakX, top);
      ctx.quadraticCurveTo(b.x + b.w - (b.x + b.w - peakX) * 0.35, base - b.h * 0.15, b.x + b.w, base);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawRuin(b) {
    const base = H;
    ctx.fillStyle = '#000';
    if (b.ruinType < 0.33) {
      // broken columns
      const colW = Math.min(8, b.w / (b.columns * 2 + 1));
      const spacing = b.w / (b.columns + 1);
      for (let i = 0; i < b.columns; i++) {
        const colX = b.x + spacing * (i + 1) - colW / 2;
        const colH = b.h * (0.5 + Math.sin(i * 1.7) * 0.3) * b.breakHeight * 0.9;
        const colTop = H - colH;
        ctx.fillRect(colX, colTop, colW, colH);
        ctx.fillRect(colX - 2, colTop, colW + 4, 4);
        ctx.beginPath();
        ctx.moveTo(colX - 1, colTop);
        ctx.lineTo(colX + colW * 0.3, colTop - 3);
        ctx.lineTo(colX + colW * 0.7, colTop - 1);
        ctx.lineTo(colX + colW + 1, colTop - 2);
        ctx.lineTo(colX + colW + 1, colTop);
        ctx.fill();
      }
    } else if (b.ruinType < 0.66) {
      // partial wall
      const top = H - b.h * b.breakHeight * 0.9;
      ctx.fillRect(b.x, top, b.w, base - top);
      ctx.beginPath();
      ctx.moveTo(b.x, top);
      const segs = 5 + Math.floor(b.w / 10);
      for (let i = 1; i <= segs; i++) {
        ctx.lineTo(b.x + b.w * i / segs, top - (Math.sin(i * 2.3) * 4 + Math.cos(i * 1.1) * 3));
      }
      ctx.lineTo(b.x + b.w, top);
      ctx.closePath();
      ctx.fill();
      if (b.hasArch) {
        const archW = b.w * 0.4;
        const archX = b.x + b.w * 0.3;
        ctx.beginPath();
        ctx.arc(archX + archW / 2, top, archW / 2, Math.PI, 0);
        ctx.fill();
      }
    } else {
      // rubble mound
      const rubbleTop = H - b.h * 0.3 * b.breakHeight * 0.9;
      ctx.beginPath();
      ctx.moveTo(b.x, base);
      ctx.lineTo(b.x + b.w * 0.1, rubbleTop + 5);
      ctx.lineTo(b.x + b.w * 0.25, rubbleTop - 3);
      ctx.lineTo(b.x + b.w * 0.4, rubbleTop + 2);
      ctx.lineTo(b.x + b.w * 0.55, rubbleTop - 5);
      ctx.lineTo(b.x + b.w * 0.7, rubbleTop + 4);
      ctx.lineTo(b.x + b.w * 0.85, rubbleTop);
      ctx.lineTo(b.x + b.w, base);
      ctx.closePath();
      ctx.fill();
      // jutting column
      const colX = b.x + b.w * 0.5;
      const colTop = H - b.h * 0.6 * b.breakHeight * 0.9;
      ctx.fillRect(colX - 3, colTop, 6, rubbleTop - colTop);
    }
  }

  // ---- WISPY CLOUDS (translucent) ----
  function drawClouds() {
    const dark = getDarkness();
    const cloudAlpha = 0.08 * (1 - dark); // fade out at night
    if (cloudAlpha < 0.002) return;
    ctx.save();
    ctx.globalAlpha = cloudAlpha;
    ctx.fillStyle = '#fff';
    ctx.filter = 'blur(8px)';
    const totalSpan = W * 2;
    for (const c of clouds) {
      let cx = c.x - (skylineOffset * 0.06) % totalSpan;
      while (cx < -500) cx += totalSpan;
      while (cx > W + 500) cx -= totalSpan;
      const pts = c.nodes.map(n => ({
        x: cx + Math.cos(n.a) * c.rx * n.r,
        y: c.y + Math.sin(n.a) * c.ry * n.r,
      }));
      const n = pts.length;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n];
        const p1 = pts[i];
        const p2 = pts[(i + 1) % n];
        const p3 = pts[(i + 2) % n];
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.filter = 'none';
  }

  // ---- PERCHED BIRDS ----
  function drawPerchedBirds() {
    ctx.fillStyle = '#000';
    for (let i = 1; i < poles.length; i++) {
      const p1 = poles[i - 1], p2 = poles[i];
      if (!p2.perchedBirds || !p2.perchedBirds.length) continue;
      if (p2.x < -80 || p1.x > W + 80) continue;
      const p1Top = H - p1.h + p1.wireOffset + WIRE_TOP_OFFSET;
      const p2Top = H - p2.h + p2.wireOffset + WIRE_TOP_OFFSET;
      const span = p2.x - p1.x;
      const baseSag = span * WIRE_SAG_BASE * p2.sagMult;
      for (const pb of p2.perchedBirds) {
        const wd = WIRE_DEFS[pb.wireIdx];
        if (!wd) continue;
        const t = pb.t;
        const y1 = p1Top + wd.offL, y2 = p2Top + wd.offR;
        const ctrlY = Math.max(y1, y2) + baseSag * wd.sagMul;
        const bx = p1.x + t * span;
        const by = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * ctrlY + t * t * y2;
        drawPerched(bx, by, pb.facing);
      }
    }
  }

  function drawPerched(x, y, facing) {
    const s = 11;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing, 1);
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.3, s * 0.55, s * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s * 0.45, -s * 0.65, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.45, -s * 0.2);
    ctx.lineTo(-s * 1.1, -s * 0.5);
    ctx.lineTo(-s * 1.0, s * 0.05);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.7, -s * 0.7);
    ctx.lineTo(s * 1.1, -s * 0.55);
    ctx.lineTo(s * 0.7, -s * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }


  // ---- POLES ----
  function drawPoles() {
    ctx.fillStyle = '#000';
    for (const p of poles) {
      if (p.x < -50 || p.x > W + 50) continue;
      const top = H - p.h;
      const hw = POLE_WIDTH / 2;
      ctx.fillRect(p.x - hw, top, POLE_WIDTH, p.h);
      ctx.fillRect(p.x - 14, top + 6, 28, 3);
    }
  }

  // ---- WIRES (with subtle wind undulation) ----
  const WIRE_DEFS = [
    { offL: -2, offR: 5,  sagMul: 0.8, thick: 1.5 },
    { offL: 12, offR: 10, sagMul: 1.2, thick: 1.5 },
  ];

  function drawWires() {
    for (let i = 0; i < poles.length - 1; i++) {
      const p1 = poles[i], p2 = poles[i + 1];
      if (p2.x < -50 || p1.x > W + 50) continue;
      const p1Top = H - p1.h + p1.wireOffset + WIRE_TOP_OFFSET;
      const p2Top = H - p2.h + p2.wireOffset + WIRE_TOP_OFFSET;
      const span = p2.x - p1.x;
      const baseSag = span * WIRE_SAG_BASE * p2.sagMult;
      const midX = (p1.x + p2.x) / 2;
      for (let wdi = 0; wdi < WIRE_DEFS.length; wdi++) {
        const wd = WIRE_DEFS[wdi];
        const y1 = p1Top + wd.offL, y2 = p2Top + wd.offR;
        const windOff = Math.sin(frameCount * 0.008 + p1.x * 0.003 + wdi * 1.5) * 2.5;
        const ctrlY = Math.max(y1, y2) + baseSag * wd.sagMul + windOff;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = wd.thick;
        ctx.beginPath(); ctx.moveTo(p1.x, y1);
        ctx.quadraticCurveTo(midX, ctrlY, p2.x, y2); ctx.stroke();
      }
    }
  }

  // ---- LIGHTNING ----
  function drawLightning() {
    if (lightningFlash <= 0) return;
    const alpha = (lightningFlash / 10) * 0.12;
    ctx.save();
    ctx.fillStyle = `rgba(200,200,255,${alpha})`;
    ctx.fillRect(0, 0, W, H);
    if (lightningBolt.length > 0 && lightningFlash > 6) {
      ctx.strokeStyle = `rgba(255,255,255,${(lightningFlash - 6) / 4 * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lightningBolt[0].x, 0);
      for (const pt of lightningBolt) ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- OBSTACLES ----
  function drawObstacles() {
    ctx.fillStyle = '#000';
    for (const ob of obstacles) {
      if (ob.x < -400 || ob.x > W + 400) continue;
      ctx.save();

      if (ob.type === 'bird') {
        ctx.translate(ob.x, ob.y);
        const s = ob.size;
        const wY = Math.sin(ob.wingPhase) * s * 0.9;
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.45, s * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-s * 0.15, -s * 0.05);
        ctx.quadraticCurveTo(-s * 0.6, wY - s * 0.45, -s * 1.3, wY * 0.7);
        ctx.lineTo(-s * 0.9, wY * 0.2 + s * 0.05);
        ctx.quadraticCurveTo(-s * 0.4, s * 0.05, -s * 0.15, s * 0.02);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(s * 0.15, -s * 0.05);
        ctx.quadraticCurveTo(s * 0.6, wY - s * 0.45, s * 1.3, wY * 0.7);
        ctx.lineTo(s * 0.9, wY * 0.2 + s * 0.05);
        ctx.quadraticCurveTo(s * 0.4, s * 0.05, s * 0.15, s * 0.02);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-s * 0.35, 0);
        ctx.lineTo(-s * 0.65, s * 0.15);
        ctx.lineTo(-s * 0.45, 0);
        ctx.lineTo(-s * 0.65, -s * 0.15);
        ctx.closePath(); ctx.fill();
      }

      else if (ob.type === 'kite') {
        const ky = ob.baseY + Math.sin(ob.phase) * 45;
        const s = ob.size;
        const kiteAngle = 0.436 + Math.sin(ob.phase * 1.3) * 0.15; // 25deg base + wobble

        // Kite body (narrow top, long point down, angled 25deg L→R)
        ctx.save();
        ctx.translate(ob.x, ky);
        ctx.rotate(kiteAngle);
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.35);
        ctx.lineTo(s * 0.45, 0);
        ctx.lineTo(0, s);
        ctx.lineTo(-s * 0.45, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // String attached at kite's rotated bottom point
        const strStartX = ob.x - s * Math.sin(kiteAngle);
        const strStartY = ky + s * Math.cos(kiteAngle);
        const pts = getKiteStringPts(strStartX, strStartY, ob.stringPhase, kiteAngle);

        // String
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p].x, pts[p].y);
        ctx.stroke();

        // Frills (small ribbon strips near top of string)
        ctx.lineWidth = 1;
        for (let f = 0; f < 6; f++) {
          const pi = f + 1;
          if (pi >= pts.length) break;
          const px = pts[pi].x, py = pts[pi].y;
          const fSize = 10 - f * 1.2;
          const wave = Math.sin(frameCount * 0.06 + f * 1.7 + ob.stringPhase) * 5;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px - fSize + wave, py + fSize * 0.6, px - fSize * 0.3 + wave, py + fSize);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + fSize - wave, py + fSize * 0.6, px + fSize * 0.3 - wave, py + fSize);
          ctx.stroke();
        }
      }

      else if (ob.type === 'balloon') {
        ctx.translate(ob.x, ob.y);
        const s = ob.size;
        if (balloonLoaded) {
          // SVG is 728x1078 — scale to fit obstacle size
          const imgH = s * 1.6;
          const imgW = imgH * (728 / 1078);
          ctx.drawImage(balloonImg, -imgW / 2, -imgH * 0.5, imgW, imgH);
        } else {
          // fallback: simple silhouette
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.moveTo(0, -s * 0.9);
          ctx.bezierCurveTo(s * 0.55, -s * 0.9, s * 0.7, -s * 0.45, s * 0.6, -s * 0.05);
          ctx.bezierCurveTo(s * 0.5, s * 0.2, s * 0.28, s * 0.32, s * 0.15, s * 0.35);
          ctx.lineTo(-s * 0.15, s * 0.35);
          ctx.bezierCurveTo(-s * 0.28, s * 0.32, -s * 0.5, s * 0.2, -s * 0.6, -s * 0.05);
          ctx.bezierCurveTo(-s * 0.7, -s * 0.45, -s * 0.55, -s * 0.9, 0, -s * 0.9);
          ctx.closePath(); ctx.fill();
        }
      }

      else if (ob.type === 'flock') {
        // 5 birds in V formation — same crescent shape as main bird
        const s = ob.size / 14; // scale factor (main bird coords go ~-20 to 14)
        for (const fb of ob.birds) {
          const fx = ob.x + fb.ox;
          const fy = ob.y + fb.oy;
          const w = Math.sin(ob.wingPhase + fb.wingOffset) * 4;
          ctx.save();
          ctx.translate(fx, fy);
          ctx.scale(-s, s); // flip to face left
          ctx.beginPath();
          ctx.moveTo(14, 0);
          ctx.quadraticCurveTo(10, -1.5, 4, -2);
          ctx.bezierCurveTo(-2, -2.8 + w * 0.15, -10, -6 + w, -20, -4.5 + w * 0.7);
          ctx.quadraticCurveTo(-15, -2.5 + w * 0.2, -10, 0);
          ctx.lineTo(-10, 0);
          ctx.quadraticCurveTo(-15, 2.5 - w * 0.2, -20, 4.5 - w * 0.7);
          ctx.bezierCurveTo(-10, 6 - w, -2, 2.8 - w * 0.15, 4, 2);
          ctx.quadraticCurveTo(10, 1.5, 14, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      else if (ob.type === 'paperplane') {
        ctx.translate(ob.x, ob.y);
        const s = ob.size;
        // angle from velocity + subtle pitch wobble
        const glideAngle = Math.atan2(ob.vy, ob.vx);
        const wobble = Math.sin(ob.wobblePhase) * ob.wobbleAmp;
        ctx.rotate(glideAngle + wobble);
        ctx.beginPath();
        // fuselage center line
        ctx.moveTo(s * 1.5, 0);
        // top wing
        ctx.lineTo(-s * 0.8, -s * 0.6);
        ctx.lineTo(-s * 1.2, 0);
        // bottom wing
        ctx.lineTo(-s * 0.8, s * 0.6);
        ctx.closePath();
        ctx.fill();
        // center fold line — knockout (reveal background through gap)
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(s * 1.5, 0);
        ctx.lineTo(-s * 1.2, 0);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }

      else if (ob.type === 'flag') {
        // large foreground flagpole
        const poleTop = ob.y - ob.poleH;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(ob.x, ob.y);
        ctx.lineTo(ob.x, poleTop);
        ctx.stroke();
        // pole cap
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(ob.x, poleTop - 5, 7, 0, Math.PI * 2);
        ctx.fill();
        // flag cloth — sine-wave ripple (large foreground scale)
        const fw = ob.flagW, fh = ob.flagH;
        const segs = 24;
        ctx.beginPath();
        // top edge (rippling)
        for (let i = 0; i <= segs; i++) {
          const t = i / segs;
          const fx = ob.x + t * fw;
          const wave = Math.sin(ob.phase + t * 4) * (10 + t * 8);
          const fy = poleTop + wave;
          if (i === 0) ctx.moveTo(fx, fy);
          else ctx.lineTo(fx, fy);
        }
        // bottom edge (rippling, reverse)
        for (let i = segs; i >= 0; i--) {
          const t = i / segs;
          const fx = ob.x + t * fw;
          const wave = Math.sin(ob.phase + t * 4 + 0.5) * (10 + t * 8);
          const fy = poleTop + fh + wave;
          ctx.lineTo(fx, fy);
        }
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // ---- HOOPS (3D wireframe torus) ----
  function drawHoops() {
    for (const h of hoops) {
      if (h.x < -100 || h.x > W + 100) continue;
      ctx.save();
      ctx.translate(h.x, h.y);

      let alpha = 1, sc = 1;
      if (h.collected) {
        const t = h.collectTimer / 14;
        alpha = t * t;
        sc = 1 + (1 - t) * 0.6;
      }

      ctx.globalAlpha = alpha;
      ctx.scale(sc, sc);

      const R = h.radius;
      const r = R * 0.12;
      const rot = h.rot;

      // dynamic hoop color — contrast against sky at hoop's Y position
      const baseCol = h.color;
      const hr = parseInt(baseCol.slice(1, 3), 16);
      const hg = parseInt(baseCol.slice(3, 5), 16);
      const hb = parseInt(baseCol.slice(5, 7), 16);
      const bg = getSkyColorAt(h.y);
      const hoopCol = contrastColor(hr, hg, hb, bg[0], bg[1], bg[2]);
      ctx.strokeStyle = hoopCol;
      ctx.lineWidth = 1.5;

      // Longitude lines (circles tracing the ring at different tube offsets)
      for (let j = 0; j < 3; j++) {
        const phi = (j / 3) * Math.PI * 2;
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const theta = (i / 40) * Math.PI * 2;
          const rr = R + r * Math.cos(phi);
          const x3 = rr * Math.sin(theta);
          const y3 = -rr * Math.cos(theta);
          const z3 = r * Math.sin(phi);
          const sx = x3 * Math.cos(rot) + z3 * Math.sin(rot);
          if (i === 0) ctx.moveTo(sx, y3);
          else ctx.lineTo(sx, y3);
        }
        ctx.stroke();
      }

      // Meridian circles (batched into single path)
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const theta = (i / 12) * Math.PI * 2;
        for (let j = 0; j <= 8; j++) {
          const phi = (j / 8) * Math.PI * 2;
          const rr = R + r * Math.cos(phi);
          const x3 = rr * Math.sin(theta);
          const y3 = -rr * Math.cos(theta);
          const z3 = r * Math.sin(phi);
          const sx = x3 * Math.cos(rot) + z3 * Math.sin(rot);
          if (j === 0) ctx.moveTo(sx, y3);
          else ctx.lineTo(sx, y3);
        }
      }
      ctx.stroke();

      // Point value inside hoop (fun typography)
      const fontSize = Math.round(R * 0.5);
      ctx.font = `800 italic ${fontSize}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = alpha * 0.3;
      ctx.fillStyle = '#000';
      ctx.fillText(h.pts, 1, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = hoopCol;
      ctx.fillText(h.pts, 0, 0);

      ctx.restore();
    }
  }

  // ---- MULTIPLIER POWERUP (3D wireframe octahedron) ----
  function drawPowerups() {
    for (const pu of powerups) {
      if (pu.x < -60 || pu.x > W + 60) continue;
      ctx.save();
      ctx.translate(pu.x, pu.y);

      let alpha = 1, sc = 1;
      if (pu.collected) {
        const t = pu.collectTimer / 18;
        alpha = t * t;
        sc = 1 + (1 - t) * 0.8;
      }

      ctx.globalAlpha = alpha;
      ctx.scale(sc, sc);

      const s = pu.size;
      const rot = pu.rot;

      // Octahedron: 6 vertices, 12 edges
      const verts = [
        [0, -s, 0], [0, s, 0],
        [s, 0, 0], [-s, 0, 0],
        [0, 0, s], [0, 0, -s],
      ];
      const edges = [
        [0,2],[0,3],[0,4],[0,5],
        [1,2],[1,3],[1,4],[1,5],
        [2,4],[4,3],[3,5],[5,2],
      ];

      // Rotate around Y axis
      const proj = verts.map(([x, y, z]) => [
        x * Math.cos(rot) + z * Math.sin(rot), y
      ]);

      // dynamic color — contrast against sky
      const bgM = getSkyColorAt(pu.y);
      const multiCol = contrastColor(255, 221, 68, bgM[0], bgM[1], bgM[2]);
      ctx.strokeStyle = multiCol;
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      for (const [a, b] of edges) {
        ctx.moveTo(proj[a][0], proj[a][1]);
        ctx.lineTo(proj[b][0], proj[b][1]);
      }
      ctx.stroke();

      // "×2" label
      ctx.font = `800 ${Math.round(s * 0.65)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = multiCol;
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillText('\u00d72', 0, 0);

      ctx.restore();
    }
  }

  // ---- SHIELD POWERUP (invincibility — 3D wireframe star) ----
  function drawShieldPowerups() {
    for (const sp of shieldPowerups) {
      if (sp.x < -60 || sp.x > W + 60) continue;
      ctx.save();
      ctx.translate(sp.x, sp.y);
      let alpha = 1, sc = 1;
      if (sp.collected) {
        const t = sp.collectTimer / 18;
        alpha = t * t;
        sc = 1 + (1 - t) * 0.8;
      }
      ctx.globalAlpha = alpha;
      ctx.scale(sc, sc);
      const s = sp.size;
      const rot = sp.rot;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);

      // 3D star: 5 outer points + 5 inner points, extruded front/back
      const outerR = s * 1.0, innerR = s * 0.4, depth = s * 0.5;
      const verts3D = [];
      // front face star (z = -depth)
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? outerR : innerR;
        verts3D.push([r * Math.cos(angle), r * Math.sin(angle), -depth]);
      }
      // back face star (z = +depth)
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? outerR : innerR;
        verts3D.push([r * Math.cos(angle), r * Math.sin(angle), depth]);
      }

      // edges: front face, back face, connectors
      const edges = [];
      for (let i = 0; i < 10; i++) { edges.push([i, (i + 1) % 10]); }           // front
      for (let i = 0; i < 10; i++) { edges.push([10 + i, 10 + (i + 1) % 10]); } // back
      for (let i = 0; i < 10; i++) { edges.push([i, 10 + i]); }                  // sides

      // Rotate around Y axis only (horizontal spin)
      const proj = verts3D.map(([x, y, z]) => {
        const rx = x * cosR + z * sinR;
        return [rx, y];
      });

      // dynamic color — contrast against sky
      const bgS = getSkyColorAt(sp.y);
      const shieldCol = contrastColor(255, 255, 255, bgS[0], bgS[1], bgS[2]);
      ctx.strokeStyle = shieldCol;
      ctx.lineWidth = 1.2;

      ctx.beginPath();
      for (const [a, b] of edges) {
        ctx.moveTo(proj[a][0], proj[a][1]);
        ctx.lineTo(proj[b][0], proj[b][1]);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- ROLL POWERUP (barrel roll charge — 3D wireframe extruded arrow) ----
  function drawRollPowerups() {
    for (const rp of rollPowerups) {
      if (rp.x < -60 || rp.x > W + 60) continue;
      ctx.save();
      ctx.translate(rp.x, rp.y);
      let alpha = 1, sc = 1;
      if (rp.collected) {
        const t = rp.collectTimer / 18;
        alpha = t * t;
        sc = 1 + (1 - t) * 0.8;
      }
      ctx.globalAlpha = alpha;
      ctx.scale(sc, sc);
      const s = rp.size;
      const rot = rp.rot;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);

      // Arrow shape: 7 vertices forming a right-pointing arrow
      const d = s * 0.5; // depth (half extrusion)
      const arrow2D = [
        [s * 0.7, 0],       // 0: tip (right)
        [s * 0.1, -s * 0.5],  // 1: top of head
        [s * 0.1, -s * 0.2],  // 2: inner top
        [-s * 0.6, -s * 0.2], // 3: tail top
        [-s * 0.6, s * 0.2],  // 4: tail bottom
        [s * 0.1, s * 0.2],   // 5: inner bottom
        [s * 0.1, s * 0.5],   // 6: bottom of head
      ];

      // Extrude: front face (z=-d) + back face (z=+d)
      const verts3D = [];
      for (const [x, y] of arrow2D) verts3D.push([x, y, -d]);
      for (const [x, y] of arrow2D) verts3D.push([x, y, d]);
      const n = arrow2D.length;

      // Edges: front face, back face, side connectors
      const edges = [];
      for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
      for (let i = 0; i < n; i++) edges.push([n + i, n + (i + 1) % n]);
      for (let i = 0; i < n; i++) edges.push([i, n + i]);

      // Rotate around Y axis only (horizontal spin)
      const proj = verts3D.map(([x, y, z]) => [x * cosR + z * sinR, y]);

      // dynamic color — contrast against sky
      const bgRc = getSkyColorAt(rp.y);
      const rollCol = contrastColor(0, 221, 255, bgRc[0], bgRc[1], bgRc[2]);
      ctx.strokeStyle = rollCol;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const [a, b] of edges) {
        ctx.moveTo(proj[a][0], proj[a][1]);
        ctx.lineTo(proj[b][0], proj[b][1]);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawSparkles() {
    if (!invincible || sparkles.length === 0) return;
    ctx.save();
    ctx.fillStyle = '#fff';
    for (const s of sparkles) {
      const t = s.life / 25;
      ctx.globalAlpha = t * 0.8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- WIND GUST STREAKS ----
  function drawGustStreaks() {
    if (gustStreaks.length === 0) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const s of gustStreaks) {
      const t = s.life / s.maxLife;
      ctx.globalAlpha = t * 0.6;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1 + t;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.len * t, s.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- PARTICLES ----
  function drawParticles() {
    for (const p of particles) {
      const t = p.life / p.maxLife;
      ctx.globalAlpha = t * 0.8;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPointPopups() {
    for (const pp of pointPopups) {
      const alpha = Math.min(pp.life / 40, 1);
      ctx.globalAlpha = alpha;
      ctx.font = `700 18px ${FONT}`;
      ctx.fillStyle = pp.color || '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(pp.text, pp.x, pp.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---- wind trail (flowing scarf from wing tips) ----
  function drawTrail() {
    if (trail.length < 4) return;
    ctx.save();
    ctx.lineCap = 'round';
    // two ribbons — one from each wing tip
    const edges = [
      { key: 'u', width: 2.5, alpha: 0.14 },  // upper wing tip
      { key: 'l', width: 2.5, alpha: 0.14 },  // lower wing tip
    ];
    for (const e of edges) {
      const xk = e.key + 'x', yk = e.key + 'y';
      ctx.beginPath();
      ctx.moveTo(trail[0][xk], trail[0][yk]);
      for (let i = 1; i < trail.length - 1; i++) {
        const t = i / (trail.length - 1);
        const pt = trail[i], ptN = trail[Math.min(i + 1, trail.length - 1)];
        const flutter = Math.sin(i * 0.35 + frameCount * 0.06) * 1.5 * t;
        const cpx = (pt[xk] + ptN[xk]) / 2;
        const cpy = (pt[yk] + ptN[yk]) / 2 + flutter;
        ctx.quadraticCurveTo(pt[xk], pt[yk] + flutter * 0.6, cpx, cpy);
      }
      const first = trail[0], last = trail[trail.length - 1];
      const grad = ctx.createLinearGradient(first[xk], 0, last[xk], 0);
      const tc = invincible ? '255,255,255' : '0,0,0';
      grad.addColorStop(0, `rgba(${tc},${e.alpha})`);
      grad.addColorStop(0.5, `rgba(${tc},${e.alpha * 0.5})`);
      grad.addColorStop(1, `rgba(${tc},0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = e.width;
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- BIRD (swift — crescent wings, anchor silhouette) ----
  function drawPlayer() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);
    // barrel roll animation — horizontal axis flip (like a cylinder rolling)
    if (barrelRolling) {
      const rollP = 1 - barrelRollTimer / BARREL_ROLL_DUR;
      const eased = rollP * rollP * (3 - 2 * rollP); // smoothstep
      ctx.scale(1, Math.cos(eased * Math.PI * 2)); // 1 full rotation over 0.6s
    }
    ctx.scale(BIRD_SCALE, BIRD_SCALE);
    ctx.fillStyle = invincible ? '#fff' : '#000';
    if (barrelRolling) { ctx.globalAlpha = 0.55; }

    // Wings spread wider when rising, relax when falling (smoothed)
    const w = wingState;

    ctx.beginPath();
    ctx.moveTo(14, 0);                                              // beak tip
    ctx.quadraticCurveTo(10, -1.5, 4, -2);                          // head
    ctx.bezierCurveTo(-2, -2.8 + w * 0.15, -10, -6 + w, -20, -4.5 + w * 0.7); // upper wing crescent
    ctx.quadraticCurveTo(-15, -2.5 + w * 0.2, -10, 0);             // wing trailing edge to center
    ctx.lineTo(-10, 0);                                             // center join
    // lower wing starts from same point
    ctx.quadraticCurveTo(-15, 2.5 - w * 0.2, -20, 4.5 - w * 0.7); // lower wing crescent
    ctx.bezierCurveTo(-10, 6 - w, -2, 2.8 - w * 0.15, 4, 2);      // lower wing return
    ctx.quadraticCurveTo(10, 1.5, 14, 0);                           // belly to beak
    ctx.closePath();
    ctx.fill();

    // white glowing tail when invincible (no shadow)
    if (invincible) {
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.6 + Math.sin(frameCount * 0.15) * 0.2;
      ctx.beginPath();
      ctx.moveTo(-10, -1);
      ctx.lineTo(-18, 0);
      ctx.lineTo(-10, 1);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // No morph — launch spawns a particle burst and immediately switches to flight form

  let perchBlinkTimer = 0;

  // ---- CANVAS-DRAWN PERCH BIRD (body + separate head) ----
  // All coordinates relative to wire contact point (0,0 = feet on wire)
  // Neck pivot where head attaches to body
  const NECK_PX = 1, NECK_PY = -38;

  const PERCH_SCALE = 1.242;

  function drawPerchBodyAt(ox, oy) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(PERCH_SCALE, PERCH_SCALE);
    ctx.fillStyle = '#000';

    // Solid body: neck-front → chest → belly → feet → rump → tail → back → neck
    ctx.beginPath();
    ctx.moveTo(-3, -38);
    // chest (rounds out left)
    ctx.bezierCurveTo(-14, -32, -16, -22, -14, -14);
    // belly curves to feet
    ctx.bezierCurveTo(-12, -6, -6, 0, -1, 2);
    // feet on wire
    ctx.lineTo(1, 2);
    ctx.lineTo(3, 1);
    // rump curves into back going up
    ctx.bezierCurveTo(6, 0, 10, -6, 12, -14);
    // back going up (smooth convex curve)
    ctx.bezierCurveTo(14, -18, 14, -24, 12, -28);
    // upper back to neck
    ctx.bezierCurveTo(10, -34, 7, -38, 4, -38);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawPerchHeadAt(ox, oy, angle) {
    ctx.save();
    ctx.translate(ox + NECK_PX * PERCH_SCALE, oy + NECK_PY * PERCH_SCALE);
    ctx.scale(PERCH_SCALE, PERCH_SCALE);
    ctx.rotate(angle);
    ctx.fillStyle = '#000';

    ctx.beginPath();
    // start at bottom center
    ctx.moveTo(0, 4);
    // curve out to left neck and up
    ctx.bezierCurveTo(-5, 6, -8, 4, -9, -2);
    // left neck to back of head
    ctx.bezierCurveTo(-10, -6, -9, -12, -6, -14);
    // back of head dome
    ctx.bezierCurveTo(-4, -16, 0, -17, 2, -16);
    // crown curving to forehead
    ctx.bezierCurveTo(6, -16, 9, -14, 10, -11);
    // forehead to beak (long beak)
    ctx.bezierCurveTo(12, -10, 16, -9, 20, -8);
    // beak tip
    ctx.lineTo(21, -7);
    // under beak
    ctx.lineTo(15, -6);
    // chin
    ctx.bezierCurveTo(10, -4, 7, -2, 6, 0);
    // right neck curving down to bottom center
    ctx.bezierCurveTo(6, 4, 5, 6, 0, 4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawPerchingBird() {
    drawPerchBodyAt(bird.x, bird.y);
    drawPerchHeadAt(bird.x, bird.y, perchHeadAngle);
  }

  function drawStaticPerchBird() {
    if (perchBirdX < -50) return;
    drawPerchBodyAt(perchBirdX, perchBirdY);
    drawPerchHeadAt(perchBirdX, perchBirdY, 0);
  }

  /* PAPER AIRPLANE (preserved for revert):
  function drawPaperAirplane() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);
    ctx.scale(BIRD_SCALE, BIRD_SCALE);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(22, -0.5); ctx.lineTo(-14, -10); ctx.lineTo(-6, -0.8);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(22, 0.5); ctx.lineTo(-14, 10); ctx.lineTo(-6, 0.8);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(4, 0.8); ctx.lineTo(-6, 3); ctx.lineTo(-10, 2.2); ctx.lineTo(-6, 0.8);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  */

  // Offscreen canvas for knockout-text button

  function drawVignette() {
    const grad = ctx.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, W * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // =========================================================
  //  UI
  // =========================================================
  function drawUI() {
    if (state === STATE.HOME) {
      // fade in from achievements closing
      if (achTransDir === -1 && achTransition < 1) {
        const t = achTransition;
        const ease = t * (2 - t); // ease-out
        ctx.save();
        ctx.globalAlpha = ease;
        ctx.translate((1 - ease) * -30, 0);
        drawHomeScreen(); drawAchievementsIcon(); drawZenToggle(); drawMusicToggle();
        ctx.restore();
      } else {
        drawHomeScreen(); drawAchievementsIcon(); /* drawLeaderboardBtn(); */ drawZenToggle(); drawMusicToggle(); /* drawSkipButton(); */
      }
      return;
    }
    if (state === STATE.LEADERBOARD) { drawLeaderboardScreen(); drawMusicToggle(); /* drawSkipButton(); */ return; }
    if (state === STATE.ACHIEVEMENTS) {
      // fade/slide in from home
      if (achTransDir === 1 && achTransition < 1) {
        const t = achTransition;
        const ease = t * (2 - t); // ease-out
        ctx.save();
        ctx.globalAlpha = ease;
        ctx.translate((1 - ease) * 30, 0);
        drawAchievementsScreen(); drawMusicToggle();
        ctx.restore();
      } else {
        drawAchievementsScreen(); drawMusicToggle(); /* drawSkipButton(); */
      }
      return;
    }

    drawDistanceDisplay();
    drawMusicToggle(); /* drawSkipButton(); */

    if (state === STATE.PAUSE) drawPauseOverlay();
    if (state === STATE.DEAD) drawDeathOverlay();
    drawToast();
    if (rollTutorialActive) drawRollTutorial();
  }

  function drawDistanceDisplay() {
    const d = Math.max(0, displayDist);
    let text;
    if (d >= 1000) text = (d / 1000).toFixed(2) + ' km';
    else text = Math.floor(d) + ' m';
    ctx.save();
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.font = `400 64px "Antique33", ${FONT}`;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillText(text, W - 19, 15);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, W - 20, 14);
    {
      ctx.font = `400 45px "Antique33", ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(points + ' pts', W - 20, 72);
    }
    if (multiplier > 1) {
      const cx = W - 40, cy = 150, cr = 18;
      // circular progress outline (depletes as timer runs out)
      const progress = Math.max(0, multiplierTimer / 1200); // 0→1
      ctx.strokeStyle = 'rgba(255,221,68,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();
      ctx.font = `700 16px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffdd44';
      ctx.fillText('\u00d7' + multiplier, cx, cy);
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    }
    if (invincible) {
      const iy = multiplier > 1 ? 196 : 150;
      const ix = W - 40, ir = 18;
      const iProg = Math.max(0, invincibleTimer / INVINCIBLE_DUR);
      ctx.strokeStyle = 'rgba(255,246,200,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ix, iy, ir, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * iProg);
      ctx.stroke();
      // star icon
      ctx.fillStyle = '#FFF6C8';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
        const aInner = a + Math.PI / 5;
        ctx.lineTo(ix + Math.cos(a) * 9, iy + Math.sin(a) * 9);
        ctx.lineTo(ix + Math.cos(aInner) * 4, iy + Math.sin(aInner) * 4);
      }
      ctx.closePath();
      ctx.fill();
    }
    // roll charges
    if (rollCharges > 0) {
      let ry = 150;
      if (multiplier > 1) ry += 46;
      if (invincible) ry += 46;
      const rx = W - 40;
      // outline circle (not filled)
      ctx.strokeStyle = '#00ddff';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(rx, ry, 18, 0, Math.PI * 2);
      ctx.stroke();
      // twist icon — two arrows that cross/swap vertically
      ctx.save();
      ctx.translate(rx, ry);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      // top arrow: starts top-left, curves down to bottom-right
      ctx.beginPath();
      ctx.moveTo(-8, -5);
      ctx.bezierCurveTo(-2, -5, 2, 5, 8, 5);
      ctx.stroke();
      // arrowhead top arrow (pointing right-down)
      ctx.beginPath();
      ctx.moveTo(5, 2); ctx.lineTo(8, 5); ctx.lineTo(5, 8);
      ctx.stroke();
      // bottom arrow: starts bottom-left, curves up to top-right
      ctx.beginPath();
      ctx.moveTo(-8, 5);
      ctx.bezierCurveTo(-2, 5, 2, -5, 8, -5);
      ctx.stroke();
      // arrowhead bottom arrow (pointing right-up)
      ctx.beginPath();
      ctx.moveTo(5, -8); ctx.lineTo(8, -5); ctx.lineTo(5, -2);
      ctx.stroke();
      ctx.restore();
      // counter badge — filled blue circle top-right
      ctx.globalAlpha = 1;
      const bx = rx + 13, by = ry - 14;
      ctx.fillStyle = '#00ddff';
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = `700 10px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(rollCharges, bx, by);
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    }
    ctx.restore();
  }

  function drawMusicToggle() {
    const iconName = musicOn ? 'volume-2' : 'volume-x';
    const entry = lucideImgs[iconName];
    if (!entry || !entry.loaded) return;
    const x = W - 28, y = H - 28, size = 22;
    ctx.save();
    ctx.globalAlpha = 0.35;
    const dpr = window.devicePixelRatio || 1;
    const s = Math.ceil(size * dpr);
    _iconCvs.width = s; _iconCvs.height = s;
    _iconCtx.clearRect(0, 0, s, s);
    _iconCtx.drawImage(entry.img, 0, 0, s, s);
    _iconCtx.globalCompositeOperation = 'source-in';
    _iconCtx.fillStyle = '#FFF6C8';
    _iconCtx.fillRect(0, 0, s, s);
    _iconCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(_iconCvs, x - size / 2, y - size / 2, size, size);
    ctx.restore();
  }

  function drawSkipButton() {
    const x = W - 72, y = H - 28;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#FFF6C8';
    ctx.strokeStyle = '#FFF6C8';
    ctx.lineWidth = 1.5;
    // skip icon: two right-pointing triangles + end bar
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 6); ctx.lineTo(x - 1, y); ctx.lineTo(x - 8, y + 6);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y - 6); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 6);
    ctx.closePath(); ctx.fill();
    // end bar
    ctx.fillRect(x + 8, y - 6, 2, 12);
    ctx.restore();
  }

  function drawZenToggle() {
    // smooth transition
    zenT += ((zenMode ? 1 : 0) - zenT) * 0.12;
    if (zenT < 0.01) zenT = 0;
    if (zenT > 0.99) zenT = 1;

    const fade = homePhase === 0 ? Math.min(homePhaseTimer / 50, 1) : Math.min(homePhaseTimer / 56, 1);
    ctx.save();
    ctx.globalAlpha = fade * (0.35 + zenT * 0.65);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `400 13px ${FONT}`;
    const zg = Math.round(246 + zenT * 9), zb = Math.round(200 + zenT * 55);
    ctx.fillStyle = `rgb(255,${zg},${zb})`;
    const tw = 22, th = 12, tr = 6;
    const textW = ctx.measureText('zen mode').width;
    const totalW = textW + 6 + tw;
    const startX = W / 2 - totalW / 2;
    const ty = H - 28;
    ctx.textAlign = 'left';
    ctx.fillText('zen mode', startX, ty);
    // toggle indicator
    const ix = startX + textW + 6 + tw / 2, iy = ty;
    ctx.strokeStyle = `rgb(255,${zg},${zb})`; ctx.lineWidth = 1;
    roundRect(ix - tw / 2, iy - th / 2, tw, th, tr);
    ctx.stroke();
    // knob (slides smoothly)
    const offX = ix - tw / 2 + tr;
    const onX = ix + tw / 2 - tr;
    const knobX = offX + (onX - offX) * zenT;
    ctx.beginPath();
    ctx.arc(knobX, iy, 4, 0, Math.PI * 2);
    const knobAlpha = 0.6 + zenT * 0.4;
    ctx.fillStyle = `rgba(255,${zg},${zb},${knobAlpha})`;
    ctx.fill();
    ctx.restore();
  }

  function drawLeaderboardIcon(x, y, size, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#FFF6C8';
    // podium bars (3 bars — 1st tallest center, 2nd left, 3rd right)
    const s = size / 2;
    const bw = s * 0.48, gap = s * 0.1;
    const bottom = s * 0.7;
    // 2nd place (left)
    ctx.fillRect(-bw * 1.5 - gap, -s * 0.3, bw, s * 0.3 + bottom);
    // 1st place (center, tallest)
    ctx.fillRect(-bw / 2, -s * 0.8, bw, s * 0.8 + bottom);
    // 3rd place (right)
    ctx.fillRect(bw * 0.5 + gap, s * 0.05, bw, -s * 0.05 + bottom);
    ctx.restore();
  }

  function drawHomeScreen() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    if (homePhase === 0) {
      // Phase 0: Title with slow fade-in
      const titleFade = Math.min(homePhaseTimer / 50, 1); // ~0.8s fade
      ctx.globalAlpha = titleFade;
      const tY = H / 2 - 20;
      ctx.fillStyle = '#FFF6C8'; ctx.font = `400 148px "Antique33", ${FONT}`;
      ctx.letterSpacing = '0px';
      // hover detection on title text
      const titleW = ctx.measureText('Dusk Rider').width;
      const titleH = 148 * 0.75;
      const titleHovered = mouseX > W / 2 - titleW / 2 && mouseX < W / 2 + titleW / 2 && mouseY > tY - titleH / 2 && mouseY < tY + titleH / 2;
      titleHoverT += ((titleHovered ? 1 : 0) - titleHoverT) * 0.12;
      if (titleHoverT < 0.01) titleHoverT = 0;
      const tsc = 1 + titleHoverT * 0.02;
      ctx.save();
      ctx.translate(W / 2, tY);
      ctx.scale(tsc, tsc);
      ctx.translate(-W / 2, -tY);
      ctx.fillText('Dusk Rider', W / 2, tY);
      ctx.restore();
      ctx.globalAlpha = 1;
    } else {
      // fading title overlay during transition
      if (titleFadeOut > 0) {
        ctx.globalAlpha = titleFadeOut / 30;
        const tY = H / 2 - 20;
        ctx.fillStyle = '#FFF6C8'; ctx.font = `400 148px "Antique33", ${FONT}`;
        ctx.letterSpacing = '0px';
        ctx.fillText('Dusk Rider', W / 2, tY);
        ctx.globalAlpha = 1;
      }
      // Phase 1: Instructional text (fade in after title fades out)
      const fadeIn = clamp((homePhaseTimer - 30) / 30, 0, 1);
      ctx.globalAlpha = fadeIn * 0.8;
      ctx.fillStyle = '#FFF6C8';
      ctx.font = `400 22px ${FONT}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const prefix = 'Hold ';
      const suffix = ' to rise \u2022 Release to fall';
      const keyLabel = 'space';
      const keyFont = `500 17px ${FONT}`;
      // measure parts to center the whole thing
      const prefW = ctx.measureText(prefix).width;
      ctx.font = keyFont;
      const keyTextW = ctx.measureText(keyLabel).width;
      const keyPadX = 14, keyH = 26, keyR = 6;
      const keyW = keyTextW + keyPadX * 2;
      ctx.font = `400 22px ${FONT}`;
      const sufW = ctx.measureText(suffix).width;
      const totalW = prefW + keyW + 10 + sufW;
      const startX = W / 2 - totalW / 2;
      const cy = H / 2;
      // draw prefix
      ctx.fillText(prefix, startX, cy);
      // draw key cap
      const kx = startX + prefW + 5;
      const ky = cy - keyH / 2;
      ctx.strokeStyle = 'rgba(255,246,200,0.6)';
      ctx.lineWidth = 1.2;
      roundRect(kx, ky, keyW, keyH, keyR);
      ctx.stroke();
      // thicker bottom edge tapering into corners to mimic physical space bar
      ctx.strokeStyle = '#FFF6C8';
      // left corner taper: draw small segments from top (thin) to bottom (thick)
      const cornerSteps = 6;
      for (let ci = 0; ci < cornerSteps; ci++) {
        const t0 = ci / cornerSteps, t1 = (ci + 1) / cornerSteps;
        ctx.lineWidth = lerp(1.2, 3, t0);
        ctx.beginPath();
        // left corner: arc from side to bottom
        const la0 = Math.PI - t0 * (Math.PI / 2), la1 = Math.PI - t1 * (Math.PI / 2);
        ctx.arc(kx + keyR, ky + keyH - keyR, keyR, la0, la1, true);
        ctx.stroke();
        // right corner: arc from bottom to side
        ctx.lineWidth = lerp(3, 1.2, t0);
        ctx.beginPath();
        const ra0 = (Math.PI / 2) - t0 * (Math.PI / 2), ra1 = (Math.PI / 2) - t1 * (Math.PI / 2);
        ctx.arc(kx + keyW - keyR, ky + keyH - keyR, keyR, ra0, ra1, true);
        ctx.stroke();
      }
      // flat bottom
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(kx + keyR, ky + keyH);
      ctx.lineTo(kx + keyW - keyR, ky + keyH);
      ctx.stroke();
      // key label
      ctx.font = keyFont;
      ctx.textAlign = 'center';
      ctx.fillText(keyLabel, kx + keyW / 2, cy - 1);
      // draw suffix
      ctx.font = `400 22px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(suffix, kx + keyW + 5, cy);
      ctx.textAlign = 'center';
      ctx.globalAlpha = 1;
    }
  }

  function drawLeaderboardScreen() {

    // back button (same as achievements page)
    const bx = 32, by = 34;
    const t = backHoverT;
    ctx.save();
    const bsc = 1 + t * 0.05;
    ctx.translate(bx, by);
    ctx.scale(bsc, bsc);
    ctx.translate(-bx, -by);
    const circleAlpha = 0.12 + t * 0.13;
    ctx.beginPath();
    ctx.arc(bx, by, 18, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,246,200,${circleAlpha})`;
    ctx.fill();
    const chevronAlpha = 0.8 + t * 0.2;
    ctx.strokeStyle = `rgba(255,246,200,${chevronAlpha})`; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx + 1, by - 4);
    ctx.lineTo(bx - 3, by);
    ctx.lineTo(bx + 1, by + 4);
    ctx.stroke();
    ctx.restore();

    // title
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFF6C8'; ctx.font = `400 90px "Antique33", ${FONT}`;
    ctx.fillText('Leaderboard', W / 2, 80);

    if (scores.length === 0) {
      ctx.fillStyle = 'rgba(255,246,200,0.5)'; ctx.font = `300 20px ${FONT}`;
      ctx.fillText('No flights yet', W / 2, H / 2);
      return;
    }

    // 2 columns of 10
    const rowH = 34;
    const colW = Math.min(320, W * 0.38);
    const gapX = 24;
    const gridW = colW * 2 + gapX;
    const gridX = (W - gridW) / 2;
    const gridTopY = Math.max(140, (H - rowH * 10) / 2);

    for (let i = 0; i < 20; i++) {
      const col = i < 10 ? 0 : 1;
      const row = i < 10 ? i : i - 10;
      const ax = gridX + col * (colW + gapX);
      const ay = gridTopY + row * rowH;
      const has = i < scores.length;
      const alpha = has ? 0.8 : 0.2;

      // rank number
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(255,246,200,${alpha * 0.6})`;
      ctx.font = `300 14px ${FONT}`;
      ctx.fillText((i + 1) + '.', ax + 24, ay + rowH / 2);

      if (has) {
        const s = scores[i];
        const dText = s.dist >= 1000 ? (s.dist / 1000).toFixed(2) + ' km' : s.dist + ' m';
        // name
        ctx.textAlign = 'left';
        ctx.fillStyle = `rgba(255,246,200,${alpha})`;
        ctx.font = `400 15px ${FONT}`;
        ctx.fillText(s.name, ax + 32, ay + rowH / 2);
        // distance (right-aligned)
        ctx.textAlign = 'right';
        ctx.fillStyle = `rgba(255,246,200,${alpha * 0.8})`;
        ctx.font = `300 14px ${FONT}`;
        ctx.fillText(dText, ax + colW, ay + rowH / 2);
      } else {
        ctx.textAlign = 'left';
        ctx.fillStyle = `rgba(255,246,200,${alpha})`;
        ctx.font = `300 15px ${FONT}`;
        ctx.fillText('—', ax + 32, ay + rowH / 2);
      }
    }
  }

  // offscreen canvas for tinting SVG icons white
  const _iconCvs = document.createElement('canvas');
  const _iconCtx = _iconCvs.getContext('2d');

  function drawTintedIcon(img, loaded, x, y, size, hoverT, color, baseAlpha) {
    if (!loaded) return;
    ctx.save();
    const fade = homePhase === 0 ? Math.min(homePhaseTimer / 50, 1) : Math.min(homePhaseTimer / 56, 1);
    const a0 = baseAlpha != null ? baseAlpha : 0.4;
    ctx.globalAlpha = (a0 + hoverT * (1 - a0)) * fade;
    const sc = 1 + hoverT * 0.05;
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    // draw to offscreen at DPR resolution, then tint
    const dpr = window.devicePixelRatio || 1;
    const s = Math.ceil(size * dpr);
    _iconCvs.width = s;
    _iconCvs.height = s;
    _iconCtx.clearRect(0, 0, s, s);
    _iconCtx.drawImage(img, 0, 0, s, s);
    _iconCtx.globalCompositeOperation = 'source-in';
    _iconCtx.fillStyle = color;
    _iconCtx.fillRect(0, 0, s, s);
    _iconCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(_iconCvs, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  function drawAchievementsIcon() {
    const t = medalHoverT;
    drawTintedIcon(achIconImg, achIconLoaded, W - 40, 40, 36, t, '#ffffff', 1);
  }

  function drawLeaderboardBtn() {
    const t = lbHoverT;
    drawTintedIcon(lbIconImg, lbIconLoaded, W - 40, 84, 32, t, '#FFF6C8');
  }

  let achCardHovered = false;
  function drawAchievementsScreen() {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    achCardHovered = false;

    // back button (top-left): circle + left chevron
    const bx = 32, by = 34;
    const t = backHoverT;
    ctx.save();
    // scale 5% on hover, centered on button
    const bsc = 1 + t * 0.05;
    ctx.translate(bx, by);
    ctx.scale(bsc, bsc);
    ctx.translate(-bx, -by);
    const circleAlpha = 0.12 + t * 0.13;
    ctx.beginPath();
    ctx.arc(bx, by, 18, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,246,200,${circleAlpha})`;
    ctx.fill();
    const chevronAlpha = 0.8 + t * 0.2;
    ctx.strokeStyle = `rgba(255,246,200,${chevronAlpha})`; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx + 1, by - 4);
    ctx.lineTo(bx - 3, by);
    ctx.lineTo(bx + 1, by + 4);
    ctx.stroke();
    ctx.restore();

    // title
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff'; ctx.font = `400 90px "Antique33", ${FONT}`;
    ctx.fillText('Achievements', W / 2, 80);

    // count unlocked
    const unlockCount = Object.keys(unlockedAch).length;
    ctx.font = `300 20px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(unlockCount + ' / ' + ACHIEVEMENTS.length, W / 2, 149);

    // grid layout: 2 columns
    const colW = Math.min(390, W * 0.36);
    const rowH = 72;
    const gapX = 7;
    const cols = 2;
    const totalW = colW * cols + gapX;
    const baseX = (W - totalW) / 2;
    const rows = Math.ceil(ACHIEVEMENTS.length / cols);
    const gridH = rows * rowH;
    const titleBlockH = 170; // title + counter space
    const gridTopY = Math.max(titleBlockH, (H - gridH) / 2);

    for (let i = 0; i < ACHIEVEMENTS.length; i++) {
      const ach = ACHIEVEMENTS[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ax = baseX + col * (colW + gapX);
      const ay = gridTopY + row * rowH;

      if (ay + rowH < 140 || ay > H + 10) continue;

      const unlocked = !!unlockedAch[ach.id];

      // hover detection
      const cardH = rowH - 7;
      const hovered = mouseX >= ax && mouseX <= ax + colW && mouseY >= ay && mouseY <= ay + cardH;
      if (hovered) achCardHovered = true;

      ctx.save();

      if (!unlocked && !hovered) ctx.globalAlpha = 0.6;
      ctx.fillStyle = hovered ? 'rgba(255,255,255,0.45)' : (unlocked ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.25)');
      roundRect(ax, ay, colW, cardH, 13);
      ctx.fill();

      // icon — colored on hover for unlocked achievements
      const cardMidY = ay + cardH / 2 + 1;
      const lockedHover = !unlocked && hovered;
      const achColor = (unlocked && hovered) ? ACH_HOVER_COLOR : null;
      if (lockedHover) ctx.save();
      if (lockedHover) ctx.globalAlpha = 1;
      drawAchievementIcon(ach.icon, ax + 31, cardMidY, 25, unlocked || lockedHover, achColor);

      // text (+12px right of icon, +3px lower for vertical centering)
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = unlocked || lockedHover ? '#ffffff' : 'rgba(255,255,255,0.6)';
      ctx.font = `600 14px ${FONT}`;
      ctx.fillText(ach.name, ax + 62, cardMidY - 9);
      ctx.font = `400 14px ${FONT}`;
      ctx.fillStyle = unlocked || lockedHover ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.5)';
      ctx.fillText(ach.desc, ax + 62, cardMidY + 10);
      if (lockedHover) ctx.restore();

      // medal icon with circle for unlocked
      if (unlocked) {
        const ckX = ax + colW - 36, ckY = cardMidY;
        ctx.save();
        ctx.globalAlpha = hovered ? 0.5 : 0.25;
        ctx.strokeStyle = achColor || '#ffffff'; ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(ckX, ckY, 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (medalLoaded) {
          const iconSz = 33;
          const dpr = window.devicePixelRatio || 1;
          const s = Math.ceil(iconSz * dpr);
          _iconCvs.width = s; _iconCvs.height = s;
          _iconCtx.clearRect(0, 0, s, s);
          _iconCtx.drawImage(medalImg, 0, 0, s, s);
          _iconCtx.globalCompositeOperation = 'source-in';
          _iconCtx.fillStyle = achColor || '#fff';
          _iconCtx.fillRect(0, 0, s, s);
          _iconCtx.globalCompositeOperation = 'source-over';
          ctx.drawImage(_iconCvs, ckX - iconSz / 2, ckY - iconSz / 2, iconSz, iconSz);
        }
        ctx.restore();
      }
      ctx.restore(); // restore locked opacity
    }
  }

  function playToastSound() {
    if (!musicOn) return;
    const ac = getSfx();
    // bright chime: two quick ascending tones
    [523, 659, 784].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain); gain.connect(ac.destination);
      osc.type = 'sine';
      const t = ac.currentTime + i * 0.08;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.linearRampToValueAtTime(0.09, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.start(t); osc.stop(t + 0.55);
    });
  }

  function drawToast() {
    if (!activeToast && toastQueue.length > 0) {
      const t = toastQueue.shift();
      activeToast = { ...t, timer: 0, phase: 'in' };
      playToastSound();
    }
    if (!activeToast) return;

    const t = activeToast;
    t.timer++;
    const SLIDE_IN = 18, HOLD = 180, SLIDE_OUT = 14;

    let slideY = 0, alpha = 1;
    if (t.phase === 'in') {
      const p = Math.min(t.timer / SLIDE_IN, 1);
      slideY = (1 - p * p) * -80;
      alpha = p;
      if (p >= 1) { t.phase = 'hold'; t.timer = 0; }
    } else if (t.phase === 'hold') {
      if (t.timer >= HOLD) { t.phase = 'out'; t.timer = 0; }
    } else if (t.phase === 'out') {
      const p = Math.min(t.timer / SLIDE_OUT, 1);
      slideY = -p * p * 80;
      alpha = 1 - p;
      if (p >= 1) { activeToast = null; return; }
    }

    const tw = Math.round(328 * 1.1 * 1.15), th = Math.round(65 * 1.1) + 6;
    const tx = (W - tw) / 2;
    const ty = 20 + slideY;

    ctx.save();
    ctx.globalAlpha = alpha;

    // shadow
    // translucent card background
    roundRect(tx, ty, tw, th, 25);
    ctx.fillStyle = 'rgba(255,246,200,0.08)';
    ctx.fill();

    // icon
    const midY = ty + th / 2 + 1;
    drawAchievementIcon(t.icon, tx + 31, midY, 25, true);

    // text (matching card text styling)
    const textX = tx + 62;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

    ctx.font = `600 14px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(t.name, textX, midY - 9);

    const ach = ACHIEVEMENTS.find(a => a.id === t.id);
    if (ach) {
      ctx.font = `400 14px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(ach.desc, textX, midY + 10);
    }

    // white medal icon with outline circle (right side of toast)
    const ckX = tx + tw - 44, ckY = midY;
    ctx.globalAlpha = alpha * 0.25;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(ckX, ckY, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    if (medalLoaded) {
      const iconSz = 33;
      const dpr = window.devicePixelRatio || 1;
      const s = Math.ceil(iconSz * dpr);
      _iconCvs.width = s; _iconCvs.height = s;
      _iconCtx.clearRect(0, 0, s, s);
      _iconCtx.drawImage(medalImg, 0, 0, s, s);
      _iconCtx.globalCompositeOperation = 'source-in';
      _iconCtx.fillStyle = '#fff';
      _iconCtx.fillRect(0, 0, s, s);
      _iconCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(_iconCvs, ckX - iconSz / 2, ckY - iconSz / 2, iconSz, iconSz);
    }

    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawPauseOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.27)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // distance (large, centered)
    const d = distance | 0;
    const dText = d >= 1000 ? (d / 1000).toFixed(2) + ' km' : d + ' m';
    ctx.fillStyle = '#fff'; ctx.font = `400 126px "Antique33", ${FONT}`;
    ctx.letterSpacing = '-3px';
    ctx.fillText(dText, W / 2, H / 2 - 50);
    ctx.letterSpacing = '0px';

    // points (below distance)
    ctx.font = `400 42px "Antique33", ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(points + ' pts', W / 2, H / 2 + 30);

    // instruction text
    ctx.font = `400 14px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.31)';
    ctx.textAlign = 'center';
    ctx.fillText('Click anywhere to resume', W / 2, H / 2 + 84);
    ctx.fillText('Press R to restart', W / 2, H / 2 + 103);
  }

  function drawDeathOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.27)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // distance (large, centered — matching pause style)
    const d = distance | 0;
    const dText = d >= 1000 ? (d / 1000).toFixed(2) + ' km' : d + ' m';
    ctx.fillStyle = '#fff'; ctx.font = `400 126px "Antique33", ${FONT}`;
    ctx.letterSpacing = '-3px';
    ctx.fillText(dText, W / 2, H / 2 - 50);
    ctx.letterSpacing = '0px';

    // points (below distance)
    ctx.font = `400 42px "Antique33", ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(points + ' pts', W / 2, H / 2 + 30);

    // new best chip
    if ((distance | 0) >= highDist && distance > 0) {
      const chipW = 48, chipH = 24, chipY = H / 2 - 50 + 126 / 2 + 32;
      ctx.fillStyle = '#fff';
      roundRect(W / 2 - chipW / 2, chipY - chipH / 2, chipW, chipH, chipH / 2);
      ctx.fill();
      ctx.font = `700 10px ${FONT}`; ctx.fillStyle = '#000';
      ctx.letterSpacing = '1.5px';
      ctx.fillText('NEW BEST', W / 2, chipY);
      ctx.letterSpacing = '0px';
    }

    // instruction text
    ctx.font = `400 16px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('Press R to restart', W / 2, H / 2 + 88);
  }

  function drawRollTutorial() {
    // darkened overlay
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    // instruction text — same style as home screen "Hold [space] to rise"
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#FFF6C8';
    ctx.font = `400 22px ${FONT}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const prefix = 'Press ';
    const suffix = ' to barrel roll \u2022 You will be briefly invincible';
    const keyLabel = 'Shift';
    const keyFont = `500 17px ${FONT}`;
    // measure parts to center the whole thing
    const prefW = ctx.measureText(prefix).width;
    ctx.font = keyFont;
    const keyTextW = ctx.measureText(keyLabel).width;
    const keyPadX = 14, keyH = 26, keyR = 6;
    const keyW = keyTextW + keyPadX * 2;
    ctx.font = `400 22px ${FONT}`;
    const sufW = ctx.measureText(suffix).width;
    const totalW = prefW + keyW + 10 + sufW;
    const startX = W / 2 - totalW / 2;
    const cy = H / 2;
    // draw prefix
    ctx.fillText(prefix, startX, cy);
    // draw key cap
    const kx = startX + prefW + 5;
    const ky = cy - keyH / 2;
    ctx.strokeStyle = 'rgba(255,246,200,0.6)';
    ctx.lineWidth = 1.2;
    roundRect(kx, ky, keyW, keyH, keyR);
    ctx.stroke();
    // thicker bottom edge (matching home screen key style)
    ctx.strokeStyle = '#FFF6C8';
    const cornerSteps = 6;
    for (let ci = 0; ci < cornerSteps; ci++) {
      const t0 = ci / cornerSteps, t1 = (ci + 1) / cornerSteps;
      ctx.lineWidth = lerp(1.2, 3, t0);
      ctx.beginPath();
      const la0 = Math.PI - t0 * (Math.PI / 2), la1 = Math.PI - t1 * (Math.PI / 2);
      ctx.arc(kx + keyR, ky + keyH - keyR, keyR, la0, la1, true);
      ctx.stroke();
      ctx.lineWidth = lerp(3, 1.2, t0);
      ctx.beginPath();
      const ra0 = (Math.PI / 2) - t0 * (Math.PI / 2), ra1 = (Math.PI / 2) - t1 * (Math.PI / 2);
      ctx.arc(kx + keyW - keyR, ky + keyH - keyR, keyR, ra0, ra1, true);
      ctx.stroke();
    }
    // flat bottom
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(kx + keyR, ky + keyH);
    ctx.lineTo(kx + keyW - keyR, ky + keyH);
    ctx.stroke();
    // key label
    ctx.font = keyFont;
    ctx.textAlign = 'center';
    ctx.fillText(keyLabel, kx + keyW / 2, cy - 1);
    // draw suffix
    ctx.font = `400 22px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(suffix, kx + keyW + 5, cy);
    ctx.textAlign = 'center';
    ctx.globalAlpha = 1;
  }

  // =========================================================
  //  MAIN LOOP
  // =========================================================
  let lastTime = 0;
  resize();
  resetGame();
  setupPerch();
  state = STATE.HOME;
  // ambient audio disabled
  // getSfx();
  // loadAmbientBuffers().then(() => startAmbientSounds());
  loadWindSound();
  // window.addEventListener('click', function resumeAmbient() {
  //   getSfx().resume().then(() => { if (!ambientSource && state === STATE.HOME) startAmbientSounds(); });
  //   window.removeEventListener('click', resumeAmbient);
  // }, { once: true });
  requestAnimationFrame(function boot(ts) { lastTime = ts; requestAnimationFrame(mainLoop); });

  function mainLoop(ts) {
    const rawDt = ts - lastTime; lastTime = ts;
    const dt = Math.min(rawDt / 16.667, 3);
    if (state === STATE.HOME || state === STATE.LEADERBOARD || state === STATE.ACHIEVEMENTS) {
      frameCount++;
      perchTimer += dt;
      perchBlinkTimer += dt;
      homePhaseTimer += dt;
      if (titleFadeOut > 0) titleFadeOut -= dt;
      // head follows cursor — tilt only, no translation
      const birdScale = BIRD_SCALE * 1.32;
      const headWorldX = bird.x + 4 * birdScale;
      const headWorldY = bird.y - 8 * birdScale;
      const dx = mouseX - headWorldX;
      const dy = mouseY - headWorldY;
      const targetAngle = clamp(Math.atan2(dy, dx), -0.8, 0.8);
      perchHeadAngle += (targetAngle - perchHeadAngle) * 0.08 * dt;
      updateAmbientLife(dt);
    } else if (!rollTutorialActive) {
      update(dt);
      updateAmbientLife(dt);
    }
    // Show cursor on menus, hide during gameplay
    const muteHovered = state !== STATE.PLAY && mouseX > W - 56 && mouseY > H - 48;
    const medalHovered = state === STATE.HOME && mouseX > W - 68 && mouseY < 58 && mouseY > 0;
    const lbBtnHovered = false; // state === STATE.HOME && mouseX > W - 68 && mouseY >= 58 && mouseY < 112;
    const backBtnHovered = (state === STATE.ACHIEVEMENTS || state === STATE.LEADERBOARD) && mouseX < 60 && mouseX > 0 && mouseY < 60 && mouseY > 0;
    // smooth hover transitions (lerp toward target)
    const hoverSpeed = 0.15;
    medalHoverT += ((medalHovered ? 1 : 0) - medalHoverT) * hoverSpeed;
    lbHoverT += ((lbBtnHovered ? 1 : 0) - lbHoverT) * hoverSpeed;
    backHoverT += ((backBtnHovered ? 1 : 0) - backHoverT) * hoverSpeed;
    if (medalHoverT < 0.01) medalHoverT = 0;
    if (lbHoverT < 0.01) lbHoverT = 0;
    if (backHoverT < 0.01) backHoverT = 0;
    if (state === STATE.PLAY) {
      canvas.style.cursor = 'default';
    } else if (state === STATE.HOME) {
      const zenHovered = mouseX > W / 2 - 40 && mouseX < W / 2 + 40 && mouseY > H - 48;
      canvas.style.cursor = (medalHovered || lbBtnHovered || zenHovered || muteHovered || (homePhase === 0 && titleHoverT > 0.1)) ? 'pointer' : 'default';
    } else if (state === STATE.ACHIEVEMENTS || state === STATE.LEADERBOARD) {
      canvas.style.cursor = (backBtnHovered || achCardHovered || muteHovered) ? 'pointer' : 'default';
    } else if (state === STATE.PAUSE) {
      canvas.style.cursor = 'pointer';
    } else {
      canvas.style.cursor = muteHovered ? 'pointer' : 'default';
    }

    // achievement page transition animation
    if (achTransDir !== 0 && achTransition < 1) {
      achTransition = Math.min(1, achTransition + dt * 0.06);
    }

    render();
    requestAnimationFrame(mainLoop);
  }

})();
