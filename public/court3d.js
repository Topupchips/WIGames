// 3D pixel-art court. Renders a real three.js scene at low resolution and lets the
// browser scale it up with nearest-neighbour filtering, which gives the chunky pixel look.
// Exposes window.Court3D.create(canvas) -> Promise<{frame, burst, netHit, shake, dispose}>.
(function () {
  'use strict';
  const U = 50;                       // game units per scene unit
  const wx = (x) => (x - 500) / U;    // court length: -10 .. 10
  const wy = (y) => y / U;
  const REACH = 165 / U, HIT_Y = 130 / U;
  const PAL = {
    night: 0x1a1c2c, purple: 0x5d275d, red: 0xb13e53, orange: 0xef7d57, yellow: 0xffcd75, lime: 0xa7f070,
    green: 0x38b764, teal: 0x257179, navy: 0x29366f, blue: 0x3b5dc9, sky: 0x41a6f6, cyan: 0x73eff7,
    white: 0xf4f4f4, grey: 0x94b0c2, slate: 0x566c86, dark: 0x333c57,
  };

  async function create(canvas) {
    const THREE = await import('/vendor/three.module.js');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setClearColor(PAL.night);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(PAL.night, 15, 38);
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 120);

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const sun = new THREE.DirectionalLight(0xfff2d0, 1.15);
    sun.position.set(-6, 16, 12);
    scene.add(sun);

    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const basic = (c, o) => new THREE.MeshBasicMaterial(Object.assign({ color: c }, o || {}));
    const box = (w, h, d, c, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || mat(c));
    const pixelTex = (cv) => {
      const t = new THREE.CanvasTexture(cv);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const css = (c) => '#' + c.toString(16).padStart(6, '0');

    // ---------------------------------------------------------------- floor
    const FW = 24, FD = 16, PPU = 20;
    const fc = document.createElement('canvas'); fc.width = FW * PPU; fc.height = FD * PPU;
    const fg = fc.getContext('2d');
    for (let i = 0; i < FW * 2; i++) { fg.fillStyle = i % 2 ? css(PAL.teal) : '#2b7c82'; fg.fillRect(i * PPU / 2, 0, PPU / 2, fc.height); }
    const cx = (x) => (x + FW / 2) * PPU, cz = (z) => (z + FD / 2) * PPU;
    fg.fillStyle = 'rgba(115,239,247,.10)'; fg.fillRect(cx(-9.2), cz(-3.4), 18.4 * PPU, 6.8 * PPU);
    fg.strokeStyle = css(PAL.white); fg.lineWidth = 3; fg.lineCap = 'square';
    const line = (x1, z1, x2, z2) => { fg.beginPath(); fg.moveTo(cx(x1), cz(z1)); fg.lineTo(cx(x2), cz(z2)); fg.stroke(); };
    line(-9.2, -3.4, 9.2, -3.4); line(-9.2, 3.4, 9.2, 3.4); line(-9.2, -3.4, -9.2, 3.4); line(9.2, -3.4, 9.2, 3.4);
    line(-9.2, -2.6, 9.2, -2.6); line(-9.2, 2.6, 9.2, 2.6);
    line(-3.4, -3.4, -3.4, 3.4); line(3.4, -3.4, 3.4, 3.4); line(-8.2, 0, -3.4, 0); line(3.4, 0, 8.2, 0);
    fg.fillStyle = 'rgba(0,0,0,.35)'; fg.fillRect(0, 0, fc.width, 6); // dark rim
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), new THREE.MeshLambertMaterial({ map: pixelTex(fc) }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(200, 120), mat(PAL.night));
    pit.rotation.x = -Math.PI / 2; pit.position.y = -0.05; scene.add(pit);

    // ---------------------------------------------------------------- back wall with pixel crowd
    const wc = document.createElement('canvas'); wc.width = 320; wc.height = 100;
    const wg = wc.getContext('2d');
    let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    function paintWall() {
      const gr = wg.createLinearGradient(0, 0, 0, 100); gr.addColorStop(0, css(PAL.navy)); gr.addColorStop(1, css(PAL.night));
      wg.fillStyle = gr; wg.fillRect(0, 0, 320, 100);
      seed = 7;
      const cols = [PAL.yellow, PAL.orange, PAL.white, PAL.sky, PAL.lime, PAL.red];
      for (let r = 0; r < 5; r++) {
        for (let x = 2 + (r % 2) * 4; x < 320; x += 8) {
          const c = cols[Math.floor(rand() * cols.length)], y = 46 + r * 11;
          wg.fillStyle = css(PAL.slate); wg.fillRect(x - 1, y + 5, 7, 8);
          wg.fillStyle = css(c); wg.fillRect(x, y, 5, 5); wg.fillStyle = 'rgba(13,14,26,' + (0.55 - r * 0.06) + ')'; wg.fillRect(x - 1, y - 1, 8, 15);
          wg.fillStyle = css([PAL.purple, PAL.dark, PAL.blue][Math.floor(rand() * 3)]); wg.fillRect(x, y + 5, 5, 6);
        }
      }
      wg.fillStyle = css(PAL.night); wg.fillRect(0, 44, 320, 3);
      wg.font = '10px "Press Start 2P", monospace'; wg.textAlign = 'center';
      wg.fillStyle = css(PAL.purple); wg.fillText('BADMINTON NIGHT', 162, 26);
      wg.fillStyle = css(PAL.cyan); wg.fillText('BADMINTON NIGHT', 160, 24);
      for (let i = 0; i < 16; i++) { wg.fillStyle = i % 2 ? css(PAL.yellow) : css(PAL.red); wg.fillRect(i * 20 + 2, 34, 14, 3); }
    }
    paintWall();
    const wallTex = pixelTex(wc);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(64, 20), new THREE.MeshBasicMaterial({ map: wallTex }));
    wall.position.set(0, 9.5, -9); scene.add(wall);
    if (document.fonts && document.fonts.load) {
      document.fonts.load('10px "Press Start 2P"').then(() => { paintWall(); wallTex.needsUpdate = true; }).catch(() => {});
    }
    // hanging lamps
    for (let i = -4; i <= 4; i++) {
      const lamp = box(1.2, 0.25, 0.6, 0, basic(PAL.yellow)); lamp.position.set(i * 5, 13, -4); scene.add(lamp);
    }

    // ---------------------------------------------------------------- net
    const net = new THREE.Group(); scene.add(net);
    for (const z of [-3.6, 3.6]) { const p = box(0.18, 3.7, 0.18, PAL.grey); p.position.set(0, 1.85, z); net.add(p); }
    const nc = document.createElement('canvas'); nc.width = 66; nc.height = 32;
    const ng = nc.getContext('2d'); ng.strokeStyle = 'rgba(244,244,244,.55)'; ng.lineWidth = 1;
    for (let x = 0; x <= 66; x += 3) { ng.beginPath(); ng.moveTo(x + .5, 0); ng.lineTo(x + .5, 32); ng.stroke(); }
    for (let y = 0; y <= 32; y += 3) { ng.beginPath(); ng.moveTo(0, y + .5); ng.lineTo(66, y + .5); ng.stroke(); }
    const netMesh = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.2),
      new THREE.MeshBasicMaterial({ map: pixelTex(nc), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    netMesh.position.set(0, 1.6, 0); netMesh.rotation.y = Math.PI / 2; net.add(netMesh);
    const tape = box(0.1, 0.14, 7.2, PAL.white); tape.position.set(0, 3.2, 0); net.add(tape);
    let netWobble = 0;

    // ---------------------------------------------------------------- shuttle
    const shuttle = new THREE.Group(); scene.add(shuttle);
    const cork = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), mat(PAL.white));
    cork.position.x = 0.35; shuttle.add(cork);
    const skirtGeo = new THREE.CylinderGeometry(0.12, 0.42, 0.8, 8, 1, true); skirtGeo.rotateZ(-Math.PI / 2);
    const skirt = new THREE.Mesh(skirtGeo, new THREE.MeshLambertMaterial({ color: PAL.white, side: THREE.DoubleSide }));
    skirt.position.x = -0.1; shuttle.add(skirt);
    shuttle.scale.setScalar(1.5);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 8), basic(0x000000, { transparent: true, opacity: 0.4, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.03; scene.add(shadow);
    const trail = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), basic(PAL.white, { transparent: true, opacity: 0 }));
      scene.add(m); trail.push(m);
    }
    const hist = [];

    // ---------------------------------------------------------------- particles (square pixels)
    const NP = 120, ppos = new Float32Array(NP * 3), pcol = new Float32Array(NP * 3);
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
    pgeo.setAttribute('color', new THREE.BufferAttribute(pcol, 3));
    const points = new THREE.Points(pgeo, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true }));
    points.frustumCulled = false; scene.add(points);
    const parts = [];

    // ---------------------------------------------------------------- players
    const players = new Map();
    function nameSprite(name, color) {
      const c = document.createElement('canvas'); c.width = 128; c.height = 28;
      const g = c.getContext('2d'); g.font = '12px "Press Start 2P", monospace'; g.textAlign = 'center';
      g.fillStyle = '#0d0e1a'; g.fillText(name.slice(0, 10), 66, 20);
      g.fillStyle = color; g.fillText(name.slice(0, 10), 64, 18);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pixelTex(c), transparent: true, depthTest: false }));
      s.scale.set(5, 1.1, 1); return s;
    }
    function makePlayer(a) {
      const col = new THREE.Color(a.color).getHex();
      const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
      for (const z of [-0.18, 0.18]) {
        const leg = box(0.3, 0.9, 0.3, PAL.dark); leg.position.set(0, 0.45, z); body.add(leg);
        const shoe = box(0.5, 0.16, 0.34, PAL.white); shoe.position.set(0.08, 0.08, z); body.add(shoe);
      }
      const torso = box(0.8, 1.05, 0.62, col); torso.position.y = 1.4; body.add(torso);
      const belt = box(0.84, 0.14, 0.66, PAL.night); belt.position.y = 0.95; body.add(belt);
      const head = box(0.62, 0.62, 0.62, PAL.yellow); head.position.y = 2.25; body.add(head);
      const hair = box(0.68, 0.24, 0.68, a.bot ? PAL.slate : PAL.night); hair.position.y = 2.6; body.add(hair);
      const band = box(0.7, 0.1, 0.7, PAL.white); band.position.y = 2.46; body.add(band);
      const eye = box(0.08, 0.1, 0.08, PAL.night); eye.position.set(0.32, 2.28, 0.14); body.add(eye);
      const eye2 = eye.clone(); eye2.position.z = -0.14; body.add(eye2);
      const arm = new THREE.Group(); arm.position.set(0.05, 1.8, 0.4); body.add(arm);
      const upper = box(0.7, 0.2, 0.22, col); upper.position.x = 0.35; arm.add(upper);
      const handle = box(0.9, 0.08, 0.08, PAL.dark); handle.position.x = 0.95; arm.add(handle);
      const fr = new THREE.Group(); fr.position.x = 1.75; arm.add(fr);
      for (const [w, h, x, y] of [[0.08, 1.0, -0.4, 0], [0.08, 1.0, 0.4, 0], [0.88, 0.08, 0, 0.5], [0.88, 0.08, 0, -0.5]]) {
        const f = box(w, h, 0.08, PAL.white); f.position.set(x, y, 0); fr.add(f);
      }
      fr.scale.set(1, 0.8, 1);
      const strings = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.9), basic(PAL.cyan, { transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
      fr.add(strings);
      const tag = nameSprite(a.name, a.color); tag.position.y = 3.5; root.add(tag);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), basic(col)); arrow.rotation.x = Math.PI; arrow.position.y = 4.1; root.add(arrow);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 12), basic(col, { transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; root.add(ring);
      scene.add(root);
      return { root, body, arm, arrow, ring, tag, x: wx(a.x), id: a.id };
    }

    // ---------------------------------------------------------------- API
    let shakeAmt = 0, lastW = 0, lastH = 0, time = 0;

    function resize() {
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch || (cw === lastW && ch === lastH)) return;
      lastW = cw; lastH = ch;
      const ps = Math.max(2, Math.round(ch / 270));       // one big pixel is ~ps screen pixels
      renderer.setSize(Math.floor(cw / ps), Math.floor(ch / ps), false);
      camera.aspect = cw / ch;
      camera.fov = (2 * Math.atan(0.64 / camera.aspect) * 180) / Math.PI;
      camera.updateProjectionMatrix();
    }

    function frame(v, dt, age) {
      time += dt; resize();
      const rally = v.phase === 'rally';
      // players
      const seen = new Set(), idx = { 0: 0, 1: 0 };
      for (const a of v.actors) {
        seen.add(a.id);
        let p = players.get(a.id);
        if (!p) { p = makePlayer(a); players.set(a.id, p); }
        const mates = v.actors.filter((o) => o.team === a.team).length;
        const lane = mates > 1 ? (idx[a.team]++ === 0 ? 1 : -1) * 1.1 : 0.5;
        p.x += (wx(a.x) - p.x) * Math.min(1, dt * 20);
        const dir = a.team === 0 ? 1 : -1;
        p.root.position.set(p.x, 0, lane);
        p.root.scale.x = dir;
        p.root.rotation.y = -0.25 * dir;
        const bob = Math.abs(a.x - (p.lastX === undefined ? a.x : p.lastX)) > 1 ? Math.abs(Math.sin(time * 14)) * 0.12 : 0;
        p.lastX = a.x; p.body.position.y = bob;
        const prog = 1 - a.sw;
        const th = a.sw > 0 ? 150 + (-30 - 150) * prog : 40;
        p.arm.rotation.z = (th * Math.PI) / 180;
        const myTurn = rally && v.last !== a.team && !a.bot;
        p.arrow.visible = myTurn; p.arrow.position.y = 4.1 + Math.sin(time * 8) * 0.12;
        p.ring.visible = myTurn;
        p.tag.scale.x = 5 * dir; // the root is mirrored for the right team; undo it for the name tag
      }
      for (const [id, p] of players) if (!seen.has(id)) { scene.remove(p.root); players.delete(id); }

      // shuttle
      const sh = v.sh, live = rally;
      const sx = wx(sh.x + (live ? sh.vx * age : 0)), sy = wy(Math.max(0, sh.y + (live ? sh.vy * age : 0)));
      shuttle.position.set(sx, sy, 0.05);
      const sp = Math.hypot(sh.vx, sh.vy);
      shuttle.rotation.z = sp < 5 ? -Math.PI / 2 : Math.atan2(sh.vy, sh.vx);
      shadow.position.set(sx, 0.03, 0.05);
      shadow.scale.setScalar(Math.max(0.5, 1.4 - sy / 14));
      shadow.material.opacity = Math.max(0.12, 0.45 - sy / 20);
      if (live) { hist.push([sx, sy]); if (hist.length > trail.length) hist.shift(); } else hist.length = 0;
      trail.forEach((m, i) => {
        const h = hist[hist.length - 1 - i];
        if (!h || i === 0) { m.material.opacity = 0; return; }
        m.position.set(h[0], h[1], 0.05);
        m.material.opacity = (1 - i / trail.length) * 0.6;
        m.material.color.setHex(sp > 900 ? PAL.orange : PAL.white);
        m.scale.setScalar(1 - i / trail.length * 0.6);
      });

      // net wobble
      netWobble *= Math.pow(0.02, dt);
      netMesh.rotation.z = Math.sin(time * 40) * netWobble * 0.08;
      netMesh.scale.x = 1 + Math.sin(time * 30) * netWobble * 0.04;

      // particles
      let n = 0;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.life -= dt * 2.2;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        p.vy -= 22 * dt; p.x += p.vx * dt; p.y = Math.max(0, p.y + p.vy * dt); p.z += p.vz * dt;
        ppos[n * 3] = p.x; ppos[n * 3 + 1] = p.y; ppos[n * 3 + 2] = p.z;
        pcol[n * 3] = p.c.r * p.life; pcol[n * 3 + 1] = p.c.g * p.life; pcol[n * 3 + 2] = p.c.b * p.life;
        if (++n >= NP) break;
      }
      pgeo.setDrawRange(0, n);
      pgeo.attributes.position.needsUpdate = true; pgeo.attributes.color.needsUpdate = true;

      // camera: a corner view that drifts slowly with the action
      shakeAmt *= Math.pow(0.001, dt);
      const fx = Math.max(-2, Math.min(2, sx * 0.12));
      camera.position.set(-3.5 + fx + (Math.random() - 0.5) * shakeAmt, 7.2 + (Math.random() - 0.5) * shakeAmt, 15.5);
      camera.lookAt(fx * 0.6, 1.9, 0);
      renderer.render(scene, camera);
    }

    function burst(e) {
      const n = e.k === 'smash' ? 26 : e.k === 'point' ? 34 : 14;
      const hex = e.k === 'smash' ? PAL.orange : e.k === 'point' ? PAL.lime : e.k === 'net' ? PAL.grey : PAL.white;
      const c = new THREE.Color(hex);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 6;
        parts.push({ x: wx(e.x), y: wy(e.y), z: 0.1, vx: Math.cos(a) * sp, vy: Math.abs(Math.sin(a)) * sp * (e.k === 'point' ? 1.6 : 0.9) + 1, vz: (Math.random() - 0.5) * 4, life: 1, c });
      }
      if (e.k === 'smash') shakeAmt = 0.35;
    }

    return {
      frame, burst,
      netHit() { netWobble = 1; },
      dispose() { try { renderer.dispose(); renderer.forceContextLoss(); } catch { /* ignore */ } },
    };
  }

  window.Court3D = { create };
})();
