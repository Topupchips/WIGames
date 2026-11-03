'use strict';
// Couch Arcade server: serves the host screen + phone controller, and relays
// everything over WebSockets. All game logic lives on the server (games.js).

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { GAMES, byId } = require('./games');

const PORT = Number(process.env.PORT) || 3000;
const PUB = path.join(__dirname, 'public');
const MAX_PLAYERS = 4;
const POINTS = [5, 3, 2, 1];
const COLORS = ['#ff5d73', '#4cc9f0', '#b8f35a', '#ffc233'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function lanIP() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  return out.find((a) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a)) || out[0] || 'localhost';
}

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = req.headers.host || `localhost:${PORT}`;
  const name = host.replace(/:\d+$/, '');
  if (name === 'localhost' || name === '127.0.0.1' || name === '[::1]') {
    return `http://${lanIP()}:${PORT}`;
  }
  const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${host}`;
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (p === '/' || p === '/host') p = '/host.html';
  else if (p === '/play') p = '/play.html';
  else if (p === '/watch') p = '/host.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------- Rooms ----------
const rooms = new Map();

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!rooms.has(c)) return c;
  }
}

function newRoom() {
  const room = {
    code: makeCode(),
    host: null,
    screens: new Set(),
    players: [],
    mode: 'lobby', // lobby | game | results
    game: null,
    results: null,
    lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

const send = (ws, obj) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
};

const pub = (p) => ({ id: p.id, name: p.name, color: p.color, points: p.points, connected: !!p.ws });

function vipOf(room) {
  const p = room.players.find((x) => x.ws);
  return p ? p.id : null;
}

function viewFor(room, p) {
  const players = room.players.map(pub);
  const you = p ? p.id : null;
  const vip = !!p && p.id === vipOf(room);
  if (room.mode === 'lobby') {
    return {
      screen: 'lobby', players, you, vip,
      games: GAMES.map((g) => ({ id: g.id, name: g.name, tag: g.tag, min: g.min })),
    };
  }
  if (room.mode === 'game' && room.game) {
    return Object.assign({ screen: 'game', players, you, vip }, room.game.view(you));
  }
  return Object.assign({ screen: 'results', players, you, vip }, room.results);
}

function pushAll(room) {
  const hv = { t: 'view', view: viewFor(room, null) };
  send(room.host, hv);
  for (const w of room.screens) send(w, hv);
  for (const p of room.players) if (p.ws) send(p.ws, { t: 'view', view: viewFor(room, p) });
}

function startGame(room, id) {
  const def = byId[id];
  const ps = room.players.filter((p) => p.ws);
  if (!def || room.mode !== 'lobby' || ps.length < def.min) return;
  const ctx = {
    players: ps.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    push: () => { if (room.game === g) pushAll(room); },
    finish: (r) => { if (room.game === g) finishGame(room, def, r); },
  };
  const g = def.create(ctx);
  room.game = g;
  room.mode = 'game';
  g.start();
}

function finishGame(room, def, r) {
  const g = room.game;
  if (g) g.stop();
  room.game = null;
  const ids = Object.keys(r.scores);
  const best = Math.max(...ids.map((id) => r.scores[id]));
  const rows = ids.map((id) => {
    const p = room.players.find((x) => x.id === id);
    const rank = ids.filter((o) => r.scores[o] > r.scores[id]).length;
    const gained = best > 0 ? POINTS[rank] || 0 : 0;
    if (p) p.points += gained;
    return {
      id, name: p ? p.name : '?', color: p ? p.color : '#888',
      label: (r.labels && r.labels[id]) || String(r.scores[id]),
      rank, gained, total: p ? p.points : 0,
    };
  });
  rows.sort((a, b) => a.rank - b.rank);
  room.results = { title: def.name, rows };
  room.mode = 'results';
  pushAll(room);
}

function toLobby(room) {
  if (room.game) room.game.stop();
  room.game = null;
  room.mode = 'lobby';
  pushAll(room);
}

// ---------- Messages ----------
const cleanName = (s) =>
  String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);

async function hostJoin(ws, m, req) {
  let room = m.code && rooms.get(String(m.code).toUpperCase());
  if (!room) room = newRoom();
  if (room.host && room.host !== ws) {
    try { room.host.close(); } catch { /* ignore */ }
  }
  room.host = ws;
  ws.ctx = { role: 'host', room };
  const url = `${baseUrl(req)}/play?room=${room.code}`;
  const qr = await QRCode.toString(url, {
    type: 'svg', margin: 0, errorCorrectionLevel: 'M',
    color: { dark: '#0b0d17', light: '#ffffff' },
  });
  send(ws, { t: 'room', code: room.code, url, qr });
  pushAll(room);
}

async function watchJoin(ws, m, req) {
  const room = rooms.get(String(m.code || '').toUpperCase());
  if (!room) return send(ws, { t: 'err', msg: 'Room not found' });
  room.screens.add(ws);
  ws.ctx = { role: 'screen', room };
  send(ws, { t: 'room', code: room.code, url: `${baseUrl(req)}/play?room=${room.code}`, qr: '' });
  pushAll(room);
}

function playerJoin(ws, m) {
  const room = rooms.get(String(m.code || '').toUpperCase());
  if (!room) return send(ws, { t: 'err', msg: 'Room not found. Check the code.' });
  let p = m.token && room.players.find((x) => x.token === m.token);
  if (p) {
    if (p.ws && p.ws !== ws) {
      try { p.ws.close(); } catch { /* ignore */ }
    }
    p.ws = ws;
  } else {
    if (room.mode === 'game') {
      return send(ws, { t: 'err', msg: 'A game is in progress. Join between games.' });
    }
    if (room.players.length >= MAX_PLAYERS) {
      const idx = room.players.findIndex((x) => !x.ws);
      if (idx >= 0) room.players.splice(idx, 1); // free a ghost slot
    }
    if (room.players.length >= MAX_PLAYERS) {
      return send(ws, { t: 'err', msg: 'Room is full (4 players).' });
    }
    const color = COLORS.find((c) => !room.players.some((x) => x.color === c));
    p = {
      id: crypto.randomBytes(3).toString('hex'),
      token: crypto.randomBytes(12).toString('hex'),
      name: cleanName(m.name) || `Player ${room.players.length + 1}`,
      color, points: 0, ws,
    };
    room.players.push(p);
  }
  ws.ctx = { role: 'player', room, pid: p.id };
  send(ws, { t: 'joined', id: p.id, token: p.token, code: room.code, color: p.color, name: p.name });
  pushAll(room);
}

function onMessage(ws, m, req) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'host') return hostJoin(ws, m, req);
  if (m.t === 'join') return playerJoin(ws, m);
  if (m.t === 'watch') return watchJoin(ws, m, req);
  const c = ws.ctx;
  if (!c) return;
  const room = c.room;
  room.lastActive = Date.now();
  const fromHost = c.role === 'host';
  const isVip = c.role === 'player' && c.pid === vipOf(room);

  if ((fromHost || isVip) && m.t === 'start') return startGame(room, m.game);
  if ((fromHost || isVip) && m.t === 'lobby') return toLobby(room);
  if (c.role === 'player' && m.t === 'in' && room.mode === 'game' && room.game) {
    room.game.input(c.pid, m);
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server });
wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    Promise.resolve(onMessage(ws, m, req)).catch((e) => console.error(e));
  });
  ws.on('close', () => {
    const c = ws.ctx;
    if (!c) return;
    if (c.role === 'host' && c.room.host === ws) c.room.host = null;
    if (c.role === 'screen') c.room.screens.delete(ws);
    if (c.role === 'player') {
      const p = c.room.players.find((x) => x.id === c.pid);
      if (p && p.ws === ws) {
        p.ws = null;
        pushAll(c.room);
      }
    }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  for (const [code, room] of rooms) {
    const empty = !room.host && !room.players.some((p) => p.ws);
    if (empty && Date.now() - room.lastActive > 30 * 60 * 1000) rooms.delete(code);
  }
}, 25000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Couch Arcade is running\n');
  console.log(`  Open on your monitor:  http://localhost:${PORT}`);
  console.log(`  Phones join via QR (same Wi-Fi), or visit http://${lanIP()}:${PORT}/play\n`);
});
