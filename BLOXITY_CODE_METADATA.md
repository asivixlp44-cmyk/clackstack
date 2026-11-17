---
game: Clackstack
slug: clackstack
canDie: false
hasScore: true
multiplayer: true
hostedOnBoxity: true
roomSize: 16
gameplayAds: false
inAppPurchases: false
---

# Clackstack: Boxity integration notes

Answers from the developer (2026-11-17):

- **canDie: false.** Nothing kills the player. Falling off a flight drops you: once you're well below your checkpoint (or you land on the
  plaza from high up), you're put back on your checkpoint landing. The game does not use `deathScreen`. Boxity's "Reset Character"
  (`respawn_request`) sends you back to your checkpoint at once.
- **hasScore: true.** Four boards, declared in `shared/config.js` (`LEADERBOARDS`) and submitted by the server from server-owned state
  (`server/src/bloxity.js`, `server/src/TowerRoom.js`):

  | id | label | order | mode | format | reset |
  |---|---|---|---|---|---|
  | `stage` | Highest stage | desc | best | number | weekly |
  | `wins` | Summit wins | desc | sum | number | weekly |
  | `playtime` | Playtime (min) | desc | sum | number | none |
  | `coins` | Coins earned | desc | sum | compact | weekly |

  `stage` is reported when a player's highest landing ever goes up (checked on the server: a landing only counts when you're standing on
  it and it's the one after your best). `wins` is +1 per Summit (every 10th stage), `coins` the Coins earned (batched every 10 s and on
  leave), `playtime` +1 a minute.
- **Gameplay banners: off.** Screens declared: `panel` (Gear Shop, Pals, a Capsule, Quests, Daily, Prize Wheel, Restack, Stages, Ranks,
  Gifts, Settings), `results` (the Summit card), `gameplay` (no banners). There is no start menu and no lobby screen.
- **No in-app purchases.** Everything costs Coins or Gems earned in the game, so there is no Gems purchase or webhook.
- **Rewarded ads:** `skip-stage` (FREE SKIP: the next landing) and `double-coins` (FREE 2X COINS for 10 minutes), each shown only while
  `ads.isAvailable()`. The server checks every token with `POST {BLOXITY_API_URL}/v1/ads/reward/verify` before granting.

Where things live:

- Client SDK wrapper: `client/src/bloxity.js` (the only `onUserChanged` subscription, the environment helper `env()`, avatar slots, the
  character kit, custom characters, chat, ads, leaderboards, settings).
- Avatars: `client/src/avatar.js` (every slot from `avatar.getAccessorySlots()`, the platform character kit when `character.canDress`,
  custom characters from `avatar.getCharacterFor`, skins from `avatar.getSkinTextureUrlFor`).
- Server: identity `POST /v1/auth/game-token/verify` (with `carriedFrom` guest progress), rewarded-ad verify, leaderboards report,
  profile stats: `server/src/bloxity.js`. Guest progress adoption: `server/src/profiles.js` (`adoptGuestProgress`). Open Rooms:
  `server/src/legion-room-reporter.js` (`installRoomReporter()` after `listen`).
- Matchmaking: `client/src/main.js` `serverEndpoint()` resolves a pod with `Legion.SDK.net.resolveEndpoint('clackstack')` on every
  connect (a new Client each time, retried for up to a minute). No socket ever opens to `clackstack.host.bloxity.io`. `?roomId=` joins
  that room through its pod's relay first (`{playUrl}/v1/dir/clackstack/list`), else normal matchmaking.
- Emotes: `game.registerFeature('emotes')` right after init; `play_emote` plays on your avatar and is relayed to the room.
