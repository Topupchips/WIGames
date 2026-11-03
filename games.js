'use strict';
// Game modules. Each game has: id, name, tag, min (min players), create(ctx).
// create(ctx) returns { start(), input(pid, msg), view(pid), stop() }.
// ctx = { players:[{id,name,color}], push(), finish({scores, labels}) }.
// view(pid) is called with null for the big screen. Times are sent as `ms`
// (remaining in the current phase) and `dur` (phase length) so clients can
// animate countdowns without clock sync.

const SCALE = Number(process.env.TIME_SCALE) || 1; // only used by tests

const shuffle = (a) => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

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
    cancel(id) { clearTimeout(id); set.delete(id); },
    cancelAll() { for (const id of set) { clearTimeout(id); clearInterval(id); } set.clear(); },
  };
}

// ---------------------------------------------------------------- Tap Frenzy
const tap = {
  id: 'tap', name: 'Tap Frenzy', tag: 'Smash your screen for 10 seconds', min: 1,
  create(ctx) {
    const T = timers();
    const DURATION = 10000;
    const taps = {};
    ctx.players.forEach((p) => { taps[p.id] = 0; });
    let phase = 'countdown', until = 0, dur = 3000;

    function finish() {
      const scores = {}, labels = {};
      for (const p of ctx.players) { scores[p.id] = taps[p.id]; labels[p.id] = `${taps[p.id]} taps`; }
      ctx.finish({ scores, labels });
    }
    return {
      start() {
        until = Date.now() + 3000;
        ctx.push();
        T.after(3000, () => {
          phase = 'play'; dur = DURATION; until = Date.now() + DURATION;
          ctx.push();
          T.every(120, () => ctx.push());
          T.after(DURATION, () => {
            T.cancelAll();
            phase = 'done'; dur = 1; until = Date.now();
            ctx.push();
            T.after(2000, finish);
          });
        });
      },
      input(pid) { if (phase === 'play' && pid in taps) taps[pid]++; },
      view() {
        return {
          game: 'tap', phase, ms: Math.max(0, until - Date.now()), dur,
          ps: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color, taps: taps[p.id] })),
        };
      },
      stop() { T.cancelAll(); },
    };
  },
};

// ---------------------------------------------------------------- Quick Draw
const reflex = {
  id: 'reflex', name: 'Quick Draw', tag: 'Wait for it, then tap first', min: 1,
  create(ctx) {
    const T = timers();
    const ROUNDS = 5;
    const wins = {}, times = {};
    ctx.players.forEach((p) => { wins[p.id] = 0; times[p.id] = []; });
    let round = 0, phase = 'intro', until = 0, dur = 0, goAt = 0;
    let locked = new Set(), winner = null, goTimer = null, waitTimer = null;

    const setPhase = (ph, ms) => { phase = ph; until = Date.now() + ms; dur = ms; };

    function next() {
      round++;
      if (round > ROUNDS) return finish();
      locked = new Set(); winner = null;
      setPhase('intro', 1600); ctx.push();
      T.after(1600, () => {
        const d = 1800 + Math.random() * 3600;
        setPhase('wait', d); ctx.push();
        waitTimer = T.after(d, go);
      });
    }
    function go() {
      goAt = Date.now();
      setPhase('go', 3000); ctx.push();
      goTimer = T.after(3000, endRound);
    }
    function endRound() {
      if (phase === 'result') return;
      T.cancel(goTimer); T.cancel(waitTimer);
      setPhase('result', 2600); ctx.push();
      T.after(2600, next);
    }
    function finish() {
      const scores = {}, labels = {};
      for (const p of ctx.players) {
        const t = times[p.id];
        const avg = t.length ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) : 0;
        scores[p.id] = wins[p.id] + (wins[p.id] ? Math.max(0, 3000 - avg) / 1e6 : 0);
        labels[p.id] = `${wins[p.id]} ${wins[p.id] === 1 ? 'win' : 'wins'}` + (wins[p.id] ? ` · avg ${avg} ms` : '');
      }
      ctx.finish({ scores, labels });
    }
    return {
      start() { next(); },
      input(pid) {
        if (!(pid in wins) || locked.has(pid)) return;
        if (phase === 'wait') {
          locked.add(pid); ctx.push();
          if (locked.size >= ctx.players.length) endRound();
        } else if (phase === 'go') {
          const ms = Date.now() - goAt;
          winner = { id: pid, ms }; wins[pid]++; times[pid].push(ms);
          endRound();
        }
      },
      view() {
        return {
          game: 'reflex', phase, ms: Math.max(0, until - Date.now()), dur, round, rounds: ROUNDS,
          locked: [...locked], winner,
          ps: ctx.players.map((p) => ({ id: p.id, name: p.name, color: p.color, wins: wins[p.id] })),
        };
      },
      stop() { T.cancelAll(); },
    };
  },
};

// -------------------------------------------------------------- Trivia Blitz
const BANK = [
  { q: 'Which planet is known as the Red Planet?', a: ['Venus', 'Mars', 'Jupiter', 'Mercury'], c: 1 },
  { q: 'What is the largest ocean on Earth?', a: ['Atlantic', 'Indian', 'Pacific', 'Arctic'], c: 2 },
  { q: 'How many sides does a hexagon have?', a: ['5', '6', '7', '8'], c: 1 },
  { q: 'Which element has the chemical symbol Au?', a: ['Silver', 'Gold', 'Iron', 'Copper'], c: 1 },
  { q: 'Who painted the Mona Lisa?', a: ['Michelangelo', 'Raphael', 'Leonardo da Vinci', 'Van Gogh'], c: 2 },
  { q: 'What is the capital of Canada?', a: ['Toronto', 'Ottawa', 'Montreal', 'Vancouver'], c: 1 },
  { q: 'Which is the largest mammal?', a: ['African elephant', 'Giraffe', 'Blue whale', 'Orca'], c: 2 },
  { q: 'In what year did the Titanic sink?', a: ['1905', '1912', '1920', '1931'], c: 1 },
  { q: 'What is the hardest natural substance?', a: ['Quartz', 'Steel', 'Diamond', 'Topaz'], c: 2 },
  { q: 'Which planet has the most prominent rings?', a: ['Saturn', 'Mars', 'Earth', 'Mercury'], c: 0 },
  { q: 'At sea level, water boils at how many degrees Celsius?', a: ['90', '100', '110', '120'], c: 1 },
  { q: 'Who wrote Romeo and Juliet?', a: ['Charles Dickens', 'Jane Austen', 'William Shakespeare', 'Mark Twain'], c: 2 },
  { q: 'Which country gave the Statue of Liberty to the United States?', a: ['France', 'England', 'Spain', 'Italy'], c: 0 },
  { q: 'What is the smallest prime number?', a: ['0', '1', '2', '3'], c: 2 },
  { q: 'Which gas do plants absorb for photosynthesis?', a: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'], c: 2 },
  { q: 'Which animal is called the ship of the desert?', a: ['Horse', 'Camel', 'Llama', 'Donkey'], c: 1 },
  { q: 'How many bones does an adult human have?', a: ['156', '206', '256', '306'], c: 1 },
  { q: 'On which continent is the Sahara Desert?', a: ['Asia', 'South America', 'Africa', 'Australia'], c: 2 },
  { q: 'What does CPU stand for?', a: ['Central Processing Unit', 'Computer Power Unit', 'Core Program Utility', 'Central Program Usage'], c: 0 },
  { q: 'What is the tallest mountain above sea level?', a: ['K2', 'Kilimanjaro', 'Mount Everest', 'Denali'], c: 2 },
  { q: 'How many strings does a standard guitar have?', a: ['4', '5', '6', '8'], c: 2 },
  { q: 'What is the chemical formula for water?', a: ['CO2', 'H2O', 'O2', 'NaCl'], c: 1 },
  { q: 'Which two provinces border the Bay of Fundy?', a: ['New Brunswick and Nova Scotia', 'PEI and Newfoundland', 'Quebec and Ontario', 'Nova Scotia and PEI'], c: 0 },
  { q: 'What is the largest planet in our solar system?', a: ['Saturn', 'Neptune', 'Jupiter', 'Earth'], c: 2 },
  { q: 'Which company created the iPhone?', a: ['Samsung', 'Apple', 'Nokia', 'Google'], c: 1 },
  { q: 'What is the square root of 144?', a: ['10', '11', '12', '14'], c: 2 },
  { q: 'Which is the largest country by land area?', a: ['Canada', 'China', 'United States', 'Russia'], c: 3 },
  { q: 'The Python language is named after which comedy group?', a: ['Monty Python', 'The Goodies', 'Blackadder', 'The Two Ronnies'], c: 0 },
  { q: 'What does HTML stand for?', a: ['HyperText Markup Language', 'High Tech Modern Language', 'Home Tool Markup Language', 'HyperTransfer Make Language'], c: 0 },
  { q: 'How many minutes are in a day?', a: ['1,240', '1,440', '1,640', '2,400'], c: 1 },
  { q: 'Which planet is closest to the Sun?', a: ['Venus', 'Earth', 'Mercury', 'Mars'], c: 2 },
  { q: 'Which ocean lies between Africa and Australia?', a: ['Atlantic', 'Indian', 'Pacific', 'Arctic'], c: 1 },
];

const trivia = {
  id: 'trivia', name: 'Trivia Blitz', tag: '8 questions, faster answers score more', min: 1,
  create(ctx) {
    const T = timers();
    const N = 8, QTIME = 15000, REVEAL = 4200;
    const qs = shuffle(BANK).slice(0, N).map((q) => {
      const opts = shuffle(q.a.map((t, i) => ({ t, ok: i === q.c })));
      return { q: q.q, opts: opts.map((o) => o.t), c: opts.findIndex((o) => o.ok) };
    });
    const score = {};
    ctx.players.forEach((p) => { score[p.id] = 0; });
    let i = -1, phase = 'intro', until = 0, dur = 0, answers = {}, gained = {}, qTimer = null;

    function next() {
      i++;
      if (i >= N) return finish();
      answers = {}; gained = {};
      phase = 'question'; until = Date.now() + QTIME; dur = QTIME;
      ctx.push();
      qTimer = T.after(QTIME, reveal);
    }
    function reveal() {
      if (phase !== 'question') return;
      T.cancel(qTimer);
      phase = 'reveal'; until = Date.now() + REVEAL; dur = REVEAL;
      ctx.push();
      T.after(REVEAL, next);
    }
    function finish() {
      const labels = {};
      for (const p of ctx.players) labels[p.id] = `${score[p.id]} pts`;
      ctx.finish({ scores: score, labels });
    }
    return {
      start() {
        phase = 'intro'; until = Date.now() + 2500; dur = 2500;
        ctx.push();
        T.after(2500, next);
      },
      input(pid, m) {
        if (phase !== 'question' || !(pid in score) || pid in answers) return;
        const c = Number(m.choice);
        if (!(c >= 0 && c < 4)) return;
        const left = Math.max(0, until - Date.now());
        answers[pid] = c;
        if (c === qs[i].c) {
          const g = 100 + Math.round((100 * left) / QTIME);
          gained[pid] = g; score[pid] += g;
        } else gained[pid] = 0;
        ctx.push();
        if (Object.keys(answers).length >= ctx.players.length) reveal();
      },
      view(pid) {
        const v = {
          game: 'trivia', phase, ms: Math.max(0, until - Date.now()), dur, n: i + 1, total: N,
          ps: ctx.players.map((p) => ({
            id: p.id, name: p.name, color: p.color, score: score[p.id], answered: p.id in answers,
          })),
        };
        if (phase === 'question' || phase === 'reveal') {
          v.q = qs[i].q; v.opts = qs[i].opts;
          v.choice = pid != null && pid in answers ? answers[pid] : null;
        }
        if (phase === 'reveal') { v.correct = qs[i].c; v.answers = answers; v.gained = gained; }
        return v;
      },
      stop() { T.cancelAll(); },
    };
  },
};

// --------------------------------------------------------------- Memory Pads
const simon = {
  id: 'simon', name: 'Memory Pads', tag: 'Watch the pattern, repeat it, last one standing', min: 1,
  create(ctx) {
    const T = timers();
    const MAXR = 14;
    const solo = ctx.players.length === 1;
    const seq = [];
    const prog = {}, status = {}, score = {};
    ctx.players.forEach((p) => { prog[p.id] = 0; status[p.id] = 'alive'; score[p.id] = 0; });
    let round = 0, phase = 'intro', until = 0, dur = 0, lit = -1, inputTimer = null;

    const alive = () => ctx.players.filter((p) => status[p.id] === 'alive');

    function next() {
      round++;
      seq.push(Math.floor(Math.random() * 4));
      ctx.players.forEach((p) => { prog[p.id] = 0; });
      phase = 'intro'; lit = -1; until = Date.now() + 1500; dur = 1500;
      ctx.push();
      T.after(1500, show);
    }
    function show() {
      const step = Math.max(300, 560 - round * 22);
      const gap = Math.max(140, 260 - round * 8);
      const total = seq.length * (step + gap) + 400;
      phase = 'show'; lit = -1; until = Date.now() + total; dur = total;
      ctx.push();
      seq.forEach((pad, k) => {
        T.after(300 + k * (step + gap), () => { lit = pad; ctx.push(); });
        T.after(300 + k * (step + gap) + step, () => { lit = -1; ctx.push(); });
      });
      T.after(total, listen);
    }
    function listen() {
      const ms = 6000 + seq.length * 1300;
      phase = 'input'; lit = -1; until = Date.now() + ms; dur = ms;
      ctx.push();
      inputTimer = T.after(ms, endRound);
    }
    function endRound() {
      if (phase !== 'input') return;
      T.cancel(inputTimer);
      for (const p of alive()) {
        if (prog[p.id] < seq.length) { status[p.id] = 'out'; score[p.id] = round - 1; }
      }
      const surv = alive();
      surv.forEach((p) => { score[p.id] = round; });
      phase = 'result'; until = Date.now() + 2200; dur = 2200;
      ctx.push();
      const over = surv.length === 0 || (!solo && surv.length <= 1) || round >= MAXR;
      T.after(2200, over ? finish : next);
    }
    function finish() {
      const labels = {};
      for (const p of ctx.players) {
        labels[p.id] = `${score[p.id]} ${score[p.id] === 1 ? 'round' : 'rounds'}`;
      }
      ctx.finish({ scores: score, labels });
    }
    return {
      start() { next(); },
      input(pid, m) {
        if (phase !== 'input' || status[pid] !== 'alive' || prog[pid] >= seq.length) return;
        const pad = Number(m.pad);
        if (pad === seq[prog[pid]]) prog[pid]++;
        else { status[pid] = 'out'; score[pid] = round - 1; }
        ctx.push();
        if (alive().every((p) => prog[p.id] >= seq.length)) endRound();
      },
      view() {
        return {
          game: 'simon', phase, ms: Math.max(0, until - Date.now()), dur, round, len: seq.length, lit,
          ps: ctx.players.map((p) => ({
            id: p.id, name: p.name, color: p.color, prog: prog[p.id],
            status: status[p.id] === 'out' ? 'out' : (phase === 'input' || phase === 'result') && prog[p.id] >= seq.length ? 'done' : 'alive',
          })),
        };
      },
      stop() { T.cancelAll(); },
    };
  },
};

const GAMES = [tap, reflex, trivia, simon];
const byId = Object.fromEntries(GAMES.map((g) => [g.id, g]));
module.exports = { GAMES, byId };
