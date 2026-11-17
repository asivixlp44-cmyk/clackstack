# Clackstack

A multiplayer obby for the browser, built with **Three.js** and **Colyseus** for Bloxity (listed as **Clackstack 🌈 Keycap Tower**, slug
`clackstack`). **An endless tower of giant keycaps, at dusk.** Flights of backlit two-tone mechanical keys (graphite and light grey caps, one
accent colour per zone, legends and under-key LEDs glowing) wind up round the outside of the Stack, a colossal dark keyboard-case pillar with LED strips
that rises from a round plaza (a desk mat with lit keycap tiles and a neon garden), up through a sea of clouds and on into space. Every
flight is a stage and every corner landing is a checkpoint: a new landing pays Coins, and every tenth stage is a **Summit** that pays a Win
and Gems and opens a new LED zone. Every key works like a real one: it goes down its full travel under you (you sink with it), a hard
landing squashes it to the bottom with dust and sparks in its LED colour, and when you step or jump off it springs back up and settles.
You walk up the stairs (a step up to 2.1 studs: a flight's next row is ~1.2 higher); a jump is only needed where the flight asks for
one. The higher you climb, the harder the flights get (holes, stepping keys, long leaps, single-key ridges, ENTER keys that bounce you up a
cliff, slippery SHIFT keys, keys that blink in and out, keys that slide side to side, keys that drop away under you) and the deeper into
the night the sky goes (a neon dusk, the blue hour over the clouds, a moonlit sky, a synth sunset, deep twilight, an aurora, the
starfield). Bonk other climbers off the stairs with the Bonk Glove, buy Boing Boots,
Zoom Sneakers, the Double Jump, the Cloud Carpet and Rocket Hop, hatch keycap Pals that multiply your Coins, and **Restack** (back to
stage 1) for a Coin multiplier that stays.

Only the genre, the core loop and the feel come from the reference (*Infinite Keyboard Tower* on Roblox: a tower of keyboard-key stairs,
stages and checkpoints, a stage picker, a skip, wins, tools). **Everything a player sees is our own**: the name, the outside-of-the-pillar
spiral and its generator, the zones and skies, the obstacle kinds, the plaza, the Pals, the tools, the HUD and its art, every word, the
sounds and the music. Nothing is taken from it.

**There are no in-app purchases.** Everything costs Coins (landings, floating coins, quests, gifts) or Gems (Summits, quests, daily tasks,
gifts, the wheel, the daily reward, codes). No Bux are spent anywhere.

It shares its engine with the other Legion games (the server, Bloxity login and avatars, the top games' character animation, the camera and
lighting rig, the quality system, profiles, saves, play stats, the keycap renderer and switch sounds, the test scripts, the deploy
workflow). It was started from the newest Legion game, Keystomp, and given its own content: a procedurally generated endless tower
instead of a desk, a climbing obby instead of a clicker.

## Project layout

| Folder | What it is |
|---|---|
| `client/` | Vite + Three.js client. **`main.js`**: boot and warm-up, you on the shared physics against the keys round you (moving keys, bounces, ice, drops, the slide carrying you), landings and checkpoints, coins, falls back to your checkpoint, the tools (Bonk Glove, Cloud Carpet, Rocket Hop, Rainbow Glove), the stage picker and SKIP, the camera (it slides along the pillar), keyboard / mouse / touch / controller, everyone else smoothed on the server's clock, networking, the climbing autopilot (QA). **`world.js`**: the pillar (one box following the camera up, painted in its shader), the sea of clouds, the plaza, the flights built in chunks round you, the moving keys, the coins, the landing numbers, the beacon over your next landing. **`keys.js`**: every keycap (legends, press under feet and pop-in in the vertex shader, the Rainbow Rush). **`buddies.js`**: the 28 Pals (built from recipes, instanced per kind) and their portraits. **`ui.js`** + `index.html`: HUD and panels. **`bloxity.js`**: the whole Boxity SDK integration. **`avatar.js`**: Bloxity avatars. The rest (engine, fx, audio, asmr, animator, chars, signs) is the Legion engine. |
| `server/` | Colyseus 0.18 server. **`TowerRoom.js`** (the `tower` room): landings (only the one after your best, only standing on it), floating coins (near you, once in 90 s each), the move guard (how far, how fast up, how high), bonks (reach, cooldown, safe landings), the stage picker, skips (Gems or a verified rewarded ad), upgrades, gear, trails, Capsules, Restack, the Rainbow Rush, rewards, codes, bots that hop up the path. **`bloxity.js`**: identity, rewarded-ad tokens, leaderboards, profile stats. **`legion-room-reporter.js`**: Boxity's cross-pod room directory. `profiles.js` / `saves.js` / `stats.js`: saves (MongoDB on Legion, a JSON file locally), play stats. |
| `shared/` | **`config.js`**: zones, skies, what a stage pays, upgrades, gear, trails, Restack, Pals and Capsules, titles, the wheel, tasks, quests, rewards, codes, the boards. **`world.js`**: the tower: the pillar, each stage's frame, the seeded stage generator (the same keys on every screen and on the server), landings, coins, moving keys, the solids, the bots' route. `physics.js`: walking, jumping, the Double Jump, gliding. |
| `tests/` | The test scripts (see Testing), the setup-page and cover generators |
| `covers/` | The two store covers (1920x1080, 800x800), rendered from the game by `node tests/covers.mjs` (git-ignored) |

## Run it locally

Double-click **`start-local.bat`** (installs what's missing, builds, starts the server on http://localhost:3163 and opens the browser).
The link only works while that window is open. If another program already has port 3163 (another local game or a test server), the
launcher uses the next free port up to 3176 and opens that instead. `tools/local-port.mjs` picks the port: `/health` answers
`game: 'clackstack'`, so a second double-click just reopens the running game.

Or by hand (Node 20+):

```
npm install          # installs server and client
npm run build        # builds client/dist
npm start            # the game server on http://localhost:3163 (serves the built client too)
```

Development: `npm run dev:server` (port 3163) and `npm run dev:client` (Vite on http://localhost:5705, which tells the page it runs against a
local Boxity: `window.BLOXITY_ENV` with `env: 'local'`, from a dev-server-only plugin). Ports 3163 / 5705 don't clash with the other
Legion games. With `QA=1` on the server, `window.__qa` in a dev page can give Coins, stages, items and teleport (never on Legion).

## Gameplay

**The tower.** Stage *n* is one flight of keycaps along one face of the pillar (120 studs, five keys wide, 30 studs of climb), from landing
*n* at one corner to landing *n + 1* at the next; a lap of the pillar is four stages. The first landing is on the plaza, straight ahead of
where you spawn. The tower never ends: each stage is built from a seed (its number), so everyone sees the same keys, and the server checks
against the same ones. The stage generator picks two or three segments per flight from the kinds open at that height:

| Kind | From stage | What it is |
|---|---|---|
| Stairs | 1 | Every key there, a rough climb (some off the path stand tall) |
| Holes | 3 | Keys missing round the way up |
| Steps | 5 | A key every other row: hop row to row |
| Bounce | 7 | A big green ENTER key: it throws you up a cliff too high to jump |
| Narrow | 9 | A single-key ridge |
| Leaps | 12 | A key every third row: long jumps |
| Ice | 15 | SHIFT keys: you slide |
| Blink | 18 | Keys that come and go on the server's clock (they flash red before they go); each row's opposite to the last |
| Slide | 23 | Wide keys sliding side to side across gaps: they carry you |
| Drop | 27 | Cracked keys that fall away a moment after you step on them (and come back) |

Every stage is checked to be climbable with the starting jump (`tests/stages.mjs`: every row's gap and rise within the jump's reach),
and the autopilot climbs a stage of every kind in the real game (`tests/autopilot.mjs`).

**Zones and skies.** Every ten stages is a zone with its own LED colour, accent caps and switch sound (Crimson Switch, Ember Row, Amber
Deck, Venom Keys, Emerald Grid, Cyan Circuit, Cobalt Peak, Indigo Loft, Violet Heights, Magenta Crown, then round again, a little deeper).
The sky goes deeper into the night with height: Neon Dusk (1), Blue Hour (31: the sea of clouds is below you), Moonlit Sky (61), Synth
Sunset (91), Deep Twilight (121), Aurora (161), Starfield (211).

**Checkpoints and falls.** The landing you last stood on is your checkpoint. Fall well below it (or land on the plaza from high up) and
you're put back on it. Landings are safe spots: nobody can bonk you there. The stage picker (top of the screen, or `[` / `]`, or the
Stages panel) takes you back to any landing you've reached; BEST takes you back up. SKIP takes you to the next landing for a few Gems
(more the higher you are), or FREE for a rewarded ad.

**Coins and Wins.** A new landing pays `8 + 2.5 x stage` Coins; climbing back up to one you'd reached pays a quarter of that (once a
minute each). Four floating coins on each flight pay `2 + stage / 6` each (and come back for you 90 s later); Lucky Coins can make one pay
x5. A Summit (landings 11, 21, 31...) pays a Win and 3 Gems. Coins are multiplied by your Restacks (x1.5, x2, x2.5...), your Pals, x2 Coins
(Gems or a rewarded ad) and the **Rainbow Rush** (every 3-5 minutes, while someone's on the server: 30 seconds of x3 Coins with every key
flashing the rainbow).

**What Coins buy.** Upgrades at the Gear Shop (Boing Boots: +5% jump a level; Zoom Sneakers: +6% speed; Coin Magnet: grab coins from
further away; Lucky Coins; Pal Slots), gear (the Double Jump, the Cloud Carpet: hold JUMP while falling to float, Rocket Hop: blast
straight up every 9 s; the Rainbow Glove for Gems), trails everyone sees, and Capsules: 7 Capsules of 4 Pals each (common to legendary),
each Pal multiplying your Coins; a full collection pays Gems.

**Restack.** Once you reach stage 25 (then 40, 55...): back to stage 1 with no Coins, Coins x0.5 more for good, Gems. Your upgrades, gear,
trails, Pals, Gems, Wins and your highest stage stay.

**Things to do.** A 30-step quest chain, three daily tasks, a 7-day daily reward, seven playtime gifts (2 to 45 minutes), a Prize Wheel
(a free spin every 7 minutes), codes (`CLACKSTACK`, `RAINBOW`, `KEYCAP`, `BLOXITY`, `LEGION`, `SKYHIGH`), a guide for someone new (four
steps), titles over your head by your highest stage, two leaderboards on the plaza (highest climbers, most time played) and four on
Boxity. `tests/economy.mjs` simulates the first sessions: a Summit every ~3 minutes, the first Upgrades in the first two minutes, the first
Restack at ~9 minutes, the Double Jump at ~14, Capsules from ~18, the Cloud Carpet at ~30, Rocket Hop at ~44.

**Multiplayer.** Up to 16 climbers in one room (the fullest fills first); a few bots hop up the lower stages when it's quiet (one leaves
for every player who joins). Everyone's position is smoothed on the server's clock. The Bonk Glove (click, F or the hotbar) knocks a
player near you flying (the server checks reach and cooldown; landings are safe). The tower gauge on the right shows everyone's height.

## Controls

| Action | Keyboard / mouse | Controller | Touch |
|---|---|---|---|
| Move | WASD / arrows | Left stick | The stick |
| Jump (hold: keep hopping; hold while falling: Cloud Carpet) | Space | A | JUMP |
| Bonk | Click, F | X | Bonk on the hotbar |
| Tools | 1-4 | X / B / Y | The hotbar |
| Stage picker | `[` / `]`, T | LB / RB | ‹ › and the stage chip |
| Back to your checkpoint | R | | Settings |
| Use (Gear Shop, Capsules, Wheel, Restack, boards) | E | X | Tap the bubble |
| Camera | Drag, wheel | Right stick | Drag, pinch |
| Shop / Pals / Quests | G / B / Q | | The buttons |

## Boxity integration

Everything Boxity is in `client/src/bloxity.js` (client) and `server/src/bloxity.js` (server); `BLOXITY_CODE_METADATA.md` has the
developer's answers and where everything lives.

- The SDK loads from `https://sdk.bloxity.io/v1/legion-sdk.min.js` before the game's code; `Legion.SDK.init({ gameSlug: 'clackstack' })`
  runs once at boot. One build runs on prod, stage and local: every Boxity URL comes from `Legion.SDK.environment()` (or
  `window.BLOXITY_ENV`, prod when nothing was told), never from the page's hostname; the server reads `BLOXITY_*` env vars with prod
  fallbacks. The Vite dev server (only) tells a local page it runs against a local Boxity.
- One `auth.onUserChanged` subscription is the source of truth; a sign-in mid-game is verified on the same connection (no rejoin). The
  server verifies every token with `POST {apiUrl}/v1/auth/game-token/verify` and uses only the returned id; guests get a server-made id;
  a guest's progress follows them into a fresh account (`carriedFrom`). No login/logout buttons (Boxity's toolbar does that).
- Avatars: the whole look (every accessory slot, skins with pants/shirt/face, body parts, proportions, custom characters, the platform
  character kit), replicated as ids.
- Hosted on Boxity: every connect resolves a pod with `Legion.SDK.net.resolveEndpoint('clackstack')`; nothing connects to the host
  route. `?roomId=` (Open Rooms, invites) joins that room. Party play is automatic (rooms of 16 through the matchmaker).
- Emotes (`registerFeature('emotes')`, `play_emote`, the catalogue from `{apiUrl}/v1/avatar/emotes`), Boxity chat bubbles over heads,
  settings (volume, music, graphics, FPS, camera sensitivity), `respawn_request` (back to your checkpoint), the ESC menu, loading steps,
  `loadingEnd()` as soon as the game has joined (no start menu), `gameplayStart/End`, `updateRoom`, `playerJoined/InRoom`.
- Ads: ad breaks pause and mute; screens declared (`panel`, `results`: the Summit card, `gameplay` with no banners); rewarded ads
  `skip-stage` and `double-coins`, verified on the server (`/v1/ads/reward/verify`) before granting. No death screen (nothing kills you).
- Leaderboards: `stage`, `wins`, `playtime`, `coins`, declared on the client and reported by the server from its own state.

## Graphics and performance

Matte Lambert (and unlit) materials only: no reflections, environment maps, bloom or post-processing. The top games' light rig
(hemisphere 1.1, ambient 0.45, sun 1.5, PCFShadowMap, NoToneMapping); each sky band only tints it, and the colour comes from the LEDs
(emissive, no bloom). The pillar is a single box that follows the camera up, its dark anodised panels, brushing, grooves and LED strips
(a ring at every landing, one up each corner, a slow wave of light rolling up through them) painted in its shader by world height. The
keycaps are sculpted (rounded corners, a rounded top edge, a dish), with backlit legends, a thin LED glow at the skirt's foot, a highlight
on the top edge and a matte grain close up. Each stage is a chunk: its keycaps one instanced draw (pressed in the vertex shader: under
whoever stands on them, a squash on a hard landing, a spring back with a little overshoot when let go), its pedestals, their LED strips
and its landing one merged mesh, its moving keys one small instanced draw; chunks are built round you two a frame as you climb (all at once
behind the fade of a warp) and dropped when far. Flights well away from you draw the plain 40-triangle cap instead of the 132-triangle
sculpted one, and keycaps far from the camera aren't drawn at all. The key shader skips its press loop past the climbers actually standing
and its clack loop entirely when nothing has clacked for a second. Physics tests only the solids within 16 studs of you.

No material changes its shader from frame to frame (`node tests/mats.mjs` counts it: 0): see-through two-sided materials are drawn in one
pass (`forceSinglePass`; three.js otherwise flags them changed twice a frame), and every kind of shadow caster has its own depth material.

Measured (`tests/perf.mjs`, headless Chrome on this PC's GPU, bots about):

| Profile | Spawn (plaza + tower) | Climbing (autopilot) | Stage 40 (over the clouds) |
|---|---|---|---|
| Desktop, Medium, 1600x900 | 142 fps (the 144 Hz screen's cap) | 142 fps, no frame over 50 ms | 144 fps |
| Weak laptop, Low, 1366x768, CPU throttled 4x | 120 fps | 124 fps, no frame over 50 ms | 120 fps |
| Phone portrait, Low, 390x844 @2x | 72 fps (every other refresh) | 72 fps | 71 fps |

With vsync off (`UNCAPPED=1`): desktop 195 / 189 / 210 fps, weak laptop 136 / 137 / 135 fps. Draw calls 22-40, triangles 47K-140K. The
weak-laptop CPU profile (`tests/cpuprof.mjs`, unminified) shows no hot spot of the game's own and no shader work per frame (it lists who
asks three.js for shader parameters: nobody, after the start). Phones and weak PCs start on Low; the smoothness watch lowers the resolution
first, then the quality.

## Testing

| Script | What it checks | Result |
|---|---|---|
| `node tests/stages.mjs 600` | Every stage 1-600 climbable with the starting jump; coins, solids, landing frames | PASS |
| `node tests/server.test.mjs --spawn` | The whole loop and its guards headless: landings (far, skipped), coins (twice, far, unreached), moves (teleport, rising), Summits, the stage picker, re-climbs, SKIP, upgrades, gear, trails, Capsules, bonks (cooldown, safe landings), Restack, the Rush, codes, quests, daily, bots | 45 / 45 |
| `node tests/autopilot.mjs` | The autopilot climbs a stage of every obstacle kind in the browser | all 10 climbed |
| `node tests/smoke.mjs [portrait]` | The loop in a browser with screenshots: climbing, a Summit, the Rush, every sky, tools, panels, a Capsule | no errors |
| `node tests/screens.mjs` | Every screen at 390x844, 360x800, 375x667, 844x390, 1280x720: no overlaps, nothing cut off, the Boxity corner free | all clean |
| `npm run build && node tests/prod.mjs` | The production build with real input only: walk to the first landing, climb the first flight to landing 2 (paid), bonk, a panel, the stage picker | PASS, no console errors |
| `node tests/perf.mjs` / `node tests/cpuprof.mjs` | Frame rates on three profiles / a CPU profile on the weak laptop | see above |
| `node tests/economy.mjs [minutes]` | The first sessions simulated with the real formulas | see Gameplay |
| `node tests/covers.mjs` / `node tests/setup-page.mjs` | Render the covers / write `bloxity-setup.html` | |
| `node tests/looks.mjs [quality]` / `node tests/press.mjs` | Screenshots for judging the look (the plaza, the stairs, every sky) / a key press frame by frame | |
| `node tests/walk.mjs [N]` / `node tests/walkup.mjs` | Walking up without jumping: every step of the way on the shared physics for stages 1-N / the first flight in the browser with real keys only | 99.9% (1 diagonal step in ~4000) / PASS |
| `node tests/live.mjs` | The hosted game: loads, joins a server through the relay, real input, no console errors | LIVE OK |
| `node tests/mats.mjs` / `node tests/progwatch.mjs` | Materials whose shader is worked out again every frame / shaders compiled mid-game | 0 / none |

Browser tests need Chrome installed (`tests/` uses puppeteer-core); `npm --prefix tests install` once.

## Deploying

**Live:** https://clackstack.play.bloxity.io (server: https://clackstack.host.bloxity.io/health answers `"db": true`). The repo is
`asivixlp44-cmyk/clackstack`. `node tests/live.mjs` checks the live game in Chrome: it loads, joins a server through the matchmaker's relay
(never a socket to `clackstack.host.bloxity.io`), takes real key input, no console errors (first run, 2026-11-17: in the game in 6.6 s).

`.github/workflows/deploy.yml` deploys on every push: `main` to the production channel, `dev` to the playtest channel, to prod always and
to stage too once the repo has the `LEGION_DEPLOY_TOKEN_STAGE` secret (separate matrix jobs: a stage failure never blocks prod). A manual
run deploys any branch to one platform. It builds the server image (tagged per platform), tells Legion to roll it out with
`roomSize: 16`, builds the client once (no environment baked in) and uploads it.

Repository secrets: **`LEGION_DEPLOY_TOKEN`** (from hosting.bloxity.io) and, for stage, **`LEGION_DEPLOY_TOKEN_STAGE`** (from
hosting.stage.bloxity.io; see docs.bloxity.io > Environments > Getting your game onto stage). After the first run, make the GHCR package
`clackstack-server` public. `bloxity-setup.html` has every field of Boxity's Create New Game form and the hosting steps.
