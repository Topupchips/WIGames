'use strict';
// Badminton. Server-authoritative physics at 60 Hz.
// World units: x 0..1000 (left to right), y 0..~500 (up from the floor). Net at x=500.
// Team 0 plays on the left, team 1 on the right. Phones slide to move and tap a shot
// (lob, drop, smash) when the shuttle is in reach; the server aims the shot.

const SCALE = Number(process.env.TIME_SCALE) || 1; // only used by tests

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
  tag: 'Doubles with up to 4 phones, or 1 phone against the CPU',
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

const GAMES = [badminton];
const byId = Object.fromEntries(GAMES.map((g) => [g.id, g]));
module.exports = { GAMES, byId };
