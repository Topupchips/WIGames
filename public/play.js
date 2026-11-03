(function () {
  'use strict';
  const { h, connect, renderer, numTimer, PADS, shape } = CA;
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
  const mine = (v) => (v.ps || []).find((p) => p.id === v.you) || {};

  function pick(v) {
    if (v.screen === 'join') return { key: 'join', build: buildJoin };
    if (v.screen === 'lobby') return { key: 'lobby', build: lobby };
    if (v.screen === 'results') return { key: 'results', build: results };
    switch (v.game) {
      case 'tap':
        return { key: 'tap:' + v.phase, build: tap, update: v.phase === 'play' ? () => {} : null };
      case 'reflex':
        return { key: 'reflex:' + v.phase + ':' + v.round, build: reflex };
      case 'trivia':
        return { key: 'trivia:' + v.phase + ':' + v.n + ':' + (v.choice == null ? 'n' : 'y'), build: trivia };
      case 'simon': {
        const m = mine(v);
        return {
          key: 'simon:' + v.phase + ':' + v.round + ':' + m.status, build: simon,
          update: v.phase === 'input' && m.status === 'alive' ? updSimon : null,
        };
      }
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
    return h('form', {
      class: 'joinform',
      onsubmit: (e) => { e.preventDefault(); doJoin(); },
    },
    h('div', { class: 'logo sm' }, h('span', { class: 'l1' }, 'COUCH'), h('span', { class: 'l2' }, 'ARCADE')),
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
        h('h2', null, 'You pick the game'),
        sub('Or use the keyboard on the big screen.'),
        h('div', { class: 'gbtns' }, v.games.map((g, i) =>
          h('button', {
            class: 'gbtn', style: { '--a': PADS[i].c },
            onclick: () => conn.send({ t: 'start', game: g.id }),
          }, h('b', null, g.name), h('small', null, g.tag)))),
        others,
      ];
    } else {
      body = [h('h2', null, "You're in!"), sub('Waiting for the next game to start...'), others];
    }
    return frame(v, body);
  }

  // ------------------------------------------------------------ Tap Frenzy
  function tap(v) {
    if (v.phase === 'countdown') {
      return frame(v, [kicker('Tap Frenzy'), h('div', { class: 'bignum' }, numTimer(v)), sub('Get ready...')]);
    }
    if (v.phase === 'done') {
      return frame(v, [huge('Time!'), sub((mine(v).taps || 0) + ' taps')]);
    }
    let n = 0;
    const count = h('div', { class: 'tapcount' }, '0');
    const btn = h('div', {
      class: 'tapbtn',
      onpointerdown: (e) => {
        e.preventDefault();
        n++; count.textContent = n;
        btn.classList.remove('pulse'); void btn.offsetWidth; btn.classList.add('pulse');
        conn.send({ t: 'in' });
        buzz(8);
      },
    }, count, h('div', { class: 'taplabel' }, 'TAP!'));
    return frame(v, [h('div', { class: 'ptimer' }, numTimer(v)), btn], 'tapframe');
  }

  // ------------------------------------------------------------ Quick Draw
  function reflex(v) {
    const press = () => { conn.send({ t: 'in' }); buzz(15); };
    const locked = v.locked.includes(v.you);
    if (v.phase === 'intro') return frame(v, [kicker('Round ' + v.round + '/' + v.rounds), huge('Ready?')]);
    if (v.phase === 'result') {
      const w = v.winner;
      const text = !w ? 'No winner' : w.id === v.you ? 'You won!' : (v.ps.find((p) => p.id === w.id) || {}).name + ' wins';
      return frame(v, [huge(text), w ? sub(w.ms + ' ms') : null]);
    }
    let cls, label;
    if (locked) { cls = 'locked'; label = 'Too early!'; }
    else if (v.phase === 'wait') { cls = 'wait'; label = 'WAIT...'; }
    else { cls = 'go'; label = 'TAP!'; }
    return frame(v, h('button', { class: 'reflexbtn ' + cls, onpointerdown: press }, label), 'bigbody');
  }

  // ------------------------------------------------------------ Trivia
  function trivia(v) {
    if (v.phase === 'intro') return frame(v, [kicker('Trivia Blitz'), huge('Ready?'), sub('Answer fast for bonus points')]);
    const ans = v.choice;
    if (v.phase === 'question') {
      if (ans != null) {
        return frame(v, [h('div', { class: 'lockedin', style: { '--c': PADS[ans].c } }, shape(ans)), huge('Locked in'), sub('Waiting for the others...')]);
      }
      return frame(v, [
        h('div', { class: 'qmini' }, v.q),
        h('div', { class: 'abtns' }, v.opts.map((t, i) =>
          h('button', {
            class: 'abtn', style: { '--c': PADS[i].c },
            onpointerdown: (e) => { e.preventDefault(); conn.send({ t: 'in', choice: i }); buzz(12); },
          }, shape(i), h('span', null, t)))),
      ], 'triv');
    }
    const ok = ans === v.correct;
    const gain = v.gained[v.you] || 0;
    return frame(v, [
      h('div', { class: 'verdict ' + (ok ? 'ok' : 'no') }, ans == null ? 'Too slow' : ok ? 'Correct!' : 'Nope'),
      h('div', { class: 'huge' }, ok ? '+' + gain : '+0'),
      sub('Answer: ' + v.opts[v.correct]),
    ]);
  }

  // ------------------------------------------------------------ Memory Pads
  function simon(v) {
    const m = mine(v);
    if (m.status === 'out') {
      return frame(v, [huge('Out!'), sub('Watch the rest on the big screen')]);
    }
    if (v.phase === 'intro') return frame(v, [kicker('Memory Pads'), huge('Round ' + v.round)]);
    if (v.phase === 'show') return frame(v, [huge('Watch'), sub('Remember the order on the big screen')], 'watch');
    if (v.phase === 'result') return frame(v, [huge('Nice!'), sub('Round complete')]);
    if (m.status === 'done') return frame(v, [huge('Done!'), sub('Waiting for the others...')]);
    const dots = h('div', { class: 'dots' }, Array.from({ length: v.len }, (_, i) =>
      h('i', { class: i < (m.prog || 0) ? 'on' : '' })));
    const pads = h('div', { class: 'padgrid' }, PADS.map((p, i) =>
      h('button', {
        class: 'pbtn', style: { '--c': p.c },
        onpointerdown: (e) => {
          e.preventDefault();
          e.currentTarget.classList.add('hit');
          setTimeout(() => e.target.classList && e.target.classList.remove('hit'), 120);
          conn.send({ t: 'in', pad: i });
          buzz(10);
        },
      }, shape(i))));
    return frame(v, [h('div', { class: 'ptimer' }, numTimer(v)), dots, pads], 'bigbody');
  }
  function updSimon(v, wrap) {
    const m = mine(v);
    wrap.querySelectorAll('.dots i').forEach((el, i) => el.classList.toggle('on', i < (m.prog || 0)));
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
