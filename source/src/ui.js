// Endless Joyland: screen, park map and controls.
(function () {
  'use strict';
  const J = window.Joyland;
  const SAVE_KEY = 'endless-joyland-v2'; // v2 (timed construction, 3D) started every park fresh
  const MAX_SPRITES = 150;
  const rnd = Math.random;
  const $ = id => document.getElementById(id);
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let S = null;
  let tab = '';           // open sheet: 'rides', 'park', 'legacy', or '' when closed
  let sel = 0;            // selected ride / lot index
  let lastTick = performance.now();
  let lastSave = 0;

  // ---------- Saving ----------
  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) return J.migrate(JSON.parse(raw));
    } catch (e) { /* storage blocked or corrupt: start fresh */ }
    return null;
  }
  function save() {
    if (!S) return;
    S.lastSeen = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
  }
  function encodeSave() { return btoa(unescape(encodeURIComponent(JSON.stringify(S)))); }
  function decodeSave(text) { return J.migrate(JSON.parse(decodeURIComponent(escape(atob(text.trim()))))); }

  // ---------- Toasts and ticker ----------
  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3200);
    while ($('toasts').children.length > 2) $('toasts').firstChild.remove();
  }
  const ticker = [];
  let lastTickerAt = 0;
  function say(html, force) {
    const now = performance.now();
    if (!force && now - lastTickerAt < 1600) return;
    lastTickerAt = now;
    ticker.unshift(html);
    ticker.length = Math.min(ticker.length, window.innerWidth >= 900 ? 3 : 1);
    $('ticker').innerHTML = ticker.map(t => '<div>' + t + '</div>').join('');
  }
  const GROUP_NAMES = {
    1: ['A solo thrill-seeker', 'A coaster fanatic', 'A curious tourist', 'A teenager skipping chores', 'A local on lunch break'],
    2: ['A couple', 'Two best friends', 'A parent and kid', 'A pair of grandparents', 'Two coworkers'],
    3: ['Three friends', 'A small family', 'A trio of cousins'],
    4: ['A family of four', 'Four roommates', 'A double date'],
    5: ['A family of five', 'A birthday party', 'A gaggle of teens'],
    6: ['A school group', 'A scout troop', 'A bachelorette party'],
  };
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  function favouriteRide(snap) {
    let x = rnd() * snap.appeal;
    for (let i = 0; i < snap.stats.length; i++) {
      const st = snap.stats[i];
      if (!st) continue;
      if ((x -= st.fun) <= 0) return J.rideDef(i).name;
    }
    return null;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- Park map ----------
  const mapEl = $('map');
  const scroller = $('mapscroll');
  const canvas = $('park');
  const ctx = canvas.getContext('2d');
  let L = null;
  // The 3D park (three.js). Without WebGL the flat map below is drawn instead.
  let P3 = null;
  try {
    if (window.Park3D && window.Park3D.supported()) P3 = window.Park3D.create(scroller, {
      def: i => J.rideDef(i),
      hue: i => rideHue(i),
      onSelect: i => { sel = i; setTab('rides'); },
      onBackground: () => { if (sheetOpen) closeSheet(); },
      decor: s => J.decorView(s),
      sheetOpen: () => sheetOpen && window.innerWidth < 900,
    });
  } catch (e) { P3 = null; }
  if (P3) mapEl.classList.add('three');
  let sprites = [];
  let popups = [];
  const rideAcc = [];
  let rideAccT = 0;
  const SHIRTS = ['#ff5d73', '#ffd54a', '#4fb3ff', '#a98bff', '#4fe0a6', '#ff9a3c', '#ff7ccf', '#ffffff', '#7fe3ff'];
  const BULBS = ['#ffc94a', '#ff4d6d', '#4fb3ff', '#3fd9a2', '#ffffff'];
  const C = {
    grass: '#1c4a3b', grass2: '#22584a', grassDark: '#163d31', path: '#4b4566', pathEdge: '#5b5478', ink: '#f7f1e3',
    muted: '#a9b1d3', gold: '#ffc94a', candy: '#ff4d6d', bad: '#ff5d6c', label: 'rgba(14,18,40,.78)', tree: '#2c7a5c', tree2: '#205e47',
  };

  function builtCount() { return S.rides.filter(r => r.lvl).length; }

  function layout() {
    // In 3D the layout is a fixed-size world in map pixels (10 px = 1 unit); in 2D it fits the screen width.
    const cols3 = (scroller.clientWidth || 360) >= 640 ? 4 : 3;
    const W = P3 ? cols3 * 120 + (cols3 - 1) * 34 + 60 : (scroller.clientWidth || 360);
    const viewH = P3 ? 0 : (scroller.clientHeight || 400);
    const cols = P3 ? cols3 : Math.max(3, Math.min(5, Math.floor(W / 140)));
    const pad = P3 ? 30 : 18, gap = P3 ? 34 : 20, top = P3 ? 34 : 40;
    const plotW = P3 ? 120 : (W - pad * 2 - gap * (cols - 1)) / cols;
    const plotH = P3 ? 120 : Math.min(plotW * 0.95, 150);
    const slots = S.rides.length;
    const rows = Math.max(2, Math.ceil(slots / cols));
    const gateH = P3 ? 110 : 84;
    const H = Math.max(viewH, Math.round(top + rows * (plotH + gap) + gateH));
    const plots = [];
    for (let i = 0; i < slots; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const x = pad + c * (plotW + gap), y = top + r * (plotH + gap);
      plots.push({ x, y, w: plotW, h: plotH, cx: x + plotW / 2, cy: y + plotH / 2, qy: y + plotH + gap / 2 });
    }
    const vcorr = [pad / 2];
    for (let c = 1; c < cols; c++) vcorr.push(pad + c * (plotW + gap) - gap / 2);
    vcorr.push(W - pad / 2);
    const hcorr = [top - gap / 2];
    for (let r = 1; r <= rows; r++) hcorr.push(top + r * (plotH + gap) - gap / 2);
    const bottomY = hcorr[hcorr.length - 1];
    const gate = { x: W / 2, y: H - 30 };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // The canvas is the whole map in 2D, and a transparent label layer over the 3D view.
    const cw = P3 ? scroller.clientWidth || 360 : W, ch = P3 ? scroller.clientHeight || 400 : H;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.height = ch + 'px';
    }
    // Decorative trees on the lawn below the rides, placed the same way every time.
    const trees = [];
    let seed = 7;
    const r01 = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 14; k++) {
      const x = r01() * W, y = bottomY + 14 + r01() * Math.max(10, H - bottomY - 40);
      if (Math.abs(x - W / 2) < 70) continue;
      trees.push({ x, y, r: 9 + r01() * 9 });
    }
    // Spots for decorations: empty lots in the grid first, then the lawn by the entrance.
    const spots = [];
    for (let k = slots; k < rows * cols; k++) {
      const r = Math.floor(k / cols), c = k % cols;
      const x = pad + c * (plotW + gap), y = top + r * (plotH + gap);
      for (const [fx, fy] of [[0.3, 0.3], [0.7, 0.7], [0.7, 0.3], [0.3, 0.7]]) spots.push([x + plotW * fx, y + plotH * fy]);
    }
    for (let y = bottomY + 24; y < H - 24; y += 34)
      for (let x = 24; x < W - 20; x += 40) if (Math.abs(x - W / 2) > 78) spots.push([x + ((y / 34) % 2) * 12, y]);
    const lampSpots = [];
    for (const y of hcorr) for (const x of vcorr) lampSpots.push([x, y]);
    L = { W, H, cols, pad, gap, top, plotW, plotH, rows, plots, vcorr, hcorr, gate, dpr, slots, bottomY, trees, viewH, spots, lampSpots, cw, ch };
    for (const sp of sprites) { sp.x = Math.min(sp.x, W); sp.y = Math.min(sp.y, H); }
    if (P3) P3.setLayout(L);
  }

  function routeTo(sp, tx, ty) {
    const mid = (sp.x + tx) / 2;
    let vx = L.vcorr[0];
    for (const v of L.vcorr) if (Math.abs(v - mid) < Math.abs(vx - mid)) vx = v;
    vx += (rnd() - 0.5) * 8;
    sp.path = [[vx, sp.y], [vx, ty], [tx, ty]];
  }
  function sendToRide(sp) {
    const built = [];
    for (let i = 0; i < S.rides.length; i++) if (S.rides[i].lvl) built.push(i);
    if (!built.length || !L.plots[built[built.length - 1]]) return leave(sp);
    const snap = lastSnap;
    let i = built[0];
    if (snap && snap.appeal) {
      let x = rnd() * snap.appeal;
      for (const b of built) { const f = snap.stats[b] ? snap.stats[b].fun : 0; if ((x -= f) <= 0) { i = b; break; } }
    }
    const p = L.plots[i];
    sp.state = 'walk';
    sp.ride = i;
    sp.speed = 38 + rnd() * 26;
    routeTo(sp, p.x + 8 + rnd() * (p.w - 16), p.qy + (rnd() - 0.5) * 7);
  }
  function leave(sp) {
    sp.state = 'leave';
    routeTo(sp, L.gate.x + (rnd() - 0.5) * 20, L.bottomY);
    sp.path.push([L.gate.x + (rnd() - 0.5) * 16, L.H + 10]);
  }
  function spawn(n) {
    for (let k = 0; k < n; k++) {
      if (sprites.length >= MAX_SPRITES + 20) return;
      const sp = { x: L.gate.x + (rnd() - 0.5) * 16, y: L.H + 4, color: pick(SHIRTS), speed: 90 + rnd() * 40, wait: 0, state: 'walk', bob: rnd() * 6, after: 'ride' };
      sp.path = [[sp.x, L.bottomY + (rnd() - 0.5) * 6]];
      sprites.push(sp);
    }
  }
  function spriteTarget() { return Math.min(MAX_SPRITES, Math.round(S.inPark)); }

  function updateSprites(dt) {
    const target = spriteTarget();
    const active = sprites.filter(s => s.state !== 'leave').length;
    if (active < target - 3) spawn(Math.min(3, target - active));
    if (active > target + 2) {
      let extra = active - target;
      for (const sp of sprites) { if (extra <= 0) break; if (sp.state === 'queue') { leave(sp); extra--; } }
    }
    for (const sp of sprites) {
      if (sp.path.length) {
        const [tx, ty] = sp.path[0];
        const dx = tx - sp.x, dy = ty - sp.y, d = Math.hypot(dx, dy);
        const stepLen = sp.speed * dt * (P3 ? 0.45 : 1);
        if (d <= stepLen) { sp.x = tx; sp.y = ty; sp.path.shift(); }
        else { sp.x += dx / d * stepLen; sp.y += dy / d * stepLen; }
        if (!sp.path.length) {
          if (sp.state === 'leave') sp.gone = true;
          else if (sp.after === 'ride') { sp.after = null; sendToRide(sp); }
          else { sp.state = 'queue'; sp.wait = 3 + rnd() * 7; }
        }
      } else if (sp.state === 'queue') {
        sp.wait -= dt;
        if (sp.wait <= 0) { if (rnd() < 0.12) leave(sp); else sendToRide(sp); }
      }
    }
    sprites = sprites.filter(s => !s.gone);
  }

  function rideHue(i) { return (i * 47 + 350) % 360; }
  function rideFill(i, l) { return `hsl(${rideHue(i)} 70% ${l || 58}%)`; }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function stringLights(y, x0, x1, phase) {
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const span = 46;
    for (let x = x0; x <= x1; x += 2) {
      const s = ((x - x0) % span) / span;
      const yy = y + Math.sin(s * Math.PI) * 5;
      if (x === x0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
    let k = 0;
    for (let x = x0 + 6; x < x1; x += 11, k++) {
      const s = ((x - x0) % span) / span;
      const yy = y + Math.sin(s * Math.PI) * 5 + 2;
      const on = reduceMotion || ((k + Math.floor(phase * 2)) % 5 !== 0);
      ctx.fillStyle = BULBS[k % BULBS.length];
      ctx.globalAlpha = on ? 0.95 : 0.35;
      ctx.beginPath(); ctx.arc(x, yy, 1.9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawDecor() {
    const d = J.decorView(S);
    // Lamp posts at path crossings
    const nl = Math.min(d.lamps, L.lampSpots.length);
    for (let k = 0; k < nl; k++) {
      const [x, y] = L.lampSpots[(k * 7) % L.lampSpots.length];
      const glow = ctx.createRadialGradient(x, y - 8, 1, x, y - 8, 18);
      glow.addColorStop(0, 'rgba(255,214,120,.55)'); glow.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y - 8, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2b3157'; ctx.fillRect(x - 1, y - 8, 2, 10);
      ctx.fillStyle = '#ffe3a0'; ctx.beginPath(); ctx.arc(x, y - 9, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    const items = [];
    for (let k = 0; k < Math.min(d.fountain, 6); k++) items.push('fountain');
    for (let k = 0; k < Math.min(d.statue, 6); k++) items.push('statue');
    for (let k = 0; k < Math.min(d.flowers, 40); k++) items.push('flowers');
    const n = Math.min(items.length, L.spots.length);
    for (let k = 0; k < n; k++) {
      const [x, y] = L.spots[k];
      const kind = items[k];
      if (kind === 'fountain') {
        ctx.fillStyle = '#7d84ad'; ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3d9be0'; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
        for (let j = 0; j < 6; j++) {
          const a = j / 6 * Math.PI * 2 + animT * 1.5, r = 3 + ((animT * 6 + j) % 5);
          ctx.fillStyle = 'rgba(220,240,255,.85)'; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, 1.3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#e8f6ff'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
      } else if (kind === 'statue') {
        ctx.fillStyle = '#6b6f94'; ctx.fillRect(x - 7, y - 2, 14, 9);
        ctx.save(); ctx.shadowColor = C.gold; ctx.shadowBlur = 10;
        ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(x, y - 9, 6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x - 4, y - 15, 2.4, 0, Math.PI * 2); ctx.arc(x + 4, y - 15, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = '#2f6b4f'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
        const cols = ['#ff7ccf', '#ffd54a', '#ff5d73', '#a98bff', '#ffffff'];
        for (let j = 0; j < 5; j++) {
          const a = j / 5 * Math.PI * 2 + k;
          ctx.fillStyle = cols[(j + k) % cols.length];
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 2, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  // Guest thoughts: short bubbles that hint at what the park needs.
  let bubbles = [];
  let bubbleT = 0;
  function thoughtFor(sp) {
    const g = lastSnap ? lastSnap.g : null;
    const r = sp.ride !== undefined ? S.rides[sp.ride] : null;
    const name = sp.ride !== undefined ? J.rideDef(sp.ride).name : 'ride';
    const problems = [];
    if (r && r.broken > 0) problems.push(`The ${name} broke down!`, 'Aww, it stopped working…', 'Fix the ride please!');
    if (r && g && (r.wait || 0) > g.tolerance) problems.push('This line is forever!', `The ${name} needs more seats`, 'Ugh, still waiting…');
    if (parkFull) problems.push('So crowded in here!');
    if (S.priceRatio > 0.95) problems.push('Entry was so pricey…');
    if (S.park.food === 0 && S.time > 120) problems.push("I'm hungry!", 'Where are the snacks?');
    if (problems.length && rnd() < 0.75) return { text: pick(problems), bad: true };
    const happy = [`Best ${name} ever!`, 'Wheee!', 'Again! Again!', 'I love this park!', `The ${name} rocks!`, 'What a view!'];
    if (S.park.gardens) happy.push('Such a pretty park!');
    if (r && r.mgr) happy.push('The staff here are great!');
    return { text: pick(happy), bad: false };
  }
  function updateBubbles(dt) {
    for (const b of bubbles) b.t += dt;
    bubbles = bubbles.filter(b => b.t < 3.2 && !b.sp.gone);
    bubbleT += dt;
    if (bubbleT < 2.4 || bubbles.length >= 2) return;
    bubbleT = 0;
    const cands = sprites.filter(sp => sp.state === 'queue' && !bubbles.some(b => b.sp === sp));
    if (!cands.length) return;
    const sp = pick(cands.slice(0, 200));
    const th = thoughtFor(sp);
    bubbles.push({ sp, text: th.text, bad: th.bad, t: 0 });
  }

  let animT = 0;
  function draw(dt) {
    if (!L) return;
    if (P3) return draw3d(dt);
    animT += dt;
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    const { W, H } = L;
    // Lawn, then a path network around the lots.
    ctx.fillStyle = C.grass;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.path;
    for (const y of L.hcorr) ctx.fillRect(0, y - L.gap / 2 + 3, W, L.gap - 6);
    for (const x of L.vcorr) ctx.fillRect(Math.max(0, x - L.gap / 2 + 3), L.hcorr[0], L.gap - 6, L.bottomY - L.hcorr[0]);
    ctx.fillRect(L.gate.x - 22, L.bottomY, 44, H - L.bottomY);
    // Trees on the lower lawn
    for (const t of L.trees) {
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.ellipse(t.x + 3, t.y + t.r * 0.7, t.r, t.r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.tree2;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.tree;
      ctx.beginPath(); ctx.arc(t.x - t.r * 0.25, t.y - t.r * 0.25, t.r * 0.62, 0, Math.PI * 2); ctx.fill();
    }
    drawDecor();
    // String lights over the paths
    for (const y of L.hcorr) stringLights(y - 4, 4, W - 4, animT);

    const snap = lastSnap;
    const g = snap ? snap.g : null;
    for (let i = 0; i < L.plots.length; i++) {
      const p = L.plots[i], r = S.rides[i], def = J.rideDef(i);
      const isSel = tab === 'rides' && i === sel;
      if (r && r.lvl) {
        ctx.fillStyle = C.grass2;
        roundRect(p.x, p.y, p.w, p.h, 14); ctx.fill();
        if (isSel) { ctx.save(); ctx.shadowColor = C.gold; ctx.shadowBlur = 16; ctx.strokeStyle = C.gold; ctx.lineWidth = 2.5; roundRect(p.x, p.y, p.w, p.h, 14); ctx.stroke(); ctx.restore(); }
        const rad = Math.min(p.w, p.h) * 0.31;
        const cy = p.y + p.h * 0.42;
        const busy = Math.min(1, r.util || 0);
        // Glowing ride pad
        const grd = ctx.createRadialGradient(p.cx, cy - rad * 0.3, rad * 0.2, p.cx, cy, rad);
        grd.addColorStop(0, rideFill(i, 72));
        grd.addColorStop(1, rideFill(i, 44));
        ctx.save();
        ctx.shadowColor = rideFill(i, 60);
        ctx.shadowBlur = 8 + busy * 14;
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(p.cx, cy, rad, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // Bulbs around the pad
        const nb = 12;
        for (let k = 0; k < nb; k++) {
          const a = k / nb * Math.PI * 2 + (reduceMotion ? 0 : animT * (0.3 + busy));
          ctx.fillStyle = k % 2 ? '#fff6d8' : C.gold;
          ctx.beginPath(); ctx.arc(p.cx + Math.cos(a) * (rad + 4), cy + Math.sin(a) * (rad + 4), 1.6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.save();
        ctx.translate(p.cx, cy);
        if (!reduceMotion) ctx.rotate(Math.sin(animT * (1.5 + busy * 3) + i) * 0.16 * (0.3 + busy));
        ctx.font = `${Math.round(rad * 1.1)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(def.icon, 0, 2);
        ctx.restore();
        // Name pill
        ctx.font = '800 11px Figtree, -apple-system, system-ui, sans-serif';
        const lvTxt = String(r.lvl);
        const lvW = ctx.measureText(lvTxt).width;
        const label = fitText(def.name, p.w - 26 - lvW);
        const nameW = ctx.measureText(label).width;
        const lw = nameW + lvW + 26;
        ctx.fillStyle = C.label;
        roundRect(p.cx - lw / 2, p.y + p.h - 22, lw, 17, 8.5); ctx.fill();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = C.ink;
        ctx.textAlign = 'left';
        ctx.fillText(label, p.cx - lw / 2 + 9, p.y + p.h - 13);
        ctx.fillStyle = C.gold;
        ctx.fillText(lvTxt, p.cx - lw / 2 + 17 + nameW, p.y + p.h - 13);
        if (r.mgr) { ctx.font = '12px sans-serif'; ctx.fillStyle = C.gold; ctx.fillText('★'.repeat(r.mgr), p.x + 7, p.y + 14); }
        ctx.textBaseline = 'alphabetic';
        // Queue meter
        if (g) {
          const frac = Math.min(1, (r.wait || 0) / (g.tolerance * 3));
          if (frac > 0.01) {
            ctx.fillStyle = (r.wait || 0) > g.tolerance ? C.bad : C.gold;
            roundRect(p.x + 12, p.y + 5, (p.w - 24) * frac, 4, 2); ctx.fill();
          }
        }
        // Upgrade affordable badge
        if (S.cash >= J.levelCost(S, i, 1)) {
          const bx = p.x + p.w - 10, by = p.y + 12;
          ctx.fillStyle = C.gold;
          ctx.beginPath(); ctx.arc(bx, by, 8, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#2a1c00';
          ctx.beginPath(); ctx.moveTo(bx, by - 4.5); ctx.lineTo(bx + 4, by + 1); ctx.lineTo(bx + 1.5, by + 1); ctx.lineTo(bx + 1.5, by + 4.5); ctx.lineTo(bx - 1.5, by + 4.5); ctx.lineTo(bx - 1.5, by + 1); ctx.lineTo(bx - 4, by + 1); ctx.closePath(); ctx.fill();
        }
      } else {
        const cost = J.levelCost(S, i, 1);
        const can = S.cash >= cost;
        ctx.fillStyle = 'rgba(0,0,0,.18)';
        roundRect(p.x, p.y, p.w, p.h, 14); ctx.fill();
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = isSel ? 2.5 : 1.5;
        ctx.strokeStyle = can || isSel ? C.gold : 'rgba(255,255,255,.35)';
        if (can && !reduceMotion) ctx.lineDashOffset = -animT * 12;
        roundRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2, 14); ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = can ? C.gold : 'rgba(255,255,255,.55)';
        ctx.font = '28px Bungee, Impact, sans-serif';
        ctx.fillText('+', p.cx, p.cy - 14);
        ctx.font = '800 11px Figtree, -apple-system, system-ui, sans-serif';
        ctx.fillText(fitText(def.name, p.w - 10), p.cx, p.cy + 12);
        ctx.font = '700 11px Figtree, -apple-system, system-ui, sans-serif';
        ctx.fillText(J.money(cost), p.cx, p.cy + 27);
        ctx.textBaseline = 'alphabetic';
      }
    }
    // Entrance arch with bulbs
    const gx = L.gate.x, gy = H - 58;
    ctx.fillStyle = C.candy;
    roundRect(gx - 44, gy, 9, 50, 3); ctx.fill();
    roundRect(gx + 35, gy, 9, 50, 3); ctx.fill();
    ctx.save(); ctx.shadowColor = C.candy; ctx.shadowBlur = 14;
    roundRect(gx - 60, gy - 22, 120, 24, 8); ctx.fill(); ctx.restore();
    for (let k = 0; k < 11; k++) {
      ctx.fillStyle = (k + Math.floor(animT * 3)) % 2 && !reduceMotion ? '#fff6d8' : C.gold;
      ctx.beginPath(); ctx.arc(gx - 54 + k * 10.8, gy - 25, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.font = '12px Bungee, Impact, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('JOYLAND', gx, gy - 10);
    ctx.textBaseline = 'alphabetic';
    // Guests
    for (const sp of sprites) {
      const bob = reduceMotion ? 0 : Math.sin(animT * 9 + sp.bob) * (sp.path.length ? 0.8 : 0.2);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.ellipse(sp.x + 1, sp.y + 3.5, 3.4, 1.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = sp.color;
      ctx.beginPath(); ctx.arc(sp.x, sp.y + bob, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f3d3b5';
      ctx.beginPath(); ctx.arc(sp.x, sp.y + bob - 3.4, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    // Guest thoughts
    ctx.font = '700 11px Figtree, -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const b of bubbles) {
      const a = Math.min(1, b.t * 4, (3.2 - b.t) * 2);
      if (a <= 0) continue;
      const w = ctx.measureText(b.text).width + 14;
      const x = Math.max(4, Math.min(W - w - 4, b.sp.x - w / 2)), y = b.sp.y - 30;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fff7e6';
      roundRect(x, y, w, 19, 9.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(b.sp.x - 4, y + 18); ctx.lineTo(b.sp.x, y + 25); ctx.lineTo(b.sp.x + 4, y + 18); ctx.fill();
      ctx.fillStyle = b.bad ? '#b8243f' : '#1a2246';
      ctx.textAlign = 'left';
      ctx.fillText(b.text, x + 7, y + 10);
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
    // Money popups
    ctx.font = '800 12px Figtree, -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 1.4);
      ctx.fillStyle = C.gold;
      ctx.fillText(p.text, p.x, p.y - p.t * 24);
    }
    ctx.globalAlpha = 1;
  }
  // 3D view: render the scene, then draw names, timers, thoughts and money on the label layer above it.
  function buildOf(i, kind) { return S.builds.find(b => b.i === i && (!kind || b.kind === kind)); }
  function timeLeft(b) { return Math.max(0, (b.end - J.now()) / 1000); }
  function pill(x, y, parts, opts) {
    // parts: [[text, color], ...] laid out left to right inside one rounded label
    ctx.font = '800 11px Figtree, -apple-system, system-ui, sans-serif';
    let w = 16;
    const ws = parts.map(p => ctx.measureText(p[0]).width);
    w += ws.reduce((a, b) => a + b, 0) + (parts.length - 1) * 5;
    const h = 18, x0 = Math.round(x - w / 2), y0 = Math.round(y - h);
    ctx.fillStyle = opts && opts.bg || C.label;
    roundRect(x0, y0, w, h, 9); ctx.fill();
    if (opts && opts.ring) { ctx.strokeStyle = opts.ring; ctx.lineWidth = 1.5; roundRect(x0, y0, w, h, 9); ctx.stroke(); }
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    let cx = x0 + 8;
    parts.forEach((p, k) => { ctx.fillStyle = p[1]; ctx.fillText(p[0], cx, y0 + h / 2 + 0.5); cx += ws[k] + 5; });
    ctx.textBaseline = 'alphabetic';
    return { x0, y0, w, h };
  }
  function draw3d(dt) {
    animT += dt;
    P3.frame(dt, S, { sel, showSel: tab === 'rides', sprites, reduceMotion, now: J.now() });
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.clearRect(0, 0, L.cw, L.ch);
    const g = lastSnap ? lastSnap.g : null;
    for (let i = 0; i < L.plots.length; i++) {
      const p = L.plots[i], r = S.rides[i], def = J.rideDef(i);
      const at = P3.toScreen(p.cx, p.y + p.h + 6, 0);
      if (!at || at.x < -80 || at.x > L.cw + 80 || at.y < -20 || at.y > L.ch + 40) continue;
      const rb = buildOf(i, 'ride');
      const l0 = P3.toScreen(p.x, p.y + p.h + 6, 0), l1 = P3.toScreen(p.x + p.w, p.y + p.h + 6, 0);
      const room = l0 && l1 ? Math.max(40, (l1.x - l0.x) * 1.15) : 160;
      ctx.font = '800 11px Figtree, -apple-system, system-ui, sans-serif';
      if (r && r.lvl) {
        const extra = (r.mgr ? 12 * r.mgr + 5 : 0) + (r.broken > 0 ? 62 : buildOf(i) ? 70 : 0);
        const parts = [[fitText(def.name, room - 30 - extra - ctx.measureText(String(r.lvl)).width), C.ink], [String(r.lvl), C.gold]];
        if (r.mgr) parts.push(['★'.repeat(r.mgr), C.gold]);
        const up = buildOf(i);
        if (r.broken > 0) parts.push(['⚠ Broken', C.bad]);
        else if (up) parts.push(['🔧 ' + J.duration(timeLeft(up)), '#9fd8ff']);
        const box = pill(at.x, at.y, parts, { ring: i === sel && tab === 'rides' ? C.gold : r.broken > 0 ? C.bad : null });
        if (g) {
          const frac = Math.min(1, (r.wait || 0) / (g.tolerance * 3));
          if (frac > 0.02) { ctx.fillStyle = (r.wait || 0) > g.tolerance ? C.bad : C.gold; roundRect(box.x0 + 6, box.y0 + box.h + 2, (box.w - 12) * frac, 3, 1.5); ctx.fill(); }
        }
        if (S.cash >= J.levelCost(S, i, 1)) {
          const bx = box.x0 + box.w + 8, by = box.y0 + box.h / 2;
          ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#2a1c00'; ctx.beginPath(); ctx.moveTo(bx, by - 4); ctx.lineTo(bx + 3.5, by + 0.5); ctx.lineTo(bx + 1.3, by + 0.5); ctx.lineTo(bx + 1.3, by + 4); ctx.lineTo(bx - 1.3, by + 4); ctx.lineTo(bx - 1.3, by + 0.5); ctx.lineTo(bx - 3.5, by + 0.5); ctx.closePath(); ctx.fill();
        }
      } else if (rb) {
        const left = timeLeft(rb), frac = 1 - left / Math.max(1, (rb.end - rb.start) / 1000);
        const box = pill(at.x, at.y, [['🏗 ' + fitText(def.name, room - 90), C.ink], [J.duration(left), '#9fd8ff']], { ring: i === sel && tab === 'rides' ? C.gold : null });
        ctx.fillStyle = 'rgba(255,255,255,.18)'; roundRect(box.x0 + 6, box.y0 + box.h + 2, box.w - 12, 4, 2); ctx.fill();
        ctx.fillStyle = '#9fd8ff'; roundRect(box.x0 + 6, box.y0 + box.h + 2, (box.w - 12) * Math.max(0.03, frac), 4, 2); ctx.fill();
      } else {
        const cost = J.levelCost(S, i, 1), can = S.cash >= cost && J.canBuild(S);
        pill(at.x, at.y, [['+ ' + fitText(def.name, room - 70), can ? C.gold : C.ink], [J.money(cost), can ? C.gold : C.muted]], { ring: i === sel && tab === 'rides' ? C.gold : can ? 'rgba(255,201,74,.5)' : null });
      }
    }
    // Guest thoughts
    ctx.font = '700 11px Figtree, -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const b of bubbles) {
      const a = Math.min(1, b.t * 4, (3.2 - b.t) * 2);
      const at = P3.toScreen(b.sp.x, b.sp.y, 1.3);
      if (a <= 0 || !at) continue;
      const w = ctx.measureText(b.text).width + 14;
      const x = Math.max(4, Math.min(L.cw - w - 4, at.x - w / 2)), y = at.y - 30;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fff7e6';
      roundRect(x, y, w, 19, 9.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(at.x - 4, y + 18); ctx.lineTo(at.x, y + 25); ctx.lineTo(at.x + 4, y + 18); ctx.fill();
      ctx.fillStyle = b.bad ? '#b8243f' : '#1a2246';
      ctx.textAlign = 'left';
      ctx.fillText(b.text, x + 7, y + 10);
    }
    ctx.globalAlpha = 1;
    // Money popups rise above the rides
    ctx.font = '800 12px Figtree, -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (const p of popups) {
      const at = P3.toScreen(p.x, p.y, 3 + p.t * 2);
      if (!at) continue;
      ctx.globalAlpha = Math.max(0, 1 - p.t / 1.4);
      ctx.fillStyle = C.gold;
      ctx.fillText(p.text, at.x, at.y);
    }
    ctx.globalAlpha = 1;
  }
  const fitCache = new Map();
  function fitText(t, w) {
    const key = t + '|' + Math.round(w) + '|' + ctx.font;
    if (fitCache.has(key)) return fitCache.get(key);
    if (fitCache.size > 600) fitCache.clear();
    let s = t;
    while (s.length > 3 && ctx.measureText(s).width > w) s = s.slice(0, -2) + '…';
    if (s !== t && !s.endsWith('…')) s += '…';
    fitCache.set(key, s);
    return s;
  }

  canvas.addEventListener('click', e => {
    if (!L) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const i = L.plots.findIndex(p => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h);
    if (i < 0) return;
    sel = i;
    setTab('rides');
  });
  function scrollToSel() {
    if (!L || !L.plots[sel]) return;
    if (P3) { P3.focus(sel); return; }
    const p = L.plots[sel];
    const top = scroller.scrollTop, h = scroller.clientHeight;
    if (p.y < top + 30 || p.y + p.h > top + h - 50) scroller.scrollTo({ top: Math.max(0, p.cy - h / 2), behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  // ---------- Sound (synthesised with Web Audio, no files) ----------
  const SOUND_KEY = 'endless-joyland-sound';
  const Sound = (function () {
    let ac = null, master = null, on = true, noiseBuf = null;
    try { on = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { /* default on */ }
    function ctx() {
      if (!ac) {
        const A = window.AudioContext || window.webkitAudioContext;
        if (!A) return null;
        try { ac = new A(); } catch (e) { return null; }
        master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return ac;
    }
    function tone(f, t0, dur, type, vol, f2) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f, t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.03);
    }
    function noise(t0, dur, vol, freq) {
      if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1; }
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq || 1800; f.Q.value = 0.8;
      g.gain.setValueAtTime(vol || 0.3, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(master); src.start(t0); src.stop(t0 + dur + 0.02);
    }
    const arp = (t, notes, step, dur, type, vol) => notes.forEach((f, k) => tone(f, t + k * step, dur, type, vol));
    const SFX = {
      tap: (t, p) => { tone(380 + p * 500, t, 0.09, 'triangle', 0.18, 520 + p * 700); noise(t, 0.04, 0.08, 3000); },
      coin: t => { tone(988, t, 0.07, 'square', 0.05); tone(1319, t + 0.06, 0.22, 'square', 0.05); },
      level: t => arp(t, [523, 659, 784], 0.05, 0.16, 'triangle', 0.16),
      milestone: t => { arp(t, [523, 659, 784, 1047, 1319], 0.06, 0.22, 'triangle', 0.17); tone(1047, t + 0.3, 0.5, 'sine', 0.08); },
      open: t => { arp(t, [392, 523, 659, 784], 0.11, 0.25, 'square', 0.07); [523, 659, 784, 1047].forEach(f => tone(f, t + 0.46, 0.9, 'triangle', 0.1)); noise(t + 0.46, 0.6, 0.12, 5000); },
      goal: t => { tone(784, t, 0.18, 'sine', 0.2); tone(1175, t + 0.1, 0.4, 'sine', 0.18); },
      done: t => { tone(659, t, 0.12, 'triangle', 0.15); tone(988, t + 0.08, 0.28, 'triangle', 0.15); },
      pop: t => { noise(t, 0.12, 0.45, 2200); tone(500, t, 0.18, 'sine', 0.15, 1400); arp(t + 0.1, [1047, 1319, 1568], 0.05, 0.15, 'triangle', 0.1); },
      trophy: t => { arp(t, [659, 831, 988, 1319], 0.08, 0.3, 'triangle', 0.15); tone(1319, t + 0.32, 0.8, 'sine', 0.1); noise(t + 0.3, 0.5, 0.08, 6000); },
      breakdown: t => { tone(220, t, 0.35, 'sawtooth', 0.08, 70); noise(t, 0.25, 0.15, 400); },
      parade: t => { const m = [523, 523, 659, 784, 659, 784, 1047]; m.forEach((f, k) => tone(f, t + k * 0.12, 0.16, 'square', 0.07)); [262, 330, 392].forEach(f => tone(f, t + 0.84, 0.9, 'triangle', 0.12)); noise(t + 0.84, 0.7, 0.15, 5000); },
      gift: t => { arp(t, [784, 988, 1175, 1568, 1976], 0.07, 0.25, 'sine', 0.14); },
      event: t => { tone(880, t, 0.15, 'sine', 0.12); tone(1320, t + 0.12, 0.3, 'sine', 0.1); },
    };
    return {
      get on() { return on; },
      set(v) { on = v; try { localStorage.setItem(SOUND_KEY, v ? 'on' : 'off'); } catch (e) { /* ignore */ } if (v) ctx(); },
      unlock() { if (on) ctx(); },
      play(name, arg) {
        if (!on || document.hidden) return;
        const c = ctx();
        if (!c || !SFX[name]) return;
        try { SFX[name](c.currentTime + 0.01, arg || 0); } catch (e) { /* audio glitch: stay silent */ }
      },
    };
  })();
  // iOS only lets audio start from a touch, so wake the audio on the first one.
  let touched = false; // browsers refuse vibration before the first touch
  document.addEventListener('pointerdown', () => { touched = true; Sound.unlock(); }, { once: true, capture: true });
  document.addEventListener('touchend', () => Sound.unlock(), { once: true, capture: true });

  // A light tap on the phone: vibrate where supported; on iPhone, toggling a hidden switch gives a haptic tick.
  let hapticEl = null;
  function buzz(ms) {
    try {
      if (!touched) return;
      if (navigator.vibrate) { navigator.vibrate(ms || 10); return; }
      if (!hapticEl) {
        hapticEl = document.createElement('label');
        hapticEl.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
        hapticEl.setAttribute('aria-hidden', 'true');
        const inp = document.createElement('input'); inp.type = 'checkbox'; inp.setAttribute('switch', ''); inp.tabIndex = -1;
        hapticEl.appendChild(inp); document.body.appendChild(hapticEl);
      }
      hapticEl.click();
    } catch (e) { /* no haptics */ }
  }

  // ---------- Effects layer: confetti, floating numbers, banners ----------
  const fxCanvas = $('fx'), fx = fxCanvas.getContext('2d');
  const CONFETTI = ['#ffc94a', '#ff4d6d', '#4fb3ff', '#3fd9a2', '#ffffff', '#a98bff', '#ff9a3c'];
  let parts = [], floaters = [], fxW = 0, fxH = 0, fxDpr = 1;
  function fxResize() {
    fxDpr = Math.min(window.devicePixelRatio || 1, 2);
    fxW = window.innerWidth; fxH = window.innerHeight;
    fxCanvas.width = Math.round(fxW * fxDpr); fxCanvas.height = Math.round(fxH * fxDpr);
  }
  fxResize();
  window.addEventListener('resize', fxResize);
  function confetti(x, y, n, power) {
    if (reduceMotion) n = Math.min(n, 8);
    power = power || 260;
    for (let k = 0; k < n && parts.length < 500; k++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2, v = power * (0.4 + rnd() * 0.8);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.4 + rnd() * 1.2, t: 0, c: pick(CONFETTI), w: 4 + rnd() * 4, h: 2 + rnd() * 3, r: rnd() * 6, vr: (rnd() - 0.5) * 14 });
    }
  }
  function confettiRain(n) {
    if (reduceMotion) n = Math.min(n, 10);
    for (let k = 0; k < n && parts.length < 500; k++)
      parts.push({ x: rnd() * fxW, y: -10 - rnd() * fxH * 0.4, vx: (rnd() - 0.5) * 60, vy: 60 + rnd() * 120, life: 4 + rnd() * 2, t: 0, c: pick(CONFETTI), w: 5 + rnd() * 4, h: 3 + rnd() * 3, r: rnd() * 6, vr: (rnd() - 0.5) * 10, rain: true });
  }
  function floatText(x, y, text, color, size) {
    if (floaters.length > 40) floaters.shift();
    floaters.push({ x, y, text, color: color || '#ffc94a', size: size || 15, t: 0 });
  }
  function drawFx(dt) {
    fx.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
    fx.clearRect(0, 0, fxW, fxH);
    if (!parts.length && !floaters.length) return;
    for (const p of parts) {
      p.t += dt;
      if (p.rain) { p.vy = Math.min(p.vy + 40 * dt, 180); p.vx += Math.sin(p.t * 3 + p.r) * 30 * dt; }
      else { p.vy += 520 * dt; p.vx *= Math.pow(0.4, dt); }
      p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      const a = Math.max(0, Math.min(1, (p.life - p.t) * 2));
      fx.globalAlpha = a;
      fx.save(); fx.translate(p.x, p.y); fx.rotate(p.r); fx.scale(1, Math.abs(Math.cos(p.t * 6 + p.r)) * 0.8 + 0.2);
      fx.fillStyle = p.c; fx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); fx.restore();
    }
    parts = parts.filter(p => p.t < p.life && p.y < fxH + 20);
    fx.textAlign = 'center'; fx.textBaseline = 'middle';
    for (const f of floaters) {
      f.t += dt;
      const a = Math.max(0, Math.min(1, (1.2 - f.t) * 2.5));
      const s = f.t < 0.12 ? 0.6 + f.t / 0.12 * 0.5 : 1.1 - Math.min(0.1, (f.t - 0.12));
      fx.globalAlpha = a;
      fx.font = `800 ${Math.round(f.size * s)}px Figtree, -apple-system, system-ui, sans-serif`;
      fx.lineWidth = 3.5; fx.strokeStyle = 'rgba(10,12,30,.85)';
      const y = f.y - f.t * 46;
      fx.strokeText(f.text, f.x, y); fx.fillStyle = f.color; fx.fillText(f.text, f.x, y);
    }
    floaters = floaters.filter(f => f.t < 1.2);
    fx.globalAlpha = 1;
  }
  // Big centred announcement; a new one replaces the last.
  function banner(icon, title, sub) {
    const box = $('banners');
    box.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'banner';
    el.innerHTML = `<div class="bi">${icon}</div><div class="bt">${esc(title)}</div>${sub ? `<div class="bs">${esc(sub)}</div>` : ''}`;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2900);
  }
  function bumpCash() {
    const el = $('kCash');
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }
  function centerOf(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  // Where a ride is on screen (for bursts over it); falls back to the middle of the screen.
  function rideScreen(i) {
    if (L && L.plots[i]) {
      const p = L.plots[i];
      if (P3) { const at = P3.toScreen(p.cx, p.cy, P3.lotTop(i) * 0.8); if (at && at.x > 0 && at.x < fxW && at.y > 0 && at.y < fxH) return at; }
      else { const y = p.cy - scroller.scrollTop; if (y > 0 && y < fxH) return { x: p.cx, y }; }
    }
    return { x: fxW / 2, y: fxH * 0.35 };
  }

  // ---------- Golden balloon ----------
  let balloon = null;
  function spawnBalloon() {
    const b = document.createElement('button');
    b.className = 'balloon';
    b.setAttribute('aria-label', 'Pop the golden balloon for a prize');
    b.innerHTML = '<svg viewBox="0 0 54 70" aria-hidden="true"><ellipse cx="27" cy="24" rx="20" ry="23" fill="#ffc94a" stroke="#9a6a00" stroke-width="2"/><ellipse cx="20" cy="15" rx="5" ry="7" fill="#fff4cc" opacity=".8"/><path d="M24 47 L30 47 L27 52 Z" fill="#9a6a00"/><path d="M27 52 C 22 58, 32 62, 27 70" stroke="#ffe7a6" stroke-width="1.5" fill="none"/></svg>';
    const h = mapEl.clientHeight, w = mapEl.clientWidth;
    balloon = { el: b, x: 20 + rnd() * Math.max(10, w - 90), h, t: 0, life: 13 };
    b.style.left = balloon.x + 'px'; b.style.top = h + 'px';
    b.addEventListener('click', () => {
      const at = centerOf(b);
      const r = J.popBalloon(S, rnd);
      Sound.play('pop'); buzz(15);
      confetti(at.x, at.y, 40, 300);
      if (r.kind === 'cash') { floatText(at.x, at.y - 20, '+' + J.money(r.amount), '#ffc94a', 20); bumpCash(); }
      if (r.kind === 'cash') { toast('Golden balloon! +' + J.money(r.amount)); say('<b>Golden balloon</b> popped: ' + J.money(r.amount) + ' inside', true); }
      else if (r.kind === 'coffee') { toast('Golden balloon! Coffee for the crews: every build is 5 min closer'); say('<b>Coffee break</b>: builds jumped 5 minutes ahead', true); }
      else { toast('Golden balloon! Rush hour: arrivals ×3 for 30 s'); say('<b>Rush hour</b>: arrivals ×3 for 30 s', true); }
      removeBalloon();
    });
    mapEl.appendChild(b);
  }
  function removeBalloon() {
    if (balloon) balloon.el.remove();
    balloon = null;
    S.nextBalloonAt = S.time + 60 + rnd() * 100;
  }
  function updateBalloon(dt) {
    if (!balloon) { if (S.time >= S.nextBalloonAt && builtCount() > 0) spawnBalloon(); return; }
    balloon.t += dt;
    const p = balloon.t / balloon.life;
    if (p >= 1) return removeBalloon();
    const dy = -p * (balloon.h + 80);
    const dx = reduceMotion ? 0 : Math.sin(balloon.t * 1.3) * 14;
    balloon.el.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // ---------- Dock: rides ----------
  let lastSnap = null;
  function btn(cls, act) {
    const b = document.createElement('button');
    b.className = ('btn ' + cls).trim();
    b.dataset.act = act;
    b.innerHTML = '<span class="t"></span><span class="c"></span>';
    return b;
  }
  function setBtn(b, title, cost, can, maxed) {
    const t = b.firstChild, c = b.lastChild;
    if (t.textContent !== title) t.textContent = title;
    if (c.textContent !== cost) c.textContent = cost;
    b.classList.toggle('off', !can && !maxed);
    b.classList.toggle('max', !!maxed);
    b.setAttribute('aria-disabled', can ? 'false' : 'true');
  }
  function text(el, v) { if (el.textContent !== v) el.textContent = v; }
  function html(el, v) { if (el.dataset.h !== v) { el.innerHTML = v; el.dataset.h = v; } }

  const RV = {};
  (function buildRideView() {
    const v = $('view-rides');
    v.innerHTML = `
      <div class="ridehead">
        <button class="nav" data-nav="-1" aria-label="Previous ride">‹</button>
        <div class="ricon" data-k="icon"></div>
        <div style="min-width:0"><div class="rname" data-k="name"></div><div class="rsub" data-k="sub"></div></div>
        <div class="lvl" data-k="lvl"></div>
        <button class="nav" data-nav="1" aria-label="Next ride">›</button>
      </div>
      <div class="statline" data-k="line"></div>
      <div class="lotdesc" data-k="lotBox"></div>
      <div class="btns" data-k="btns"></div>`;
    v.querySelectorAll('[data-k]').forEach(n => { RV[n.dataset.k] = n; });
    RV.fix = btn('danger full', 'fix');
    RV.up = btn('primary half', 'level');
    RV.max = btn('half', 'max');
    RV.seat = btn('', 'seat');
    RV.speed = btn('', 'speed');
    RV.mgr = btn('', 'mgr');
    RV.btns.append(RV.fix, RV.up, RV.max, RV.seat, RV.speed, RV.mgr);
    v.addEventListener('click', e => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { sel = (sel + +nav.dataset.nav + S.rides.length) % S.rides.length; scrollToSel(); refresh(true); return; }
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const i = sel;
      let ok = false;
      const act = b.dataset.act;
      // a button on a running build pays overtime to finish it now
      const running = act === 'level' && !S.rides[i].lvl ? buildOf(i, 'ride') : act === 'seat' ? buildOf(i, 'seats') : act === 'speed' ? buildOf(i, 'speed') : null;
      if (running) {
        ok = J.rushBuild(S, running);
        if (ok) { Sound.play('coin'); for (const d of J.processBuilds(S)) announceBuild(d); }
        else toast('Not enough cash to pay the overtime yet.');
      } else if (act === 'level' && !S.rides[i].lvl) {
        ok = J.buyLevels(S, i, 1);
        if (ok) { Sound.play('coin'); buzz(); toast(`Construction started: ${J.rideDef(i).name} opens in ${J.duration(J.buildTime(S, 'ride', i) || 0)}`); say(`Builders are on the <b>${esc(J.rideDef(i).name)}</b>`, true); }
        else if (!J.canBuild(S)) toast('All construction crews are busy. Hire more in Park.');
      } else if (act === 'fix') {
        ok = J.repair(S, i);
        if (ok) { Sound.play('done'); toast(`${J.rideDef(i).name} fixed!`); say(`Mechanics fixed the <b>${esc(J.rideDef(i).name)}</b>`, true); }
      } else if (act === 'level' || act === 'max') {
        const before = J.milestonesPassed(S.rides[i].lvl);
        ok = J.buyLevels(S, i, act === 'max' ? Math.max(1, J.maxLevels(S, i)) : 1);
        if (ok) {
          const at = rideScreen(i), big = J.milestonesPassed(S.rides[i].lvl) > before;
          Sound.play(big ? 'milestone' : 'level'); buzz(big ? 25 : 8);
          confetti(at.x, at.y, big ? 70 : 14, big ? 340 : 200);
          floatText(at.x, at.y - 10, 'Lv ' + S.rides[i].lvl, big ? '#ffffff' : '#ffc94a', big ? 22 : 16);
          if (big) toast(`${J.rideDef(i).name} reached Lv ${S.rides[i].lvl}: tickets ×2`);
        }
      } else if (act === 'seat' || act === 'speed') {
        ok = act === 'seat' ? J.buySeats(S, i) : J.buySpeed(S, i);
        if (ok) Sound.play('coin');
        if (ok) toast(`Work started on the ${J.rideDef(i).name}: ${act === 'seat' ? 'more seats' : 'faster ride'}`);
        else if (!J.canBuild(S) && !buildOf(i, act === 'seat' ? 'seats' : 'speed')) toast('All construction crews are busy. Hire more in Park.');
      } else if (act === 'mgr') {
        ok = J.buyManager(S, i);
        if (ok) { const at = rideScreen(i); Sound.play('milestone'); buzz(20); confetti(at.x, at.y, 40, 300); floatText(at.x, at.y - 10, '★'.repeat(S.rides[i].mgr), '#ffc94a', 22); }
        if (ok) toast(`${J.MANAGERS[S.rides[i].mgr - 1].name} hired for the ${J.rideDef(i).name}: ${J.MANAGERS[S.rides[i].mgr - 1].desc}`);
      }
      if (ok) refresh(true);
    });
  })();

  function renderRides(snap) {
    if (sel >= S.rides.length) sel = S.rides.length - 1;
    const i = sel, r = S.rides[i], d = J.rideDef(i), g = snap.g;
    const built = !!r.lvl;
    if (RV.icon.dataset.i !== String(i) || RV.icon.dataset.b !== String(built)) {
      RV.icon.textContent = d.icon;
      RV.icon.style.background = built ? `radial-gradient(circle at 40% 30%, ${rideFill(i, 72)}, ${rideFill(i, 42)})` : 'var(--night-3)';
      RV.icon.style.filter = built ? '' : 'grayscale(.7)';
      RV.icon.dataset.i = i; RV.icon.dataset.b = built;
    }
    text(RV.name, d.name);
    const broken = built && r.broken > 0;
    RV.fix.hidden = !broken;
    for (const k of ['max', 'seat', 'speed', 'mgr']) RV[k].hidden = !built;
    RV.up.classList.toggle('full', !built);
    RV.line.hidden = !built;
    RV.lotBox.hidden = built;
    const crewsFree = J.canBuild(S);
    if (!built) {
      text(RV.lvl, '');
      text(RV.sub, `${d.seats} seats · ${d.cycle} s ride${d.water ? ' · water ride' : ''}`);
      const b = buildOf(i, 'ride');
      const cost = J.levelCost(S, i, 1);
      if (b) {
        const left = timeLeft(b), frac = 1 - left / Math.max(1, (b.end - b.start) / 1000);
        html(RV.lotBox, `<b>Under construction.</b> Opens in ${J.duration(left)}.<div class="load" style="margin-top:6px"><i class="build" style="width:${Math.max(3, frac * 100).toFixed(1)}%"></i></div>`);
        const rc = J.rushCost(S, b);
        setBtn(RV.up, `Finish now (${J.duration(left)} left)`, 'Overtime ' + J.money(rc), S.cash >= rc);
        return;
      }
      text(RV.lotBox, `Brings ${J.fmt(d.fun0)} fun and more guests. Building takes ${J.duration(J.buildTime(S, 'ride', i))}.`);
      setBtn(RV.up, crewsFree ? (i === 0 ? 'Build your first ride' : 'Build ' + d.name) : 'All crews busy', J.money(cost), S.cash >= cost && crewsFree);
      return;
    }
    const st = snap.stats[i];
    if (broken) setBtn(RV.fix, '⚠ Broken down: repair now', `Fixes itself in ${J.duration(r.broken)}`, true);
    text(RV.lvl, 'Lv ' + r.lvl);
    text(RV.sub, `${Math.round(d.seats * (1 + 0.5 * r.cap))} seats · ${(d.cycle * Math.pow(0.88, r.spd)).toFixed(1)} s ride`);
    const wait = r.wait || 0, util = r.util || 0;
    const warn = broken ? '<span class="bad">Guests in line are leaving</span>'
      : wait > g.tolerance ? '<span class="bad">Line too long: add seats or speed</span>'
      : util > 1.05 ? '<span class="warn">Very busy</span>' : '';
    html(RV.line, `<span>Fun <b>${J.fmt(st.fun)}</b></span><span><b>${J.money(st.price)}</b> a ride</span><span>Queue <b>${wait < 1 ? 'none' : J.duration(wait)}</b></span>${warn}`);
    const lc = J.levelCost(S, i, 1);
    setBtn(RV.up, 'Upgrade +1', J.money(lc), S.cash >= lc);
    const n = Math.max(1, J.maxLevels(S, i)), mc = J.levelCost(S, i, n);
    setBtn(RV.max, n > 1 ? `Upgrade +${n}` : 'Upgrade max', J.money(mc), S.cash >= mc);
    const sc = J.seatCost(S, i), sb = buildOf(i, 'seats');
    if (sb) setBtn(RV.seat, 'Seats ' + J.duration(timeLeft(sb)), 'Finish ' + J.money(J.rushCost(S, sb)), S.cash >= J.rushCost(S, sb));
    else setBtn(RV.seat, '+ Seats', crewsFree ? J.money(sc) : 'Crews busy', S.cash >= sc && crewsFree);
    const pc = J.speedCost(S, i), pb = buildOf(i, 'speed');
    const maxed = r.spd >= J.MAX_SPEED;
    if (pb) setBtn(RV.speed, 'Speed ' + J.duration(timeLeft(pb)), 'Finish ' + J.money(J.rushCost(S, pb)), S.cash >= J.rushCost(S, pb));
    else setBtn(RV.speed, maxed ? 'Top speed' : 'Faster', maxed ? 'Maxed' : crewsFree ? J.money(pc) : 'Crews busy', S.cash >= pc && crewsFree, maxed);
    const t = J.MANAGERS[r.mgr], mgc = J.managerCost(S, i);
    if (t) setBtn(RV.mgr, 'Hire ' + t.name.toLowerCase(), J.money(mgc), S.cash >= mgc);
    else setBtn(RV.mgr, '★★★ Staff', 'Fully staffed', false, true);
    RV.mgr.title = t ? t.desc : '';
  }

  // ---------- Dock: park ----------
  const SHORT = { land: 'More land', food: 'Snack stands', gardens: 'Gardens & fountains', comfort: 'Shade & lamps', mascot: 'Mascots & statues', mech: 'Mechanics', crews: 'Builder crews' };
  function upgradeNow(id, s, g) {
    const l = s.park[id];
    switch (id) {
      case 'land': return `Room for ${J.fmt(g.capacity)} guests`;
      case 'food': return `${J.money(g.foodRate * (lastSnap ? lastSnap.avgPrice : 1) * 60)} per guest a minute`;
      case 'mascot': return `+${12 * l}% arrivals`;
      case 'gardens': return `+${6 * l}% fun on every ride`;
      case 'comfort': return `Guests queue ${g.tolerance} s happily`;
      case 'mech': return `A ride breaks ~every ${J.duration(g.mtbf)}, fixed in ${J.duration(g.repair)}`;
      case 'crews': return `${g.crews} crew${g.crews > 1 ? 's' : ''}: ${g.crews} build${g.crews > 1 ? 's' : ''} at once`;
    }
    return '';
  }
  const parkTiles = {};
  function tileEl(container, id, title, desc, act) {
    const el = document.createElement('button');
    el.className = 'tile';
    el.dataset.act = act;
    el.dataset.id = id;
    el.title = desc;
    el.innerHTML = `<div class="tr"><h3>${esc(title)} <span data-k="lvl"></span></h3><b class="cost" data-k="cost"></b></div><p data-k="now"></p>`;
    container.appendChild(el);
    return { el, lvl: el.querySelector('[data-k=lvl]'), now: el.querySelector('[data-k=now]'), cost: el.querySelector('[data-k=cost]') };
  }
  function setTile(c, lvl, now, costText, can, maxed) {
    text(c.lvl, lvl ? String(lvl) : '');
    text(c.now, now);
    text(c.cost, maxed ? 'Maxed' : costText);
    c.el.classList.toggle('can', can && !maxed);
    c.el.classList.toggle('max', !!maxed);
  }
  function renderPark(snap) {
    for (const u of J.PARK_UPGRADES) {
      const c = parkTiles[u.id] || (parkTiles[u.id] = tileEl($('parkTiles'), u.id, SHORT[u.id], u.desc, 'park'));
      const cost = J.parkCost(S, u.id);
      if (u.id === 'land') {
        const lb = buildOf(undefined, 'land');
        if (lb) { const rc = J.rushCost(S, lb); setTile(c, S.park.land, `Ready in ${J.duration(timeLeft(lb))} · tap to finish now`, J.money(rc), S.cash >= rc, false); continue; }
        const free = J.canBuild(S);
        setTile(c, S.park.land, upgradeNow('land', S, snap.g) + ` · takes ${J.duration(J.buildTime(S, 'land'))}`, free ? J.money(cost) : 'Crews busy', S.cash >= cost && free, !isFinite(cost));
        continue;
      }
      setTile(c, S.park[u.id], upgradeNow(u.id, S, snap.g), J.money(cost), S.cash >= cost, !isFinite(cost));
    }
    text($('priceVal'), J.money(snap.ticketPrice * snap.g.incomeMult));
    text($('priceLabel'), J.priceLabel(S.priceRatio));
    text($('priceEffect'), `${Math.round(snap.priceFactor * 100)}% still come in`);
    if (document.activeElement !== $('priceSlider')) $('priceSlider').value = Math.round(S.priceRatio * 100);
  }
  $('parkTiles').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const lb = b.dataset.id === 'land' && buildOf(undefined, 'land');
    if (lb) { if (J.rushBuild(S, lb)) { Sound.play('coin'); for (const d of J.processBuilds(S)) announceBuild(d); } else toast('Not enough cash to pay the overtime yet.'); return; }
    if (J.buyPark(S, b.dataset.id)) { Sound.play('coin'); buzz(); const at = centerOf(b); confetti(at.x, at.y, 10, 180); if (b.dataset.id === 'land') toast('Builders are clearing new land.'); refresh(true); }
    else if (b.dataset.id === 'land' && !J.canBuild(S) && !buildOf(undefined, 'land')) toast('All construction crews are busy.');
  });
  $('priceSlider').addEventListener('input', e => { S.priceRatio = +e.target.value / 100; refresh(true); });

  // ---------- Dock: legacy ----------
  function perkNow(id) {
    const l = S.perks[id];
    switch (id) {
      case 'seed': return `Start with ${J.money(15 + J.seedCash(l))}`;
      case 'fame': return `+${25 * l}% arrivals`;
      case 'thrift': return `Rides ${Math.round((1 - Math.pow(0.95, l)) * 100)}% cheaper`;
      case 'patience': return `+${20 * l} s queue patience`;
      case 'builder': return `Builds ${Math.round((1 - Math.pow(0.9, l)) * 100)}% faster`;
    }
    return '';
  }
  const perkTiles = {};
  function goalRows() {
    return S.goals.map(g => {
      const info = J.goalInfo(S, g);
      return { info, frac: Math.max(0, Math.min(1, info.value / info.target)) };
    });
  }
  function renderGoals() {
    const rows = goalRows();
    if (!rows.length) return;
    const top = rows.reduce((a, b) => (b.frac > a.frac ? b : a));
    $('goalbar').style.setProperty('--p', top.frac.toFixed(3));
    $('goalbar').setAttribute('aria-label', 'Goals: ' + top.info.label);
    if (!$('goalModal').hidden) {
      html($('goalList'), rows.map(r => `<div class="goalrow"><div class="gl"><span>${esc(r.info.label)}</span><span>${Math.floor(r.frac * 100)}%</span></div><div class="gprog"><i style="width:${Math.round(r.frac * 100)}%"></i></div></div>`).join(''));
      const left = 5 - (S.goalsDone % 5);
      text($('goalsDone'), `${S.goalsDone} goals finished. ${left === 5 ? 5 : left} more until the next ×2 income bonus.`);
    }
  }
  $('goalbar').addEventListener('click', () => { openModal('goalModal'); refresh(true); });
  $('goalClose').addEventListener('click', () => closeModal('goalModal'));
  let goalT = 0;
  function updateGoals(dt) {
    goalT += dt;
    if (goalT < 1) return;
    goalT = 0;
    for (const d of J.checkGoals(S, rnd)) {
      toast(`Goal done: ${d.label}. +${J.money(d.prize)}` + (d.boost ? ' and ×2 income for 5 min!' : ''));
      say(`<b>Goal done</b>: ${esc(d.label)} (+${J.money(d.prize)})`, true);
      const at = centerOf($('goalbar'));
      Sound.play('goal'); buzz(12); bumpCash();
      confetti(at.x, at.y + 10, 30, 240);
      floatText(at.x - 30, at.y + 40, '+' + J.money(d.prize), '#ffc94a', 17);
      if (d.boost) { banner('⚡', 'Income ×2', '5 goals done: double income for 5 minutes'); Sound.play('milestone'); }
    }
    const got = J.checkTrophies(S);
    if (got.length) {
      setTimeout(() => {
        Sound.play('trophy'); buzz(30); confettiRain(got.length > 1 ? 120 : 70);
        if (got.length === 1) banner(got[0].icon, 'Trophy: ' + got[0].name, `${got[0].desc} · +${Math.round(J.TROPHY_BONUS * 100)}% income forever`);
        else banner('🏆', got.length + ' trophies!', `+${Math.round(J.TROPHY_BONUS * 100 * got.length)}% income forever. See them in the menu.`);
      }, 600);
      refresh(true);
    }
    updateGift();
  }

  function renderLegacy() {
    const have = J.tickets(S), pend = J.pendingTickets(S);
    text($('trophyCount'), `Trophies ${S.trophies.length} / ${J.TROPHIES.length}`);
    text($('trophySub'), `+${Math.round(S.trophies.length * J.TROPHY_BONUS * 100)}% income in every park. Tap to see them all.`);
    text($('tixHave'), J.fmt(have, 0));
    const nextTotal = J.ticketsTotalFor(S.lifetimeEarned) + 1;
    const need = Math.max(0, Math.pow(nextTotal, 2) * J.TICKET_SCALE - S.lifetimeEarned);
    text($('tixInfo'), `+${J.fmt(3 * S.ticketsEarned, 0)}% income, +${J.fmt(S.ticketsEarned, 0)}% guests from ${J.fmt(S.ticketsEarned, 0)} earned. Next ticket in ${J.money(need)}.`);
    text($('sellC'), '+' + J.fmt(pend, 0) + ' tickets');
    $('sellBtn').classList.toggle('off', pend < 1);
    for (const p of J.PERKS) {
      const c = perkTiles[p.id] || (perkTiles[p.id] = tileEl($('perkTiles'), p.id, p.name, p.desc, 'perk'));
      const cost = J.perkCost(S, p.id);
      setTile(c, S.perks[p.id], perkNow(p.id), J.fmt(cost, 0) + ' 🎟', have >= cost, !isFinite(cost));
      c.el.classList.add('gold');
    }
    const badge = $('legacyBadge');
    badge.hidden = pend < 1;
    text(badge, '+' + J.fmt(pend, 0));
  }
  $('perkTiles').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (b && J.buyPerk(S, b.dataset.id)) { Sound.play('milestone'); const at = centerOf(b); confetti(at.x, at.y, 30, 260); refresh(true); }
  });
  $('sellBtn').addEventListener('click', () => {
    const pend = J.pendingTickets(S);
    if (pend < 1) { toast('Your first golden ticket comes at ' + J.money(J.TICKET_SCALE) + ' total earnings.'); return; }
    text($('sellGain'), J.fmt(pend, 0) + (pend === 1 ? ' golden ticket' : ' golden tickets'));
    $('sellConfirm').hidden = false;
  });
  $('sellNo').addEventListener('click', () => { $('sellConfirm').hidden = true; });
  $('sellYes').addEventListener('click', () => {
    const r = J.sellPark(S);
    $('sellConfirm').hidden = true;
    if (!r) return;
    replaceState(r.state);
    toast(`Sold for ${J.fmt(r.gain, 0)} golden tickets. Welcome to Park ${S.parkNumber}!`);
    banner('🎟️', 'Park ' + S.parkNumber, `+${J.fmt(r.gain, 0)} golden tickets. Build it bigger!`);
    Sound.play('trophy'); confettiRain(140);
    say(`<b>Park ${S.parkNumber}</b> is an empty lot. Time to build.`, true);
    setTab('rides');
  });

  // ---------- Dock: stats ----------
  function renderStats(snap) {
    const rows = [
      ['Open for', J.duration(S.time)],
      ['Rides open', String(builtCount())],
      ['Builder crews', `${J.busyCrews(S)} busy of ${J.globals(S).crews}`],
      ['Guests here', J.fmt(S.runVisitors, 0)],
      ['Guests ever', J.fmt(S.totalVisitors, 0)],
      ['Earned here', J.money(S.runEarned)],
      ['Earned ever', J.money(S.lifetimeEarned)],
      ['Rides', J.money(S.rate.rides) + '/s'],
      ['Gate', J.money(S.rate.gate) + '/s'],
      ['Food', J.money(S.rate.food) + '/s'],
      ['Arrivals', J.fmt(S.rate.arrivals * 60) + '/min'],
      ['Total fun', J.fmt(snap.appeal)],
      ['Best income', J.money(S.bestIncome) + '/s'],
    ];
    html($('statGrid'), rows.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join(''));
  }
  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }
  $('saveOpen').addEventListener('click', () => { $('saveText').value = encodeSave(); text($('importMsg'), ''); openModal('saveModal'); });
  $('saveClose').addEventListener('click', () => closeModal('saveModal'));
  $('copyBtn').addEventListener('click', () => {
    const v = $('saveText').value;
    const fallback = () => { $('saveText').focus(); $('saveText').select(); toast('Select the code and copy it'); };
    try { navigator.clipboard.writeText(v).then(() => toast('Save code copied'), fallback); } catch (e) { fallback(); }
  });
  $('importBtn').addEventListener('click', () => {
    try {
      replaceState(decodeSave($('importText').value));
      $('importText').value = '';
      closeModal('saveModal');
      toast('Save loaded');
    } catch (e) { text($('importMsg'), "That code didn't load. Check that it was copied in full."); }
  });
  $('resetOpen').addEventListener('click', () => openModal('resetModal'));
  $('resetNo').addEventListener('click', () => closeModal('resetModal'));
  $('resetYes').addEventListener('click', () => {
    replaceState(J.newState());
    closeModal('resetModal');
    setTab('rides');
    toast('Fresh start. Open your first ride.');
  });
  $('helpOpen').addEventListener('click', () => openModal('helpModal'));
  $('helpClose').addEventListener('click', () => closeModal('helpModal'));

  function replaceState(ns) {
    S = ns; sel = 0; sprites = []; popups = [];
    if (balloon) { balloon.el.remove(); balloon = null; }
    layout(); save(); refresh(true);
  }

  // ---------- Megaphone: tap to hype the crowd, a full ring starts a parade ----------
  const hypeBtn = $('hypeBtn');
  let hypeHitT = 0, paradeRainT = 0;
  hypeBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!builtCount()) { toast('Open your first ride, then hype the crowd.'); return; }
    const r = J.tapHype(S);
    const at = centerOf(hypeBtn);
    Sound.play('tap', S.hype);
    buzz(6);
    floatText(at.x + (rnd() - 0.5) * 30, at.y - 40, '+' + J.money(r.cash), '#ffc94a', 15);
    hypeBtn.classList.add('hit'); hypeHitT = 0.08;
    if (r.parade) {
      Sound.play('parade'); buzz(40);
      banner('🎉', 'Parade!', `Income ×${J.PARADE_MULT} for ${J.PARADE_SECONDS} seconds`);
      confettiRain(90);
      confetti(at.x, at.y, 50, 360);
      say('<b>Parade!</b> The whole park is dancing', true);
    }
    refresh(true);
  });
  hypeBtn.addEventListener('click', e => e.preventDefault());
  function renderHype(dt) {
    if (hypeHitT > 0 && (hypeHitT -= dt) <= 0) hypeBtn.classList.remove('hit');
    const parade = S.effects.find(e => e.type === 'parade' && e.until > S.time);
    hypeBtn.classList.toggle('parade', !!parade);
    const p = parade ? (parade.until - S.time) / J.PARADE_SECONDS : (S.hype || 0);
    const ps = p.toFixed(3);
    if (hypeBtn.dataset.p !== ps) { hypeBtn.style.setProperty('--p', ps); hypeBtn.dataset.p = ps; }
    const tm = $('hypeTm');
    tm.hidden = !parade;
    if (parade) text(tm, Math.ceil(parade.until - S.time) + ' s');
    if (parade && (paradeRainT += dt) > 0.5) { paradeRainT = 0; confettiRain(6); }
    $('hypeHint').hidden = sheetOpen || !builtCount() || S.counts.taps >= 12;
  }

  // ---------- Trophies ----------
  function renderTrophies() {
    const n = S.trophies.length;
    text($('trophyIntro'), `${n} of ${J.TROPHIES.length} won. Each one adds ${Math.round(J.TROPHY_BONUS * 100)}% income to every park you will ever run: now +${Math.round(n * J.TROPHY_BONUS * 100)}%.`);
    const rows = J.TROPHIES.map(t => ({ t, info: J.trophyInfo(S, t) }))
      .sort((a, b) => (b.info.done - a.info.done) || (b.info.value / b.info.target - a.info.value / a.info.target));
    html($('trophyList'), rows.map(({ t, info }) => {
      const frac = info.done ? 1 : info.value / info.target;
      const v = info.done ? '✓ Won' : t.target >= 1000 ? Math.floor(frac * 100) + '%' : `${J.fmt(info.value, 0)} / ${J.fmt(t.target, 0)}`;
      return `<div class="trow ${info.done ? 'done' : 'locked'}"><span class="ti">${t.icon}</span><b>${esc(t.name)}</b><span class="tv">${v}</span><span class="small" style="grid-column:2/-1">${esc(t.desc)}</span>${info.done ? '' : `<div class="gprog"><i style="width:${(frac * 100).toFixed(1)}%"></i></div>`}</div>`;
    }).join(''));
  }
  $('trophyOpen').addEventListener('click', () => { renderTrophies(); openModal('trophyModal'); });
  $('trophyClose').addEventListener('click', () => closeModal('trophyModal'));

  // ---------- Daily gift ----------
  function dayKey(t) { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function today() { return dayKey(Date.now()); }
  function yesterday() { return dayKey(Date.now() - 864e5); }
  function updateGift() { $('giftBtn').hidden = !J.dailyReady(S, today()); }
  $('giftBtn').addEventListener('click', () => {
    if (!J.dailyReady(S, today())) return updateGift();
    const streak = J.nextStreak(S, yesterday());
    text($('giftText'), (streak > 1 ? `Day ${streak} in a row! ` : 'Welcome! ') + `Inside: ${J.money(J.dailyPrize(S, streak))} and double income for 10 minutes. Come back tomorrow for a bigger gift.`);
    html($('giftStreak'), [1, 2, 3, 4, 5, 6, 7].map(d => `<div class="${d === Math.min(streak, 7) ? 'now' : d < Math.min(streak, 7) ? 'on' : ''}">Day ${d}</div>`).join(''));
    openModal('giftModal');
  });
  $('giftLater').addEventListener('click', () => closeModal('giftModal'));
  $('giftOpen').addEventListener('click', () => {
    const r = J.claimDaily(S, today(), yesterday());
    closeModal('giftModal');
    updateGift();
    if (!r) return;
    Sound.play('gift'); buzz(30); bumpCash(); confettiRain(110);
    banner('🎁', '+' + J.money(r.prize), `Day ${r.streak} gift · income ×2 for 10 min`);
    save(); refresh(true);
  });

  // ---------- Sound switch ----------
  function renderSoundBtn() { text($('soundBtn'), Sound.on ? 'Sound: on' : 'Sound: off'); }
  $('soundBtn').addEventListener('click', () => { Sound.set(!Sound.on); renderSoundBtn(); if (Sound.on) Sound.play('coin'); });
  renderSoundBtn();

  // ---------- HUD and tabs ----------
  const EFFECT_LABEL = { sunny: 'Sunny ×1.5', celebrity: 'Celebrity ×2', heat: 'Heat wave: water rides', rush: 'Rush hour ×3', rain: 'Rain ×0.7', boost: 'Income ×2', parade: 'Parade: income ×3' };
  let parkFull = false;
  function renderHud(snap) {
    const inc = S.rate.rides + S.rate.gate + S.rate.food;
    text($('kCash'), J.money(S.cash));
    text($('kInc'), J.money(inc) + '/s');
    text($('kVis'), J.fmt(S.inPark, 0));
    $('kVis').style.color = parkFull ? 'var(--bad)' : '';
    text($('parkNo'), 'Park ' + S.parkNumber);
    const sat = S.satisfaction;
    text($('kMood'), sat > 0.85 ? '😄' : sat > 0.7 ? '🙂' : sat > 0.5 ? '😐' : '😠');
    $('moodBtn').setAttribute('aria-label', 'Guest mood: ' + (sat > 0.85 ? 'happy' : sat > 0.7 ? 'content' : sat > 0.5 ? 'restless' : 'grumpy'));
    const anyCan = J.PARK_UPGRADES.some(u => S.cash >= J.parkCost(S, u.id));
    $('parkFab').classList.toggle('can', anyCan);
    if (!$('moodModal').hidden) renderMood();
    const chips = [];
    for (const e of S.effects) if (e.until > S.time && EFFECT_LABEL[e.type]) chips.push(`<span class="chip gold">${EFFECT_LABEL[e.type]} · ${J.duration(Math.ceil(e.until - S.time))}</span>`);
    if (S.builds.length) {
      // only the next build to finish; the map labels show the rest
      const b = S.builds.reduce((a, c) => (c.end < a.end ? c : a));
      const what = b.kind === 'ride' ? J.rideDef(b.i).name : b.kind === 'land' ? 'New land' : J.rideDef(b.i).name + (b.kind === 'seats' ? ' seats' : ' speed');
      chips.push(`<span class="chip build">🏗 ${esc(what)} · ${J.duration(timeLeft(b))}${S.builds.length > 1 ? ` · +${S.builds.length - 1}` : ''}</span>`);
    }
    if (parkFull) chips.push('<span class="chip bad">Park full: buy land</span>');
    if (!P3 && S.inPark > MAX_SPRITES) chips.push(`<span class="chip">1 dot ≈ ${J.fmt(S.inPark / MAX_SPRITES, 0)} guests</span>`);
    html($('chips'), chips.join(''));
  }
  function renderMood() {
    const m = S.mood || { queues: 1, crowd: 1, price: 1, food: 1, decor: 1 };
    const pct = v => Math.round(v * 100) + '%';
    const col = v => v >= 0.95 ? 'var(--mint)' : v >= 0.8 ? 'var(--warn)' : 'var(--bad)';
    const rows = [
      ['Queues', m.queues, m.queues >= 0.95 ? 'Lines are short. Nice.' : 'Some lines are too long. Add seats, speed rides up, or buy shade & lamps.'],
      ['Space', m.crowd, m.crowd >= 0.95 ? 'Plenty of room.' : 'The park is packed. Buy more land in Park.'],
      ['Entry price', m.price, m.price >= 0.95 ? 'Guests think the price is fine.' : 'Guests find the entry ticket too pricey.'],
      ['Food', m.food, m.food >= 0.95 ? 'Nobody is hungry.' : 'Guests are hungry. Buy snack stands in Park.'],
    ];
    const bonus = m.decor > 1 ? `<div class="moodrow"><b>Gardens</b><span class="pct" style="color:var(--mint)">+${Math.round((m.decor - 1) * 100)}%</span><span class="small">Guests love the pretty park.</span></div>` : '';
    html($('moodList'), rows.map(([n, v, h]) => `<div class="moodrow"><b>${n}</b><span class="pct" style="color:${col(v)}">${pct(v)}</span><span class="small">${h}</span></div>`).join('') + bonus);
  }
  $('moodBtn').addEventListener('click', () => { renderMood(); openModal('moodModal'); });
  $('moodClose').addEventListener('click', () => closeModal('moodModal'));

  // The sheet opens on demand: a ride (tap it on the map), the park upgrades, or the menu.
  let sheetOpen = false;
  function setTab(t) {
    tab = t;
    sheetOpen = true;
    $('dock').hidden = false;
    $('fabs').hidden = true;
    $('hypeBtn').hidden = true; $('hypeHint').hidden = true;
    for (const v of ['rides', 'park', 'legacy']) $('view-' + v).hidden = v !== t;
    if (t === 'rides') scrollToSel();
    refresh(true);
  }
  function closeSheet() {
    sheetOpen = false;
    $('dock').hidden = true;
    $('fabs').hidden = false;
    $('hypeBtn').hidden = false;
    $('sellConfirm').hidden = true;
    tab = '';
  }
  document.querySelectorAll('.fab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('sheetClose').addEventListener('click', closeSheet);
  $('cashBtn').addEventListener('click', () => setTab('legacy'));
  // swipe the sheet down to close it
  (function () {
    let y0 = null;
    const sh = document.querySelector('.sheet');
    sh.addEventListener('touchstart', e => { y0 = sh.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    sh.addEventListener('touchmove', e => { if (y0 !== null && e.touches[0].clientY - y0 > 70) { y0 = null; closeSheet(); } }, { passive: true });
  })();

  let lastRefresh = 0;
  function refresh(force) {
    const now = performance.now();
    if (!force && now - lastRefresh < 200) return;
    lastRefresh = now;
    const snap = lastSnap = J.snapshot(S);
    renderHud(snap);
    if (tab === 'rides') renderRides(snap);
    else if (tab === 'park') renderPark(snap);
    else if (tab === 'legacy') renderStats(snap);
    renderGoals();
    renderLegacy();
    if (L && L.slots !== S.rides.length) layout();
  }

  // ---------- Game loop ----------
  let lastFullAt = 0;
  let arrivalAcc = 0, arrivalAccT = 0;
  function tick(dt) {
    const out = J.step(S, dt, rnd);
    for (const i of out.broke) {
      toast(`${J.rideDef(i).name} broke down! Tap Repair.`);
      Sound.play('breakdown');
      say(`<b>${esc(J.rideDef(i).name)}</b> broke down`, true);
    }
    const snapNow = lastSnap || J.snapshot(S);
    if (snapNow.lambda < 4) {
      if (out.groups.length) {
        const n = pick(out.groups);
        const fav = favouriteRide(snapNow);
        say(`${pick(GROUP_NAMES[n] || GROUP_NAMES[2])} arrived${fav ? ', off to the <b>' + esc(fav) + '</b>' : ''}`);
      }
    } else {
      arrivalAcc += out.arrivals; arrivalAccT += dt;
      if (arrivalAccT >= 3) {
        if (arrivalAcc >= 1) say(`<b>${J.fmt(arrivalAcc, 0)}</b> guests walked in`);
        arrivalAcc = 0; arrivalAccT = 0;
      }
    }
    if (out.groups.length && L) {
      const room = spriteTarget() - sprites.filter(s => s.state !== 'leave').length;
      if (room > 0) spawn(Math.min(room, out.groups.reduce((a, b) => a + b, 0)));
    }
    parkFull = out.turnedAway > 0 || S.inPark >= J.globals(S).capacity - 0.5;
    if (out.turnedAway > 0 && performance.now() - lastFullAt > 15000) {
      lastFullAt = performance.now();
      say('<b>Gate closed</b>: the park is full. Buy more land.', true);
    }
    if (S.time >= S.nextEventAt && builtCount() > 0) {
      const ev = J.rollEvent(S, rnd);
      const extra = ev.type === 'bus' ? ` ${J.fmt(ev.busVisitors, 0)} guests piled out.` : '';
      toast(ev.title + '!');
      if (ev.type !== 'rain') Sound.play('event');
      say(`<b>${esc(ev.title)}</b>. ${esc(ev.text)}${extra}`, true);
      if (ev.type === 'bus' && L) spawn(Math.min(40, ev.busVisitors));
    }
    rideAccT += dt;
    for (let i = 0; i < out.rideEarned.length; i++) rideAcc[i] = (rideAcc[i] || 0) + (out.rideEarned[i] || 0);
    if (rideAccT > 1.8 && L) {
      rideAccT = 0;
      for (let i = 0; i < rideAcc.length; i++) {
        const p = L.plots[i];
        if (rideAcc[i] > 0 && p && popups.length < 30) popups.push({ x: p.cx + (rnd() - 0.5) * p.w * 0.4, y: P3 ? p.cy : p.y + p.h * 0.22, text: '+' + J.money(rideAcc[i]), t: 0 });
        rideAcc[i] = 0;
      }
    }
  }

  function announceBuild(b) {
    const name = b.i !== undefined ? J.rideDef(b.i).name : '';
    if (b.kind === 'ride') {
      say(`<b>${esc(name)}</b> opened its gates`, true);
      if (!sheetOpen && P3) P3.focus(b.i);
      setTimeout(() => { const at = rideScreen(b.i); confetti(at.x, at.y, 90, 380); }, sheetOpen ? 0 : 450);
      banner(J.rideDef(b.i).icon, name + ' is open!', b.i === 0 ? 'Guests are on their way' : 'More fun, more guests');
      Sound.play('open'); buzz(30);
      if (sel === b.i) refresh(true);
    }
    else if (b.kind === 'land') { Sound.play('done'); toast('New land is ready! Room for ' + J.fmt(J.globals(S).capacity) + ' guests.'); say('<b>New land</b> opened', true); }
    else { Sound.play('done'); const at = rideScreen(b.i); confetti(at.x, at.y, 20, 220); toast(`${name}: ${b.kind === 'seats' ? 'new seats installed' : 'now runs faster'}`); }
    refresh(true);
  }
  function frame(now) {
    let dt = (now - lastTick) / 1000;
    lastTick = now;
    if (dt > 10) {
      const r = J.offline(S, dt);
      if (r && dt > 60) showWelcome(r);
      dt = 0;
    }
    dt = Math.min(dt, 1);
    for (const b of J.processBuilds(S)) announceBuild(b);
    if (dt > 0) {
      let left = dt;
      while (left > 0) { const h = Math.min(0.1, left); tick(h); left -= h; }
      updateSprites(dt);
      updateBalloon(dt);
      for (const p of popups) p.t += dt;
      updateBubbles(dt);
      updateGoals(dt);
      popups = popups.filter(p => p.t < 1.4);
    }
    refresh(false);
    draw(dt);
    renderHype(dt);
    drawFx(dt);
    if (now - lastSave > 5000) { lastSave = now; save(); }
    if (now - lastCloudSave > 20000) { lastCloudSave = now; cloudSave(); }
    requestAnimationFrame(frame);
  }
  setInterval(() => {
    if (document.hidden) {
      const now = performance.now();
      const dt = (now - lastTick) / 1000;
      if (dt > 0.9) { lastTick = now; let left = Math.min(dt, 60); while (left > 0) { const h = Math.min(0.5, left); tick(h); left -= h; } save(); }
    }
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { save(); cloudSave(); } });
  window.addEventListener('pagehide', () => { save(); cloudSave(); });
  if (window.ResizeObserver) new ResizeObserver(() => { if (S) layout(); }).observe(scroller);
  else window.addEventListener('resize', () => { if (S) layout(); });

  function showWelcome(r) {
    const capped = r.seconds > r.counted + 1;
    const done = (r.built || []).map(b => b.kind === 'ride' ? J.rideDef(b.i).name + ' opened' : b.kind === 'land' ? 'new land is ready' : J.rideDef(b.i).name + (b.kind === 'seats' ? ' got more seats' : ' got faster'));
    $('welcomeText').textContent = `You were away for ${J.duration(r.seconds)}. ${J.fmt(r.visitors, 0)} guests came by and your park earned ${J.money(r.earned)}.` +
      (done.length ? ` While you were gone: ${done.join(', ')}.` : '') +
      (capped ? ` Offline earnings stop after ${r.hours} h; night security extends that.` : '');
    openModal('welcome');
  }
  $('welcomeOk').addEventListener('click', () => { closeModal('welcome'); Sound.play('gift'); bumpCash(); const at = centerOf($('kCash')); confetti(at.x, at.y + 10, 50, 260); });

  // ---------- Account save (Claude link only) ----------
  // Some viewers (the Claude iPhone app) wipe browser storage between visits, so the park is also
  // kept in this viewer's private slot of the artifact database when the page runs on claude.ai.
  let cloudRef = null, cloudBusy = false, lastCloudSave = 0, hadLocal = false;
  async function cloudSave() {
    if (!cloudRef || cloudBusy || !S) return;
    cloudBusy = true;
    try { await cloudRef.set({ json: JSON.stringify(S), savedAt: Date.now(), lifetime: S.lifetimeEarned }); }
    catch (e) { /* view-only or offline: keep local save only */ }
    cloudBusy = false;
  }
  async function initCloud() {
    const use = window.claude && window.claude.use;
    if (typeof use !== 'function') return;
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      const uid = db && user ? await user.id() : null;
      if (!uid) return;
      const ref = db.doc('data/users/' + uid + '/save2');
      const snap = await ref.get();
      if (snap.exists) {
        const d = snap.data();
        const newer = hadLocal ? d.savedAt > (S.lastSeen || 0) + 5000 : (d.lifetime || 0) > S.lifetimeEarned;
        if (newer && typeof d.json === 'string') {
          const remote = J.migrate(JSON.parse(d.json));
          replaceState(remote);
          const away = (Date.now() - (d.savedAt || Date.now())) / 1000;
          const r = J.offline(S, away);
          sel = Math.max(0, builtCount() - 1);
          refresh(true);
          if (r && away > 60) showWelcome(r);
          say(`Welcome back to <b>Park ${S.parkNumber}</b>.`, true);
        }
      }
      cloudRef = ref;
      cloudSave();
    } catch (e) { /* no account save on this view */ }
  }

  function start(data) {
    let restored = data && data.state ? J.migrate(data.state) : null;
    const fromHot = !!restored;
    if (!restored) restored = loadSave();
    const fresh = !restored;
    hadLocal = !fresh;
    S = restored || J.newState();
    layout();
    if (!fresh && !fromHot) {
      const away = (Date.now() - (S.lastSeen || Date.now())) / 1000;
      const r = J.offline(S, away);
      if (r && away > 60) showWelcome(r);
    }
    // Start with the newest ride (or the empty lot) selected.
    sel = fresh ? 0 : Math.max(0, builtCount() - 1);
    if (fresh) { say('Welcome to your empty lot. Tap <b>Build your first ride</b> to begin.', true); setTab('rides'); }
    else say(`Welcome back to <b>Park ${S.parkNumber}</b>.`, true);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitCache.clear());
    refresh(true);
    lastTick = performance.now();
    requestAnimationFrame(frame);
    initCloud();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  window.JoylandDebug = { state: () => S }; // for automated tests
  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') { try { hot.snapshot(() => ({ state: S })); } catch (e) { /* optional */ } }
  if (hot && typeof hot.ready === 'function') hot.ready(start);
  else start((hot && hot.data) || {});
})();
