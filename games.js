'use strict';
// Badminton and Racing. Server-authoritative physics at 60 Hz.
// ---- Badminton ----
// World units: x 0..1000 (left to right), y 0..~500 (up from the floor). Net at x=500.
// Team 0 plays on the left, team 1 on the right. Phones slide to move and tap a shot
// (lob, drop, smash) when the shuttle is in reach; the server aims the shot.

const SCALE = Number(process.env.TIME_SCALE) || 1; // only used by tests
const Track = require('./public/track.js');

const NETX = 500, NETH = 160;
const G = 900, K = 0.0036;          // gravity and shuttle drag (quadratic)
const MINX = 40, MAXX = 960;        // court boundary (in bounds)
const REACH = 165, HIT_Y = 130;     // racket reach circle: centre (player x, HIT_Y)
const SPEED = 440, BOT_SPEED = 300;
const WIN_TO = 11, CAP = 15;
const SWING_CD = 0.38;
const BUFFER_MS = 300;       // a swing waits this long for the shuttle to arrive

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

function timers() {
  const set = new Set();
  return {
    after(ms, fn) {
      const id = setTimeout(() => { set.delete(id); fn(); }, ms * SCALE);
      set.add(id);
      return id;
    },
    every(ms, fn) {
      const id = setInterval(fn, ms * SCALE);
      set.add(id);
      return id;
    },
    cancelAll() { for (const id of set) { clearTimeout(id); clearInterval(id); } set.clear(); },
  };
}

// Forward-simulate a shot until it lands. Returns landing x, whether it clears the net, apex.
function flight(x, y, vx, vy) {
  const dt = 1 / 60;
  let clear = true, apex = y, t = 0;
  while (y > 0 && t < 8) {
    const sp = Math.hypot(vx, vy);
    vx -= K * sp * vx * dt;
    vy -= (G + K * sp * vy) * dt;
    const nx = x + vx * dt, ny = y + vy * dt;
    if ((x - NETX) * (nx - NETX) < 0) {
      const yy = y + (ny - y) * ((NETX - x) / (nx - x));
      if (yy < NETH + 6) clear = false;
    }
    x = nx; y = ny; t += dt;
    if (y > apex) apex = y;
  }
  return { x, clear, apex, t };
}

// Find the launch speed at a given angle that lands the shuttle on targetX.
function solve(x0, y0, dir, angDeg, targetX) {
  const a = (angDeg * Math.PI) / 180;
  const want = Math.abs(targetX - x0);
  let lo = 120, hi = 2600;
  for (let i = 0; i < 22; i++) {
    const s = (lo + hi) / 2;
    const r = flight(x0, y0, dir * Math.cos(a) * s, Math.sin(a) * s);
    if (dir * (r.x - x0) < want) lo = s; else hi = s;
  }
  const s = (lo + hi) / 2;
  const vx = dir * Math.cos(a) * s, vy = Math.sin(a) * s;
  return { vx, vy, s, r: flight(x0, y0, vx, vy), want };
}

function pickShot(kind, x0, y0, dir) {
  const deep = dir > 0 ? rnd(820, 920) : rnd(80, 180);
  const near = dir > 0 ? rnd(565, 625) : rnd(375, 435);
  const mid = dir > 0 ? rnd(660, 790) : rnd(210, 340);
  let plans;
  if (kind === 'lob') plans = [[56, deep], [62, deep], [50, deep], [68, deep]];
  else if (kind === 'drop') plans = [[38, near], [48, near], [58, near], [68, near]];
  else if (y0 >= HIT_Y + 10) plans = [[-18, mid], [-10, mid], [-2, mid], [8, mid], [16, mid]];
  else {
    const t = mid + (dir > 0 ? 60 : -60);
    plans = [[10, t], [18, t], [26, t], [34, t]]; // too low to smash: flat drive
  }
  for (const [a, t] of plans) {
    const o = solve(x0, y0, dir, a, t);
    if (o.r.clear && o.s < 2500 && o.r.apex < 520 && Math.abs(dir * (o.r.x - x0) - o.want) < 30) {
      return { vx: o.vx, vy: o.vy };
    }
  }
  // Could not reach the target (e.g. hit from the back corner): lob as far as is safe.
  for (const t of dir > 0 ? [780, 700, 620, 570] : [220, 300, 380, 430]) {
    for (const a of [62, 72, 52, 80]) {
      const o = solve(x0, y0, dir, a, t);
      if (o.r.clear && o.s < 2500 && o.r.apex < 520 && dir * (o.r.x - NETX) > 30) return { vx: o.vx, vy: o.vy };
    }
  }
  const o = solve(x0, y0, dir, 75, dir > 0 ? 600 : 400);
  return { vx: o.vx, vy: o.vy };
}

const badminton = {
  id: 'badminton', name: 'Badminton', min: 1,
  tag: 'Swing your phone like a racket. Doubles, or 1 phone vs the CPU',
  create(ctx) {
    const T = timers();
    const actors = ctx.players.map((p, i) => ({
      id: p.id, name: p.name, color: p.color, team: i % 2, bot: false,
      x: 0, tx: 0, cd: 0, req: null, reqAt: 0, swingEnd: 0, err: 0,
    }));
    for (const t of [0, 1]) {
      if (!actors.some((a) => a.team === t)) {
        actors.push({ id: 'cpu' + t, name: 'CPU', color: '#9aa0c3', team: t, bot: true, x: 0, tx: 0, cd: 0, req: null, swingEnd: 0, err: 0 });
      }
    }
    const teamActors = (t) => actors.filter((a) => a.team === t);
    const names = [0, 1].map((t) => teamActors(t).map((a) => a.name).join(' & '));
    const homeX = (a) => {
      const i = teamActors(a.team).indexOf(a);
      return a.team === 0 ? 230 + i * 120 : 770 - i * 120;
    };
    const range = (t) => (t === 0 ? [MINX, NETX - 40] : [NETX + 40, MAXX]);
    actors.forEach((a) => { a.x = a.tx = homeX(a); });

    const sh = { x: 230, y: 280, vx: 0, vy: 0, live: false };
    const score = [0, 0];
    let phase = 'intro', until = 0, dur = 0, serving = 0, rally = 0, banner = '';
    let lastTeam = null, pred = null, predTeam = null, evn = 0, ev = { n: 0, k: '', x: 0, y: 0 };
    let last = Date.now(), tickN = 0;

    const setPhase = (p, ms) => { phase = p; until = Date.now() + ms; dur = ms; };

    function beginServe(team) {
      serving = team; rally = 0; lastTeam = null; pred = null;
      actors.forEach((a) => { a.x = a.tx = homeX(a); a.cd = 0; a.req = null; });
      sh.x = team === 0 ? 230 : 770; sh.y = 280; sh.vx = sh.vy = 0; sh.live = false;
      banner = `${names[team]} to serve`;
      setPhase('serve', 1300);
      ctx.push();
      T.after(1300, () => {
        if (phase !== 'serve') return;
        phase = 'rally'; sh.live = true; until = Date.now(); dur = 1;
        ctx.push();
      });
    }

    function endPoint(loser) {
      if (phase !== 'rally') return;
      const win = 1 - loser;
      score[win]++;
      sh.live = false; sh.vx = sh.vy = 0; sh.y = Math.max(0, sh.y);
      ev = { n: ++evn, k: 'point', x: sh.x, y: 0 };
      const over = (score[win] >= WIN_TO && score[win] - score[loser] >= 2) || score[win] >= CAP;
      banner = over ? `${names[win]} win!` : `${names[win]} score`;
      setPhase(over ? 'over' : 'point', over ? 3800 : 1900);
      ctx.push();
      T.after(over ? 3800 : 1900, () => (over ? finish(win) : beginServe(win)));
    }

    function finish(win) {
      const scores = {}, labels = {};
      for (const a of actors) {
        if (a.bot) continue;
        const won = a.team === win;
        scores[a.id] = won ? 100 + score[a.team] : 0;
        labels[a.id] = `${won ? 'Won' : 'Lost'} ${score[a.team]}-${score[1 - a.team]}`;
      }
      ctx.finish({ scores, labels });
    }

    function landed() {
      const x = sh.x;
      let loser;
      if (x < MINX || x > MAXX) loser = lastTeam !== null ? lastTeam : (x < NETX ? 0 : 1);
      else loser = x < NETX ? 0 : 1;
      endPoint(loser);
    }

    function canHit(a) {
      const onSide = a.team === 0 ? sh.x <= NETX + 10 : sh.x >= NETX - 10;
      return Math.hypot(sh.x - a.x, sh.y - HIT_Y) <= REACH && onSide && lastTeam !== a.team;
    }

    function doSwing(a, kind) {
      a.cd = SWING_CD;
      a.swingEnd = Date.now() + 260;
      if (canHit(a)) {
        const dir = a.team === 0 ? 1 : -1;
        const s = pickShot(kind, sh.x, sh.y, dir);
        sh.vx = s.vx; sh.vy = s.vy;
        lastTeam = a.team; rally++;
        pred = flight(sh.x, sh.y, sh.vx, sh.vy).x; predTeam = 1 - a.team;
        teamActors(1 - a.team).forEach((o) => { o.err = rnd(-110, 110); });
        ev = { n: ++evn, k: kind, x: sh.x, y: sh.y };
      }
    }

    function botThink(a) {
      const [lo, hi] = range(a.team);
      if (phase === 'rally' && sh.live && lastTeam !== a.team) {
        const target = pred !== null && predTeam === a.team ? pred + a.err : sh.x;
        a.tx = clamp(target, lo, hi);
        const onSide = a.team === 0 ? sh.x <= NETX : sh.x >= NETX;
        if (a.cd <= 0 && onSide && Math.hypot(sh.x - a.x, sh.y - HIT_Y) <= REACH - 25 && Math.random() < 0.14) {
          const r = Math.random();
          a.req = sh.y > 150 && r < 0.35 ? 'smash' : r < 0.72 ? 'lob' : 'drop';
          a.reqAt = Date.now();
        }
      } else a.tx = homeX(a);
    }

    function tick() {
      const now = Date.now();
      const dt = SCALE === 1 ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      for (const a of actors) {
        a.cd = Math.max(0, a.cd - dt);
        if (a.bot) botThink(a);
        const sp = a.bot ? BOT_SPEED : SPEED;
        a.x += clamp(a.tx - a.x, -sp * dt, sp * dt);
      }
      // Shot requests are buffered for a moment, so a swing that is a little early
      // still connects as soon as the shuttle gets into reach.
      for (const a of actors) {
        if (!a.req) continue;
        const age = now - a.reqAt;
        if (phase !== 'rally' || !sh.live) { if (age > 250) a.req = null; continue; }
        if (a.cd > 0) { if (age > 250) a.req = null; continue; }
        const k = a.req;
        if (canHit(a)) { a.req = null; doSwing(a, k); }
        else if (age > BUFFER_MS) { a.req = null; a.cd = SWING_CD; a.swingEnd = now + 260; }
      }
      if (phase === 'rally' && sh.live) {
        let rem = dt;
        while (rem > 1e-6 && phase === 'rally') {
          const h = Math.min(rem, 1 / 60); rem -= h;
          const sp = Math.hypot(sh.vx, sh.vy);
          sh.vx -= K * sp * sh.vx * h;
          sh.vy -= (G + K * sp * sh.vy) * h;
          const nx = sh.x + sh.vx * h, ny = sh.y + sh.vy * h;
          if ((sh.x - NETX) * (nx - NETX) < 0 &&
              sh.y + (ny - sh.y) * ((NETX - sh.x) / (nx - sh.x)) < NETH) {
            const side = sh.x < NETX ? -1 : 1;
            sh.x = NETX + side * 3; sh.vx = -sh.vx * 0.12; sh.vy = Math.min(sh.vy, 0) * 0.3;
            ev = { n: ++evn, k: 'net', x: NETX, y: sh.y };
          } else { sh.x = nx; sh.y = ny; }
          if (sh.y <= 0) { sh.y = 0; landed(); break; }
          if (sh.x < -200 || sh.x > 1200) { landed(); break; }
        }
      }
      if (++tickN % 2 === 0) ctx.push();
    }

    return {
      start() {
        setPhase('intro', 3000);
        ctx.push();
        T.every(1000 / 60, tick);
        T.after(3000, () => beginServe(0));
      },
      input(pid, m) {
        const a = actors.find((x) => x.id === pid);
        if (!a || a.bot) return;
        if (m.k === 'pos') {
          const f = clamp(Number(m.f) || 0, 0, 1);
          const [lo, hi] = range(a.team);
          a.tx = lo + f * (hi - lo);
        } else if (m.k === 'shot' && (m.s === 'lob' || m.s === 'drop' || m.s === 'smash')) {
          if (a.req || a.cd > 0) return;
          a.req = m.s; a.reqAt = Date.now(); a.swingEnd = Date.now() + 260;
        }
      },
      view(pid) {
        const v = {
          game: 'badminton', phase, ms: Math.max(0, until - Date.now()), dur,
          score: score.slice(), serving, target: WIN_TO, banner, teams: names,
        };
        if (pid != null) {
          const me = actors.find((a) => a.id === pid);
          v.team = me ? me.team : 0;
          return v;
        }
        const now = Date.now();
        v.rally = rally; v.last = lastTeam; v.ev = ev;
        v.sh = { x: Math.round(sh.x * 10) / 10, y: Math.round(sh.y * 10) / 10, vx: Math.round(sh.vx), vy: Math.round(sh.vy) };
        v.actors = actors.map((a) => ({
          id: a.id, name: a.name, color: a.color, team: a.team, bot: a.bot,
          x: Math.round(a.x), sw: Math.max(0, (a.swingEnd - now) / 260),
        }));
        return v;
      },
      stop() { T.cancelAll(); },
      _debug: { flight, solve, pickShot, actors, sh, tick },
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Racing. Cars auto-accelerate; phones steer (tilt like a wheel or touch), brake and boost.
// Positions are in the track's world units (see public/track.js). Heading h: forward = (sin h, cos h),
// and a larger h turns left. Steering is -1 (full left) .. +1 (full right).
const LAPS = 4;
const VMAX = 42, ACCEL = 0.95, BRAKE = 48, OFF_VMAX = 17, WALL_HIT = 0.5;
const BOOST_MUL = 1.32, BOOST_DRAIN = 0.42, BOOST_FILL = 0.1;
const CAR_R = 1.7;
const FINISH_GRACE = 25000;     // after the first car finishes, the others have this long
const COUNT_MS = 3000, INTRO_MS = 2600, OVER_MS = 4200, MAX_RACE_MS = 240000;
const BOT_NAMES = ['Turbo', 'Zippy', 'Nitro', 'Blitz', 'Pixel', 'Rocket'];
const BOT_COLORS = ['#9aa0c3', '#c7a6ff', '#7fe0c4', '#f5a97f'];

const racing = {
  id: 'racing', name: 'Racing', min: 1,
  tag: 'Tilt your phone like a wheel. 4 laps, up to 4 cars',
  create(ctx) {
    const T = timers();
    const cars = [];
    const mk = (id, name, color, bot, slot, skill) => {
      // starting grid: two columns, staggered behind the line (s = 0)
      const row = Math.floor(slot / 2), col = slot % 2;
      const s0 = -9 - row * 8 - col * 3, lat = col === 0 ? 3.6 : -3.6;
      const pl = Track.place(s0, lat);
      const pr = Track.project(pl.x, pl.z);
      return {
        id, name, color, bot, slot, skill: skill || 1,
        x: pl.x, z: pl.z, h: pl.head, v: 0, st: 0, inSt: 0, brake: false, boost: false, meter: 1, boosting: false,
        idx: pr.i, s: pr.s, dist: s0, lat: 0, off: false, fin: false, finT: 0, place: 0, inAt: Date.now(),
        wob: Math.random() * 6, lane: (Math.random() - 0.5) * 6, hitCd: 0, lapShown: 1,
      };
    };
    ctx.players.slice(0, 4).forEach((p, i) => cars.push(mk(p.id, p.name, p.color, false, i)));
    let b = 0;
    while (cars.length < 4) {
      cars.push(mk('cpu' + b, BOT_NAMES[b % BOT_NAMES.length], BOT_COLORS[b % BOT_COLORS.length], true, cars.length, 0.86 + Math.random() * 0.1));
      b++;
    }

    let phase = 'intro', until = 0, dur = 0, raceT = 0, tickN = 0, last = Date.now();
    let evn = 0, ev = { n: 0, k: '', id: '', i: 0 }, firstFinT = null, banner = '';
    const setPhase = (p, ms) => { phase = p; until = Date.now() + ms; dur = ms; };
    const emit = (k, car) => { ev = { n: ++evn, k, id: car ? car.id : '', i: car ? car.lapShown : 0 }; };

    function rank() {
      const order = cars.slice().sort((a, c) => {
        if (a.fin && c.fin) return a.finT - c.finT;
        if (a.fin) return -1;
        if (c.fin) return 1;
        return c.dist - a.dist;
      });
      order.forEach((c, i) => { c.place = i + 1; });
      return order;
    }

    rank();

    function botDrive(a) {
      // follow the centre line with a look-ahead point and brake for the corner ahead
      const look = 10 + a.v * 0.5;
      const lane = a.lane + Math.sin(raceT / 1000 * 0.7 + a.wob) * 1.5;
      const tgt = Track.place(a.s + look, lane);
      let want = Math.atan2(tgt.x - a.x, tgt.z - a.z);
      let diff = Track.wrap(want - a.h);
      a.inSt = Math.max(-1, Math.min(1, -diff * 2.6));
      // corner speed from the sharpest curve in the next 60 units
      let k = 0;
      for (let d = 6; d <= 60; d += 6) k = Math.max(k, Math.abs(Track.curvAt(a.s + d)));
      const vcorner = Math.min(VMAX * 1.1, Math.sqrt(520 / Math.max(k, 1e-4)));
      const target = vcorner * a.skill;
      a.brake = a.v > target + 3;
      a.boost = !a.brake && k < 0.012 && a.meter > 0.55 && Math.abs(diff) < 0.1;
    }

    function stepCar(a, dt, leaderDist) {
      if (a.hitCd > 0) a.hitCd -= dt;
      // stale phone input stops steering and boosting
      if (!a.bot && Date.now() - a.inAt > 900) { a.inSt = 0; a.boost = false; a.brake = false; }
      if (a.bot) botDrive(a);
      const racingNow = phase !== 'intro' && phase !== 'count' && !a.fin;
      // steering eases toward the input
      a.st += Math.max(-7 * dt, Math.min(7 * dt, a.inSt - a.st));
      // speed
      const behind = Math.max(0, Math.min(1, (leaderDist - a.dist - 15) / 120));
      const rubber = 1 + 0.07 * behind;
      a.boosting = racingNow && a.boost && a.meter > 0.02;
      if (a.boosting) a.meter = Math.max(0, a.meter - BOOST_DRAIN * dt);
      else a.meter = Math.min(1, a.meter + BOOST_FILL * dt);
      let vmax = (a.off ? OFF_VMAX : VMAX) * rubber * (a.boosting ? BOOST_MUL : 1);
      if (a.fin) vmax = VMAX * 0.45; // coast on after the flag
      if (phase === 'intro' || phase === 'count') {
        a.v = 0; // parked on the grid
      } else if (a.brake && !a.fin) {
        a.v = Math.max(0, a.v - BRAKE * dt);
      } else {
        const rate = a.off ? 2.6 : a.boosting ? 2.2 : ACCEL;
        a.v += (vmax - a.v) * Math.min(1, rate * dt);
      }
      // turning: less agile at high speed, and hard cornering scrubs speed
      const agile = 2.15 / (1 + 0.9 * Math.pow(a.v / VMAX, 2));
      const dh = -a.st * agile * Math.min(1, a.v / 6) * dt;
      a.h += dh;
      a.v *= 1 - Math.abs(a.st) * 0.16 * dt * (a.v / VMAX + 0.4);
      a.x += Math.sin(a.h) * a.v * dt;
      a.z += Math.cos(a.h) * a.v * dt;
      // track position, grass and walls
      const pr = Track.project(a.x, a.z, a.idx);
      a.idx = pr.i; a.lat = pr.lat;
      const alat = Math.abs(pr.lat);
      a.off = alat > Track.HALF;
      if (alat > Track.WALL) {
        const side = Math.sign(pr.lat);
        const px = Track.place(pr.s, side * Track.WALL);
        a.x = px.x; a.z = px.z;
        // lose speed and get nudged back toward the track direction
        const along = Track.wrap(pr.head - a.h);
        a.h += Math.max(-0.5, Math.min(0.5, along)) * 0.5;
        if (a.v > 8 && a.hitCd <= 0) { emit('wall', a); a.hitCd = 0.5; }
        a.v *= Math.pow(WALL_HIT, Math.min(1, dt * 14));
      }
      // progress (monotonic across the start line, handles driving backwards)
      let d = pr.s - a.s;
      if (d < -Track.L / 2) d += Track.L;
      else if (d > Track.L / 2) d -= Track.L;
      a.s = (pr.s % Track.L + Track.L) % Track.L;
      a.dist += d;
      const lap = Math.max(1, Math.min(LAPS, Math.floor(a.dist / Track.L) + 1));
      if (lap > a.lapShown && !a.fin) { a.lapShown = lap; emit('lap', a); }
      if (!a.fin && racingNow && a.dist >= LAPS * Track.L) {
        a.fin = true; a.finT = raceT; a.lapShown = LAPS;
        emit('finish', a);
        if (firstFinT === null) {
          firstFinT = raceT;
          banner = a.name + ' wins!';
        }
      }
    }

    function collide() {
      for (let i = 0; i < cars.length; i++) {
        for (let j = i + 1; j < cars.length; j++) {
          const a = cars[i], c = cars[j];
          const dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz);
          const min = CAR_R * 2;
          if (d >= min || d < 1e-4) continue;
          const nx = dx / d, nz = dz / d, push = (min - d) / 2;
          a.x -= nx * push; a.z -= nz * push; c.x += nx * push; c.z += nz * push;
          // the car that is behind (along the first car's heading) loses a bit more speed
          const fa = Math.sin(a.h) * nx + Math.cos(a.h) * nz; // > 0 when c is ahead of a
          const slow = (car) => { car.v *= 0.985; };
          slow(a); slow(c);
          if (fa > 0.3) a.v *= 0.97; else if (fa < -0.3) c.v *= 0.97;
          if (Math.abs(a.v - c.v) > 6 && a.hitCd <= 0 && c.hitCd <= 0) { emit('bump', a); a.hitCd = c.hitCd = 0.4; }
        }
      }
    }

    function tick() {
      const now = Date.now();
      const dt = SCALE === 1 ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      if (phase === 'race') raceT += dt * 1000;
      const order = rank();
      const leaderDist = order[0].dist;
      for (const a of cars) stepCar(a, dt, leaderDist);
      collide();
      rank();
      if (phase === 'race') {
        const humans = cars.filter((c) => !c.bot);
        const humansDone = humans.every((c) => c.fin);
        const timeUp = firstFinT !== null && raceT - firstFinT > FINISH_GRACE;
        if (humansDone || timeUp || raceT > MAX_RACE_MS) {
          setPhase('over', OVER_MS);
          if (!banner) banner = 'Time!';
          ctx.push();
          T.after(OVER_MS, finish);
        }
      }
      if (++tickN % 2 === 0) ctx.push();
    }

    function finish() {
      // everyone is ranked together, CPU cars included, so a human who comes 4th gets 4th-place points
      const scores = {}, labels = {}, meta = {};
      rank();
      for (const a of cars) {
        if (a.fin) {
          scores[a.id] = Math.max(1, 1000000 - Math.round(a.finT));
          labels[a.id] = fmt(a.finT);
        } else {
          scores[a.id] = Math.max(1, Math.round(Math.max(0, a.dist) / 10));
          labels[a.id] = 'DNF';
        }
        if (a.bot) meta[a.id] = { name: a.name + ' (CPU)', color: a.color };
      }
      ctx.finish({ scores, labels, meta });
    }

    function startRace() {
      setPhase('race', MAX_RACE_MS);
      raceT = 0;
      emit('go');
      ctx.push();
    }

    return {
      start() {
        setPhase('intro', INTRO_MS);
        ctx.push();
        T.every(1000 / 60, tick);
        T.after(INTRO_MS, () => { setPhase('count', COUNT_MS); emit('count'); ctx.push(); });
        T.after(INTRO_MS + COUNT_MS, startRace);
      },
      input(pid, m) {
        const a = cars.find((x) => x.id === pid);
        if (!a || a.bot) return;
        a.inAt = Date.now();
        if (m.k === 'steer') a.inSt = Math.max(-1, Math.min(1, Number(m.v) || 0));
        else if (m.k === 'pedals') { a.brake = !!m.brake; a.boost = !!m.boost; if (m.v !== undefined) a.inSt = Math.max(-1, Math.min(1, Number(m.v) || 0)); }
      },
      view(pid) {
        const v = {
          game: 'racing', phase, ms: Math.max(0, until - Date.now()), dur, laps: LAPS, banner,
          t: Math.round(raceT),
        };
        if (pid != null) {
          const me = cars.find((a) => a.id === pid);
          if (me) {
            v.me = {
              place: me.place, lap: me.lapShown, v: Math.round(me.v * 10) / 10, meter: Math.round(me.meter * 100) / 100,
              boosting: me.boosting, fin: me.fin, finT: Math.round(me.finT), off: me.off,
            };
          }
          v.total = cars.length;
          return v;
        }
        v.ev = ev;
        v.cars = cars.map((a) => ({
          id: a.id, name: a.name, color: a.color, bot: a.bot,
          x: Math.round(a.x * 100) / 100, z: Math.round(a.z * 100) / 100, h: Math.round(a.h * 1000) / 1000,
          v: Math.round(a.v * 10) / 10, st: Math.round(a.st * 100) / 100, bo: a.boosting, off: a.off,
          place: a.place, lap: a.lapShown, fin: a.fin, ft: Math.round(a.finT),
          d: Math.round(a.dist),
        }));
        return v;
      },
      stop() { T.cancelAll(); },
      _debug: { cars, tick },
    };
  },
};

function fmt(ms) {
  const s = ms / 1000, m = Math.floor(s / 60);
  return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0');
}

const GAMES = [badminton, racing];
const byId = Object.fromEntries(GAMES.map((g) => [g.id, g]));
module.exports = { GAMES, byId };
