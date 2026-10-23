// Endless Joyland: the 3D park (three.js r128). Low-poly animated rides, construction sites, guests and decorations.
// The UI keeps the park layout in "map pixels" (L); this file turns that into a world at 1 unit = 10 px.
(function () {
  'use strict';
  const T = window.THREE;
  if (!T) return;
  const K = 0.1;

  // ---------- Shared geometry and materials ----------
  const BOX = new T.BoxGeometry(1, 1, 1);
  const CYL = n => new T.CylinderGeometry(1, 1, 1, n);
  const CYL6 = CYL(6), CYL8 = CYL(8), CYL12 = CYL(12), CYL16 = CYL(16);
  const CONE4 = new T.ConeGeometry(1, 1, 4), CONE8 = new T.ConeGeometry(1, 1, 8), CONE12 = new T.ConeGeometry(1, 1, 12);
  const SPH = new T.SphereGeometry(1, 8, 6);
  const SPH_HI = new T.SphereGeometry(1, 12, 8);
  const MAT = new T.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 18 });
  const MAT2 = new T.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 18, side: T.DoubleSide });
  const WATER = new T.MeshPhongMaterial({ color: 0x3fa9e8, shininess: 80, flatShading: true, transparent: true, opacity: 0.9 });
  const _v = new T.Vector3(), _s = new T.Vector3(), _q = new T.Quaternion(), _e = new T.Euler(), _m = new T.Matrix4(), _c = new T.Color();
  const UP = new T.Vector3(0, 1, 0);

  function color(c) { return c instanceof T.Color ? c : new T.Color(c); }
  function hsl(h, s, l) { return new T.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l); }

  // Collects many small shapes and merges them into a single mesh (one draw call).
  class B {
    constructor() { this.p = []; }
    add(g, c, x, y, z, sx, sy, sz, rx, ry, rz) {
      const m = new T.Matrix4().compose(_v.set(x || 0, y || 0, z || 0), _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0)), _s.set(sx || 1, sy || 1, sz || 1));
      this.p.push({ g, m, c: color(c) });
      return this;
    }
    addM(g, c, m) { this.p.push({ g, m: m.clone(), c: color(c) }); return this; }
    // A cylinder from point a to point b.
    beam(a, b, r, c, g) {
      const d = _v.subVectors(b, a), len = d.length();
      const q = new T.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
      const m = new T.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new T.Vector3(r, len, r));
      this.p.push({ g: g || CYL6, m, c: color(c) });
      return this;
    }
    mesh(mat, shadow) {
      let n = 0;
      const geos = this.p.map(p => { const g = p.g.index ? p.g.toNonIndexed() : p.g.clone(); g.applyMatrix4(p.m); n += g.attributes.position.count; return g; });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
      let o = 0;
      geos.forEach((g, k) => {
        const cnt = g.attributes.position.count, c = this.p[k].c;
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        for (let v = 0; v < cnt; v++) { col[(o + v) * 3] = c.r; col[(o + v) * 3 + 1] = c.g; col[(o + v) * 3 + 2] = c.b; }
        o += cnt;
        g.dispose();
      });
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
      geo.setAttribute('color', new T.BufferAttribute(col, 3));
      const mesh = new T.Mesh(geo, mat || MAT);
      if (shadow !== false && (!mat || mat === MAT || mat === MAT2)) { mesh.castShadow = true; mesh.receiveShadow = true; }
      return mesh;
    }
  }

  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    return t;
  }
  const GLOW_TEX = canvasTex(64, 64, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  });
  const SMOKE_TEX = canvasTex(64, 64, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(90,90,100,.9)'); g.addColorStop(1, 'rgba(90,90,100,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  });

  // Glowing light bulbs: one Points object per set, colours cycle to twinkle.
  const BULB_COLS = [0xffc94a, 0xff4d6d, 0x4fb3ff, 0x3fd9a2, 0xffffff].map(c => new T.Color(c));
  function bulbs(points, size, palette) {
    const geo = new T.BufferGeometry();
    const pos = new Float32Array(points.length * 3), col = new Float32Array(points.length * 3);
    points.forEach((p, k) => { pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z; });
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    const mat = new T.PointsMaterial({ size: size || 0.7, map: GLOW_TEX, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    const pts = new T.Points(geo, mat);
    pts.userData.palette = palette || BULB_COLS;
    pts.userData.n = points.length;
    twinkle(pts, 0);
    return pts;
  }
  function twinkle(pts, phase) {
    const col = pts.geometry.attributes.color, pal = pts.userData.palette;
    for (let k = 0; k < pts.userData.n; k++) {
      const c = pal[k % pal.length];
      const on = (k + phase) % 6 !== 0 ? 1 : 0.25;
      col.setXYZ(k, c.r * on, c.g * on, c.b * on);
    }
    col.needsUpdate = true;
  }
  function ring(n, r, y) { const a = []; for (let k = 0; k < n; k++) { const t = k / n * Math.PI * 2; a.push(new T.Vector3(Math.cos(t) * r, y, Math.sin(t) * r)); } return a; }

  function person(b, x, y, z, shirt, s) {
    s = s || 1;
    b.add(CYL6, shirt, x, y + 0.35 * s, z, 0.22 * s, 0.7 * s, 0.22 * s);
    b.add(SPH, 0xf3d3b5, x, y + 0.85 * s, z, 0.17 * s, 0.17 * s, 0.17 * s);
  }

  // ---------- Ride models ----------
  // Each returns { g: Group, h: height for labels, update(t, dt, spd) }. The lot is about 12×12 units centred on 0.
  const MODELS = {};

  MODELS.carousel = hue => {
    const g = new T.Group();
    const c = hsl(hue, 0.7, 0.55), c2 = hsl(hue, 0.6, 0.85);
    const st = new B();
    st.add(CYL16, c, 0, 0.3, 0, 4.8, 0.6, 4.8).add(CYL16, 0xf7e7c6, 0, 0.62, 0, 4.9, 0.05, 4.9);
    st.add(CYL8, 0xffc94a, 0, 2.6, 0, 0.35, 4.2, 0.35);
    g.add(st.mesh());
    const rot = new T.Group(); g.add(rot);
    const rb = new B();
    rb.add(CYL16, c2, 0, 0.72, 0, 4.4, 0.15, 4.4);
    rb.add(CYL16, 0xffffff, 0, 4.3, 0, 4.9, 0.5, 4.9);
    for (let k = 0; k < 12; k++) rb.add(CONE4, k % 2 ? c : 0xffffff, Math.cos(k / 12 * 6.283) * 3.2, 5.3, Math.sin(k / 12 * 6.283) * 3.2, 1.6, 1.6, 0.8, 0, -k / 12 * 6.283 + 1.57, 0);
    rb.add(CONE12, c, 0, 5.5, 0, 5.2, 2.0, 5.2).add(SPH, 0xffc94a, 0, 6.7, 0, 0.35, 0.35, 0.35);
    for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; rb.add(CYL6, 0xffc94a, Math.cos(a) * 3.4, 2.4, Math.sin(a) * 3.4, 0.06, 3.4, 0.06); }
    rot.add(rb.mesh());
    rot.add(bulbs(ring(24, 4.95, 4.3), 0.8));
    const horses = [];
    const hc = [0xffffff, 0xffd54a, 0x8b5a2b, 0xff9ad5, 0xa98bff];
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * 6.283, hb = new B(), col = hc[k % hc.length];
      hb.add(BOX, col, 0, 0, 0, 0.35, 0.5, 1.1).add(BOX, col, 0, 0.35, 0.55, 0.3, 0.55, 0.3, -0.5).add(BOX, 0xd33b55, 0, 0.3, 0, 0.4, 0.1, 0.5);
      for (const [lx, lz] of [[-0.12, -0.4], [0.12, -0.4], [-0.12, 0.4], [0.12, 0.4]]) hb.add(BOX, col, lx, -0.4, lz, 0.08, 0.45, 0.08);
      const h = hb.mesh();
      h.position.set(Math.cos(a) * 3.4, 1.8, Math.sin(a) * 3.4);
      h.rotation.y = -a;
      rot.add(h); horses.push(h);
    }
    return { g, h: 7, update(t, dt, spd) {
      rot.rotation.y += dt * 0.9 * spd;
      horses.forEach((h, k) => { h.position.y = 1.7 + Math.sin(t * 3 * Math.max(0.3, spd) + k * 1.6) * 0.4 * Math.min(1, spd * 2); });
    } };
  };

  MODELS.teacups = hue => {
    const g = new T.Group();
    const st = new B();
    st.add(CYL16, hsl(hue, 0.5, 0.4), 0, 0.2, 0, 5, 0.4, 5);
    g.add(st.mesh());
    const plat = new T.Group(); g.add(plat);
    const pb = new B();
    pb.add(CYL16, hsl(hue, 0.7, 0.75), 0, 0.5, 0, 4.7, 0.2, 4.7);
    pb.add(SPH_HI, 0xffffff, 0, 1.6, 0, 1.2, 1.0, 1.2).add(CONE8, hsl(hue, 0.7, 0.55), 0, 2.8, 0, 0.6, 0.8, 0.6).add(CYL8, 0xffffff, 1.3, 1.8, 0, 0.18, 1.2, 0.18, 0, 0, -0.9);
    plat.add(pb.mesh());
    plat.add(bulbs(ring(20, 4.7, 0.7), 0.6));
    const cups = [];
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * 6.283 + 0.4, cb = new B();
      const cc = hsl(hue + k * 70, 0.75, 0.6);
      cb.add(new T.CylinderGeometry(1.15, 0.75, 1, 12, 1, true), cc, 0, 0.5, 0, 1, 1, 1).add(CYL12, 0x3a2b4a, 0, 0.12, 0, 0.75, 0.2, 0.75);
      cb.add(new T.TorusGeometry(1.15, 0.08, 4, 16), 0xffffff, 0, 1, 0, 1, 1, 1, 1.5708).add(CYL6, 0xffffff, 0, 0.5, 0, 0.12, 1, 0.12);
      person(cb, -0.4, 0.2, 0.1, hsl(hue + k * 40, 0.8, 0.6), 0.8);
      person(cb, 0.4, 0.2, -0.1, hsl(hue + k * 90, 0.8, 0.6), 0.8);
      const m = cb.mesh(MAT2);
      const holder = new T.Group();
      holder.position.set(Math.cos(a) * 2.9, 0.6, Math.sin(a) * 2.9);
      holder.add(m); plat.add(holder); cups.push(holder);
    }
    return { g, h: 3.6, update(t, dt, spd) {
      plat.rotation.y += dt * 0.5 * spd;
      cups.forEach((c, k) => { c.rotation.y -= dt * (1.5 + k * 0.4) * spd; });
    } };
  };

  MODELS.bumper = hue => {
    const g = new T.Group();
    const st = new B();
    st.add(BOX, 0x2b2f45, 0, 0.15, 0, 10.4, 0.3, 8.4).add(BOX, 0x45496a, 0, 0.32, 0, 9.6, 0.05, 7.6);
    const wc = hsl(hue, 0.75, 0.55);
    st.add(BOX, wc, 0, 0.55, 4.0, 10.2, 0.5, 0.4).add(BOX, wc, 0, 0.55, -4.0, 10.2, 0.5, 0.4).add(BOX, wc, 5.0, 0.55, 0, 0.4, 0.5, 8).add(BOX, wc, -5.0, 0.55, 0, 0.4, 0.5, 8);
    for (const [x, z] of [[-5, -4], [5, -4], [-5, 4], [5, 4]]) st.add(CYL8, 0xd8d8e8, x, 2.3, z, 0.15, 4, 0.15);
    st.add(BOX, hsl(hue, 0.6, 0.35), 0, 4.35, -4.1, 10.4, 0.25, 0.5).add(BOX, hsl(hue, 0.6, 0.35), 0, 4.35, 4.1, 10.4, 0.25, 0.5);
    g.add(st.mesh());
    const pts = [];
    for (let x = -5; x <= 5; x += 0.8) { pts.push(new T.Vector3(x, 4.2, -4.1)); pts.push(new T.Vector3(x, 4.2, 4.1)); }
    g.add(bulbs(pts, 0.6));
    const cars = [];
    for (let k = 0; k < 6; k++) {
      const cb = new B(), cc = hsl(hue + k * 55, 0.85, 0.58);
      cb.add(BOX, cc, 0, 0.35, 0, 1.0, 0.4, 1.4).add(BOX, 0x222222, 0, 0.2, 0, 1.15, 0.25, 1.55).add(CYL6, 0xcccccc, 0, 2.0, -0.5, 0.03, 3.2, 0.03);
      person(cb, 0, 0.35, 0.1, hsl(hue + k * 77, 0.7, 0.65), 0.7);
      const m = cb.mesh(); g.add(m); cars.push(m);
    }
    let ph = 0;
    return { g, h: 4.6, update(t, dt, spd) {
      ph += dt * spd;
      cars.forEach((c, k) => {
        const a = ph * (0.6 + k * 0.07) + k * 1.1;
        const x = Math.sin(a * 1.3 + k) * 3.6, z = Math.sin(a * 0.9 + k * 2) * 2.7;
        const nx = Math.sin((a + 0.05) * 1.3 + k) * 3.6, nz = Math.sin((a + 0.05) * 0.9 + k * 2) * 2.7;
        c.position.set(x, 0.3, z);
        c.rotation.y = Math.atan2(nx - x, nz - z);
      });
    } };
  };

  MODELS.wheel = hue => {
    const g = new T.Group();
    const st = new B(), steel = 0xe6e8f5;
    st.add(BOX, hsl(hue, 0.4, 0.35), 0, 0.2, 0, 9, 0.4, 4);
    const hub = new T.Vector3(0, 5.6, 0);
    for (const z of [-1.1, 1.1]) for (const x of [-2.8, 2.8]) st.beam(new T.Vector3(x, 0.3, z * 1.6), new T.Vector3(0, 5.6, z), 0.16, steel);
    st.add(CYL8, steel, 0, 5.6, 0, 0.3, 2.6, 0.3, 1.5708);
    st.add(BOX, hsl(hue, 0.7, 0.55), 0, 0.9, 2.4, 2.4, 1.2, 1.2).add(BOX, 0xffffff, 0, 1.6, 2.4, 2.8, 0.2, 1.6);
    g.add(st.mesh());
    const wheel = new T.Group(); wheel.position.copy(hub); g.add(wheel);
    const wb = new B(), rim = hsl(hue, 0.75, 0.6);
    for (const z of [-0.6, 0.6]) {
      wb.add(new T.TorusGeometry(4.4, 0.12, 4, 32), rim, 0, 0, z);
      wb.add(new T.TorusGeometry(2.2, 0.08, 4, 20), steel, 0, 0, z);
      for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283; wb.beam(new T.Vector3(0, 0, z), new T.Vector3(Math.cos(a) * 4.4, Math.sin(a) * 4.4, z), 0.05, steel); }
    }
    wheel.add(wb.mesh());
    const lights = []; for (let k = 0; k < 36; k++) { const a = k / 36 * 6.283; lights.push(new T.Vector3(Math.cos(a) * 4.4, Math.sin(a) * 4.4, 0.75)); }
    wheel.add(bulbs(lights, 0.7));
    const cabins = [];
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * 6.283, cb = new B(), cc = hsl(hue + k * 30, 0.75, 0.6);
      cb.add(BOX, cc, 0, -0.75, 0, 0.9, 0.7, 0.9).add(CONE4, 0xffffff, 0, -0.15, 0, 0.7, 0.4, 0.7, 0, 0.785).add(CYL6, 0xdddddd, 0, -0.2, 0, 0.04, 0.4, 0.04);
      const m = cb.mesh(); m.castShadow = false;
      m.position.set(Math.cos(a) * 4.4, Math.sin(a) * 4.4, 0);
      wheel.add(m); cabins.push(m);
    }
    return { g, h: 10.4, update(t, dt, spd) {
      wheel.rotation.z += dt * 0.22 * spd;
      for (const c of cabins) c.rotation.z = -wheel.rotation.z + Math.sin(t * 2 + c.position.x) * 0.05 * spd;
    } };
  };

  MODELS.haunted = hue => {
    const g = new T.Group();
    const st = new B(), wall = 0x40355e, roof = 0x241d36;
    st.add(BOX, 0x2c3a2f, 0, 0.1, 0, 11, 0.2, 10);
    st.add(BOX, wall, 0, 2.2, -0.5, 7, 4, 5).add(CONE4, roof, 0, 5.3, -0.5, 5.4, 2.4, 4.2, 0, 0.785);
    st.add(CYL8, 0x4a3f6b, 3.2, 3.6, -2.5, 1.1, 7.2, 1.1).add(CONE8, roof, 3.2, 8.2, -2.5, 1.5, 2.2, 1.5);
    st.add(BOX, 0x1a1426, 0, 1.1, 2.05, 1.3, 2.2, 0.1).add(BOX, 0x6b5a8f, 0, 0.25, 2.6, 3, 0.3, 1.2);
    st.add(CYL6, 0x3b2a1e, -2.6, 1.6, -3.4, 0.08, 1.4, 0.08); // chimney-ish post
    for (let k = 0; k < 7; k++) { const x = -4.6 + k * 1.5; st.add(BOX, 0x8f93a8, x, 0.5, 4.2, 0.5, 0.8 + (k % 3) * 0.15, 0.18, 0, 0, (k % 2 ? 0.12 : -0.1)); }
    // a bare spooky tree
    st.add(CYL6, 0x3b2a1e, -4.2, 1.8, -3, 0.2, 3.6, 0.2).beam(new T.Vector3(-4.2, 2.8, -3), new T.Vector3(-3.2, 3.9, -2.6), 0.08, 0x3b2a1e).beam(new T.Vector3(-4.2, 3.2, -3), new T.Vector3(-5, 4.1, -3.4), 0.08, 0x3b2a1e);
    g.add(st.mesh());
    const wb = new B();
    for (const [x, y] of [[-2.2, 2.6], [2.2, 2.6], [-2.2, 1.1], [2.2, 1.1]]) wb.add(BOX, 0xffffff, x, y, 2.02, 0.9, 0.8, 0.05);
    wb.add(BOX, 0xffffff, 3.2, 5.5, -1.38, 0.5, 0.8, 0.05);
    const winMat = new T.MeshBasicMaterial({ color: 0x9cff7a, vertexColors: true });
    const win = wb.mesh(winMat, false); g.add(win);
    const ghost = new B();
    ghost.add(SPH_HI, 0xffffff, 0, 0.5, 0, 0.6, 0.6, 0.6).add(CONE8, 0xffffff, 0, -0.2, 0, 0.6, 1.2, 0.6, Math.PI).add(SPH, 0x111111, -0.2, 0.6, 0.5, 0.09, 0.12, 0.05).add(SPH, 0x111111, 0.2, 0.6, 0.5, 0.09, 0.12, 0.05);
    const gm = ghost.mesh(new T.MeshPhongMaterial({ vertexColors: true, transparent: true, opacity: 0.8, emissive: 0x333344 }), false);
    g.add(gm);
    let flick = 0;
    return { g, h: 9.4, update(t, dt, spd) {
      flick -= dt;
      if (flick <= 0) { flick = 0.08 + Math.random() * 0.5; const on = spd > 0.05 ? Math.random() > 0.25 : Math.random() > 0.8; winMat.color.setHex(on ? 0x9cff7a : 0x2b3a2b); }
      const a = t * 0.6;
      gm.position.set(Math.cos(a) * 4.6, 3.2 + Math.sin(t * 2) * 0.5, Math.sin(a) * 4);
      gm.rotation.y = -a;
      gm.visible = spd > 0.05;
    } };
  };

  // Tracked rides: a closed curve, cars that follow it with speed from height (gravity), optional lift section.
  function tracked(g, pts, opts) {
    const curve = new T.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    const len = curve.getLength();
    const N = opts.samples || 160;
    const sp = curve.getSpacedPoints(N);
    let yMax = -1; for (const p of sp) yMax = Math.max(yMax, p.y);
    const tb = new B();
    const sides = [], prevSide = new T.Vector3(1, 0, 0);
    for (let k = 0; k < N; k++) {
      const tan = curve.getTangentAt(k / N);
      const side = new T.Vector3().crossVectors(tan, UP);
      if (side.lengthSq() < 1e-4) side.copy(prevSide); else side.normalize();
      prevSide.copy(side); sides.push(side);
    }
    if (opts.rails) {
      for (const sgn of [-1, 1]) {
        const rp = sp.slice(0, N).map((p, k) => p.clone().addScaledVector(sides[k], sgn * opts.gauge));
        tb.add(new T.TubeGeometry(new T.CatmullRomCurve3(rp, true), N * 2, opts.rail, 5, true), opts.railColor);
      }
      for (let k = 0; k < N; k += 2) {
        const p = sp[k], tan = curve.getTangentAt(k / N), side = sides[k];
        const up2 = new T.Vector3().crossVectors(side, tan).normalize();
        const m = new T.Matrix4().makeBasis(side, up2, tan).scale(_s.set(opts.gauge * 2.4, 0.08, 0.18)).setPosition(p.clone().addScaledVector(up2, -0.08));
        tb.addM(BOX, opts.tieColor, m);
      }
    }
    if (opts.water) {
      const ch = new T.TubeGeometry(curve, N * 2, opts.water, 7, true);
      tb.add(ch, opts.troughColor, 0, -0.25, 0, 1, 1, 1);
    }
    let last = null;
    for (let k = 0; k < N; k += opts.supportEvery || 5) {
      const p = sp[k];
      if (p.y < 0.5) continue;
      const foot = new T.Vector3(p.x, 0, p.z);
      tb.beam(foot, new T.Vector3(p.x, p.y - 0.2, p.z), opts.supportR || 0.09, opts.supportColor);
      if (opts.braces && last && p.y > 1.5) tb.beam(new T.Vector3(last.x, 0.2, last.z), new T.Vector3(p.x, p.y * 0.7, p.z), 0.05, opts.supportColor);
      last = p;
    }
    g.add(tb.mesh());
    if (opts.water) {
      const w = new T.Mesh(new T.TubeGeometry(curve, N * 2, opts.water * 0.82, 7, true), WATER);
      w.position.y = -0.05; w.receiveShadow = true; g.add(w);
    }
    const cars = [];
    for (let k = 0; k < opts.cars; k++) { const m = opts.car(k); g.add(m); cars.push(m); }
    let u = 0;
    const tmp = new T.Vector3();
    return {
      curve, yMax,
      update(dt, spd) {
        if (spd <= 0) return;
        const p = curve.getPointAt(u);
        const tan = curve.getTangentAt(u);
        let v = Math.sqrt(2 * 9.8 * Math.max(0, yMax + 0.4 - p.y)) * (opts.speed || 1);
        if (opts.lift && tan.y > 0.12) v = opts.lift;
        v = Math.max(v, 1.6);
        u = (u + v * dt * spd / len) % 1;
        cars.forEach((c, k) => {
          const uk = (u - k * opts.spacing / len + 1) % 1;
          const pk = curve.getPointAt(uk), tk = curve.getTangentAt(uk);
          c.position.copy(pk);
          c.lookAt(tmp.copy(pk).add(tk));
        });
      },
    };
  }
  function coasterCar(col, w) {
    const cb = new B();
    cb.add(BOX, col, 0, 0.35, 0, w || 0.9, 0.4, 1.1).add(BOX, 0x222233, 0, 0.6, -0.15, (w || 0.9) * 0.85, 0.2, 0.5);
    person(cb, -0.2, 0.4, 0, 0xffd54a, 0.6); person(cb, 0.2, 0.4, 0, 0x4fb3ff, 0.6);
    const m = cb.mesh(); m.castShadow = false; return m;
  }

  MODELS.coaster = hue => {
    const g = new T.Group();
    const pts = [[-4.6, 0.7, 4.2], [-1, 0.7, 4.6], [2, 2.4, 4.6], [4.3, 5.6, 3.2], [4.9, 6.0, 1.0], [4.3, 1.2, -1.5], [2.5, 0.9, -4.4], [0, 3.6, -4.8], [-2.6, 2.0, -4.4], [-4.7, 3.6, -2.0], [-4.9, 1.2, 1.6]].map(p => new T.Vector3(p[0], p[1], p[2]));
    const wood = 0xa0703f;
    const tr = tracked(g, pts, { rails: true, gauge: 0.32, rail: 0.06, railColor: 0x8a8f99, tieColor: 0x6e4a26, supportColor: wood, supportR: 0.1, braces: true, supportEvery: 4, cars: 4, spacing: 1.25, lift: 2.4, speed: 0.75, car: k => coasterCar(hsl(hue + k * 25, 0.75, 0.55)) });
    const st = new B();
    st.add(BOX, 0x7a5a3a, -2.8, 0.25, 4.4, 4.6, 0.5, 1.8).add(BOX, hsl(hue, 0.6, 0.5), -2.8, 2.6, 4.4, 5, 0.3, 2.4);
    for (const x of [-5, -0.6]) st.add(CYL6, wood, x, 1.4, 5.1, 0.1, 2.4, 0.1);
    g.add(st.mesh());
    return { g, h: 7.2, update(t, dt, spd) { tr.update(dt, spd); } };
  };

  MODELS.hyper = hue => {
    const g = new T.Group();
    const pts = [];
    // A tall first drop, then a helix and bunny hops.
    const raw = [[-4.8, 0.8, 4.6], [-1.5, 0.8, 4.8], [1.5, 4.5, 4.8], [3.6, 9.5, 4.4], [4.9, 9.8, 2.6], [4.8, 1.0, -0.8], [3.4, 4.6, -4.6], [0.6, 6.0, -5.0], [-1.2, 2.2, -2.2], [0.8, 1.8, 0.2], [-1.3, 1.6, 2.0], [-3.4, 4.2, -0.5], [-4.6, 3.0, -4.0], [-5.2, 1.2, 0.6]];
    for (const p of raw) pts.push(new T.Vector3(p[0], p[1], p[2]));
    const tr = tracked(g, pts, { rails: true, gauge: 0.3, rail: 0.09, railColor: hsl(hue, 0.85, 0.55), tieColor: 0x666a80, supportColor: 0xf0f0fa, supportR: 0.14, supportEvery: 5, cars: 5, spacing: 1.2, lift: 3.2, speed: 0.85, car: k => coasterCar(hsl(hue + 180, 0.7, 0.55), 1.0) });
    const st = new B();
    st.add(BOX, 0x3d4466, -3.2, 0.3, 4.8, 4, 0.6, 1.8).add(BOX, hsl(hue, 0.7, 0.45), -3.2, 2.7, 4.8, 4.4, 0.25, 2.3);
    g.add(st.mesh());
    g.add(bulbs(tr.curve.getSpacedPoints(70).map(p => p.clone().add(_v.set(0, -0.35, 0))), 0.5));
    return { g, h: 10.8, update(t, dt, spd) { tr.update(dt, spd); } };
  };

  MODELS.flume = (hue, water) => {
    const g = new T.Group();
    const raw = [[-4.4, 0.5, 4.2], [0, 0.5, 4.6], [3.6, 0.5, 3.8], [4.6, 1.8, 1.0], [4.4, 4.8, -2.2], [3.0, 5.0, -4.2], [0.6, 4.9, -4.6], [-1.6, 1.0, -4.4], [-3.6, 0.5, -3.6], [-4.8, 0.5, -0.4]];
    const pts = raw.map(p => new T.Vector3(p[0], p[1], p[2]));
    const st = new B();
    st.add(CONE8, 0x6b5b4a, -0.5, 2.1, -1.2, 3.4, 4.2, 3.0).add(CONE8, 0x2c7a5c, -0.5, 4.0, -1.2, 1.6, 1.3, 1.4);
    st.add(new T.DodecahedronGeometry(1, 0), 0x8a8f99, 2.4, 0.6, 0.8, 1.2, 0.8, 1.0).add(new T.DodecahedronGeometry(1, 0), 0x7d828c, -3, 0.5, 1.8, 0.9, 0.6, 0.8);
    g.add(st.mesh());
    const tr = tracked(g, pts, { water: 0.75, troughColor: 0x8a6239, supportColor: 0x6e4a26, supportR: 0.12, supportEvery: 6, cars: 3, spacing: 3.2, lift: 1.8, speed: 0.7, car: k => {
      const cb = new B();
      cb.add(BOX, 0x8b5a2b, 0, 0.15, 0, 0.8, 0.45, 1.8).add(CYL8, 0x6b4421, 0, 0.3, 0.9, 0.4, 0.8, 0.4, 1.5708);
      person(cb, 0, 0.3, -0.3, hsl(hue + k * 60, 0.8, 0.6), 0.6); person(cb, 0, 0.3, 0.3, hsl(hue + k * 120, 0.8, 0.6), 0.6);
      const m = cb.mesh(); m.castShadow = false; return m;
    } });
    // Spray where the drop meets the water
    const spray = bulbs(Array.from({ length: 14 }, () => new T.Vector3()), 0.55, [new T.Color(0xcfeeff)]);
    g.add(spray);
    const base = new T.Vector3(-2.2, 0.6, -4.2);
    return { g, h: 6.2, update(t, dt, spd) {
      tr.update(dt, spd);
      const pa = spray.geometry.attributes.position;
      for (let k = 0; k < 14; k++) {
        const ph = (t * 1.6 + k / 14) % 1, a = k * 2.4;
        pa.setXYZ(k, base.x + Math.cos(a) * ph * 1.4, base.y + Math.sin(ph * Math.PI) * 1.6 * spd, base.z + Math.sin(a) * ph * 1.4);
      }
      pa.needsUpdate = true;
    } };
  };

  MODELS.rapids = hue => {
    const g = new T.Group();
    const raw = [[-4.6, 0.3, 4.0], [-1, 0.3, 4.8], [2.6, 0.3, 3.4], [4.6, 0.3, 0.4], [2.4, 0.3, -1.2], [4.2, 0.3, -4.0], [0.6, 0.3, -4.8], [-2.0, 0.3, -2.4], [-4.6, 0.3, -3.6], [-4.9, 0.3, 0.6]];
    const pts = raw.map(p => new T.Vector3(p[0], p[1], p[2]));
    const tr = tracked(g, pts, { water: 1.05, troughColor: 0x6d6a73, supportColor: 0x555555, cars: 4, spacing: 4, speed: 0.4, car: k => {
      const cb = new B();
      cb.add(new T.TorusGeometry(0.75, 0.3, 5, 10), hsl(hue + k * 50, 0.8, 0.55), 0, 0.3, 0, 1, 1, 1, 1.5708).add(CYL8, 0x333344, 0, 0.2, 0, 0.6, 0.2, 0.6);
      for (let j = 0; j < 4; j++) person(cb, Math.cos(j * 1.57) * 0.45, 0.25, Math.sin(j * 1.57) * 0.45, hsl(hue + j * 80 + k * 20, 0.8, 0.6), 0.55);
      const m = cb.mesh(); m.castShadow = false; return m;
    } });
    g.children[0].scale.y = 0.45; // flatten the channel so it reads as a river bed
    g.children[1].scale.y = 0.45;
    const st = new B();
    for (let k = 0; k < 12; k++) {
      const p = tr.curve.getPointAt(k / 12), tan = tr.curve.getTangentAt(k / 12), side = new T.Vector3().crossVectors(tan, UP).normalize();
      const s = (k % 2 ? 1 : -1) * 1.5;
      st.add(new T.DodecahedronGeometry(1, 0), 0x8a8f99, p.x + side.x * s, 0.3, p.z + side.z * s, 0.5, 0.4, 0.45, k, k * 2, 0);
    }
    st.add(CONE8, 0x1f6b4a, 0.2, 1.8, 0.2, 1.2, 2.6, 1.2).add(CYL6, 0x5a3d26, 0.2, 0.3, 0.2, 0.2, 0.6, 0.2);
    st.add(CONE8, 0x2c7a5c, -0.8, 1.4, 1.6, 0.9, 2.0, 0.9).add(CYL6, 0x5a3d26, -0.8, 0.2, 1.6, 0.15, 0.4, 0.15);
    g.add(st.mesh());
    return { g, h: 3.4, update(t, dt, spd) {
      tr.update(dt, spd);
    } };
  };

  MODELS.pirate = hue => {
    const g = new T.Group();
    const st = new B(), frame = 0x8a5a33;
    st.add(BOX, 0x3d4466, 0, 0.2, 0, 10, 0.4, 4.4);
    for (const z of [-1.6, 1.6]) { st.beam(new T.Vector3(-3.6, 0.3, z), new T.Vector3(0, 6.6, z * 0.7), 0.2, frame); st.beam(new T.Vector3(3.6, 0.3, z), new T.Vector3(0, 6.6, z * 0.7), 0.2, frame); }
    st.add(CYL8, 0xbbbbcc, 0, 6.6, 0, 0.22, 2.6, 0.22, 1.5708);
    g.add(st.mesh());
    const sw = new T.Group(); sw.position.set(0, 6.6, 0); g.add(sw);
    const sb = new B(), hull = 0x7a4a24, hc = hsl(hue, 0.7, 0.45);
    sb.add(BOX, hull, 0, -5.1, 0, 6.4, 1.1, 1.9).add(CONE4, hull, 3.9, -5.0, 0, 1.0, 1.4, 1.0, 0, 0.785, -1.5708).add(CONE4, hull, -3.9, -5.0, 0, 1.0, 1.4, 1.0, 0, 0.785, 1.5708);
    sb.add(BOX, hc, 0, -4.5, 0, 6.6, 0.2, 2.0).add(BOX, 0xf0d9a8, 0, -4.4, 0, 6.0, 0.1, 1.6);
    sb.add(CYL6, 0x5a3d26, 0, -2.6, 0, 0.1, 3.6, 0.1).add(BOX, 0xfaf3e0, 0, -2.5, 0, 0.05, 2.0, 1.5).add(BOX, 0x111111, 0, -0.7, 0.3, 0.02, 0.4, 0.6);
    for (const z of [-0.75, 0.75]) sb.beam(new T.Vector3(0, 0, z), new T.Vector3(-2.6, -4.6, z), 0.08, 0xbbbbcc).beam(new T.Vector3(0, 0, z), new T.Vector3(2.6, -4.6, z), 0.08, 0xbbbbcc);
    for (let k = 0; k < 6; k++) person(sb, -2.5 + k, -4.4, (k % 2 ? 0.4 : -0.4), hsl(hue + k * 50, 0.8, 0.6), 0.65);
    sw.add(sb.mesh());
    let amp = 0, ph = 0;
    return { g, h: 7.4, update(t, dt, spd) {
      amp += (spd * 1.0 - amp) * Math.min(1, dt * 0.5);
      ph += dt * 1.25;
      sw.rotation.z = Math.sin(ph) * amp;
    } };
  };

  MODELS.drop = hue => {
    const g = new T.Group();
    const st = new B(), steel = 0xdfe3f0;
    st.add(CYL12, 0x3d4466, 0, 0.25, 0, 3.2, 0.5, 3.2);
    st.add(CYL8, steel, 0, 7, 0, 0.55, 13.5, 0.55).add(CYL8, hsl(hue, 0.7, 0.5), 0, 13.9, 0, 0.9, 0.6, 0.9).add(CONE8, hsl(hue, 0.7, 0.55), 0, 14.7, 0, 0.9, 1.0, 0.9);
    g.add(st.mesh());
    const lights = []; for (let y = 1; y < 13.5; y += 0.7) { lights.push(new T.Vector3(0.6, y, 0)); lights.push(new T.Vector3(-0.6, y, 0)); }
    g.add(bulbs(lights, 0.55));
    const car = new B();
    car.add(CYL12, hsl(hue, 0.8, 0.55), 0, 0, 0, 1.6, 0.6, 1.6);
    for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; person(car, Math.cos(a) * 1.75, -0.7, Math.sin(a) * 1.75, hsl(hue + k * 45, 0.8, 0.6), 0.6); }
    const cm = car.mesh(); g.add(cm);
    let ph = 0;
    return { g, h: 15.4, update(t, dt, spd) {
      ph = (ph + dt * spd / 9) % 1;
      let y;
      if (ph < 0.6) y = 1 + 11.2 * (ph / 0.6);       // slow climb
      else if (ph < 0.7) y = 12.2;                  // suspense
      else if (ph < 0.78) { const k = (ph - 0.7) / 0.08; y = 12.2 - 10.6 * k * k; } // drop
      else y = 1.6 - 0.6 * ((ph - 0.78) / 0.22);    // brake
      cm.position.y = y;
    } };
  };

  MODELS.rocket = hue => {
    const g = new T.Group();
    const st = new B(), steel = 0xcfd4e6;
    st.add(CYL12, 0x2b3150, 0, 0.3, 0, 3.6, 0.6, 3.6).add(CYL12, 0xffc94a, 0, 0.62, 0, 3.0, 0.05, 3.0);
    for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) st.add(BOX, steel, x, 8, z, 0.18, 16, 0.18);
    for (let y = 1.5; y < 16; y += 1.6) { st.add(BOX, steel, 0, y, -1.3, 2.6, 0.08, 0.08).add(BOX, steel, 0, y, 1.3, 2.6, 0.08, 0.08).add(BOX, steel, -1.3, y, 0, 0.08, 0.08, 2.6).add(BOX, steel, 1.3, y, 0, 0.08, 0.08, 2.6); }
    st.add(BOX, hsl(hue, 0.6, 0.45), 3.5, 1.2, 2.5, 2.4, 1.6, 1.6).add(CYL8, 0xdddddd, 3.5, 2.4, 2.5, 0.4, 0.8, 0.4); // control room
    g.add(st.mesh());
    g.add(bulbs([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => new T.Vector3(-1.4, 1 + k * 1.6, 1.4)), 0.7, [new T.Color(0xff4d6d)]));
    const rk = new T.Group(); g.add(rk);
    const rb = new B();
    rb.add(CYL12, 0xf5f6fb, 0, 1.6, 0, 0.75, 3.2, 0.75).add(CONE12, hsl(hue, 0.8, 0.55), 0, 3.8, 0, 0.75, 1.3, 0.75).add(CYL12, 0x5ac8fa, 0, 2.4, 0.7, 0.28, 0.08, 0.28, 1.5708);
    for (let k = 0; k < 3; k++) { const a = k / 3 * 6.283; rb.add(BOX, hsl(hue, 0.8, 0.5), Math.cos(a) * 0.85, 0.5, Math.sin(a) * 0.85, 0.12, 1.0, 0.7, 0, -a, 0); }
    rk.add(rb.mesh());
    const flame = new T.Mesh(new T.ConeGeometry(0.5, 1.6, 8), new T.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 }));
    flame.rotation.x = Math.PI; flame.position.y = -0.6; rk.add(flame);
    const fl = new T.Sprite(new T.SpriteMaterial({ map: GLOW_TEX, color: 0xffb060, blending: T.AdditiveBlending, depthWrite: false }));
    fl.scale.set(3, 3, 1); fl.position.y = -0.8; rk.add(fl);
    let ph = 0;
    return { g, h: 17, update(t, dt, spd) {
      ph = (ph + dt * spd / 10) % 1;
      let y, burn = 0;
      if (ph < 0.25) { y = 0.7; burn = ph > 0.18 ? 0.5 : 0; }
      else if (ph < 0.38) { const k = (ph - 0.25) / 0.13; y = 0.7 + 12.5 * k * k; burn = 1; }
      else if (ph < 0.45) y = 13.2 + Math.sin((ph - 0.38) / 0.07 * Math.PI) * 0.5;
      else { const k = (ph - 0.45) / 0.55; y = 13.2 - 12.5 * (1 - Math.pow(1 - k, 2)); burn = k > 0.85 ? 0.4 : 0; }
      rk.position.y = y;
      flame.visible = fl.visible = burn > 0;
      flame.scale.set(1, 0.6 + burn * (0.8 + Math.random() * 0.4), 1);
    } };
  };

  MODELS.swing = hue => {
    const g = new T.Group();
    const st = new B();
    st.add(CYL12, 0x3d4466, 0, 0.25, 0, 4.6, 0.5, 4.6).add(CYL8, 0xe7e9f5, 0, 3.8, 0, 0.5, 7, 0.5);
    g.add(st.mesh());
    const top = new T.Group(); top.position.y = 7.2; g.add(top);
    const tb = new B();
    tb.add(CONE12, hsl(hue, 0.75, 0.55), 0, 0.9, 0, 3.4, 1.6, 3.4).add(CYL12, 0xffffff, 0, 0, 0, 3.4, 0.4, 3.4);
    top.add(tb.mesh());
    top.add(bulbs(ring(24, 3.45, 0), 0.7));
    const pivots = [];
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * 6.283, pv = new T.Group();
      pv.position.set(Math.cos(a) * 3.1, -0.1, Math.sin(a) * 3.1);
      pv.rotation.y = -a;
      const arm = new T.Group(); pv.add(arm);
      const sb = new B();
      sb.add(CYL6, 0xcccccc, 0, -1.9, 0, 0.03, 3.8, 0.03).add(BOX, hsl(hue + k * 36, 0.8, 0.6), 0, -3.9, 0, 0.5, 0.15, 0.5);
      person(sb, 0, -3.85, 0, hsl(hue + k * 50, 0.8, 0.6), 0.6);
      arm.add(sb.mesh());
      top.add(pv); pivots.push(arm);
    }
    let w = 0;
    return { g, h: 9, update(t, dt, spd) {
      w += (spd - w) * Math.min(1, dt * 0.6);
      top.rotation.y += dt * 1.4 * w;
      top.position.y = 7.2 + w * 0.8;
      for (const a of pivots) a.rotation.z = -0.7 * w;
    } };
  };

  // ---------- Construction site ----------
  function constructionSite(hue) {
    const g = new T.Group();
    const st = new B();
    st.add(BOX, 0x7a5f45, 0, 0.06, 0, 11, 0.12, 11);
    for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; st.add(CONE8, 0xff7a2a, Math.cos(a) * 5.3, 0.4, Math.sin(a) * 5.3, 0.25, 0.8, 0.25).add(CYL8, 0xffffff, Math.cos(a) * 5.3, 0.45, Math.sin(a) * 5.3, 0.2, 0.12, 0.2); }
    st.add(BOX, 0xd8b26a, -3.6, 0.35, 3.6, 1.6, 0.5, 1.0).add(BOX, 0xbfa070, -3.4, 0.75, 3.6, 1.4, 0.3, 0.9); // stacked planks
    g.add(st.mesh());
    const scaf = new T.Group(); g.add(scaf);
    const sb = new B(), pole = 0xffc94a, plank = 0xa77b47;
    for (const x of [-3, -1, 1, 3]) for (const z of [-3, -1, 1, 3]) if (Math.abs(x) === 3 || Math.abs(z) === 3) sb.add(CYL6, pole, x, 3, z, 0.07, 6, 0.07);
    for (let y = 1.5; y <= 6; y += 1.5) for (const s of [-3, 3]) { sb.add(BOX, plank, 0, y, s, 6.2, 0.12, 0.5).add(BOX, plank, s, y, 0, 0.5, 0.12, 6.2); }
    sb.add(BOX, 0x9a9aa8, 0, 1.0, 0, 5.4, 2.0, 5.4).add(BOX, hsl(hue, 0.6, 0.5), 0, 2.05, 0, 3.4, 0.1, 3.4);
    scaf.add(sb.mesh());
    const crane = craneModel();
    crane.g.position.set(4.2, 0, -4.2);
    g.add(crane.g);
    const wb = new B();
    person(wb, 0, 0, 0, 0xff8a00, 0.9); wb.add(SPH, 0xffd400, 0, 0.98, 0, 0.2, 0.12, 0.2);
    const w1 = wb.mesh(), w2 = w1.clone(); g.add(w1, w2);
    return { g, h: 7, update(t, dt, spd, progress) {
      scaf.scale.y = 0.15 + 0.85 * progress;
      crane.update(t, dt);
      w1.position.set(-4.4 + Math.sin(t * 0.7) * 2.5, 0.12, 4.4); w1.rotation.y = Math.cos(t * 0.7) > 0 ? 1.57 : -1.57;
      w2.position.set(4.4, 0.12, -1 + Math.sin(t * 0.5 + 2) * 2.5);
    } };
  }
  function craneModel(small) {
    const g = new T.Group(), s = small ? 0.6 : 1;
    const b = new B(), y = 0xffb800;
    b.add(BOX, 0x555a70, 0, 0.3 * s, 0, 1.4 * s, 0.6 * s, 1.4 * s);
    for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) b.add(BOX, y, x * s, 5 * s, z * s, 0.08 * s, 10 * s, 0.08 * s);
    for (let h = 1; h < 10; h += 1) b.add(BOX, y, 0, h * s, 0.3 * s, 0.6 * s, 0.05 * s, 0.05 * s).add(BOX, y, 0, h * s, -0.3 * s, 0.6 * s, 0.05 * s, 0.05 * s);
    g.add(b.mesh());
    const jib = new T.Group(); jib.position.y = 10 * s; g.add(jib);
    const jb = new B();
    jb.add(BOX, y, -2 * s, 0.2 * s, 0, 8.5 * s, 0.35 * s, 0.4 * s).add(BOX, 0x666b80, 1.6 * s, 0, 0, 1.2 * s, 0.8 * s, 0.8 * s).add(BOX, 0x333344, -0.0, 0.7 * s, 0, 0.6 * s, 0.9 * s, 0.6 * s);
    jb.add(CYL6, 0x222222, -5 * s, -2 * s, 0, 0.02 * s, 4 * s, 0.02 * s).add(BOX, 0x8a8f99, -5 * s, -4.1 * s, 0, 0.6 * s, 0.4 * s, 0.6 * s);
    jib.add(jb.mesh());
    return { g, update(t) { jib.rotation.y = Math.sin(t * 0.25) * 1.2 + 0.6; } };
  }

  // Empty lot waiting for a ride: dirt patch, survey stakes and a sign.
  function emptyLot(hue) {
    const g = new T.Group();
    const b = new B();
    b.add(BOX, 0x2f5e48, 0, 0.04, 0, 11, 0.08, 11);
    for (let k = 0; k < 12; k++) {
      const s = -5 + (k % 6) * 2, side = Math.floor(k / 6);
      b.add(BOX, 0xf0e6cc, s, 0.35, side ? 5 : -5, 0.12, 0.6, 0.12).add(BOX, 0xf0e6cc, side ? 5 : -5, 0.35, s, 0.12, 0.6, 0.12);
    }
    b.add(CYL6, 0x8a6239, 0, 1, 0, 0.08, 2, 0.08).add(BOX, 0xffffff, 0, 2.0, 0, 2.4, 1.0, 0.1).add(BOX, hsl(hue, 0.7, 0.55), 0, 2.0, 0.06, 2.1, 0.75, 0.02);
    g.add(b.mesh());
    return { g, h: 2.6, update() {} };
  }

  // ---------- The scene ----------
  function create(host, hooks) {
    const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputEncoding = T.sRGBEncoding;
    const el = renderer.domElement;
    el.className = 'gl';
    host.insertBefore(el, host.firstChild);

    const scene = new T.Scene();
    const FOG = 0x26244d;
    scene.background = new T.Color(FOG);
    scene.fog = new T.Fog(FOG, 70, 190);
    const camera = new T.PerspectiveCamera(42, 1, 0.5, 400);
    scene.add(new T.HemisphereLight(0xc9b8ff, 0x2b4a38, 0.8));
    scene.add(new T.AmbientLight(0x3a3060, 0.35));
    const sun = new T.DirectionalLight(0xffd2a0, 0.95);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    scene.add(sun, sun.target);

    const world = new T.Group(); scene.add(world);
    let staticGroup = null, decorGroup = null, decorKey = '';
    const lots = [];       // per lot: { key, obj, label anchor }
    let L = null, W = 0, H = 0, ox = 0, oz = 0;
    const toW = (px, py) => [px * K - ox, py * K - oz];

    // Selection ring
    const selRing = new T.Mesh(new T.RingGeometry(6.2, 6.6, 48), new T.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.85, side: T.DoubleSide }));
    selRing.rotation.x = -Math.PI / 2; selRing.position.y = 0.08; world.add(selRing);

    // Guests (instanced: body + head)
    const MAXG = 200;
    const bodies = new T.InstancedMesh(new T.CylinderGeometry(0.2, 0.26, 0.7, 6), new T.MeshLambertMaterial(), MAXG);
    const heads = new T.InstancedMesh(new T.SphereGeometry(0.17, 6, 4), new T.MeshLambertMaterial({ color: 0xf3d3b5 }), MAXG);
    bodies.instanceMatrix.setUsage(T.DynamicDrawUsage); heads.instanceMatrix.setUsage(T.DynamicDrawUsage);
    for (let k = 0; k < MAXG; k++) bodies.setColorAt(k, _c.set(0xffffff));
    bodies.castShadow = true;
    world.add(bodies, heads);
    const shirtCache = new Map();

    // Smoke puffs for broken rides
    const smoke = [];
    for (let k = 0; k < 40; k++) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: SMOKE_TEX, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; world.add(s); smoke.push({ s, life: 0, lot: -1 });
    }
    const beacons = [];

    function buildStatic() {
      if (staticGroup) { world.remove(staticGroup); staticGroup.traverse(o => { if (o.geometry && o.geometry !== BOX) o.geometry.dispose(); }); }
      staticGroup = new T.Group();
      const b = new B();
      const pw = W * K, ph = H * K;
      // Ground: lawn inside the park, darker meadow outside.
      const ground = new T.Mesh(new T.PlaneGeometry(600, 600), new T.MeshLambertMaterial({ color: 0x1b3d30 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
      staticGroup.add(ground);
      b.add(BOX, 0x24624a, 0, -0.01, 0, pw + 2, 0.04, ph + 2);
      const pathC = 0x6f689c, edge = 0x8b84b6;
      for (const y of L.hcorr) { const [, z] = toW(0, y); b.add(BOX, pathC, 0, 0.03, z, pw, 0.06, L.gap * K * 0.8).add(BOX, edge, 0, 0.035, z, pw, 0.05, L.gap * K * 0.9); }
      for (const x of L.vcorr) { const [wx] = toW(x, 0); const z0 = toW(0, L.hcorr[0])[1], z1 = toW(0, L.bottomY)[1]; b.add(BOX, pathC, wx, 0.04, (z0 + z1) / 2, L.gap * K * 0.8, 0.06, z1 - z0); }
      { const [gx, gz] = toW(L.gate.x, L.bottomY); const gz1 = ph / 2 + 4; b.add(BOX, pathC, gx, 0.04, (gz + gz1) / 2, 4.4, 0.06, gz1 - gz); }
      // Fence around the park with a gap for the gate
      const fx = pw / 2 + 0.6, fz = ph / 2 + 0.6, fence = 0xe9e4ff;
      for (let x = -fx; x <= fx; x += 2) { b.add(CYL6, fence, x, 0.5, -fz, 0.07, 1, 0.07); if (Math.abs(x) > 3.2) b.add(CYL6, fence, x, 0.5, fz, 0.07, 1, 0.07); }
      for (let z = -fz; z <= fz; z += 2) { b.add(CYL6, fence, -fx, 0.5, z, 0.07, 1, 0.07).add(CYL6, fence, fx, 0.5, z, 0.07, 1, 0.07); }
      b.add(BOX, fence, 0, 0.85, -fz, fx * 2, 0.08, 0.08).add(BOX, fence, -fx, 0.85, 0, 0.08, 0.08, fz * 2).add(BOX, fence, fx, 0.85, 0, 0.08, 0.08, fz * 2);
      b.add(BOX, fence, -(fx + 3.2) / 2, 0.85, fz, fx - 3.2, 0.08, 0.08).add(BOX, fence, (fx + 3.2) / 2, 0.85, fz, fx - 3.2, 0.08, 0.08);
      // Trees: in the lawn spots from the layout and a ring of forest outside the fence.
      const tree = (x, z, s, k) => {
        b.add(CYL6, 0x5a3d26, x, 0.6 * s, z, 0.18 * s, 1.2 * s, 0.18 * s);
        if (k % 3) b.add(CONE8, k % 2 ? 0x2c7a5c : 0x24694f, x, 2.0 * s, z, 1.1 * s, 2.4 * s, 1.1 * s).add(CONE8, 0x339068, x, 3.0 * s, z, 0.8 * s, 1.6 * s, 0.8 * s);
        else b.add(SPH, 0x2f8a5f, x, 1.9 * s, z, 1.2 * s, 1.1 * s, 1.2 * s);
      };
      L.trees.forEach((t, k) => { const [x, z] = toW(t.x, t.y); tree(x, z, 0.7 + t.r / 30, k); });
      let seed = 11; const r01 = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 90; k++) {
        const side = k % 4, d = 3 + r01() * 14;
        let x, z;
        if (side === 0) { x = -fx - d; z = (r01() - 0.5) * (ph + 30); }
        else if (side === 1) { x = fx + d; z = (r01() - 0.5) * (ph + 30); }
        else if (side === 2) { z = -fz - d; x = (r01() - 0.5) * (pw + 30); }
        else { z = fz + d + 2; x = (r01() - 0.5) * (pw + 30); if (Math.abs(x) < 6) continue; }
        tree(x, z, 0.8 + r01() * 0.8, k);
      }
      // Entrance arch
      const gz = fz;
      for (const sx of [-2.6, 2.6]) for (let k = 0; k < 6; k++) b.add(CYL8, k % 2 ? 0xffffff : 0xff4d6d, sx, 0.4 + k * 0.8, gz, 0.4, 0.8, 0.4);
      b.add(BOX, 0xff4d6d, 0, 5.3, gz, 7.4, 1.4, 0.5).add(CONE8, 0xffc94a, -2.6, 5.4 + 0.9, gz, 0.5, 0.8, 0.5).add(CONE8, 0xffc94a, 2.6, 5.4 + 0.9, gz, 0.5, 0.8, 0.5);
      // Ticket booths
      b.add(BOX, 0xffe0a8, -5, 1, gz + 1.5, 1.8, 2, 1.6).add(CONE4, 0xff4d6d, -5, 2.5, gz + 1.5, 1.5, 1, 1.5, 0, 0.785);
      b.add(BOX, 0xffe0a8, 5, 1, gz + 1.5, 1.8, 2, 1.6).add(CONE4, 0xff4d6d, 5, 2.5, gz + 1.5, 1.5, 1, 1.5, 0, 0.785);
      staticGroup.add(b.mesh());
      const sign = new T.Mesh(new T.PlaneGeometry(6.6, 1.1), new T.MeshBasicMaterial({ map: canvasTex(512, 86, (x, w, h) => {
        x.fillStyle = '#ff4d6d'; x.fillRect(0, 0, w, h);
        x.fillStyle = '#fff'; x.font = '60px Bungee, Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('JOYLAND', w / 2, h / 2 + 3);
      }) }));
      sign.position.set(0, 5.3, gz + 0.27); staticGroup.add(sign);
      const archBulbs = []; for (let k = 0; k < 16; k++) archBulbs.push(new T.Vector3(-3.6 + k * 0.48, 6.1, gz + 0.3));
      staticGroup.add(bulbs(archBulbs, 0.7));
      // String lights between the path crossings
      const lp = [];
      for (const y of L.hcorr) {
        const [, z] = toW(0, y);
        for (let k = 0; k < L.vcorr.length - 1; k++) {
          const [x0] = toW(L.vcorr[k], 0), [x1] = toW(L.vcorr[k + 1], 0);
          for (let j = 1; j < 10; j++) { const f = j / 10; lp.push(new T.Vector3(x0 + (x1 - x0) * f, 3.4 - Math.sin(f * Math.PI) * 0.8, z)); }
        }
      }
      const poleB = new B();
      for (const y of L.hcorr) for (const x of L.vcorr) { const [wx, wz] = toW(x, y); poleB.add(CYL6, 0x34395e, wx, 1.75, wz, 0.08, 3.5, 0.08); }
      staticGroup.add(poleB.mesh());
      lightsPts = bulbs(lp, 0.75);
      staticGroup.add(lightsPts);
      twinkles = [lightsPts];
      staticGroup.traverse(o => { if (o.isPoints) twinkles.push(o); });
      world.add(staticGroup);
      // Shadow camera covers the whole park.
      const r = Math.max(pw, ph) / 2 + 10;
      Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 220 });
      sun.shadow.camera.updateProjectionMatrix();
      sun.position.set(-40, 70, 35); sun.target.position.set(0, 0, 0);
      decorKey = '';
    }
    let lightsPts = null, twinkles = [];

    // Decorations from the layout spots
    let fountains = [];
    function buildDecor(S) {
      const key = JSON.stringify(S.decor) + L.spots.length;
      if (key === decorKey) return;
      decorKey = key;
      if (decorGroup) world.remove(decorGroup);
      decorGroup = new T.Group();
      fountains = [];
      const d = S.decor, b = new B(), glow = [];
      const nl = Math.min(d.lamps, L.lampSpots.length);
      for (let k = 0; k < nl; k++) {
        const [x, z] = toW(...L.lampSpots[(k * 7) % L.lampSpots.length]);
        b.add(CYL6, 0x2b3157, x + 1.2, 1.4, z + 1.2, 0.08, 2.8, 0.08).add(SPH, 0xffe3a0, x + 1.2, 2.9, z + 1.2, 0.22, 0.22, 0.22);
        glow.push(new T.Vector3(x + 1.2, 2.9, z + 1.2));
      }
      const items = [];
      for (let k = 0; k < Math.min(d.fountain, 6); k++) items.push('fountain');
      for (let k = 0; k < Math.min(d.statue, 6); k++) items.push('statue');
      for (let k = 0; k < Math.min(d.flowers, 40); k++) items.push('flowers');
      const n = Math.min(items.length, L.spots.length);
      const fl = [0xff7ccf, 0xffd54a, 0xff5d73, 0xa98bff, 0xffffff];
      for (let k = 0; k < n; k++) {
        const [x, z] = toW(...L.spots[k]);
        if (items[k] === 'fountain') {
          b.add(CYL16, 0x9aa0c8, x, 0.3, z, 1.4, 0.6, 1.4).add(CYL16, 0x3d9be0, x, 0.55, z, 1.2, 0.1, 1.2).add(CYL8, 0xc8cce6, x, 0.9, z, 0.18, 1.2, 0.18).add(CYL8, 0x9aa0c8, x, 1.5, z, 0.6, 0.12, 0.6);
          fountains.push(new T.Vector3(x, 1.6, z));
        } else if (items[k] === 'statue') {
          b.add(BOX, 0x6b6f94, x, 0.5, z, 1, 1, 1);
          const gold = 0xffc94a;
          b.add(SPH, gold, x, 1.5, z, 0.5, 0.5, 0.5).add(SPH, gold, x - 0.4, 2.0, z, 0.22, 0.22, 0.1).add(SPH, gold, x + 0.4, 2.0, z, 0.22, 0.22, 0.1);
        } else {
          b.add(CYL8, 0x2f6b4f, x, 0.15, z, 0.8, 0.3, 0.8);
          for (let j = 0; j < 6; j++) { const a = j / 6 * 6.283 + k; b.add(SPH, fl[(j + k) % fl.length], x + Math.cos(a) * 0.5, 0.38, z + Math.sin(a) * 0.5, 0.16, 0.16, 0.16); }
        }
      }
      if (b.p.length) decorGroup.add(b.mesh());
      if (glow.length) { const g = bulbs(glow, 2.2, [new T.Color(0xffd890)]); decorGroup.add(g); }
      if (fountains.length) {
        const pts = [];
        for (const f of fountains) for (let j = 0; j < 12; j++) pts.push(f.clone());
        fountainPts = bulbs(pts, 0.35, [new T.Color(0xcfeeff)]);
        decorGroup.add(fountainPts);
      } else fountainPts = null;
      world.add(decorGroup);
    }
    let fountainPts = null;

    // ---------- Lots ----------
    function lotKey(S, i) {
      const r = S.rides[i];
      if (r && r.lvl) return 'ride:' + hooks.def(i).model;
      if (S.builds.some(b => b.kind === 'ride' && b.i === i)) return 'build';
      return 'empty';
    }
    function syncLots(S) {
      for (let i = 0; i < L.plots.length; i++) {
        const key = lotKey(S, i);
        let lot = lots[i];
        const [cx, cz] = toW(L.plots[i].cx, L.plots[i].cy);
        if (!lot || lot.key !== key) {
          if (lot) { world.remove(lot.obj.g); if (lot.crane) world.remove(lot.crane.g); }
          const hue = hooks.hue(i);
          let obj;
          if (key === 'build') obj = constructionSite(hue);
          else if (key === 'empty') obj = emptyLot(hue);
          else obj = (MODELS[key.slice(5)] || MODELS.carousel)(hue);
          lot = lots[i] = { key, obj, spd: 0, t: Math.random() * 10 };
          if (key.startsWith('ride')) {
            const pad = new B();
            pad.add(CYL16, 0x2a6b52, 0, 0.02, 0, 5.9, 0.04, 5.9);
            obj.g.add(pad.mesh());
          }
          world.add(obj.g);
        }
        // scale models to the lot size (layout lots are 12 units)
        const sc = Math.min(L.plotW, L.plotH) * K / 12;
        lot.obj.g.position.set(cx, 0, cz);
        lot.obj.g.scale.setScalar(sc);
        lot.cx = cx; lot.cz = cz; lot.sc = sc;
        // a small crane next to a ride that is being upgraded
        const upgrading = S.builds.some(b => b.i === i && b.kind !== 'ride');
        if (upgrading && !lot.crane) { lot.crane = craneModel(true); world.add(lot.crane.g); }
        if (!upgrading && lot.crane) { world.remove(lot.crane.g); lot.crane = null; }
        if (lot.crane) lot.crane.g.position.set(cx + 5 * sc, 0, cz - 5 * sc);
      }
      for (let i = L.plots.length; i < lots.length; i++) if (lots[i]) { world.remove(lots[i].obj.g); if (lots[i].crane) world.remove(lots[i].crane.g); }
      lots.length = L.plots.length;
    }

    // ---------- Camera ----------
    const cam = { x: 0, z: 0, dist: 40, yaw: 0, pitch: 0.92, tx: null, tz: null, vx: 0, vz: 0 };
    let vw = 1, vh = 1;
    function resize() {
      vw = host.clientWidth || 1; vh = host.clientHeight || 1;
      renderer.setSize(vw, vh, false);
      el.style.width = vw + 'px'; el.style.height = vh + 'px';
      camera.aspect = vw / vh;
      camera.updateProjectionMatrix();
    }
    function fitDist() {
      const pw = W * K + 4;
      const vis = 2 * Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
      return Math.max(18, Math.min(110, pw / vis * 1.05));
    }
    function clampCam() {
      const pw = W * K / 2, ph = H * K / 2;
      cam.x = Math.max(-pw, Math.min(pw, cam.x));
      cam.z = Math.max(-ph - 2, Math.min(ph + 4, cam.z));
      cam.dist = Math.max(10, Math.min(130, cam.dist));
    }
    function placeCamera() {
      const h = Math.sin(cam.pitch) * cam.dist, d = Math.cos(cam.pitch) * cam.dist;
      camera.position.set(cam.x + Math.sin(cam.yaw) * d, h, cam.z + Math.cos(cam.yaw) * d);
      camera.lookAt(cam.x, 0, cam.z);
    }

    // Pointer: one finger pans, two fingers pinch to zoom and twist to turn, a short tap selects a lot.
    const ptrs = new Map();
    let gesture = null, tapStart = null;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      cam.tx = null; cam.vx = cam.vz = 0;
      if (ptrs.size === 1) tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      else tapStart = null;
      gesture = null;
    });
    el.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const nx = e.clientX, ny = e.clientY;
      if (ptrs.size === 1) {
        const dx = nx - p.x, dy = ny - p.y;
        if (tapStart && Math.hypot(nx - tapStart.x, ny - tapStart.y) > 8) tapStart.moved = true;
        const per = 2 * cam.dist * Math.tan(camera.fov * Math.PI / 360) / vh;
        const mx = -dx * per, mz = -dy * per / Math.sin(cam.pitch);
        const cs = Math.cos(cam.yaw), sn = Math.sin(cam.yaw);
        const wx = mx * cs + mz * sn, wz = -mx * sn + mz * cs;
        cam.x += wx; cam.z += wz;
        cam.vx = wx / 0.016; cam.vz = wz / 0.016;
        p.x = nx; p.y = ny;
      } else if (ptrs.size === 2) {
        p.x = nx; p.y = ny;
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (gesture) {
          cam.dist *= gesture.d / Math.max(1, d);
          let da = ang - gesture.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
          cam.yaw -= da;
        }
        gesture = { d, a: ang };
      }
      clampCam();
    });
    const up = e => {
      ptrs.delete(e.pointerId);
      gesture = null;
      if (tapStart && !tapStart.moved && performance.now() - tapStart.t < 450 && ptrs.size === 0) {
        cam.vx = cam.vz = 0;
        const i = pickLot(e.clientX, e.clientY);
        if (i >= 0) hooks.onSelect(i);
      }
      if (ptrs.size === 0) tapStart = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); gesture = null; tapStart = null; });
    el.addEventListener('wheel', e => { e.preventDefault(); cam.dist *= Math.exp(e.deltaY * 0.0012); clampCam(); }, { passive: false });

    const ray = new T.Raycaster(), ndc = new T.Vector2(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3();
    function pickLot(cx, cy) {
      const r = el.getBoundingClientRect();
      ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      // Prefer ride meshes that are hit, then the ground position.
      const objs = lots.map(l => l && l.obj.g).filter(Boolean);
      const hits = ray.intersectObjects(objs, true);
      if (hits.length) {
        let o = hits[0].object;
        while (o.parent && !objs.includes(o)) o = o.parent;
        const i = lots.findIndex(l => l && l.obj.g === o);
        if (i >= 0) return i;
      }
      if (!ray.ray.intersectPlane(plane, hit)) return -1;
      const px = (hit.x + ox) / K, py = (hit.z + oz) / K;
      return L.plots.findIndex(p => px >= p.x - 6 && px <= p.x + p.w + 6 && py >= p.y - 6 && py <= p.y + p.h + 6);
    }

    // ---------- Per-frame ----------
    let t = 0, twinkleT = 0, phase = 0;
    const proj = new T.Vector3();
    function project(x, y, z) {
      proj.set(x, y, z).project(camera);
      if (proj.z > 1) return null;
      return { x: (proj.x + 1) / 2 * vw, y: (1 - proj.y) / 2 * vh };
    }

    const api = {
      el,
      setLayout(nl) {
        const first = !L;
        L = nl; W = L.W; H = L.H; ox = W * K / 2; oz = H * K / 2;
        buildStatic();
        resize();
        if (first) { cam.dist = fitDist(); cam.x = 0; cam.z = H * K / 2 - cam.dist * 0.3; }
        clampCam();
      },
      resize() { resize(); },
      fit() { cam.dist = fitDist(); clampCam(); },
      focus(i) {
        if (!L || !L.plots[i]) return;
        const [x, z] = toW(L.plots[i].cx, L.plots[i].cy);
        cam.tx = cam.dist < fitDist() * 0.9 ? x : 0; cam.tz = z;
      },
      // World position (map pixels) to screen, for overlay labels.
      toScreen(px, py, h) { if (!L) return null; const [x, z] = toW(px, py); return project(x, h || 0, z); },
      lotTop(i) { const l = lots[i]; return l ? l.obj.h * l.sc : 2; },
      frame(dt, S, view) {
        if (!L) return;
        t += dt;
        // camera easing toward a focused lot, and fling inertia
        if (cam.tx !== null) {
          cam.x += (cam.tx - cam.x) * Math.min(1, dt * 4); cam.z += (cam.tz - cam.z) * Math.min(1, dt * 4);
          if (Math.abs(cam.tx - cam.x) + Math.abs(cam.tz - cam.z) < 0.05) cam.tx = null;
        } else if (!ptrs.size && (cam.vx || cam.vz)) {
          cam.x += cam.vx * dt; cam.z += cam.vz * dt;
          const f = Math.pow(0.04, dt); cam.vx *= f; cam.vz *= f;
          if (Math.abs(cam.vx) + Math.abs(cam.vz) < 0.05) cam.vx = cam.vz = 0;
        }
        clampCam();
        placeCamera();
        syncLots(S);
        buildDecor(S);
        // rides
        for (let i = 0; i < lots.length; i++) {
          const lot = lots[i], r = S.rides[i];
          if (!lot) continue;
          const broken = r && r.broken > 0;
          const target = view.reduceMotion ? 0 : broken ? 0 : r && r.lvl ? 0.45 + 0.55 * Math.min(1, r.util || 0) : 1;
          lot.spd += (target - lot.spd) * Math.min(1, dt * (broken ? 3 : 0.8));
          lot.t += dt;
          let prog = 0;
          const b = S.builds.find(x => x.kind === 'ride' && x.i === i);
          if (b) prog = Math.max(0, Math.min(1, (view.now - b.start) / (b.end - b.start)));
          lot.obj.update(lot.t, dt, lot.spd, prog);
          if (lot.crane) lot.crane.update(lot.t);
          if (broken && Math.random() < dt * 6) {
            const p = smoke.find(s => s.life <= 0);
            if (p) { p.life = 2.2; p.s.visible = true; p.s.position.set(lot.cx + (Math.random() - 0.5) * 2, lot.obj.h * lot.sc * 0.6, lot.cz + (Math.random() - 0.5) * 2); p.s.scale.setScalar(1.2); }
          }
        }
        for (const p of smoke) {
          if (p.life <= 0) continue;
          p.life -= dt;
          p.s.position.y += dt * 1.6; p.s.scale.multiplyScalar(1 + dt * 0.6);
          p.s.material.opacity = Math.max(0, Math.min(0.7, p.life / 2.2 * 0.8));
          if (p.life <= 0) p.s.visible = false;
        }
        // selection ring
        const sl = lots[view.sel];
        selRing.visible = !!sl && view.showSel;
        if (sl) { selRing.position.x = sl.cx; selRing.position.z = sl.cz; selRing.scale.setScalar(sl.sc * (1 + Math.sin(t * 3) * 0.02)); selRing.material.opacity = 0.6 + Math.sin(t * 3) * 0.25; }
        // guests
        const n = Math.min(MAXG, view.sprites.length);
        for (let k = 0; k < n; k++) {
          const sp = view.sprites[k];
          const [x, z] = toW(sp.x, sp.y);
          const bob = view.reduceMotion ? 0 : Math.abs(Math.sin(t * 9 + sp.bob)) * (sp.path.length ? 0.12 : 0);
          _m.makeScale(1.6, 1.6, 1.6).setPosition(x, 0.56 + bob, z); bodies.setMatrixAt(k, _m);
          _m.makeScale(1.6, 1.6, 1.6).setPosition(x, 1.38 + bob, z); heads.setMatrixAt(k, _m);
          let c = shirtCache.get(sp.color); if (!c) { c = new T.Color(sp.color); shirtCache.set(sp.color, c); }
          bodies.setColorAt(k, c);
        }
        bodies.count = heads.count = n;
        bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
        if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
        // twinkling lights and fountains
        twinkleT += dt;
        if (twinkleT > 0.35 && !view.reduceMotion) { twinkleT = 0; phase++; for (const p of twinkles) twinkle(p, phase); }
        if (fountainPts) {
          const pa = fountainPts.geometry.attributes.position;
          let k = 0;
          for (const f of fountains) for (let j = 0; j < 12; j++, k++) {
            const ph = (t * 0.9 + j / 12) % 1, a = j * 0.52;
            pa.setXYZ(k, f.x + Math.cos(a) * ph * 1.0, f.y + Math.sin(ph * Math.PI) * 1.2, f.z + Math.sin(a) * ph * 1.0);
          }
          pa.needsUpdate = true;
        }
        renderer.render(scene, camera);
      },
    };
    return api;
  }

  window.Park3D = { create, supported() {
    try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch (e) { return false; }
  } };
})();
