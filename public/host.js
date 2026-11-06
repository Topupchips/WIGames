(function () {
  'use strict';
  const { h, connect, renderer, numTimer, snd } = CA;
  const root = document.getElementById('app');
  const watching = location.pathname === '/watch';
  const watchCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  let room = null, view = null, prev = null, conn;

  const ICON = {
    badminton: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><ellipse cx="22" cy="22" rx="12" ry="16" transform="rotate(45 22 22)"/><path d="M31 31 54 54"/><circle cx="52" cy="12" r="4.500" fill="currentColor" stroke="none"/></svg>',
  };

  conn = connect({
    onOpen() {
      if (watching) return conn.send({ t: 'watch', code: watchCode });
      let code;
      try { code = sessionStorage.getItem('ca:room') || undefined; } catch { /* ignore */ }
      conn.send({ t: 'host', code });
    },
    onStatus(ok) { document.body.classList.toggle('offline', !ok); },
    onMessage(m) {
      if (m.t === 'room') {
        room = m;
        if (!watching) { try { sessionStorage.setItem('ca:room', m.code); } catch { /* ignore */ } }
        if (view) render(view);
      } else if (m.t === 'view') {
        prev = view; view = m.view;
        cue(prev, view);
        render(view);
      }
    },
  });

  // ------------------------------------------------------------ sound cues
  function cue(a, b) {
    const pa = a && a.players ? a.players.filter((p) => p.connected).length : 0;
    const pb = b.players.filter((p) => p.connected).length;
    if (b.screen === 'lobby' && a && pb > pa) snd.join();
    if (b.screen === 'results' && (!a || a.screen !== 'results')) snd.win();
    if (b.screen !== 'game') return;
    const same = a && a.screen === 'game';
    if (b.phase === 'serve' && (!same || a.phase !== 'serve')) snd.go();
    if (b.ev && (!same || !a.ev || a.ev.n !== b.ev.n)) {
      const k = b.ev.k;
      if (k === 'lob') snd.beep(620);
      else if (k === 'drop') snd.beep(840);
      else if (k === 'smash') snd.beep(1250);
      else if (k === 'net') snd.bad();
      else if (k === 'point') snd.ok();
    }
  }

  // ------------------------------------------------------------ keyboard
  addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    } else if (e.key === 'm' || e.key === 'M') {
      toast(snd.toggleMute() ? 'Sound off' : 'Sound on');
    } else if (!view || watching) {
      return;
    } else if (view.screen === 'lobby' && (e.key === 'Enter' || e.key === ' ' || e.key === '1')) {
      e.preventDefault();
      conn.send({ t: 'start', game: view.games[0].id });
    } else if (view.screen === 'results' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      conn.send({ t: 'lobby' });
    } else if (view.screen === 'game' && e.key === 'Escape') {
      conn.send({ t: 'lobby' });
    }
  });
  function toast(msg) {
    const t = h('div', { class: 'toast' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 1500);
  }

  // ------------------------------------------------------------ rendering
  const render = renderer(root, pick);

  function pick(v) {
    if (v.screen === 'lobby') return { key: 'lobby:' + (room ? room.code : ''), build: buildLobby };
    if (v.screen === 'results') return { key: 'results', build: buildResults };
    if (v.game === 'badminton') return { key: 'bd', build: buildBadminton, update: updateBadminton };
    return null;
  }

  const initial = (p) => (p.name[0] || '?').toUpperCase();

  // ------------------------------------------------------------ lobby
  function buildLobby(v) {
    const connected = v.players.filter((p) => p.connected);
    const live = connected.length;
    const short = room ? new URL(room.url).host + '/play' : '';
    const left = h('section', { class: 'join' },
      h('div', { class: 'logo', 'aria-label': 'Badminton' },
        h('span', { class: 'l1' }, 'BADMINTON'), h('span', { class: 'l2' }, 'NIGHT')),
      room && room.qr ? h('div', { class: 'qrcard' }, h('div', { class: 'qr', html: room.qr })) : h('div', { class: 'qrcard skeleton' }),
      h('p', { class: 'steps' }, 'Scan with your phone camera'),
      room ? h('div', { class: 'code' }, room.code.split('').map((c) => h('b', null, c))) : null,
      room ? h('p', { class: 'url' }, 'or open ', h('span', null, short), ' and enter the code') : null,
      room && !watching ? h('p', { class: 'url' }, 'Friends far away can watch at ', h('span', null, new URL(room.url).host + '/watch?room=' + room.code)) : null);

    const slots = [0, 1, 2, 3].map((i) => {
      const p = v.players[i];
      if (!p) {
        return h('div', { class: 'slot empty' }, h('div', { class: 'avatar' }, '+'), h('div', { class: 'sname' }, 'Waiting...'));
      }
      const idx = connected.findIndex((x) => x.id === p.id);
      const side = idx < 0 ? 'offline' : idx % 2 === 0 ? 'Left team' : 'Right team';
      return h('div', { class: 'slot' + (p.connected ? '' : ' off'), style: { '--c': p.color } },
        h('div', { class: 'avatar' }, initial(p)),
        h('div', { class: 'sname' }, p.name),
        h('div', { class: 'spts' }, side + ' · ' + p.points + ' pts'));
    });

    const g = v.games[0];
    const start = h('button', {
      class: 'startcard', disabled: live < 1,
      onclick: () => conn.send({ t: 'start', game: g.id }),
    },
    h('div', { class: 'gicon', html: ICON.badminton }),
    h('div', null,
      h('h3', null, live < 1 ? 'Waiting for players' : 'Start match'),
      h('p', null, live === 1 ? 'One player: you play the CPU' : live >= 2 ? 'First to ' + 11 + ', win by 2' : g.tag)),
    h('kbd', null, 'Enter'));

    const right = h('section', { class: 'lobbyr' },
      h('div', { class: 'slots' }, slots),
      start,
      h('p', { class: 'hint' }, 'Phones 1 and 3 play on the left, phones 2 and 4 on the right. Slide your thumb to move, then swing your phone (down = smash, up = lob, flick = drop) or tap the buttons when the shuttle is near you.'),
      h('p', { class: 'hint' }, h('kbd', null, 'F'), ' fullscreen  ·  ', h('kbd', null, 'M'), ' mute  ·  ', h('kbd', null, 'Esc'), ' back to lobby'));
    return h('div', { class: 'lobby' }, left, right);
  }

  // ------------------------------------------------------------ Badminton
  const NETX = 500, NETH = 160, MINX = 40, MAXX = 960, REACH = 165, HIT_Y = 130;
  const bd = { mode: '2d', r3: null, callout: null, v: null, vt: 0, canvas: null, hud: null, over: null, hudSig: '', overSig: '', trail: [], parts: [], sm: {}, ev: 0, lastT: 0 };

  function webglOk() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
  }
  function buildBadminton(v) {
    if (bd.r3) { bd.r3.dispose(); bd.r3 = null; }
    bd.canvas = h('canvas', { class: 'bdcanvas' });
    bd.hud = h('div', { class: 'bdhud' });
    bd.over = h('div', { class: 'bdover' });
    bd.callout = h('div', { class: 'callout' });
    bd.hudSig = ''; bd.overSig = ''; bd.trail = []; bd.parts = []; bd.sm = {}; bd.ev = v.ev ? v.ev.n : 0; bd.lastT = 0;
    bd.mode = '2d';
    const wrap = h('div', { class: 'bdwrap' }, bd.canvas, bd.hud, bd.over, bd.callout);
    if (window.Court3D && webglOk()) {
      bd.mode = '3d';
      const cv = bd.canvas;
      window.Court3D.create(cv).then((r) => {
        if (bd.canvas === cv) bd.r3 = r; else r.dispose();
      }).catch((err) => {
        console.warn('3D court unavailable, using the flat court', err);
        if (bd.canvas !== cv) return;
        bd.mode = '2d';
        bd.canvas = h('canvas', { class: 'bdcanvas' });
        cv.replaceWith(bd.canvas);
      });
    }
    updateBadminton(v);
    requestAnimationFrame(loop);
    return h('div', { class: 'stage bdstage' }, wrap);
  }

  function updateBadminton(v) {
    bd.v = v; bd.vt = performance.now();
    if (v.ev && v.ev.n !== bd.ev) {
      bd.ev = v.ev.n; burst(v.ev);
      const word = { smash: 'SMASH!', lob: 'LOB', drop: 'DROP', net: 'NET!' }[v.ev.k];
      if (word && bd.callout) {
        bd.callout.textContent = word; bd.callout.className = 'callout ' + v.ev.k;
        void bd.callout.offsetWidth; bd.callout.classList.add('go');
      }
    }
    const hs = JSON.stringify([v.teams, v.score, v.serving]);
    if (hs !== bd.hudSig) {
      bd.hudSig = hs;
      const team = (t) => h('div', { class: 'bdteam t' + t + (v.serving === t ? ' srv' : '') },
        t === 0 ? [h('span', { class: 'tn' }, v.teams[0]), h('b', { class: 'ts' }, v.score[0])]
          : [h('b', { class: 'ts' }, v.score[1]), h('span', { class: 'tn' }, v.teams[1])]);
      bd.hud.replaceChildren(team(0), h('div', { class: 'bdmid' }, 'First to ' + v.target), team(1));
    }
    const os = v.phase + '|' + v.banner;
    if (os !== bd.overSig) {
      bd.overSig = os;
      if (v.phase === 'intro') {
        bd.over.replaceChildren(h('div', { class: 'kicker' }, 'Get ready'), numTimer(v, 'bignum'));
      } else if (v.phase === 'rally') {
        bd.over.replaceChildren();
      } else {
        bd.over.replaceChildren(h('div', { class: 'huge sm' + (v.phase === 'over' ? ' win' : '') }, v.banner));
      }
    }
  }

  function burst(e) {
    if (bd.r3) { bd.r3.burst(e); if (e.k === 'net') bd.r3.netHit(); }
    const n = e.k === 'smash' ? 22 : e.k === 'point' ? 26 : 12;
    const col = e.k === 'smash' ? '#ffb347' : e.k === 'point' ? '#b8f35a' : e.k === 'net' ? '#9aa0c3' : '#ffffff';
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 260;
      bd.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * (e.k === 'point' ? 1.3 : 0.8) + 40, life: 1, col });
    }
  }

  function loop(t) {
    const c = bd.canvas;
    if (!c || !document.body.contains(c)) {
      if (bd.r3 && !document.body.contains(bd.canvas)) { bd.r3.dispose(); bd.r3 = null; }
      return;
    }
    requestAnimationFrame(loop);
    const v = bd.v;
    if (!v) return;
    const dt = bd.lastT ? Math.min(0.05, (t - bd.lastT) / 1000) : 0.016;
    bd.lastT = t;
    if (bd.mode === '3d') {
      if (bd.r3) bd.r3.frame(v, dt, Math.min(0.08, (performance.now() - bd.vt) / 1000));
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    draw(c.getContext('2d'), W, H, v, dt);
  }

  function draw(g, W, H, v, dt) {
    g.clearRect(0, 0, W, H);
    const s = Math.min(W / 1000, H / 640);
    const ox = (W - 1000 * s) / 2, gy = (H - 640 * s) / 2 + 560 * s;
    const X = (x) => ox + x * s, Y = (y) => gy - y * s;
    const age = Math.min(0.08, (performance.now() - bd.vt) / 1000);

    // floor and court halves
    const fl = g.createLinearGradient(0, gy, 0, gy + 80 * s);
    fl.addColorStop(0, 'rgba(255,255,255,.12)'); fl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = fl; g.fillRect(X(0), gy, 1000 * s, 80 * s);
    for (const [x0, x1, col] of [[MINX, NETX, '255,93,115'], [NETX, MAXX, '76,201,240']]) {
      const gr = g.createLinearGradient(0, gy, 0, gy - 540 * s);
      gr.addColorStop(0, `rgba(${col},.14)`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(X(x0), gy - 540 * s, (x1 - x0) * s, 540 * s);
    }
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = Math.max(2, 3 * s);
    g.beginPath(); g.moveTo(X(0), gy); g.lineTo(X(1000), gy); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.35)';
    for (const bx of [MINX, MAXX]) { g.beginPath(); g.moveTo(X(bx), gy); g.lineTo(X(bx), Y(30)); g.stroke(); }

    // net
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(X(NETX - 4), Y(NETH), 8 * s, NETH * s);
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
    for (let yy = 16; yy < NETH; yy += 16) { g.beginPath(); g.moveTo(X(NETX - 4), Y(yy)); g.lineTo(X(NETX + 4), Y(yy)); g.stroke(); }
    g.strokeStyle = '#fff'; g.lineWidth = Math.max(2, 4 * s);
    g.beginPath(); g.moveTo(X(NETX), gy); g.lineTo(X(NETX), Y(NETH + 26)); g.stroke();
    g.beginPath(); g.moveTo(X(NETX - 5), Y(NETH)); g.lineTo(X(NETX + 5), Y(NETH)); g.stroke();

    // shuttle (extrapolated between server updates)
    const sh = v.sh, live = v.phase === 'rally';
    const sx = sh.x + (live ? sh.vx * age : 0);
    const sy = Math.max(0, sh.y + (live ? sh.vy * age : 0));
    if (live) { bd.trail.push([sx, sy]); if (bd.trail.length > 16) bd.trail.shift(); } else bd.trail.length = 0;

    // players
    for (const a of v.actors) {
      const st = bd.sm[a.id] || (bd.sm[a.id] = { x: a.x });
      st.x += (a.x - st.x) * Math.min(1, dt * 20);
      drawPlayer(g, a, st.x, v, s, X, Y, gy);
    }

    // shuttle shadow and trail
    g.fillStyle = `rgba(0,0,0,${Math.max(0.08, 0.35 - sy / 1200)})`;
    g.beginPath(); g.ellipse(X(sx), gy + 3 * s, (12 + sy / 40) * s, 3.5 * s, 0, 0, Math.PI * 2); g.fill();
    const sp = Math.hypot(sh.vx, sh.vy);
    for (let i = 1; i < bd.trail.length; i++) {
      const [x1, y1] = bd.trail[i - 1], [x2, y2] = bd.trail[i];
      g.strokeStyle = `rgba(${sp > 900 ? '255,179,71' : '255,255,255'},${(i / bd.trail.length) * 0.5})`;
      g.lineWidth = (2 + (i / bd.trail.length) * 4) * s;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(X(x1), Y(y1)); g.lineTo(X(x2), Y(y2)); g.stroke();
    }
    drawShuttle(g, X(sx), Y(sy), sh, s, sp);

    // particles
    for (let i = bd.parts.length - 1; i >= 0; i--) {
      const p = bd.parts[i];
      p.life -= dt * 1.6;
      if (p.life <= 0) { bd.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 500 * dt;
      g.globalAlpha = Math.max(0, p.life);
      g.fillStyle = p.col;
      g.beginPath(); g.arc(X(p.x), Y(Math.max(0, p.y)), 3.5 * s, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;

    // marker when the shuttle is above the screen
    if (sy > 520) {
      g.fillStyle = 'rgba(255,255,255,.8)';
      g.beginPath(); g.moveTo(X(sx), Y(530)); g.lineTo(X(sx) - 9 * s, Y(530) + 16 * s); g.lineTo(X(sx) + 9 * s, Y(530) + 16 * s); g.fill();
    }
  }

  function drawShuttle(g, px, py, sh, s, sp) {
    const ang = sp < 5 ? -Math.PI / 2 : Math.atan2(sh.vy, sh.vx);
    const dx = Math.cos(ang), dy = -Math.sin(ang);       // screen direction of travel
    const nx = -dy, ny = dx;
    const bx = px - dx * 30 * s, by = py - dy * 30 * s;  // feather base
    g.save();
    if (sp > 900) { g.shadowColor = '#ffb347'; g.shadowBlur = 18 * s; }
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.beginPath(); g.moveTo(px - dx * 4 * s, py - dy * 4 * s);
    g.lineTo(bx + nx * 13 * s, by + ny * 13 * s); g.lineTo(bx - nx * 13 * s, by - ny * 13 * s); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1;
    for (const k of [-0.5, 0, 0.5]) {
      g.beginPath(); g.moveTo(px - dx * 6 * s, py - dy * 6 * s); g.lineTo(bx + nx * 13 * s * k, by + ny * 13 * s * k); g.stroke();
    }
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(px, py, 6.5 * s, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function drawPlayer(g, a, x, v, s, X, Y, gy) {
    const dir = a.team === 0 ? 1 : -1;
    const col = a.color;
    // reach ring when it is this team's turn to hit
    if (v.phase === 'rally' && v.last !== a.team && !a.bot) {
      g.save(); g.setLineDash([8 * s, 8 * s]); g.strokeStyle = col; g.globalAlpha = 0.3; g.lineWidth = 2 * s;
      g.beginPath(); g.arc(X(x), Y(HIT_Y), REACH * s, 0, Math.PI * 2); g.stroke(); g.restore();
    }
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(X(x), gy + 3 * s, 26 * s, 6 * s, 0, 0, Math.PI * 2); g.fill();
    // body
    g.fillStyle = col;
    rr(g, X(x) - 15 * s, Y(72), 30 * s, 72 * s, 12 * s); g.fill();
    g.fillStyle = 'rgba(255,255,255,.22)';
    rr(g, X(x) - 15 * s, Y(72), 30 * s, 26 * s, 12 * s); g.fill();
    g.fillStyle = col;
    g.beginPath(); g.arc(X(x), Y(96), 15 * s, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0b0d17';
    g.beginPath(); g.arc(X(x) + dir * 6 * s, Y(98), 2.6 * s, 0, Math.PI * 2); g.fill();
    // racket
    const p = 1 - a.sw;
    let th = a.sw > 0 ? 150 + (-30 - 150) * p : 68;      // degrees, facing right
    if (dir < 0) th = 180 - th;
    const hx = X(x) + dir * 12 * s, hy = Y(58);
    g.save(); g.translate(hx, hy); g.rotate((-th * Math.PI) / 180);
    g.strokeStyle = '#e9ecff'; g.lineWidth = 3.5 * s; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(40 * s, 0); g.stroke();
    g.beginPath(); g.ellipse(64 * s, 0, 24 * s, 17 * s, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,.10)'; g.fill(); g.stroke();
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.35)';
    for (let k = -12; k <= 12; k += 8) { g.beginPath(); g.moveTo(64 * s + k * s, -14 * s); g.lineTo(64 * s + k * s, 14 * s); g.stroke(); }
    g.restore();
    // name
    g.fillStyle = a.bot ? 'rgba(255,255,255,.55)' : '#fff';
    g.font = `800 ${Math.max(12, 17 * s)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    g.textAlign = 'center';
    g.fillText(a.name, X(x), Y(126));
  }

  function rr(g, x, y, w, hh, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r);
    g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // ------------------------------------------------------------ Results
  function buildResults(v) {
    const top = v.rows[0];
    const tie = v.rows.filter((r) => r.rank === 0).length > 1;
    const winner = top && top.gained > 0
      ? (tie ? 'Team wins!' : top.name + ' wins!')
      : 'CPU wins this one';
    return h('div', { class: 'stage results' },
      h('div', { class: 'center' },
        h('div', { class: 'kicker' }, v.title),
        h('div', { class: 'huge sm', style: { color: top && top.gained > 0 && !tie ? top.color : '' } }, winner)),
      h('div', { class: 'rtable' }, v.rows.map((r, i) =>
        h('div', { class: 'rrow' + (r.rank === 0 && r.gained > 0 ? ' first' : ''), style: { '--c': r.color, '--i': i } },
          h('div', { class: 'rank' }, r.rank + 1),
          h('div', { class: 'avatar' }, (r.name[0] || '?').toUpperCase()),
          h('div', { class: 'rname' }, r.name),
          h('div', { class: 'rlabel' }, r.label),
          h('div', { class: 'gain' }, r.gained ? '+' + r.gained : '0'),
          h('div', { class: 'total' }, r.total + ' pts')))),
      h('button', { class: 'cta', onclick: () => conn.send({ t: 'lobby' }) }, 'Back to lobby ', h('kbd', null, 'Enter')));
  }
})();
