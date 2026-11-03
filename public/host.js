(function () {
  'use strict';
  const { h, connect, renderer, numTimer, barTimer, snd, PADS, shape } = CA;
  const root = document.getElementById('app');
  const watching = location.pathname === '/watch';
  const watchCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  let room = null, view = null, prev = null, conn;

  const ICON = {
    tap: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><circle cx="32" cy="32" r="6" fill="currentColor" stroke="none"/><circle cx="32" cy="32" r="16"/><circle cx="32" cy="32" r="27" opacity=".5"/></svg>',
    reflex: '<svg viewBox="0 0 64 64"><path fill="currentColor" d="M37 5 12 37h17l-4 22 27-34H35z"/></svg>',
    trivia: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 23c0-6 4.5-10 11-10s11 4 11 9.500c0 9-11 8.500-11 18"/><circle cx="32" cy="52" r="2.500" fill="currentColor"/></svg>',
    simon: '<svg viewBox="0 0 64 64" fill="currentColor"><rect x="6" y="6" width="23" height="23" rx="7"/><rect x="35" y="6" width="23" height="23" rx="7" opacity=".7"/><rect x="6" y="35" width="23" height="23" rx="7" opacity=".7"/><rect x="35" y="35" width="23" height="23" rx="7" opacity=".4"/></svg>',
  };
  const GCOL = ['#ff5d73', '#4cc9f0', '#b8f35a', '#ffc233'];

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
    const same = a && a.screen === 'game' && a.game === b.game;
    const ph = same ? a.phase : null;
    if (b.game === 'simon' && b.lit >= 0 && (!same || a.lit !== b.lit)) snd.pad(b.lit);
    if (b.phase === ph) return;
    if (b.game === 'tap' && b.phase === 'play') snd.go();
    if (b.game === 'reflex' && b.phase === 'go') snd.go();
    if (b.game === 'reflex' && b.phase === 'result') (b.winner ? snd.ok() : snd.bad());
    if (b.game === 'trivia' && b.phase === 'question') snd.beep(520);
    if (b.game === 'trivia' && b.phase === 'reveal') snd.ok();
    if (b.game === 'simon' && b.phase === 'input') snd.beep(620);
  }
  let lastSec = null;
  setInterval(() => {
    if (view && view.game === 'tap' && view.phase === 'countdown') {
      const s = Math.ceil((view.deadline - Date.now()) / 1000);
      if (s !== lastSec) { lastSec = s; if (s > 0) snd.beep(440 + (3 - s) * 110); }
    }
  }, 100);

  // ------------------------------------------------------------ keyboard
  addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    } else if (e.key === 'm' || e.key === 'M') {
      const m = snd.toggleMute();
      toast(m ? 'Sound off' : 'Sound on');
    } else if (!view || watching) {
      return;
    } else if (view.screen === 'lobby' && /^[1-4]$/.test(e.key)) {
      const g = view.games[Number(e.key) - 1];
      if (g) conn.send({ t: 'start', game: g.id });
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
    switch (v.game) {
      case 'tap':
        return { key: 'tap:' + v.phase, build: buildTap, update: v.phase === 'play' ? updateTap : null };
      case 'reflex':
        return { key: 'reflex:' + v.phase + ':' + v.round, build: buildReflex };
      case 'trivia':
        return { key: 'trivia:' + v.phase + ':' + v.n, build: buildTrivia, update: v.phase === 'question' ? updateChips : null };
      case 'simon':
        return { key: 'simon:' + v.phase + ':' + v.round, build: buildSimon, update: updateSimon };
    }
    return null;
  }

  const initial = (p) => (p.name[0] || '?').toUpperCase();
  const header = (title, right) =>
    h('div', { class: 'ghead' }, h('div', { class: 'gtitle' }, title), right || null);

  function chips(v, val, cls) {
    return h('div', { class: 'chips' }, v.ps.map((p) =>
      h('div', { class: 'chip ' + (cls ? cls(p) : ''), style: { '--c': p.color } },
        h('span', { class: 'avatar sm' }, initial(p)),
        h('span', { class: 'cname' }, p.name),
        h('span', { class: 'cval' }, val(p)))));
  }

  // ------------------------------------------------------------ lobby
  function buildLobby(v) {
    const live = v.players.filter((p) => p.connected).length;
    const short = room ? new URL(room.url).host + '/play' : '';
    const left = h('section', { class: 'join' },
      h('div', { class: 'logo', 'aria-label': 'Couch Arcade' },
        h('span', { class: 'l1' }, 'COUCH'), h('span', { class: 'l2' }, 'ARCADE')),
      room && room.qr ? h('div', { class: 'qrcard' }, h('div', { class: 'qr', html: room.qr })) : h('div', { class: 'qrcard skeleton' }),
      h('p', { class: 'steps' }, 'Scan with your phone camera'),
      room ? h('div', { class: 'code' }, room.code.split('').map((c) => h('b', null, c))) : null,
      room ? h('p', { class: 'url' }, 'or open ', h('span', null, short), ' and enter the code') : null,
      room && !watching ? h('p', { class: 'url' }, 'Friends far away can watch at ', h('span', null, new URL(room.url).host + '/watch?room=' + room.code)) : null);

    const slots = [0, 1, 2, 3].map((i) => {
      const p = v.players[i];
      return p
        ? h('div', { class: 'slot' + (p.connected ? '' : ' off'), style: { '--c': p.color } },
          h('div', { class: 'avatar' }, initial(p)),
          h('div', { class: 'sname' }, p.name),
          h('div', { class: 'spts' }, p.points + ' pts'))
        : h('div', { class: 'slot empty' },
          h('div', { class: 'avatar' }, '+'),
          h('div', { class: 'sname' }, 'Waiting...'));
    });

    const cards = v.games.map((g, i) => card(g, i, live));
    const vip = v.players.find((p) => p.connected);
    const right = h('section', { class: 'lobbyr' },
      h('div', { class: 'slots' }, slots),
      h('h2', { class: 'sect' }, live ? 'Pick a game' : 'Waiting for players to join'),
      h('div', { class: 'games' }, cards),
      h('p', { class: 'hint' },
        'Press ', h('kbd', null, '1'), ' to ', h('kbd', null, '4'), ' to start',
        vip ? ' or let ' + vip.name + ' choose from their phone' : '',
        '  ·  ', h('kbd', null, 'F'), ' fullscreen  ·  ', h('kbd', null, 'M'), ' mute'));
    return h('div', { class: 'lobby' }, left, right);
  }

  function card(g, i, live) {
    const el = h('button', {
      class: 'gcard', disabled: live < g.min, style: { '--a': GCOL[i] },
      onclick: () => conn.send({ t: 'start', game: g.id }),
    },
    h('span', { class: 'gkey' }, i + 1),
    h('div', { class: 'gicon', html: ICON[g.id] }),
    h('h3', null, g.name),
    h('p', null, g.tag));
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--ry', (x - 0.5) * 14 + 'deg');
      el.style.setProperty('--rx', (0.5 - y) * 14 + 'deg');
      el.style.setProperty('--mx', x * 100 + '%');
      el.style.setProperty('--my', y * 100 + '%');
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
    return el;
  }

  // ------------------------------------------------------------ Tap Frenzy
  function laneRows(v) {
    const max = Math.max(25, ...v.ps.map((p) => p.taps));
    const lead = Math.max(...v.ps.map((p) => p.taps));
    return v.ps.map((p) =>
      h('div', { class: 'lane' + (p.taps === lead && lead > 0 ? ' lead' : ''), style: { '--c': p.color } },
        h('div', { class: 'lname' }, p.name),
        h('div', { class: 'track' }, h('i', { class: 'fill', style: { width: (p.taps / max) * 100 + '%' } })),
        h('div', { class: 'lcount' }, p.taps)));
  }
  function buildTap(v) {
    if (v.phase === 'countdown') {
      return h('div', { class: 'stage center' },
        h('div', { class: 'kicker' }, 'Tap Frenzy'),
        numTimer(v, 'bignum'),
        h('p', { class: 'sub' }, 'Smash the button on your phone as fast as you can'));
    }
    return h('div', { class: 'stage' },
      header('Tap Frenzy', v.phase === 'play' ? numTimer(v, 'tnum') : h('div', { class: 'tnum' }, 'Time!')),
      h('div', { class: 'lanes' }, laneRows(v)));
  }
  function updateTap(v, wrap) {
    const lanes = wrap.querySelector('.lanes');
    if (lanes) lanes.replaceChildren(...laneRows(v));
  }

  // ------------------------------------------------------------ Quick Draw
  function buildReflex(v) {
    const w = v.winner ? v.ps.find((p) => p.id === v.winner.id) : null;
    let main;
    if (v.phase === 'intro') {
      main = [h('div', { class: 'kicker' }, 'Round ' + v.round + ' of ' + v.rounds), h('div', { class: 'huge' }, 'Get ready')];
    } else if (v.phase === 'wait') {
      main = [h('div', { class: 'huge wait' }, 'Wait for it...'), h('p', { class: 'sub' }, 'Tap too early and you are locked out')];
    } else if (v.phase === 'go') {
      main = [h('div', { class: 'flash' }), h('div', { class: 'huge go' }, 'TAP!')];
    } else if (w) {
      main = [h('div', { class: 'kicker' }, 'Round winner'),
        h('div', { class: 'huge', style: { color: w.color } }, w.name),
        h('p', { class: 'sub' }, v.winner.ms + ' ms')];
    } else {
      main = [h('div', { class: 'huge dimtxt' }, 'No winner'), h('p', { class: 'sub' }, 'Nobody tapped in time')];
    }
    return h('div', { class: 'stage reflex ' + v.phase },
      header('Quick Draw  ' + Math.min(v.round, v.rounds) + '/' + v.rounds),
      h('div', { class: 'center grow' }, main),
      chips(v, (p) => '★'.repeat(p.wins) || '0', (p) => (v.locked.includes(p.id) && v.phase !== 'result' ? 'out' : '')));
  }

  // ------------------------------------------------------------ Trivia
  function triviaChips(v) {
    const rev = v.phase === 'reveal';
    return chips(v,
      (p) => p.score + (rev && v.gained[p.id] ? '  +' + v.gained[p.id] : ''),
      (p) => (rev ? (v.gained[p.id] ? 'done' : 'out') : p.answered ? 'done' : ''));
  }
  function buildTrivia(v) {
    if (v.phase === 'intro') {
      return h('div', { class: 'stage center' },
        h('div', { class: 'kicker' }, 'Trivia Blitz'),
        h('div', { class: 'huge' }, 'Ready?'),
        h('p', { class: 'sub' }, 'Faster correct answers earn more points'));
    }
    const rev = v.phase === 'reveal';
    const counts = [0, 0, 0, 0];
    if (rev) Object.values(v.answers).forEach((c) => { counts[c]++; });
    const opts = v.opts.map((t, i) =>
      h('div', { class: 'opt' + (rev ? (i === v.correct ? ' ok' : ' dim') : ''), style: { '--c': PADS[i].c } },
        shape(i), h('span', { class: 'otext' }, t), rev && counts[i] ? h('span', { class: 'ocount' }, counts[i]) : null));
    return h('div', { class: 'stage trivia' },
      header('Trivia Blitz  ' + v.n + '/' + v.total, rev ? null : numTimer(v, 'tnum')),
      rev ? h('div', { class: 'tbar' }) : barTimer(v),
      h('div', { class: 'qcard' }, v.q),
      h('div', { class: 'opts' }, opts),
      triviaChips(v));
  }
  function updateChips(v, wrap) {
    const old = wrap.querySelector('.chips');
    if (old) old.replaceWith(triviaChips(v));
  }

  // ------------------------------------------------------------ Memory Pads
  const SIMON_TEXT = {
    intro: ['Get ready', ''],
    show: ['Watch the pattern', 'Remember the order'],
    input: ['Your turn!', 'Repeat it on your phone'],
    result: ['Round complete', ''],
  };
  function simonChips(v) {
    return chips(v,
      (p) => (p.status === 'out' ? 'Out' : v.phase === 'input' ? p.prog + '/' + v.len : p.status === 'done' ? 'Done' : ''),
      (p) => (p.status === 'out' ? 'out' : p.status === 'done' ? 'done' : ''));
  }
  function buildSimon(v) {
    const t = SIMON_TEXT[v.phase];
    return h('div', { class: 'stage simon' },
      header('Memory Pads  Round ' + v.round, v.phase === 'input' ? numTimer(v, 'tnum') : null),
      h('div', { class: 'center' }, h('div', { class: 'huge sm' }, t[0]), t[1] ? h('p', { class: 'sub' }, t[1]) : null),
      h('div', { class: 'pads' }, PADS.map((p, i) =>
        h('div', { class: 'pad' + (v.lit === i ? ' lit' : ''), style: { '--c': p.c } }, shape(i)))),
      simonChips(v));
  }
  function updateSimon(v, wrap) {
    wrap.querySelectorAll('.pad').forEach((el, i) => el.classList.toggle('lit', v.lit === i));
    const old = wrap.querySelector('.chips');
    if (old) old.replaceWith(simonChips(v));
  }

  // ------------------------------------------------------------ Results
  function buildResults(v) {
    const top = v.rows[0];
    const tie = v.rows.filter((r) => r.rank === 0).length > 1;
    const winner = top && top.gained > 0
      ? (tie ? 'It is a tie!' : top.name + ' wins!')
      : 'Nobody scored';
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
