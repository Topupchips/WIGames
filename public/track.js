// Race track geometry, shared by the server (physics) and the browser (3D view).
// The track is a closed Catmull-Rom loop through control points on the x/z plane,
// sampled about once per world unit. Heading 0 faces +z, and forward = (sin h, cos h).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Track = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CTRL = [
    [0, -78], [62, -80], [114, -58], [128, -8], [104, 24], [64, 24], [50, 46], [52, 90],
    [0, 120], [-66, 116], [-114, 80], [-122, 38], [-114, 4], [-116, -34], [-66, -72],
  ];
  const HALF = 8;       // asphalt half width
  const WALL = 11.5;    // barrier distance from the centre line

  function build() {
    const n = CTRL.length;
    const pts = [];
    const STEPS = 60;
    for (let i = 0; i < n; i++) {
      const p0 = CTRL[(i + n - 1) % n], p1 = CTRL[i], p2 = CTRL[(i + 1) % n], p3 = CTRL[(i + 2) % n];
      for (let s = 0; s < STEPS; s++) {
        const t = s / STEPS, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    // resample at an even spacing of about 1 unit
    let len = 0;
    const cum = [0];
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1], b = pts[i % pts.length];
      len += Math.hypot(b[0] - a[0], b[1] - a[1]);
      cum.push(len);
    }
    const N = Math.round(len);
    const P = [];
    let k = 0;
    for (let i = 0; i < N; i++) {
      const d = (i / N) * len;
      while (cum[k + 1] < d) k++;
      const a = pts[k % pts.length], b = pts[(k + 1) % pts.length];
      const u = (d - cum[k]) / Math.max(1e-6, cum[k + 1] - cum[k]);
      P.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
    const L = len;
    const step = L / N;
    const tan = P.map((p, i) => {
      const a = P[(i + N - 2) % N], b = P[(i + 2) % N];
      const dx = b[0] - a[0], dz = b[1] - a[1], m = Math.hypot(dx, dz) || 1;
      return [dx / m, dz / m];
    });
    const head = tan.map((t) => Math.atan2(t[0], t[1]));
    // signed curvature (1/radius), positive when the heading increases (a left turn for the driver)
    const curv = head.map((h, i) => {
      let d = head[(i + 3) % N] - head[(i + N - 3) % N];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return d / (6 * step);
    });
    return { P, tan, head, curv, N, L, step };
  }

  const T = build();
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  // Nearest centre-line sample. With a hint index it only searches nearby (cheap and stable).
  function project(x, z, hint) {
    const { P, tan, N, step } = T;
    let lo = 0, hi = N - 1, wrapIt = false;
    if (hint !== undefined && hint !== null) { lo = -30; hi = 30; wrapIt = true; }
    let best = -1, bd = Infinity;
    for (let j = lo; j <= hi; j++) {
      const i = wrapIt ? ((hint + j) % N + N) % N : j;
      const dx = x - P[i][0], dz = z - P[i][1], d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    const t = tan[best];
    const dx = x - P[best][0], dz = z - P[best][1];
    const along = dx * t[0] + dz * t[1];
    const lat = dx * t[1] - dz * t[0]; // positive on the driver's left-hand side
    return { i: best, s: best * step + along, lat, dist: Math.sqrt(bd), head: T.head[best] };
  }

  // Point on the centre line at arc length s (wraps), with its heading.
  function at(s) {
    const { P, N, L, step } = T;
    const f = (((s % L) + L) % L) / step;
    const i = Math.floor(f) % N, j = (i + 1) % N, u = f - Math.floor(f);
    return { x: P[i][0] + (P[j][0] - P[i][0]) * u, z: P[i][1] + (P[j][1] - P[i][1]) * u, head: T.head[i], i };
  }
  // Signed curvature at arc length s.
  function curvAt(s) {
    const f = Math.floor((((s % T.L) + T.L) % T.L) / T.step) % T.N;
    return T.curv[f];
  }
  // World position for an arc length s and sideways offset (positive = left of travel).
  function place(s, lat) {
    const p = at(s);
    const rx = Math.cos(p.head), rz = -Math.sin(p.head); // left-hand normal of (sin h, cos h)
    return { x: p.x + rx * lat, z: p.z + rz * lat, head: p.head };
  }

  return Object.assign({ HALF, WALL, CTRL, project, at, curvAt, place, wrap }, T);
}));
