// Endless Joyland: screen, park map and controls.
(function () {
  'use strict';
  const J = window.Joyland;
  const SAVE_KEY = 'endless-joyland-v1';
  const MAX_SPRITES = 150;
  const rnd = Math.random;
  const $ = id => document.getElementById(id);
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let S = null;
  let bulk = 1;
  let tab = 'rides';
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
    const W = scroller.clientWidth || 360;
    const viewH = scroller.clientHeight || 400;
    const cols = Math.max(3, Math.min(5, Math.floor(W / 140)));
    const pad = 18, gap = 20, top = 40;
    const plotW = (W - pad * 2 - gap * (cols - 1)) / cols;
    const plotH = Math.min(plotW * 0.95, 150);
    const slots = S.rides.length;
    const rows = Math.max(2, Math.ceil(slots / cols));
    const gateH = 84;
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
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = H + 'px';
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
    L = { W, H, cols, pad, gap, top, plotW, plotH, rows, plots, vcorr, hcorr, gate, dpr, slots, bottomY, trees, viewH, spots, lampSpots };
    for (const sp of sprites) { sp.x = Math.min(sp.x, W); sp.y = Math.min(sp.y, H); }
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
        const stepLen = sp.speed * dt;
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
    const d = S.decor;
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
    if (r && g && (r.wait || 0) > g.tolerance) problems.push('This line is forever!', `The ${name} needs more seats`, 'Ugh, still waiting…');
    if (parkFull) problems.push('So crowded in here!');
    if (S.priceRatio > 0.95) problems.push('Entry was so pricey…');
    if (S.park.food === 0 && S.time > 120) problems.push("I'm hungry!", 'Where are the snacks?');
    if (problems.length && rnd() < 0.75) return { text: pick(problems), bad: true };
    const happy = [`Best ${name} ever!`, 'Wheee!', 'Again! Again!', 'I love this park!', `The ${name} rocks!`, 'What a view!'];
    if (S.decor.fountain || S.decor.flowers) happy.push('Such a pretty park!');
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
    const sp = pick(cands);
    const th = thoughtFor(sp);
    bubbles.push({ sp, text: th.text, bad: th.bad, t: 0 });
  }

  let animT = 0;
  function draw(dt) {
    if (!L) return;
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
  const fitCache = new Map();
  function fitText(t, w) {
    const key = t + '|' + Math.round(w) + '|' + ctx.font;
    if (fitCache.has(key)) return fitCache.get(key);
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
    const p = L.plots[sel];
    const top = scroller.scrollTop, h = scroller.clientHeight;
    if (p.y < top + 30 || p.y + p.h > top + h - 50) scroller.scrollTo({ top: Math.max(0, p.cy - h / 2), behavior: reduceMotion ? 'auto' : 'smooth' });
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
      const r = J.popBalloon(S, rnd);
      if (r.kind === 'cash') { toast('Golden balloon! +' + J.money(r.amount)); say('<b>Golden balloon</b> popped: ' + J.money(r.amount) + ' inside', true); }
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
    b.className = 'btn ' + cls;
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
      <div class="panel" style="display:grid;gap:9px">
        <div class="ridehead">
          <button class="nav" data-nav="-1" aria-label="Previous ride">‹</button>
          <div class="ricon" data-k="icon"></div>
          <div style="min-width:0"><div class="rname" data-k="name"></div><div class="rsub" data-k="sub"></div></div>
          <div class="lvl" data-k="lvl"></div>
          <button class="nav" data-nav="1" aria-label="Next ride">›</button>
        </div>
        <div data-k="builtBox" style="display:grid;gap:9px">
          <div class="stats">
            <div class="stat"><div class="lab">Fun</div><div class="v" data-k="fun"></div></div>
            <div class="stat"><div class="lab">Ticket</div><div class="v" data-k="price"></div></div>
            <div class="stat"><div class="lab">Riders/min</div><div class="v" data-k="thr"></div></div>
            <div class="stat"><div class="lab">Queue</div><div class="v" data-k="wait"></div></div>
          </div>
          <div class="loadrow"><div class="load"><i data-k="bar"></i></div><div class="note" data-k="ms"></div></div>
        </div>
        <div class="lotdesc" data-k="lotBox"></div>
        <div class="btns" data-k="btns"></div>
      </div>
      <div class="footrow">
        <div class="seg" id="bulk" aria-label="Levels per upgrade"><button aria-pressed="true" data-n="1">×1</button><button aria-pressed="false" data-n="10">×10</button><button aria-pressed="false" data-n="25">×25</button><button aria-pressed="false" data-n="max">Max</button></div>
        <button class="mgr" data-act="mgr" data-k="mgr"></button>
      </div>`;
    v.querySelectorAll('[data-k]').forEach(n => { RV[n.dataset.k] = n; });
    RV.up = btn('primary', 'level');
    RV.seat = btn('', 'seat');
    RV.speed = btn('', 'speed');
    RV.btns.append(RV.up, RV.seat, RV.speed);
    v.addEventListener('click', e => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { sel = (sel + +nav.dataset.nav + S.rides.length) % S.rides.length; scrollToSel(); refresh(true); return; }
      const bb = e.target.closest('#bulk button');
      if (bb) {
        bulk = bb.dataset.n === 'max' ? 'max' : +bb.dataset.n;
        for (const x of bb.parentElement.children) x.setAttribute('aria-pressed', x === bb ? 'true' : 'false');
        refresh(true); return;
      }
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const i = sel;
      let ok = false;
      const act = b.dataset.act;
      if (act === 'level' && !S.rides[i].lvl) {
        ok = J.buyLevels(S, i, 1);
        if (ok) { toast(J.rideDef(i).name + ' is open!'); say(`<b>${esc(J.rideDef(i).name)}</b> opened its gates`, true); layout(); }
      } else if (act === 'level') {
        const before = J.milestonesPassed(S.rides[i].lvl);
        ok = J.buyLevels(S, i, bulkCount(i));
        if (ok && J.milestonesPassed(S.rides[i].lvl) > before) toast(`${J.rideDef(i).name} reached Lv ${S.rides[i].lvl}: tickets ×2`);
      } else if (act === 'seat') ok = J.buySeats(S, i);
      else if (act === 'speed') ok = J.buySpeed(S, i);
      else if (act === 'mgr') {
        ok = J.buyManager(S, i);
        if (ok) toast(`${J.MANAGERS[S.rides[i].mgr - 1].name} hired for the ${J.rideDef(i).name}: ${J.MANAGERS[S.rides[i].mgr - 1].desc}`);
      }
      if (ok) refresh(true);
    });
  })();

  function bulkCount(i) { return bulk === 'max' ? Math.max(1, J.maxLevels(S, i)) : bulk; }

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
    RV.mgr.hidden = !built;
    if (built) {
      const mc = J.managerCost(S, i);
      const t = J.MANAGERS[r.mgr];
      html(RV.mgr, t ? `Hire ${t.name.toLowerCase()}<small>${t.desc} · ${J.money(mc)}</small>` : `${'★'.repeat(r.mgr)} Showrunner<small>Fully staffed</small>`);
      RV.mgr.classList.toggle('can', !!t && S.cash >= mc);
      RV.mgr.classList.toggle('max', !t);
    }
    RV.builtBox.hidden = !built;
    RV.lotBox.hidden = built;
    RV.seat.hidden = !built; RV.speed.hidden = !built;
    RV.btns.style.gridTemplateColumns = built ? '' : '1fr';
    if (!built) {
      text(RV.lvl, '');
      text(RV.sub, `${d.seats} seats · ${d.cycle} s ride${d.water ? ' · water ride' : ''}`);
      text(RV.lotBox, `A new ride adds ${J.fmt(d.fun0)} fun, which brings more guests. Tickets start at ${J.money(d.price0 * g.incomeMult)}.`);
      const cost = J.levelCost(S, i, 1);
      setBtn(RV.up, i === 0 ? 'Open your first ride' : 'Build ' + d.name, J.money(cost), S.cash >= cost);
      return;
    }
    const st = snap.stats[i];
    text(RV.lvl, 'Lv ' + r.lvl);
    text(RV.sub, `${Math.round(d.seats * (1 + 0.5 * r.cap))} seats · ${(d.cycle * Math.pow(0.88, r.spd)).toFixed(1)} s ride${d.water ? ' · water' : ''}`);
    text(RV.fun, J.fmt(st.fun));
    text(RV.price, J.money(st.price));
    text(RV.thr, J.fmt(st.throughput * 60));
    const wait = r.wait || 0;
    text(RV.wait, wait < 1 ? 'None' : J.duration(wait));
    RV.wait.style.color = wait > g.tolerance ? 'var(--bad)' : wait > g.tolerance * 0.6 ? 'var(--warn)' : '';
    const util = r.util || 0;
    RV.bar.style.width = Math.min(100, util * 100) + '%';
    RV.bar.className = util > 1.05 ? (wait > g.tolerance ? 'bad' : 'warn') : '';
    html(RV.ms, util > 1.05
      ? `Too busy (${Math.round(util * 100)}% of capacity). Add seats or speed it up.`
      : `Next milestone <b>Lv ${J.nextMilestone(r.lvl)}</b>: tickets ×2, fun ×1.5`);
    const n = bulkCount(i);
    const lc = J.levelCost(S, i, n);
    setBtn(RV.up, 'Upgrade +' + n, J.money(lc), S.cash >= lc);
    const sc = J.seatCost(S, i);
    setBtn(RV.seat, '+ Seats', J.money(sc), S.cash >= sc);
    const pc = J.speedCost(S, i);
    const maxed = r.spd >= J.MAX_SPEED;
    setBtn(RV.speed, maxed ? 'Top speed' : 'Faster', maxed ? 'Maxed' : J.money(pc), S.cash >= pc, maxed);
  }

  // ---------- Dock: park ----------
  const SHORT = { land: 'More land', food: 'Snack stands', mascot: 'Mascot parades', crew: 'Crew training', comfort: 'Shade & benches', night: 'Night security' };
  function upgradeNow(id, s, g) {
    const l = s.park[id];
    switch (id) {
      case 'land': return `Room for ${J.fmt(g.capacity)} guests`;
      case 'food': return `${J.money(g.foodRate * (lastSnap ? lastSnap.avgPrice : 1) * 60)} per guest a minute`;
      case 'mascot': return `+${12 * l}% arrivals`;
      case 'crew': return `+${10 * l}% riders on every ride`;
      case 'comfort': return `Guests queue ${g.tolerance} s happily`;
      case 'night': { const o = J.offlineLimits(s); return `${Math.round(o.eff * 100)}% earnings, ${o.hours} h away`; }
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
    if (J.buyPark(S, b.dataset.id)) { if (b.dataset.id === 'land') toast('New land! Room for ' + J.fmt(J.globals(S).capacity) + ' guests.'); refresh(true); }
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
    }
    return '';
  }
  const perkTiles = {};
  const decorTiles = {};
  function decorNow(id) {
    const n = S.decor[id];
    switch (id) {
      case 'flowers': return `${n} placed · +${3 * n}% fun`;
      case 'lamps': return `${n} placed · +${5 * n} s patience`;
      case 'fountain': return `${n} placed · +${8 * n}% fun`;
      case 'statue': return `${n} placed · +${10 * n}% guests`;
    }
    return '';
  }
  function renderDecor() {
    for (const d of J.DECOR) {
      const c = decorTiles[d.id] || (decorTiles[d.id] = tileEl($('decorTiles'), d.id, d.name, d.desc, 'decor'));
      const cost = J.decorCost(S, d.id);
      setTile(c, 0, decorNow(d.id), J.money(cost), S.cash >= cost, false);
    }
  }
  $('decorTiles').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (b && J.buyDecor(S, b.dataset.id)) refresh(true);
  });

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
    text($('gLabel'), top.info.label);
    $('gBar').style.width = Math.round(top.frac * 100) + '%';
    text($('gCount'), `${S.goalsDone} done`);
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
    }
  }

  function renderLegacy() {
    const have = J.tickets(S), pend = J.pendingTickets(S);
    text($('tixHave'), J.fmt(have, 0));
    const nextTotal = J.ticketsTotalFor(S.lifetimeEarned) + 1;
    const need = Math.max(0, Math.pow(nextTotal, 2) * 1e8 - S.lifetimeEarned);
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
    if (b && J.buyPerk(S, b.dataset.id)) refresh(true);
  });
  $('sellBtn').addEventListener('click', () => {
    const pend = J.pendingTickets(S);
    if (pend < 1) { toast('Your first golden ticket comes at $100 M total earnings.'); return; }
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
    say(`<b>Park ${S.parkNumber}</b> is an empty lot. Time to build.`, true);
    setTab('rides');
  });

  // ---------- Dock: stats ----------
  function renderStats(snap) {
    const rows = [
      ['Open for', J.duration(S.time)],
      ['Rides open', String(builtCount())],
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

  // ---------- HUD and tabs ----------
  const EFFECT_LABEL = { sunny: 'Sunny ×1.5', celebrity: 'Celebrity ×2', heat: 'Heat wave: water rides', rush: 'Rush hour ×3', rain: 'Rain ×0.7', boost: 'Goal bonus: income ×2' };
  let parkFull = false;
  function renderHud(snap) {
    const inc = S.rate.rides + S.rate.gate + S.rate.food;
    text($('kCash'), J.money(S.cash));
    text($('kInc'), J.money(inc) + '/s');
    text($('kVis'), J.fmt(S.inPark, 0));
    $('kVis').style.color = parkFull ? 'var(--bad)' : '';
    text($('parkNo'), 'Park ' + S.parkNumber);
    const sat = S.satisfaction;
    text($('kMood'), sat > 0.85 ? 'Happy' : sat > 0.5 ? 'Restless' : 'Grumpy');
    $('kMoodDot').className = 'dot' + (sat > 0.85 ? '' : sat > 0.5 ? ' warn' : ' bad');
    const chips = [];
    for (const e of S.effects) if (e.until > S.time && EFFECT_LABEL[e.type]) chips.push(`<span class="chip gold">${EFFECT_LABEL[e.type]} · ${Math.ceil(e.until - S.time)}s</span>`);
    if (parkFull) chips.push('<span class="chip bad">Park full: buy land</span>');
    if (S.inPark > MAX_SPRITES) chips.push(`<span class="chip">1 dot ≈ ${J.fmt(S.inPark / MAX_SPRITES, 0)} guests</span>`);
    html($('chips'), chips.join(''));
  }
  function setTab(t) {
    tab = t;
    for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false');
    for (const v of ['rides', 'park', 'decor', 'legacy', 'stats']) $('view-' + v).hidden = v !== t;
    if (t === 'rides') scrollToSel();
    refresh(true);
  }
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  let lastRefresh = 0;
  function refresh(force) {
    const now = performance.now();
    if (!force && now - lastRefresh < 200) return;
    lastRefresh = now;
    const snap = lastSnap = J.snapshot(S);
    renderHud(snap);
    if (tab === 'rides') renderRides(snap);
    else if (tab === 'park') renderPark(snap);
    else if (tab === 'stats') renderStats(snap);
    else if (tab === 'decor') renderDecor();
    renderGoals();
    renderLegacy();
    if (L && L.slots !== S.rides.length) layout();
  }

  // ---------- Game loop ----------
  let lastFullAt = 0;
  let arrivalAcc = 0, arrivalAccT = 0;
  function tick(dt) {
    const out = J.step(S, dt, rnd);
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
      say(`<b>${esc(ev.title)}</b>. ${esc(ev.text)}${extra}`, true);
      if (ev.type === 'bus' && L) spawn(Math.min(40, ev.busVisitors));
    }
    rideAccT += dt;
    for (let i = 0; i < out.rideEarned.length; i++) rideAcc[i] = (rideAcc[i] || 0) + (out.rideEarned[i] || 0);
    if (rideAccT > 1.8 && L) {
      rideAccT = 0;
      for (let i = 0; i < rideAcc.length; i++) {
        const p = L.plots[i];
        if (rideAcc[i] > 0 && p && popups.length < 30) popups.push({ x: p.cx + (rnd() - 0.5) * p.w * 0.4, y: p.y + p.h * 0.22, text: '+' + J.money(rideAcc[i]), t: 0 });
        rideAcc[i] = 0;
      }
    }
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
    $('welcomeText').textContent = `You were away for ${J.duration(r.seconds)}. ${J.fmt(r.visitors, 0)} guests came by and your park earned ${J.money(r.earned)}.` +
      (capped ? ` Offline earnings stop after ${r.hours} h; night security extends that.` : '');
    openModal('welcome');
  }
  $('welcomeOk').addEventListener('click', () => closeModal('welcome'));

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
      const ref = db.doc('data/users/' + uid + '/save');
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
    if (fresh) say('Welcome to your empty lot. Tap <b>Open your first ride</b> to begin.', true);
    else say(`Welcome back to <b>Park ${S.parkNumber}</b>.`, true);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitCache.clear());
    refresh(true);
    lastTick = performance.now();
    requestAnimationFrame(frame);
    initCloud();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') { try { hot.snapshot(() => ({ state: S })); } catch (e) { /* optional */ } }
  if (hot && typeof hot.ready === 'function') hot.ready(start);
  else start((hot && hot.data) || {});
})();
