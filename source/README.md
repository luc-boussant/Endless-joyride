# Endless Joyland

Ad-free amusement park idle game. Playable link: https://claude.ai/artifact/4BjGUiEsG2C1Myssz2cmgL

- `src/core.js`: rules and simulation (no DOM, runs in Node for balance tests)
- `src/ui.js`: panels, game loop, saving, guest movement, label layer over the 3D view (and a flat 2D map if WebGL is missing)
- `src/scene3d.js`: the 3D park (three.js r128, `src/vendor/three.min.js`): animated low-poly rides, construction sites, guests, decorations; drag to pan, pinch to zoom, twist to turn, tap to select
- `src/index.html`: page template and styles
- `node build.js` writes `endless-joyland.html` (published as the Claude artifact) and `app/` (installable iPhone web app: index.html, manifest, offline service worker, icons). `app/` is meant to be hosted on GitHub Pages.
- Layout: one screen, no page scroll. HUD on top, scrollable park map, fixed control dock with Rides/Park/Legacy/Stats tabs. Tap a ride on the map to manage it.

## How the game works
- Visitors arrive at random in groups (Poisson). Arrival rate grows with total ride fun (^0.85), mascots, golden tickets and events, and drops with ticket price and bad mood.
- Visitors stay ~90 s and want a ride every 15 s. Demand is split across rides by fun. Each ride has a queue; waits beyond the patience limit make the crowd grumpy, which cuts arrivals.
- Each ride has three upgrades: level (fun + ticket price, milestones at 10/25/50/75/100 then every 50 double the price), seats, speed.
- Park upgrades: land (capacity), snacks, mascots, crew, comfort (patience), night security (offline time and rate).
- Prestige: sell the park for golden tickets = floor(sqrt(lifetime earnings / 1e12)); each one gives +3% income and +1% arrivals and can buy perks.
- Rides after the 12 handcrafted ones are generated forever. Offline progress finishes due construction, settles the park, then pays steady income at 50% (up to 94%) for 4 h (up to 26 h).
- Saves in localStorage under `endless-joyland-v2` (v2 started everyone fresh), with export and import codes in Stats. Claude link cloud save: `data/users/<id>/save2`.
- Goals: 3 short goals always on offer (built from the current park), paid in cash; every 5th goal gives ×2 income for 5 min.
- Ride managers: 3 tiers per ride (tickets ×2, +50% riders, tickets ×2 and fun ×1.5).
- Decorations (Decor tab): flower beds, lamp posts, fountains, mascot statues; drawn on the map and give fun, patience or arrivals.
- Guest thoughts: bubbles over queueing guests that hint at problems (long queues, crowding, no snacks, high prices).
- Queues: wait = half a ride cycle, growing sharply as demand nears capacity (u/(1-u)), plus backlog. Ride throughput scales 1.45^tier so rides do fill up.
- Mood = queues × space (crowding above 85% full) × entry price × food × decor bonus; tap Mood in the HUD for the breakdown. Labels: Happy, Content, Restless, Grumpy.

## v2 pacing (2026-10-23)
- Construction takes real time and a free builder crew: new ride i takes 60 s × 2.3^i (×1.25 per ride after the 11th), seats 25 s×(1+i)×1.35^seats, speed 60 s×(1+i)×1.5^speed, land 120 s×1.7^land. Level-ups stay instant.
- Builder crews: 1 + up to 3 more (Park tab). Master builders perk: −10% build time per level. Golden balloons can give crews coffee (−5 min on all builds).
- Breakdowns: each ride breaks about once an hour (Mechanics make it rarer and repairs faster); a broken ride earns nothing and its line leaves unhappy. Tap Repair to fix it at once.
- Bot sim (sessions of 20 min every 3 h, nights offline): rides 1–3 in the first 15 min, ride 4 after ~3 h, ride 8 on day 1, ride 12 around day 10. Sim script lives in the session scratchpad (bot2.js); rerun before balance changes.
