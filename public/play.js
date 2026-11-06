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


  // ------------------------------------------------------------ Motion (swing the phone)
  // Direction of the first push of a swing picks the shot: down = smash, up = lob, flat flick = drop
  // (a hard flat swing still smashes). Gravity is tracked so this works however the phone is held.
  const SWING_MIN = 10, ROT_MIN = 320, TILT_RANGE = 25;
  const motion = {
    on: false, move: 'slide', listening: false, got: false, ui: null, liveUi: null, moveUi: null,
    g: null, cool: 0, tracking: false, t0: 0, peak: 0, upSum: 0, mSum: 0, rotPeak: 0,
    neutral: null, tiltF: 0.5, freeze: 0, lastTilt: -1, lastTiltT: 0, liveT: 0,
  };

  function onMotion(e) {
    const acc = e.acceleration, ag = e.accelerationIncludingGravity, rr = e.rotationRate;
    if (ag && ag.x != null) {
      if (!motion.g) motion.g = [ag.x, ag.y, ag.z];
      else if (!motion.tracking) {
        const k = 0.05;
        motion.g = [motion.g[0] + (ag.x - motion.g[0]) * k, motion.g[1] + (ag.y - motion.g[1]) * k, motion.g[2] + (ag.z - motion.g[2]) * k];
      }
    }
    let lin;
    if (acc && acc.x != null) lin = [acc.x, acc.y, acc.z];
    else if (ag && ag.x != null && motion.g) lin = [ag.x - motion.g[0], ag.y - motion.g[1], ag.z - motion.g[2]];
    else return;
    motion.got = true;
    if (!motion.on) return;
    const m = Math.hypot(lin[0], lin[1], lin[2]);
    const gn = motion.g ? Math.hypot(motion.g[0], motion.g[1], motion.g[2]) : 0;
    const up = gn > 1 ? (lin[0] * motion.g[0] + lin[1] * motion.g[1] + lin[2] * motion.g[2]) / gn : 0;
    const rot = rr ? Math.hypot(rr.alpha || 0, rr.beta || 0, rr.gamma || 0) : 0;
    const now = performance.now();
    if (motion.liveUi && now - motion.liveT > 50) { motion.liveT = now; motion.liveUi(Math.max(m, rot / 12)); }
    if (now < motion.cool) return;
    if (!motion.tracking) {
      if (m > SWING_MIN || rot > ROT_MIN) {
        motion.tracking = true; motion.t0 = now; motion.peak = m; motion.upSum = up; motion.mSum = m; motion.rotPeak = rot;
        motion.sign0 = Math.sign(up); motion.dirOpen = true;
      }
    } else {
      const el = now - motion.t0;
      if (m > motion.peak) motion.peak = m;
      // the first push (until the acceleration changes direction) shows the intended swing direction
      if (motion.dirOpen && el < 100) {
        if (Math.sign(up) !== motion.sign0 && Math.abs(up) > 3) motion.dirOpen = false;
        else { motion.upSum += up; motion.mSum += m; }
      }
      motion.rotPeak = Math.max(motion.rotPeak, rot);
      if (el > 120 || (el > 50 && m < motion.peak * 0.45)) {
        motion.tracking = false; motion.cool = now + 380; motion.freeze = now + 450;
        const str = Math.max(motion.peak, motion.rotPeak / 12);
        const r = motion.upSum / Math.max(1, motion.mSum);
        let shot;
        if (r < -0.3 && str >= 16) shot = 'smash';
        else if (r > 0.3) shot = 'lob';
        else if (str >= 34) shot = 'smash';
        else if (str >= 20) shot = 'lob';
        else shot = 'drop';
        swung(shot, str);
      }
    }
  }
  function swung(s, str) {
    conn.send({ t: 'in', k: 'shot', s });
    buzz(s === 'smash' ? 45 : 22);
    if (motion.ui) motion.ui(s, str);
  }
  function onOrient(e) {
    if (!motion.on || motion.move !== 'tilt' || e.gamma == null) return;
    const now = performance.now();
    if (motion.neutral == null) motion.neutral = e.gamma;
    if (now < motion.freeze || motion.tracking) return;
    const f = Math.max(0, Math.min(1, 0.5 + (e.gamma - motion.neutral) / (2 * TILT_RANGE)));
    motion.tiltF += (f - motion.tiltF) * 0.4;
    if (Math.abs(motion.tiltF - motion.lastTilt) > 0.004 && now - motion.lastTiltT > 33) {
      motion.lastTilt = motion.tiltF; motion.lastTiltT = now;
      conn.send({ t: 'in', k: 'pos', f: Math.round(motion.tiltF * 1000) / 1000 });
      if (motion.moveUi) motion.moveUi(motion.tiltF);
    }
  }
  async function enableMotion() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        if ((await DeviceMotionEvent.requestPermission()) !== 'granted') return 'denied';
        try {
          if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            await DeviceOrientationEvent.requestPermission();
          }
        } catch { /* orientation is optional */ }
      }
    } catch { return 'denied'; }
    if (!motion.listening) {
      addEventListener('devicemotion', onMotion);
      addEventListener('deviceorientation', onOrient);
      motion.listening = true;
    }
    motion.on = true; motion.got = false; motion.g = null;
    await new Promise((r) => setTimeout(r, 1200));
    return motion.got ? 'ok' : 'nosensor';
  }

  function badminton(v) {
    const score = h('div', { class: 'bdscore' });
    const status = h('div', { class: 'bdstatus' });
    paintBd(v, score, status);

    // slide pad: your finger position maps to your position on your half of the court
    const thumb = h('i', { class: 'thumb' });
    const padLabel = h('span', { class: 'padlabel' }, 'SLIDE TO MOVE');
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
    const sliding = () => !(motion.on && motion.move === 'tilt');
    const pad = h('div', {
      class: 'movepad',
      onpointerdown: (e) => { if (!sliding()) return; e.preventDefault(); pad.setPointerCapture(e.pointerId); pad.classList.add('on'); set(e); },
      onpointermove: (e) => { if (pad.classList.contains('on')) set(e); },
      onpointerup: () => { if (pad.classList.contains('on')) { pad.classList.remove('on'); send(true); } },
      onpointercancel: () => { pad.classList.remove('on'); send(true); },
    }, padLabel, thumb);

    const shot = (s, label, hint, col) => h('button', {
      class: 'shotbtn', style: { '--c': col },
      onpointerdown: (e) => { e.preventDefault(); conn.send({ t: 'in', k: 'shot', s }); buzz(14); },
    }, h('b', null, label), h('small', null, hint));
    const buttons = h('div', { class: 'shots' },
      shot('lob', 'LOB', 'high, deep', '#73eff7'),
      shot('drop', 'DROP', 'soft, short', '#a7f070'),
      shot('smash', 'SMASH', 'fast, hard', '#ef7d57'));

    // swing zone: shown instead of the buttons once motion controls are on
    const swingText = h('b', null, 'SWING YOUR PHONE');
    const meter = h('i', { class: 'meterfill live' });
    const swing = h('div', { class: 'swingzone' }, swingText, h('div', { class: 'meter' }, meter),
      h('small', null, 'Swing down = smash, swing up = lob, flick = drop'));
    const note = h('p', { class: 'motionnote' });
    const modeBtn = h('button', { class: 'modebtn' });
    const moveBtn = h('button', { class: 'modebtn' });
    const calBtn = h('button', { class: 'modebtn' }, 'RECENTER');
    const slot = h('div', { class: 'shotslot' });
    const modes = h('div', { class: 'modes' });
    let holdUntil = 0;
    const paint = () => {
      slot.replaceChildren(motion.on ? swing : buttons);
      modeBtn.textContent = motion.on ? 'USE BUTTONS' : 'USE MOTION';
      moveBtn.textContent = 'MOVE: ' + (motion.move === 'tilt' ? 'TILT' : 'THUMB');
      const tilt = motion.on && motion.move === 'tilt';
      pad.classList.toggle('tilt', tilt);
      padLabel.textContent = tilt ? 'TILT PHONE LEFT / RIGHT TO MOVE' : 'SLIDE TO MOVE';
      modes.replaceChildren(modeBtn, ...(motion.on ? [moveBtn] : []), ...(tilt ? [calBtn] : []));
      if (motion.on) {
        motion.ui = (s, str) => {
          swingText.textContent = s.toUpperCase() + '!';
          meter.style.width = Math.min(100, (str / 50) * 100) + '%'; meter.className = 'meterfill';
          holdUntil = performance.now() + 700;
          swing.classList.remove('hit'); void swing.offsetWidth; swing.classList.add('hit');
        };
        motion.liveUi = (m) => {
          if (performance.now() < holdUntil) return;
          meter.className = 'meterfill live'; meter.style.width = Math.min(100, (m / 50) * 100) + '%';
        };
        motion.moveUi = (ff) => { thumb.style.left = ff * 100 + '%'; };
      } else { motion.ui = null; motion.liveUi = null; motion.moveUi = null; }
    };
    modeBtn.addEventListener('click', async () => {
      if (motion.on) { motion.on = false; note.textContent = ''; paint(); return; }
      if (!window.isSecureContext) {
        note.textContent = 'Phone sensors need a secure (https) link. Run npm run start:https, or see the README.';
        return;
      }
      note.textContent = 'Checking motion sensor...';
      const r = await enableMotion();
      if (r === 'ok') { note.textContent = ''; ls.set('ca:motion', '1'); paint(); }
      else {
        motion.on = false;
        note.textContent = r === 'denied' ? 'Motion permission was denied. Allow it in the browser settings and try again.'
          : 'No motion data received. Use the buttons, or try another browser.';
      }
    });
    moveBtn.addEventListener('click', () => {
      motion.move = motion.move === 'tilt' ? 'slide' : 'tilt'; motion.neutral = null; paint();
    });
    calBtn.addEventListener('click', () => { motion.neutral = null; buzz(15); });
    paint();

    return frame(v, [score, status, pad, slot, modes, note], 'bdframe');
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
