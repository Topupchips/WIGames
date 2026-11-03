(function () {
  'use strict';

  // Tiny DOM helper: h('div', {class:'x', onclick:fn}, child, [children], 'text')
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'style') {
          if (typeof v === 'string') e.style.cssText = v;
          else for (const s of Object.keys(v)) {
            if (s.startsWith('--')) e.style.setProperty(s, v[s]);
            else e.style[s] = v[s];
          }
        } else if (k === 'html') e.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    (function add(list) {
      for (const c of list) {
        if (c == null || c === false) continue;
        if (Array.isArray(c)) add(c);
        else e.append(c.nodeType ? c : document.createTextNode(String(c)));
      }
    })(kids);
    return e;
  }

  // Pad / answer colours and shapes (shared by Memory Pads and Trivia)
  const SHAPES = {
    tri: '<svg viewBox="0 0 100 100"><path d="M50 14 90 84H10z"/></svg>',
    dia: '<svg viewBox="0 0 100 100"><path d="M50 8 92 50 50 92 8 50z"/></svg>',
    cir: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="38"/></svg>',
    sq: '<svg viewBox="0 0 100 100"><rect x="16" y="16" width="68" height="68" rx="8"/></svg>',
  };
  const PADS = [
    { c: '#ff5d73', s: 'tri' },
    { c: '#4cc9f0', s: 'dia' },
    { c: '#b8f35a', s: 'cir' },
    { c: '#ffc233', s: 'sq' },
  ];
  const shape = (i) => h('span', { class: 'shape', html: SHAPES[PADS[i].s] });

  // WebSocket with auto-reconnect
  function connect({ onOpen, onMessage, onStatus }) {
    let ws, tries = 0;
    function open() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}`);
      ws.onopen = () => { tries = 0; if (onStatus) onStatus(true); if (onOpen) onOpen(); };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        onMessage(m);
      };
      ws.onclose = () => {
        if (onStatus) onStatus(false);
        setTimeout(open, Math.min(4000, 500 + tries++ * 500));
      };
    }
    open();
    return { send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); } };
  }

  // Screen renderer. pick(view) -> { key, build(view), update?(view, wrap) }
  // New key: fresh screen with enter animation. Same key: rebuild contents when the
  // view changed (or call update to patch in place).
  function renderer(root, pick) {
    let key = null, sig = null, wrap = null;
    return function (view) {
      view.deadline = Date.now() + (view.ms || 0);
      const def = pick(view);
      if (!def) return;
      const s = JSON.stringify(view, (k, v) => (k === 'ms' || k === 'deadline' ? undefined : v));
      if (def.key !== key || !wrap) {
        key = def.key; sig = s;
        wrap = h('div', { class: 'screen enter' });
        wrap.append(def.build(view));
        root.replaceChildren(wrap);
        return;
      }
      if (def.update) { def.update(view, wrap); sig = s; return; }
      if (s !== sig) { sig = s; wrap.replaceChildren(def.build(view)); }
    };
  }

  // Countdown helpers: elements carrying a deadline are animated by one rAF loop.
  const numTimer = (v, cls) =>
    h('span', { class: cls || '', 'data-kind': 'num', 'data-deadline': v.deadline });
  const barTimer = (v) =>
    h('div', { class: 'tbar' }, h('i', { 'data-kind': 'bar', 'data-deadline': v.deadline, 'data-dur': v.dur || 1 }));
  (function loop() {
    const now = Date.now();
    for (const el of document.querySelectorAll('[data-deadline]')) {
      const left = Math.max(0, Number(el.dataset.deadline) - now);
      if (el.dataset.kind === 'bar') {
        el.style.transform = 'scaleX(' + Math.min(1, left / Number(el.dataset.dur || 1)) + ')';
      } else {
        const t = String(Math.ceil(left / 1000));
        if (el.textContent !== t) el.textContent = t;
      }
    }
    requestAnimationFrame(loop);
  })();

  // Sound (host screen). Browsers require a click or key press first.
  let ac = null, muted = false;
  function unlock() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ }
    }
    if (ac && ac.state === 'suspended') ac.resume();
  }
  ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, unlock, { passive: true }));
  function tone(f, d, type, vol, delay) {
    if (!ac || muted) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (d || 0.15));
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + (d || 0.15) + 0.03);
  }
  const snd = {
    beep: (f) => tone(f || 440, 0.12, 'triangle', 0.12),
    pad: (i) => tone([262, 330, 392, 523][i] || 300, 0.4, 'sine', 0.2),
    go: () => { tone(660, 0.1, 'square', 0.08); tone(990, 0.22, 'square', 0.08, 0.1); },
    ok: () => { tone(523, 0.1, 'triangle', 0.14); tone(784, 0.2, 'triangle', 0.14, 0.09); },
    bad: () => tone(160, 0.3, 'sawtooth', 0.1),
    join: () => { tone(587, 0.1, 'triangle', 0.12); tone(880, 0.16, 'triangle', 0.12, 0.08); },
    win: () => [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.25, 'triangle', 0.14, k * 0.11)),
    toggleMute: () => { muted = !muted; return muted; },
  };

  // Keep screens awake
  async function keepAwake() {
    try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
  keepAwake();

  window.CA = { h, connect, renderer, numTimer, barTimer, snd, PADS, shape };
})();
