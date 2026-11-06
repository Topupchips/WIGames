// 3D pixel-art race track. Renders a three.js scene at low resolution and lets the browser
// scale it up with nearest-neighbour filtering for the chunky pixel look.
// Exposes window.Race3D.create(canvas) -> Promise<{frame, event, dispose}>. Needs window.Track.
(function () {
  'use strict';
  const PAL = {
    night: 0x1a1c2c, purple: 0x5d275d, red: 0xb13e53, orange: 0xef7d57, yellow: 0xffcd75, lime: 0xa7f070,
    green: 0x38b764, teal: 0x257179, navy: 0x29366f, blue: 0x3b5dc9, sky: 0x41a6f6, cyan: 0x73eff7,
    white: 0xf4f4f4, grey: 0x94b0c2, slate: 0x566c86, dark: 0x333c57, sand: 0xd9b46c, brown: 0x7a4a2a,
  };
  const SKY = 0x8fd8ff;

  async function create(canvas) {
    const THREE = await import('/vendor/three.module.js');
    const Track = window.Track;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setClearColor(SKY);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(SKY, 90, 420);
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 900);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2d0, 1.05);
    sun.position.set(-60, 110, 40);
    scene.add(sun);

    const css = (c) => '#' + c.toString(16).padStart(6, '0');
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const basic = (c, o) => new THREE.MeshBasicMaterial(Object.assign({ color: c }, o || {}));
    const box = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    const pixelTex = (cv, repeat) => {
      const t = new THREE.CanvasTexture(cv);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      return t;
    };
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const canv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };

    // ---------------------------------------------------------------- ground
    {
      const [c, g] = canv(4, 4);
      const greens = ['#3fbf6a', '#38b764', '#2fa457', '#46c971'];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = greens[Math.floor(rand() * 4)]; g.fillRect(x, y, 1, 1); }
      const t = pixelTex(c, true); t.repeat.set(1000 / 20, 1000 / 20);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshLambertMaterial({ map: t }));
      ground.rotation.x = -Math.PI / 2; scene.add(ground);
    }

    // ---------------------------------------------------------------- track ribbons
    function strip(l0, l1, y, tex, per) {
      const N = Track.N, pos = new Float32Array((N + 1) * 6), uv = new Float32Array((N + 1) * 4), idx = [];
      const v = Track.L / Math.round(Track.L / per);
      for (let i = 0; i <= N; i++) {
        const s = i * Track.step, a = Track.place(s, l0), b = Track.place(s, l1);
        pos.set([a.x, y, a.z, b.x, y, b.z], i * 6);
        uv.set([0, s / v, 1, s / v], i * 4);
      }
      for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
      scene.add(m); return m;
    }
    {
      // sand run-off
      const [c, g] = canv(8, 8);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = rand() < 0.5 ? '#d9b46c' : '#c9a35a'; g.fillRect(x, y, 1, 1); }
      const sandT = pixelTex(c, true);
      strip(Track.WALL + 0.6, Track.HALF, 0.01, sandT, 12);
      strip(-Track.HALF, -(Track.WALL + 0.6), 0.01, sandT, 12);
      // kerbs
      const [kc, kg] = canv(2, 8);
      for (let y = 0; y < 8; y++) { kg.fillStyle = y < 4 ? '#b13e53' : '#f4f4f4'; kg.fillRect(0, y, 2, 1); }
      const kT = pixelTex(kc, true);
      strip(Track.HALF + 1.5, Track.HALF, 0.03, kT, 6);
      strip(-Track.HALF, -(Track.HALF + 1.5), 0.03, kT, 6);
      // asphalt: speckle, edge lines and a dashed centre line
      const [ac, ag] = canv(32, 32);
      ag.fillStyle = '#3a4160'; ag.fillRect(0, 0, 32, 32);
      for (let i = 0; i < 90; i++) { ag.fillStyle = rand() < 0.5 ? '#333c57' : '#454d6e'; ag.fillRect(Math.floor(rand() * 32), Math.floor(rand() * 32), 1, 1); }
      ag.fillStyle = '#f4f4f4'; ag.fillRect(1, 0, 1, 32); ag.fillRect(30, 0, 1, 32);
      ag.fillStyle = '#ffcd75'; for (let y = 0; y < 32; y += 16) ag.fillRect(15, y, 2, 8);
      const roadT = pixelTex(ac, true);
      strip(Track.HALF, -Track.HALF, 0.02, roadT, 20);
    }

    // start / finish line, gantry and grandstand
    const start = Track.place(0, 0);
    const startG = new THREE.Group(); startG.position.set(start.x, 0, start.z); startG.rotation.y = start.head; scene.add(startG);
    {
      const [c, g] = canv(16, 2);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) % 2 ? '#1a1c2c' : '#f4f4f4'; g.fillRect(x, y, 1, 1); }
      const line = new THREE.Mesh(new THREE.PlaneGeometry(Track.HALF * 2, 2.2), new THREE.MeshBasicMaterial({ map: pixelTex(c) }));
      line.rotation.x = -Math.PI / 2; line.position.y = 0.05; startG.add(line);
      const px = Track.WALL + 2;
      for (const sx of [-1, 1]) { const post = box(1, 9, 1, PAL.slate); post.position.set(sx * px, 4.5, 0); startG.add(post); }
      const beam = box(px * 2 + 1, 2.4, 1, PAL.dark); beam.position.set(0, 9, 0); startG.add(beam);
      const [bc, bg] = canv(256, 40);
      const paint = () => {
        bg.fillStyle = css(PAL.dark); bg.fillRect(0, 0, 256, 40);
        for (let i = 0; i < 32; i++) { bg.fillStyle = i % 2 ? '#f4f4f4' : '#1a1c2c'; bg.fillRect(i * 8, 0, 8, 5); bg.fillRect((31 - i) * 8, 35, 8, 5); }
        bg.font = '16px "Press Start 2P", monospace'; bg.textAlign = 'center';
        bg.fillStyle = css(PAL.red); bg.fillText('START / FINISH', 130, 26);
        bg.fillStyle = css(PAL.yellow); bg.fillText('START / FINISH', 128, 24);
      };
      paint();
      const bt = pixelTex(bc);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(px * 2 - 1, 2.2), new THREE.MeshBasicMaterial({ map: bt, side: THREE.DoubleSide }));
      banner.position.set(0, 9, -0.52); banner.rotation.y = Math.PI; startG.add(banner);
      if (document.fonts && document.fonts.load) document.fonts.load('16px "Press Start 2P"').then(() => { paint(); bt.needsUpdate = true; }).catch(() => {});
      // grandstand on the right-hand side
      const [cc, cg] = canv(40, 6);
      const cols = ['#ffcd75', '#ef7d57', '#f4f4f4', '#41a6f6', '#a7f070', '#b13e53'];
      cg.fillStyle = '#29366f'; cg.fillRect(0, 0, 40, 6);
      for (let x = 0; x < 40; x += 2) for (let y = 0; y < 6; y += 3) { cg.fillStyle = cols[Math.floor(rand() * cols.length)]; cg.fillRect(x, y, 1, 2); }
      const ct = pixelTex(cc, true); ct.repeat.set(4, 1);
      for (let i = 0; i < 3; i++) {
        const tier = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.5, 54), new THREE.MeshLambertMaterial({ map: ct }));
        tier.position.set(-(Track.WALL + 6 + i * 3.4), 0.75 + i * 1.5, 4); startG.add(tier);
      }
      const roof = box(14, 0.5, 56, PAL.red); roof.position.set(-(Track.WALL + 11), 7, 4); startG.add(roof);
      for (const dz of [-24, 0, 24]) { const p = box(0.6, 6, 0.6, PAL.slate); p.position.set(-(Track.WALL + 16), 3.5, 4 + dz); startG.add(p); }
    }

    // ---------------------------------------------------------------- walls (instanced)
    {
      const seg = 3.3, n = Math.ceil(Track.L / seg);
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.1, seg), new THREE.MeshLambertMaterial(), n * 2);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1);
      let k = 0;
      for (let i = 0; i < n; i++) {
        for (const side of [-1, 1]) {
          const p = Track.place(i * seg, side * (Track.WALL + 0.5));
          e.set(0, p.head, 0); q.setFromEuler(e);
          m4.compose(new THREE.Vector3(p.x, 0.55, p.z), q, sc);
          im.setMatrixAt(k, m4);
          im.setColorAt(k, new THREE.Color(i % 2 ? PAL.white : PAL.red));
          k++;
        }
      }
      im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
      scene.add(im);
    }

    // ---------------------------------------------------------------- scenery: pine trees, mountains, clouds
    {
      const trees = [];
      for (let tries = 0; trees.length < 260 && tries < 4000; tries++) {
        const x = (rand() - 0.5) * 420, z = (rand() - 0.4) * 380;
        let near = 1e9;
        for (let i = 0; i < Track.N; i += 3) near = Math.min(near, Math.hypot(x - Track.P[i][0], z - Track.P[i][1]));
        if (near < 26) continue;
        if (Math.hypot(x - start.x, z - start.z) < 40) continue;
        trees.push([x, z, 0.8 + rand() * 1.0]);
      }
      const layers = [[2.6, 2.2, 2.0, PAL.green], [2.0, 2.0, 3.8, 0x2f9d52], [1.3, 1.8, 5.4, PAL.lime]];
      const trunk = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 2.2, 0.8), mat(PAL.brown), trees.length);
      const m4 = new THREE.Matrix4();
      trees.forEach(([x, z, s], i) => { m4.compose(new THREE.Vector3(x, 1.1 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)); trunk.setMatrixAt(i, m4); });
      scene.add(trunk);
      for (const [w, h, y, col] of layers) {
        const im = new THREE.InstancedMesh(new THREE.BoxGeometry(w, h, w), mat(col), trees.length);
        trees.forEach(([x, z, s], i) => { m4.compose(new THREE.Vector3(x, y * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)); im.setMatrixAt(i, m4); });
        scene.add(im);
      }
      // distant blocky mountains
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + rand() * 0.2, r = 380 + rand() * 40, h = 50 + rand() * 60;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(36 + rand() * 24, h, 4), mat(i % 3 ? PAL.slate : PAL.teal));
        cone.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r); cone.rotation.y = rand() * 3; scene.add(cone);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(11, h * 0.28, 4), mat(PAL.white));
        cap.position.set(cone.position.x, h - h * 0.14 - 2, cone.position.z); cap.rotation.y = cone.rotation.y; scene.add(cap);
      }
    }
    const clouds = [];
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group();
      for (let j = 0; j < 4; j++) { const b = box(10 + rand() * 12, 3, 6 + rand() * 6, PAL.white); b.position.set(j * 9 - 14, rand() * 2, rand() * 6); g.add(b); }
      g.position.set((rand() - 0.5) * 520, 85 + rand() * 25, (rand() - 0.5) * 520);
      g.children.forEach((c) => { c.material.fog = false; });
      scene.add(g); clouds.push(g);
    }

    // ---------------------------------------------------------------- particles
    const NP = 360, ppos = new Float32Array(NP * 3), pcol = new Float32Array(NP * 3);
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
    pgeo.setAttribute('color', new THREE.BufferAttribute(pcol, 3));
    const points = new THREE.Points(pgeo, new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true }));
    points.frustumCulled = false; scene.add(points);
    const parts = [];
    const spawn = (x, y, z, vx, vy, vz, hex, life) => {
      if (parts.length < NP) parts.push({ x, y, z, vx, vy, vz, c: new THREE.Color(hex), life: 1, rate: 1 / (life || 0.6) });
    };

    // ---------------------------------------------------------------- cars
    const cars = new Map();
    function nameSprite(name, color) {
      const label = name.slice(0, 7), cw = 8 * label.length + 8;
      const [c, g] = canv(cw, 12);
      g.font = '8px "Press Start 2P", monospace'; g.textAlign = 'center';
      const paint = () => {
        g.fillStyle = '#0d0e1a'; g.fillRect(0, 0, cw, 12); g.fillStyle = color; g.fillRect(1, 1, cw - 2, 10);
        g.fillStyle = '#0d0e1a'; g.fillText(label, cw / 2, 9);
      };
      paint();
      const tex = pixelTex(c);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
      sp.renderOrder = 5; sp.userData.cw = cw;
      if (document.fonts && document.fonts.load) {
        document.fonts.load('8px "Press Start 2P"').then(() => { paint(); tex.needsUpdate = true; }).catch(() => {});
      }
      return sp;
    }
    function makeCar(c) {
      const col = new THREE.Color(c.color).getHex();
      const root = new THREE.Group();
      const tilt = new THREE.Group(); root.add(tilt);
      const add = (m, x, y, z) => { m.position.set(x, y, z); tilt.add(m); return m; };
      add(box(1.9, 0.55, 3.8, col), 0, 0.72, 0);
      add(box(0.4, 0.58, 3.84, PAL.white), 0, 0.72, 0);
      add(box(1.6, 0.4, 1.3, col), 0, 0.62, 1.55);
      add(box(1.45, 0.6, 1.6, PAL.dark), 0, 1.26, -0.35);
      add(box(1.47, 0.34, 0.1, PAL.cyan), 0, 1.3, 0.48);
      add(box(1.5, 0.12, 0.6, PAL.night), 0, 1.5, -2.0);
      add(box(0.12, 0.5, 0.12, PAL.night), -0.6, 1.2, -1.9);
      add(box(0.12, 0.5, 0.12, PAL.night), 0.6, 1.2, -1.9);
      for (const sx of [-0.62, 0.62]) {
        add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.12), basic(PAL.yellow)), sx, 0.78, 1.94);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.12), basic(PAL.red)), sx, 0.78, -1.94);
      }
      const wheels = [];
      for (const [x, z, front] of [[-1.0, 1.25, true], [1.0, 1.25, true], [-1.0, -1.25, false], [1.0, -1.25, false]]) {
        const grp = new THREE.Group(); grp.position.set(x, 0.42, z);
        const w = box(0.38, 0.84, 0.84, PAL.night); grp.add(w);
        const hub = box(0.4, 0.3, 0.3, PAL.grey); grp.add(hub);
        root.add(grp); wheels.push({ grp, front, w });
      }
      const flame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 2), basic(PAL.orange, { transparent: true, opacity: 0.9 }));
      flame.position.set(0, 0.8, -3.2); flame.visible = false; tilt.add(flame);
      const flame2 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 1.5), basic(PAL.yellow));
      flame2.position.set(0, 0.8, -3.0); flame2.visible = false; tilt.add(flame2);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.4), basic(0x000000, { transparent: true, opacity: 0.32, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.07; root.add(shadow);
      const tag = nameSprite(c.name, c.color); tag.position.y = 3.6; root.add(tag);
      scene.add(root);
      return { root, tilt, tag, wheels, flame, flame2, x: c.x, z: c.z, h: c.h, roll: 0, spin: 0 };
    }

    // ---------------------------------------------------------------- frame
    let time = 0, lastW = 0, lastH = 0, shake = 0, targW = 640;
    const cam = { x: 0, y: 40, z: -60, tx: 0, tz: 0, ang: 0, ready: false };
    const grid = Track.place(-13, 0);

    function resize() {
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch || (cw === lastW && ch === lastH)) return;
      lastW = cw; lastH = ch;
      const ps = Math.max(2, Math.round(ch / 300));
      renderer.setSize(Math.floor(cw / ps), Math.floor(ch / ps), false);
      targW = Math.floor(cw / ps);
      camera.aspect = cw / ch;
      camera.fov = cw / ch < 1.5 ? 70 : 55;
      camera.updateProjectionMatrix();
    }

    const lerpAng = (a, b, k) => a + Track.wrap(b - a) * Math.min(1, k);

    function frame(v, dt, age) {
      time += dt; resize();
      const racing = v.phase === 'race' || v.phase === 'over';
      const seen = new Set();
      for (const c of v.cars) {
        seen.add(c.id);
        let p = cars.get(c.id);
        if (!p) { p = makeCar(c); cars.set(c.id, p); }
        const live = racing || v.phase === 'count';
        const px = c.x + Math.sin(c.h) * c.v * (live ? age : 0), pz = c.z + Math.cos(c.h) * c.v * (live ? age : 0);
        const k = Math.min(1, dt * 22);
        p.x += (px - p.x) * k; p.z += (pz - p.z) * k; p.h = lerpAng(p.h, c.h, dt * 18);
        p.root.position.set(p.x, 0, p.z); p.root.rotation.y = p.h;
        p.roll += (-c.st * Math.min(1, c.v / 30) * 0.12 - p.roll) * Math.min(1, dt * 8);
        p.tilt.rotation.z = p.roll;
        p.tilt.rotation.x = c.bo ? -0.05 : 0;
        p.tilt.position.y = c.off ? Math.sin(time * 40 + c.x) * 0.06 : 0;
        p.spin += c.v * dt * 1.3;
        for (const w of p.wheels) { w.w.rotation.x = p.spin; if (w.front) w.grp.rotation.y = -c.st * 0.5; }
        p.flame.visible = p.flame2.visible = !!c.bo;
        if (c.bo) {
          const f = 0.8 + Math.random() * 0.5; p.flame.scale.set(1, 1, f); p.flame2.scale.set(1, 1, f * 0.9);
          if (Math.random() < 0.8) spawn(p.x - Math.sin(p.h) * 3.4, 0.9, p.z - Math.cos(p.h) * 3.4, (Math.random() - 0.5) * 3 - Math.sin(p.h) * 8, 1 + Math.random() * 2, (Math.random() - 0.5) * 3 - Math.cos(p.h) * 8, Math.random() < 0.5 ? PAL.orange : PAL.yellow, 0.35);
        }
        if (c.off && c.v > 5 && Math.random() < 0.7) {
          spawn(p.x - Math.sin(p.h) * 2 + (Math.random() - 0.5) * 2, 0.3, p.z - Math.cos(p.h) * 2 + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3, PAL.sand, 0.6);
        }
      }
      for (const [id, p] of cars) if (!seen.has(id)) { scene.remove(p.root); cars.delete(id); }

      // particles
      let n = 0;
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i]; q.life -= dt * q.rate;
        if (q.life <= 0) { parts.splice(i, 1); continue; }
        q.vy -= 14 * dt; q.x += q.vx * dt; q.y = Math.max(0.05, q.y + q.vy * dt); q.z += q.vz * dt;
        ppos[n * 3] = q.x; ppos[n * 3 + 1] = q.y; ppos[n * 3 + 2] = q.z;
        pcol[n * 3] = q.c.r * Math.min(1, q.life * 1.6); pcol[n * 3 + 1] = q.c.g * Math.min(1, q.life * 1.6); pcol[n * 3 + 2] = q.c.b * Math.min(1, q.life * 1.6);
        n++;
      }
      pgeo.setDrawRange(0, n);
      pgeo.attributes.position.needsUpdate = true; pgeo.attributes.color.needsUpdate = true;
      for (const cl of clouds) { cl.position.x += dt * 2.2; if (cl.position.x > 300) cl.position.x = -300; }

      // camera
      let fx, fz, ang, dist, height, lookAhead;
      if (v.phase === 'intro') {
        const th = 0.45 + 0.95 * (0.5 + 0.5 * Math.sin(time * 0.7 - 1.2));
        const R = 36, lx = Math.cos(grid.head), lz = -Math.sin(grid.head), fx2 = Math.sin(grid.head), fz2 = Math.cos(grid.head);
        const tx = grid.x + (lx * Math.sin(th) + fx2 * Math.cos(th)) * R, tz = grid.z + (lz * Math.sin(th) + fz2 * Math.cos(th)) * R;
        if (!cam.ready) { cam.x = tx; cam.z = tz; cam.y = 14; cam.ready = true; }
        cam.x += (tx - cam.x) * Math.min(1, dt * 4); cam.z += (tz - cam.z) * Math.min(1, dt * 4);
        cam.y += (13 - cam.y) * Math.min(1, dt * 4);
        camera.position.set(cam.x, cam.y, cam.z); camera.lookAt(grid.x, 1.5, grid.z);
      } else {
        const order = v.cars.slice().sort((a, b) => b.d - a.d);
        const lead = cars.get(order[0].id);
        let wxs = 0, wzs = 0, wsum = 0;
        for (const c of v.cars) {
          const p = cars.get(c.id), dl = Math.hypot(p.x - lead.x, p.z - lead.z);
          const w = (c === order[0] ? 1.6 : 1) * (dl < 45 ? 1 : Math.max(0.03, 1 - (dl - 45) / 50));
          wxs += p.x * w; wzs += p.z * w; wsum += w;
        }
        fx = wxs / wsum; fz = wzs / wsum;
        let spread = 0;
        for (const c of v.cars) {
          const p = cars.get(c.id);
          if (Math.hypot(p.x - lead.x, p.z - lead.z) < 110) spread = Math.max(spread, Math.hypot(p.x - fx, p.z - fz));
        }
        spread = Math.min(55, spread);
        const before = v.phase === 'count';
        ang = before ? grid.head : lead.h;
        dist = before ? 26 : 17 + spread * 0.5; height = before ? 13 : 12.5 + spread * 0.6; lookAhead = before ? 16 : 9;
        if (!cam.ready) { cam.ang = ang; cam.tx = fx; cam.tz = fz; cam.ready = true; }
        const kk = Math.min(1, dt * (before ? 3 : 2.4));
        cam.ang = lerpAng(cam.ang, ang, dt * 1.6);
        cam.tx += (fx - cam.tx) * Math.min(1, dt * 5); cam.tz += (fz - cam.tz) * Math.min(1, dt * 5);
        const tx = cam.tx - Math.sin(cam.ang) * dist, tz = cam.tz - Math.cos(cam.ang) * dist;
        cam.x += (tx - cam.x) * kk; cam.z += (tz - cam.z) * kk; cam.y += (height - cam.y) * kk;
        shake *= Math.pow(0.001, dt);
        camera.position.set(cam.x + (Math.random() - 0.5) * shake, cam.y + (Math.random() - 0.5) * shake, cam.z + (Math.random() - 0.5) * shake);
        camera.lookAt(cam.tx + Math.sin(cam.ang) * lookAhead, 0, cam.tz + Math.cos(cam.ang) * lookAhead);
      }
      // name tags keep a constant on-screen size: one canvas pixel is about one render pixel
      const tanH = Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
      for (const p of cars.values()) {
        const d = camera.position.distanceTo(p.root.position);
        const cw = p.tag.userData.cw, w = (cw / targW) * 2 * d * tanH;
        p.tag.scale.set(w, (w * 12) / cw, 1);
        p.tag.position.y = 2.1 + (w * 12) / cw / 2;
      }
      renderer.render(scene, camera);
    }

    function event(e, v) {
      const car = v && v.cars.find((c) => c.id === e.id);
      const p = car && cars.get(car.id);
      if (!p) return;
      if (e.k === 'wall' || e.k === 'bump') {
        shake = Math.max(shake, e.k === 'wall' ? 0.7 : 0.4);
        for (let i = 0; i < 14; i++) spawn(p.x, 0.9, p.z, (Math.random() - 0.5) * 14, 2 + Math.random() * 6, (Math.random() - 0.5) * 14, Math.random() < 0.5 ? PAL.yellow : PAL.white, 0.5);
      } else if (e.k === 'finish') {
        const cols = [PAL.yellow, PAL.red, PAL.cyan, PAL.lime, PAL.orange];
        for (let i = 0; i < 70; i++) spawn(p.x, 2, p.z, (Math.random() - 0.5) * 22, 8 + Math.random() * 14, (Math.random() - 0.5) * 22, cols[i % cols.length], 1.6);
      }
    }

    return {
      frame, event,
      dispose() { try { renderer.dispose(); renderer.forceContextLoss(); } catch { /* ignore */ } },
    };
  }

  window.Race3D = { create };
})();
