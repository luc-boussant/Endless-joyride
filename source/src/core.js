// Endless Joyland: game rules and simulation. No DOM here, so it also runs in Node for balance tests.
(function (root) {
  'use strict';

  // ---------- Tunables ----------
  const STAY = 90;            // average seconds a visitor spends in the park
  const RIDE_EVERY = 15;      // a visitor wants a ride every N seconds
  const BASE_TOLERANCE = 60;  // seconds of queue a visitor accepts before getting grumpy
  const LEVEL_GROWTH = 1.14;
  const SEAT_GROWTH = 1.32;
  const SPEED_GROWTH = 2.2;
  const MAX_SPEED = 12;
  const TICKET_SCALE = 1e8;   // golden tickets = floor(sqrt(lifetime / TICKET_SCALE))

  // [name, icon, seats, cycle seconds, water ride]
  const HANDCRAFTED = [
    ['Carousel', '🎠', 12, 8, 0],
    ['Teacups', '☕', 16, 10, 0],
    ['Bumper Cars', '🚗', 20, 12, 0],
    ['Ferris Wheel', '🎡', 48, 20, 0],
    ['Haunted House', '👻', 30, 15, 0],
    ['Log Flume', '🛶', 24, 18, 1],
    ['Pirate Ship', '⛵', 40, 16, 0],
    ['Wooden Coaster', '🎢', 28, 24, 0],
    ['Drop Tower', '🗼', 16, 12, 0],
    ['River Rapids', '🌊', 32, 22, 1],
    ['Hyper Coaster', '⚡', 36, 30, 0],
    ['Space Launch', '🚀', 24, 26, 0],
  ];
  const PREFIX = ['Mega', 'Cosmic', 'Thunder', 'Twisted', 'Quantum', 'Midnight', 'Volcano', 'Galactic', 'Infinity', 'Crystal', 'Phantom', 'Aurora'];
  const KINDS = [
    ['Coaster', '🎢', 30, 26, 0], ['Spinner', '🌀', 24, 14, 0], ['Drop', '🗼', 18, 12, 0], ['Splash', '🌊', 30, 20, 1],
    ['Wheel', '🎡', 50, 22, 0], ['Dark Ride', '🏰', 28, 18, 0], ['Swing', '🪂', 32, 16, 0], ['Rocket', '🚀', 22, 24, 0],
  ];
  const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];

  const defCache = [];
  function rideDef(i) {
    if (defCache[i]) return defCache[i];
    let name, icon, seats, cycle, water;
    if (i < HANDCRAFTED.length) {
      [name, icon, seats, cycle, water] = HANDCRAFTED[i];
    } else {
      const j = i - HANDCRAFTED.length;
      const k = KINDS[(j * 3) % KINDS.length];
      const gen = Math.floor(j / PREFIX.length);
      name = PREFIX[j % PREFIX.length] + ' ' + k[0] + (gen < ROMAN.length ? ROMAN[gen] : ' #' + (gen + 1));
      [, icon, seats, cycle, water] = k;
    }
    const d = {
      i, name, icon, seats, cycle, water: !!water,
      cost0: 12 * Math.pow(12, i),
      fun0: Math.pow(2.6, i),
      price0: Math.pow(3, i),
      thr0: Math.pow(1.7, i),
    };
    defCache[i] = d;
    return d;
  }

  // Ride level milestones: each one doubles ticket price and adds 50% fun.
  const MILESTONES = [10, 25, 50, 75, 100];
  function milestonesPassed(lvl) {
    let m = 0;
    for (const t of MILESTONES) if (lvl >= t) m++;
    if (lvl >= 150) m += Math.floor((lvl - 100) / 50);
    return m;
  }
  function nextMilestone(lvl) {
    for (const t of MILESTONES) if (lvl < t) return t;
    return 100 + 50 * (Math.floor((lvl - 100) / 50) + 1);
  }

  // ---------- Park-wide upgrades ----------
  const PARK_UPGRADES = [
    { id: 'land', name: 'Buy more land', desc: 'Park capacity ×1.6', base: 250, growth: 3.2 },
    { id: 'food', name: 'Snack stands', desc: 'Visitors spend more on food and drinks between rides', base: 80, growth: 1.6 },
    { id: 'mascot', name: 'Mascot parades', desc: '+12% visitor arrivals', base: 400, growth: 1.9 },
    { id: 'crew', name: 'Ride crew training', desc: '+10% throughput on every ride', base: 500, growth: 1.85 },
    { id: 'comfort', name: 'Shade, benches & restrooms', desc: 'Visitors tolerate +15 s more queueing', base: 300, growth: 2.1, max: 20 },
    { id: 'night', name: 'Night security', desc: '+1 h offline time and +2.5% offline earnings', base: 2000, growth: 3, max: 22 },
  ];
  const UPG = Object.fromEntries(PARK_UPGRADES.map(u => [u.id, u]));

  // ---------- Legacy perks (bought with golden tickets, kept forever) ----------
  const PERKS = [
    { id: 'seed', name: 'Founder’s fund', desc: 'Start each new park with more cash', base: 3, growth: 2 },
    { id: 'fame', name: 'Famous name', desc: '+25% visitor arrivals', base: 5, growth: 1.8 },
    { id: 'thrift', name: 'Bulk contractors', desc: 'All ride upgrades cost 5% less', base: 8, growth: 2.2, max: 10 },
    { id: 'patience', name: 'Loyal fans', desc: 'Visitors tolerate +20 s more queueing', base: 6, growth: 2, max: 10 },
  ];
  const PERK = Object.fromEntries(PERKS.map(p => [p.id, p]));

  function newRide() { return { lvl: 0, cap: 0, spd: 0, queue: 0 }; }

  function newState(keep) {
    const s = {
      v: 1,
      cash: 15,
      time: 0,
      rides: [newRide()],
      park: { land: 0, food: 0, mascot: 0, crew: 0, comfort: 0, night: 0 },
      priceRatio: 0.5,
      inPark: 0,
      satisfaction: 1,
      runEarned: 0,
      lifetimeEarned: 0,
      ticketsEarned: 0,     // tickets ever earned from selling parks
      ticketsSpent: 0,
      perks: { seed: 0, fame: 0, thrift: 0, patience: 0 },
      parkNumber: 1,
      totalVisitors: 0,
      runVisitors: 0,
      bestIncome: 0,
      effects: [],          // {type, until}
      nextEventAt: 120,
      nextBalloonAt: 50,
      rate: { rides: 0, gate: 0, food: 0, arrivals: 0 },
      lastSeen: Date.now(),
      created: Date.now(),
    };
    if (keep) {
      for (const k of ['lifetimeEarned', 'ticketsEarned', 'ticketsSpent', 'totalVisitors', 'bestIncome', 'created']) s[k] = keep[k];
      s.perks = Object.assign({}, s.perks, keep.perks);
      s.parkNumber = (keep.parkNumber || 1) + 1;
      s.cash = 15 + seedCash(s.perks.seed);
    }
    return s;
  }

  function seedCash(lvl) { return lvl ? 500 * Math.pow(12, lvl - 1) : 0; }

  // Older or partial saves get any missing fields filled in.
  function migrate(raw) {
    const s = newState();
    if (!raw || typeof raw !== 'object') return s;
    for (const k of Object.keys(s)) if (raw[k] !== undefined) s[k] = raw[k];
    s.park = Object.assign(newState().park, raw.park || {});
    s.perks = Object.assign(newState().perks, raw.perks || {});
    s.rate = Object.assign(newState().rate, raw.rate || {});
    if (!Array.isArray(s.rides) || !s.rides.length) s.rides = [newRide()];
    s.rides = s.rides.map(r => Object.assign(newRide(), r));
    if (!Array.isArray(s.effects)) s.effects = [];
    for (const k of ['cash', 'inPark', 'runEarned', 'lifetimeEarned']) if (!isFinite(s[k])) s[k] = 0;
    return s;
  }

  // ---------- Derived numbers ----------
  function tickets(s) { return s.ticketsEarned - s.ticketsSpent; }
  function hasEffect(s, type) { return s.effects.some(e => e.type === type && e.until > s.time); }

  function globals(s) {
    const t = s.ticketsEarned; // every ticket ever earned counts, spent or not
    return {
      incomeMult: 1 + 0.03 * t,
      arrivalMult: (1 + 0.12 * s.park.mascot) * (1 + 0.25 * s.perks.fame) * (1 + 0.01 * t),
      crewMult: 1 + 0.1 * s.park.crew,
      tolerance: BASE_TOLERANCE + 15 * s.park.comfort + 20 * s.perks.patience,
      capacity: Math.floor(60 * Math.pow(1.6, s.park.land)),
      foodRate: 0.04 * (1 - Math.pow(0.93, s.park.food)),
      costMult: Math.pow(0.95, s.perks.thrift),
    };
  }

  function rideStats(s, i, g) {
    const r = s.rides[i];
    if (!r || !r.lvl) return null;
    const d = rideDef(i);
    const m = milestonesPassed(r.lvl);
    const heat = d.water && hasEffect(s, 'heat');
    return {
      fun: d.fun0 * r.lvl * Math.pow(1.5, m) * (heat ? 3 : 1),
      price: d.price0 * (1 + 0.15 * (r.lvl - 1)) * Math.pow(2, m) * g.incomeMult,
      throughput: d.thr0 * d.seats * (1 + 0.5 * r.cap) * (1 + 0.02 * (r.lvl - 1)) / (d.cycle * Math.pow(0.88, r.spd)) * g.crewMult,
    };
  }

  function snapshot(s) {
    const g = globals(s);
    const stats = s.rides.map((_, i) => rideStats(s, i, g));
    let appeal = 0, priceW = 0;
    for (const st of stats) if (st) { appeal += st.fun; priceW += st.fun * st.price; }
    const avgPrice = appeal ? priceW / appeal : 1;
    const fair = 2 * avgPrice;
    const ticketPrice = s.priceRatio * fair;
    const priceFactor = 1 / (1 + Math.pow(s.priceRatio, 3));
    let eventMult = 1;
    if (hasEffect(s, 'sunny')) eventMult *= 1.5;
    if (hasEffect(s, 'celebrity')) eventMult *= 2;
    if (hasEffect(s, 'rush')) eventMult *= 3;
    if (hasEffect(s, 'rain')) eventMult *= 0.7;
    const satFactor = 0.25 + 0.75 * s.satisfaction;
    const lambda = appeal ? 0.12 * Math.pow(appeal, 0.85) * g.arrivalMult * priceFactor * satFactor * eventMult : 0;
    return { g, stats, appeal, avgPrice, fair, ticketPrice, priceFactor, lambda, eventMult, satFactor };
  }

  function priceLabel(ratio) {
    if (ratio <= 0.001) return 'Free entry';
    if (ratio < 0.35) return 'A bargain';
    if (ratio < 0.65) return 'Fair';
    if (ratio < 0.95) return 'A bit pricey';
    if (ratio < 1.4) return 'Expensive';
    return 'Outrageous';
  }

  // ---------- Costs ----------
  function geoSum(c0, r, n) { return r === 1 ? c0 * n : c0 * (Math.pow(r, n) - 1) / (r - 1); }
  function geoMax(c0, r, cash) { return cash < c0 ? 0 : Math.floor(Math.log(cash * (r - 1) / c0 + 1) / Math.log(r)); }

  function levelCost(s, i, n) {
    const r = s.rides[i], d = rideDef(i), g = globals(s);
    return geoSum(d.cost0 * Math.pow(LEVEL_GROWTH, r.lvl) * g.costMult, LEVEL_GROWTH, n);
  }
  function maxLevels(s, i) {
    const r = s.rides[i], d = rideDef(i), g = globals(s);
    return geoMax(d.cost0 * Math.pow(LEVEL_GROWTH, r.lvl) * g.costMult, LEVEL_GROWTH, s.cash);
  }
  function seatCost(s, i) { return rideDef(i).cost0 * 2 * Math.pow(SEAT_GROWTH, s.rides[i].cap) * globals(s).costMult; }
  function speedCost(s, i) {
    const r = s.rides[i];
    return r.spd >= MAX_SPEED ? Infinity : rideDef(i).cost0 * 10 * Math.pow(SPEED_GROWTH, r.spd) * globals(s).costMult;
  }
  function parkCost(s, id) {
    const u = UPG[id], l = s.park[id];
    return u.max !== undefined && l >= u.max ? Infinity : u.base * Math.pow(u.growth, l);
  }
  function perkCost(s, id) {
    const p = PERK[id], l = s.perks[id];
    return p.max !== undefined && l >= p.max ? Infinity : Math.ceil(p.base * Math.pow(p.growth, l));
  }

  // ---------- Actions ----------
  function spend(s, c) { if (!(c <= s.cash)) return false; s.cash -= c; return true; }
  function buyLevels(s, i, n) {
    if (n <= 0) return false;
    if (!spend(s, levelCost(s, i, n))) return false;
    const r = s.rides[i];
    const built = r.lvl === 0;
    r.lvl += n;
    if (built && i === s.rides.length - 1) s.rides.push(newRide());
    return true;
  }
  function buySeats(s, i) { if (!s.rides[i].lvl || !spend(s, seatCost(s, i))) return false; s.rides[i].cap++; return true; }
  function buySpeed(s, i) { if (!s.rides[i].lvl || !spend(s, speedCost(s, i))) return false; s.rides[i].spd++; return true; }
  function buyPark(s, id) { if (!spend(s, parkCost(s, id))) return false; s.park[id]++; return true; }
  function buyPerk(s, id) {
    const c = perkCost(s, id);
    if (!(c <= tickets(s))) return false;
    s.ticketsSpent += c; s.perks[id]++;
    return true;
  }

  function ticketsTotalFor(lifetime) { return Math.floor(Math.sqrt(Math.max(0, lifetime) / TICKET_SCALE)); }
  function pendingTickets(s) { return Math.max(0, ticketsTotalFor(s.lifetimeEarned) - s.ticketsEarned); }
  function sellPark(s) {
    const gain = pendingTickets(s);
    if (gain < 1) return null;
    const keep = Object.assign({}, s, { ticketsEarned: s.ticketsEarned + gain });
    return { state: newState(keep), gain };
  }

  function offlineLimits(s) {
    return { hours: 2 + s.park.night, eff: 0.5 + 0.025 * s.park.night };
  }

  // ---------- Simulation ----------
  function poisson(mean, rnd) {
    if (mean <= 0) return 0;
    if (mean > 40) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss(rnd)));
    const L = Math.exp(-mean);
    let k = 0, p = 1;
    do { k++; p *= rnd(); } while (p > L);
    return k - 1;
  }
  function gauss(rnd) { return Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd()); }

  const GROUPS = [[1, 0.24], [2, 0.32], [3, 0.14], [4, 0.18], [5, 0.08], [6, 0.04]];
  const AVG_GROUP = GROUPS.reduce((a, [n, p]) => a + n * p, 0);
  function groupSize(rnd) {
    let x = rnd();
    for (const [n, p] of GROUPS) { if ((x -= p) <= 0) return n; }
    return 2;
  }

  // Advance the park by dt seconds. With rnd, arrivals are random groups; without, expected values are used.
  // Returns what happened so the UI can animate it.
  function step(s, dt, rnd) {
    const snap = snapshot(s);
    const { g, stats } = snap;
    const out = { groups: [], earned: 0, rideEarned: [], turnedAway: 0 };

    // Arrivals
    let arrivals;
    if (rnd) {
      const nGroups = poisson(snap.lambda * dt / AVG_GROUP, rnd);
      arrivals = 0;
      if (nGroups > 30) arrivals = Math.round(nGroups * AVG_GROUP);
      else for (let k = 0; k < nGroups; k++) { const n = groupSize(rnd); arrivals += n; out.groups.push(n); }
    } else {
      arrivals = snap.lambda * dt;
    }
    const room = Math.max(0, g.capacity - s.inPark);
    if (arrivals > room) { out.turnedAway = arrivals - room; arrivals = room; }
    s.inPark += arrivals;
    const gate = arrivals * snap.ticketPrice * g.incomeMult;

    // Rides: demand is shared by fun, queues fill when demand beats throughput.
    const demandTotal = s.inPark / RIDE_EVERY;
    let rideMoney = 0, satNum = 0, satDen = 0;
    for (let i = 0; i < stats.length; i++) {
      const st = stats[i];
      out.rideEarned[i] = 0;
      if (!st) continue;
      const r = s.rides[i];
      const demand = snap.appeal ? demandTotal * st.fun / snap.appeal : 0;
      const maxQueue = st.throughput * g.tolerance * 3;
      let incoming = demand * dt;
      const space = Math.max(0, maxQueue - r.queue);
      const balked = Math.max(0, incoming - space);
      incoming -= balked;
      const available = r.queue + incoming;
      const served = Math.min(available, st.throughput * dt);
      r.queue = available - served;
      const money = served * st.price;
      out.rideEarned[i] = money;
      rideMoney += money;
      const wait = r.queue / st.throughput;
      let sat = wait <= g.tolerance ? 1 : Math.max(0, 1 - (wait - g.tolerance) / (2 * g.tolerance));
      if (demand > 0 && balked > 0) sat *= Math.max(0, 1 - balked / (demand * dt));
      r.wait = wait;
      r.util = st.throughput ? demand / st.throughput : 0;
      satNum += demand * sat; satDen += demand;
    }
    const food = s.inPark * g.foodRate * snap.avgPrice * dt;

    // Departures
    const leaving = rnd ? Math.min(s.inPark, poisson(s.inPark * dt / STAY, rnd)) : s.inPark * dt / STAY;
    s.inPark = Math.max(0, s.inPark - leaving);

    // Satisfaction drifts toward the current mood of the crowd.
    const target = satDen ? satNum / satDen : 1;
    s.satisfaction += (target - s.satisfaction) * Math.min(1, dt / 20);

    const earned = gate + rideMoney + food;
    s.cash += earned; s.runEarned += earned; s.lifetimeEarned += earned;
    s.totalVisitors += arrivals; s.runVisitors += arrivals;
    s.time += dt;
    s.effects = s.effects.filter(e => e.until > s.time);

    const a = Math.min(1, dt / 5);
    s.rate.rides += (rideMoney / dt - s.rate.rides) * a;
    s.rate.gate += (gate / dt - s.rate.gate) * a;
    s.rate.food += (food / dt - s.rate.food) * a;
    s.rate.arrivals += (arrivals / dt - s.rate.arrivals) * a;
    const inc = s.rate.rides + s.rate.gate + s.rate.food;
    if (inc > s.bestIncome) s.bestIncome = inc;

    out.earned = earned;
    out.arrivals = arrivals;
    out.leaving = leaving;
    return out;
  }

  // Offline progress: settle the park deterministically, then pay the steady income for the rest.
  function offline(s, seconds) {
    const lim = offlineLimits(s);
    const capped = Math.min(seconds, lim.hours * 3600);
    if (capped < 10) return null;
    const cash0 = s.cash, vis0 = s.totalVisitors;
    const settle = Math.min(capped, 300);
    let t = 0, tail = 0, tailT = 0;
    while (t < settle) {
      const before = s.cash;
      step(s, 1);
      t += 1;
      if (t > settle - 60) { tail += s.cash - before; tailT += 1; }
    }
    const rest = capped - settle;
    const perSec = tailT ? tail / tailT : 0;
    const extra = perSec * rest * lim.eff;
    const extraVis = s.rate.arrivals * rest;
    s.cash += extra; s.runEarned += extra; s.lifetimeEarned += extra;
    s.totalVisitors += extraVis; s.runVisitors += extraVis;
    s.time += rest;
    s.effects = [];
    s.nextEventAt = s.time + 60; s.nextBalloonAt = s.time + 30;
    return { seconds, counted: capped, earned: s.cash - cash0, visitors: s.totalVisitors - vis0, eff: lim.eff, hours: lim.hours };
  }

  const EVENTS = [
    { type: 'sunny', w: 4, dur: 60, title: 'Perfect weather', text: 'Sunshine all round. Visitor arrivals ×1.5.' },
    { type: 'celebrity', w: 2, dur: 45, title: 'A celebrity is visiting', text: 'Fans are flooding in. Arrivals ×2.' },
    { type: 'heat', w: 2, dur: 60, title: 'Heat wave', text: 'Water rides are 3× as popular.', needsWater: true },
    { type: 'bus', w: 3, dur: 8, title: 'Tour buses arrived', text: 'A convoy of tour buses just pulled in.' },
    { type: 'rain', w: 1.5, dur: 40, title: 'Light rain', text: 'Some people stay home. Arrivals ×0.7.' },
  ];
  function rollEvent(s, rnd) {
    const water = s.rides.some((r, i) => r.lvl && rideDef(i).water);
    const pool = EVENTS.filter(e => !e.needsWater || water);
    let x = rnd() * pool.reduce((a, e) => a + e.w, 0);
    let ev = pool[0];
    for (const e of pool) { if ((x -= e.w) <= 0) { ev = e; break; } }
    s.effects.push({ type: ev.type, until: s.time + ev.dur });
    let busVisitors = 0;
    if (ev.type === 'bus') {
      const snap = snapshot(s);
      busVisitors = Math.min(Math.max(0, snap.g.capacity - s.inPark), Math.max(8, Math.round(snap.lambda * 30)));
      s.inPark += busVisitors; s.totalVisitors += busVisitors; s.runVisitors += busVisitors;
    }
    s.nextEventAt = s.time + 90 + rnd() * 150;
    return Object.assign({}, ev, { busVisitors });
  }

  function popBalloon(s, rnd) {
    const inc = s.rate.rides + s.rate.gate + s.rate.food;
    if (rnd() < 0.6) {
      const prize = Math.max(25, inc * 90, s.cash * 0.05);
      s.cash += prize; s.runEarned += prize; s.lifetimeEarned += prize;
      return { kind: 'cash', amount: prize };
    }
    s.effects.push({ type: 'rush', until: s.time + 30 });
    return { kind: 'rush' };
  }

  // ---------- Formatting ----------
  const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg'];
  function fmt(n, digits) {
    if (!isFinite(n)) return '∞';
    if (n < 0) return '-' + fmt(-n, digits);
    if (n < 1000) return n < 10 && digits !== 0 ? (Math.round(n * 10) / 10).toString() : Math.floor(n).toString();
    const e = Math.floor(Math.log10(n) / 3);
    if (e < SUFFIX.length) {
      const v = n / Math.pow(1000, e);
      return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + SUFFIX[e];
    }
    return n.toExponential(2).replace('+', '');
  }
  function money(n) { return '$' + fmt(n); }
  function duration(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + ' s';
    if (sec < 3600) return Math.floor(sec / 60) + ' min ' + (sec % 60 ? (sec % 60) + ' s' : '');
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h + ' h' + (m ? ' ' + m + ' min' : '');
  }

  root.Joyland = {
    STAY, RIDE_EVERY, MAX_SPEED, PARK_UPGRADES, PERKS, EVENTS,
    rideDef, milestonesPassed, nextMilestone, newState, migrate, globals, rideStats, snapshot, priceLabel,
    levelCost, maxLevels, seatCost, speedCost, parkCost, perkCost, seedCash,
    buyLevels, buySeats, buySpeed, buyPark, buyPerk, tickets, pendingTickets, ticketsTotalFor, sellPark,
    offlineLimits, step, offline, rollEvent, popBalloon, hasEffect, fmt, money, duration,
  };
})(typeof window !== 'undefined' ? window : globalThis);
