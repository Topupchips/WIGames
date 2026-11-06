(function () {
  'use strict';
  const { h, connect, renderer } = CA;
  const root = document.getElementById('app');
  const qs = new URLSearchParams(location.search);
  let me = null, view = null, joinErr = '', conn;
  let codeVal = (qs.get('room') || '').toUpperCase(), nameVal = '';

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  nameVal = ls.get('ca:name') || '';
  const session = () => { try { return JSON.parse(ls.get('ca:session') || 'null'); } catch { return null; } };
  const buzz = (n) => { try { if (navigator.vibrate) navigator.vibrate(n || 10); } catch { /* ignore */ } };
  const render = renderer(root, pick);

  function showJoin() { view = { screen: 'join', err: joinErr }; render(view); }

  conn = connect({
    onOpen() {
      const s = session();
      if (s && s.token && (!codeVal || s.code === codeVal)) conn.send({ t: 'join', code: s.code, token: s.token });
      else if (!me) showJoin();
    },
    onStatus(ok) { document.body.classList.toggle('offline', !ok); },
    onMessage(m) {
      if (m.t === 'joined') {
        me = m; joinErr = '';
        ls.set('ca:session', JSON.stringify({ code: m.code, token: m.token }));
        ls.set('ca:name', m.name);
        document.documentElement.style.setProperty('--me', m.color);
        history.replaceState(null, '', '/play?room=' + m.code);
      } else if (m.t === 'err') {
        joinErr = m.msg;
        if (!me) { ls.del('ca:session'); showJoin(); }
      } else if (m.t === 'view') {
        view = m.view;
        render(view);
      }
    },
  });

  function doJoin() {
    joinErr = '';
    if (codeVal.length !== 4) { joinErr = 'Enter the 4 letter room code.'; return showJoin(); }
    conn.send({ t: 'join', code: codeVal, name: nameVal });
  }

  // ------------------------------------------------------------ routing
  function pick(v) {
    if (v.screen === 'join') return { key: 'join', build: buildJoin };
    if (v.screen === 'lobby') return { key: 'lobby', build: lobby };
    if (v.screen === 'results') return { key: 'results', build: results };
    if (v.game === 'badminton') {
      return v.phase === 'over'
        ? { key: 'bd:over', build: matchOver }
        : { key: 'bd:play', build: badminton, update: updBd };
    }
    return null;
  }

  function frame(v, body, cls) {
    const p = v.players.find((x) => x.id === v.you) || { name: '?', points: 0 };
    return h('div', { class: 'pframe ' + (cls || '') },
      h('header', { class: 'ptop' },
        h('span', { class: 'avatar sm' }, (p.name[0] || '?').toUpperCase()),
        h('span', { class: 'pname' }, p.name),
        h('span', { class: 'ppts' }, p.points + ' pts')),
      h('main', { class: 'pmain' }, body));
  }
  const huge = (t) => h('div', { class: 'huge' }, t);
  const sub = (t) => h('p', { class: 'sub' }, t);
  const kicker = (t) => h('div', { class: 'kicker' }, t);

  // ------------------------------------------------------------ join
  function buildJoin(v) {
    return h('form', { class: 'joinform', onsubmit: (e) => { e.preventDefault(); doJoin(); } },
      h('div', { class: 'logo sm' }, h('span', { class: 'l1' }, 'BADMINTON'), h('span', { class: 'l2' }, 'NIGHT')),
      h('label', null, 'Room code',
        h('input', {
          class: 'codeinput', value: codeVal, maxlength: 4, autocapitalize: 'characters', autocomplete: 'off',
          spellcheck: 'false', placeholder: 'ABCD',
          oninput: (e) => { codeVal = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); e.target.value = codeVal; },
        })),
      h('label', null, 'Your name',
        h('input', {
          value: nameVal, maxlength: 12, autocomplete: 'off', placeholder: 'e.g. Sam',
          oninput: (e) => { nameVal = e.target.value; },
        })),
      v.err ? h('p', { class: 'err' }, v.err) : null,
      h('button', { class: 'cta', type: 'submit' }, 'Join'));
  }

  // ------------------------------------------------------------ lobby
  function lobby(v) {
    const others = h('div', { class: 'plist' }, v.players.map((p) =>
      h('span', { class: 'pchip' + (p.connected ? '' : ' off'), style: { '--c': p.color } }, p.name)));
    let body;
    if (v.vip) {
      body = [
        h('h2', null, "You're in"),
        sub('Start the match when everyone has joined.'),
        h('button', { class: 'cta big', onclick: () => conn.send({ t: 'start', game: v.games[0].id }) }, 'Start match'),
        others,
      ];
    } else {
      body = [h('h2', null, "You're in!"), sub('Waiting for the match to start...'), others];
    }
    return frame(v, body);
  }

  // ------------------------------------------------------------ Badminton
  function paintBd(v, score, status) {
    if (!score || !status) return;
    score.textContent = v.score[0] + '  :  ' + v.score[1];
    const side = v.team === 0 ? 'LEFT' : 'RIGHT';
    let s;
    if (v.phase === 'intro') s = 'Match starting. You play on the ' + side;
    else if (v.phase === 'serve') s = v.serving === v.team ? 'Your serve! Get under the shuttle' : 'Their serve. Get ready';
    else if (v.phase === 'point') s = v.banner;
    else s = 'You are on the ' + side;
    status.textContent = s;
  }
  function updBd(v, wrap) {
    paintBd(v, wrap.querySelector('.bdscore'), wrap.querySelector('.bdstatus'));
  }

  function badminton(v) {
    const score = h('div', { class: 'bdscore' });
    const status = h('div', { class: 'bdstatus' });
    paintBd(v, score, status);

    // slide pad: your finger position maps to your position on your half of the court
    const thumb = h('i', { class: 'thumb' });
    let lastSend = 0, f = 0.5;
    const send = (force) => {
      const n = performance.now();
      if (force || n - lastSend > 35) { lastSend = n; conn.send({ t: 'in', k: 'pos', f: Math.round(f * 1000) / 1000 }); }
    };
    const set = (e) => {
      const r = pad.getBoundingClientRect();
      f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      thumb.style.left = f * 100 + '%';
      send(false);
    };
    const pad = h('div', {
      class: 'movepad',
      onpointerdown: (e) => { e.preventDefault(); pad.setPointerCapture(e.pointerId); pad.classList.add('on'); set(e); },
      onpointermove: (e) => { if (pad.classList.contains('on')) set(e); },
      onpointerup: () => { pad.classList.remove('on'); send(true); },
      onpointercancel: () => { pad.classList.remove('on'); send(true); },
    }, h('span', { class: 'padlabel' }, 'Slide to move'), thumb);

    const shot = (s, label, hint, col) => h('button', {
      class: 'shotbtn', style: { '--c': col },
      onpointerdown: (e) => { e.preventDefault(); conn.send({ t: 'in', k: 'shot', s }); buzz(14); },
    }, h('b', null, label), h('small', null, hint));

    return frame(v, [
      score, status, pad,
      h('div', { class: 'shots' },
        shot('lob', 'Lob', 'high and deep', '#4cc9f0'),
        shot('drop', 'Drop', 'soft by the net', '#b8f35a'),
        shot('smash', 'Smash', 'fast and hard', '#ff5d73')),
    ], 'bdframe');
  }

  function matchOver(v) {
    return frame(v, [kicker('Match over'), huge(v.banner), sub(v.score[0] + ' : ' + v.score[1])]);
  }

  // ------------------------------------------------------------ Results
  const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
  function results(v) {
    const r = v.rows.find((x) => x.id === v.you);
    return frame(v, [
      kicker(v.title),
      r ? h('div', { class: 'huge' }, ord(r.rank + 1)) : null,
      r ? sub(r.gained ? '+' + r.gained + ' points' : 'No points this time') : null,
      h('div', { class: 'rmini' }, v.rows.map((x) =>
        h('div', { class: 'rm' + (x.id === v.you ? ' me' : ''), style: { '--c': x.color } },
          h('span', null, x.rank + 1), h('b', null, x.name), h('em', null, x.label), h('i', null, x.total + ' pts')))),
      v.vip
        ? h('button', { class: 'cta', onclick: () => conn.send({ t: 'lobby' }) }, 'Back to lobby')
        : sub('Waiting for the host...'),
    ]);
  }
})();
