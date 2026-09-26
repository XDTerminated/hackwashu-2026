# 🌙 Moon Village

*Earth sent you to the Moon for talking about AI too much. Turns out AI is how you stay close to everyone.*

A Stardew-style colony on the Moon where **every villager is a real AI agent connected to your real
accounts**: Gmail, Google Calendar, Canvas, the web, and your phone via Photon. You play a cozy
game; your villagers read your mail, check your deadlines and book your week. Anything that leaves
your account waits for your OK: a letter at your door in-game, or a text you answer with "yes".

Built at HackWashU Fall 2026, theme *Fly Me to the Moon*.

## Run it

```bash
npm install
npm run dev        # game at http://localhost:5173, agent server on :8787
```

Keys go in `.env` (repo root) or `server/.env`; see `server/.env.example`. You need one brain
(`GROQ_API` or `ANTHROPIC_API_KEY`). Every account connection is optional: an unconnected villager
can run on clearly labeled **sample data** until you connect it.

Fresh colony: stop the server, delete `server/data/world.json`, start again.
`UNLOCK_ALL=1` starts a fresh colony with everything built (demo prep). `DEV_TOOLS=1` enables
websocket dev commands `{"type":"dev","action":"complete_quest" | "meteor" | "dust"}`, handy for
rehearsing the demo or summoning a meteor shower on cue.

## Unlocking the colony

You start with the **Jade Rabbit** (your guide) and the **Stargazer** (live web research).
Each villager's real work uncovers the next one. Coins come from popping finished work ("baby clods").

| Quest | Unlocks | Moves in when you connect |
|---|---|---|
| Ask the Stargazer 3 questions | Post Office plot | **Google**: Postmaster reads Gmail, drafts replies |
| Have the Postmaster check your mail | Clock Tower + Rocket Pad plots | same Google account: Timekeeper reads and books your Calendar |
| Ask the Timekeeper about your week | Library plot | **Canvas** token: Scholar reads courses, due dates, announcements |
| Give the Rabbit a job for two neighbors | the finale | (Rabbit starts coordinating once two neighbors live here) |

Build a plot, then press **E** at the new house to "call" its villager: **CONNECT GOOGLE** opens
Google sign-in; for Canvas, paste an access token; or choose **USE SAMPLE DATA** for now.

Buildings the quests reveal are free, so you can never get stuck. Construction takes a few seconds:
scaffolding goes up, baby clods hammer away, and a path is laid once it's done.

## Earning coins

- **Pop clods**: every real tool call a villager makes leaves a clod worth a few coins.
- **Moondust**: drifts pile up by the solar lamps and dim them, even while you're away. Hold SPACE to sweep one (3¢).
- **Meteors**: a shadow and a whistle, then a glowing moon-rock. Grab it (SPACE) before it cools (8¢). Sometimes a shower comes.
- **Villager chores** (opt-in, per villager): tick **[ ] CHORES** in their dialog and, when idle, they do a small real check every 15 minutes (unread mail, next 24h, what's due, space news). Each round uses real API calls. Chores never count toward quests.

When they're not working, villagers wander, visit each other and gossip: scripted lines plus small talk about
what they actually fetched for you (no extra API calls).

## Every game element is something an agent is actually doing

| On the island | What the agent is doing |
|---|---|
| Villager walks to a building | Using that tool: Mailbox = read inbox, Post Office = draft, Rocket Pad = send, Clock Tower = calendar, Library = Canvas, Observatory = web |
| Thought bubble over a villager (click it) | Its latest reasoning |
| Baby clod runs off, then glows | One real tool call finished. SPACE pops it for the result and coins |
| Two villagers meet, a letter flies | A handoff between agents |
| Villager at your door with ❗ and a letter | Needs your OK to send an email or book an event. The same letter texts your phone |
| Building smokes | A tool failed ("the post office is closed") |
| Lantern rises | Task done; the lantern ring at the plaza is your history |

## Safety

- Sending email and creating calendar events always need your approval. Reading never changes anything, and Canvas is read-only.
- Villagers treat email, Canvas and web content as data, never as instructions (prompt-injection guard).
- Tokens live in `server/data/` (gitignored, owner-only permissions). Revoke any time from Google or Canvas settings.

## Controls

Walk with **WASD** / arrow keys. Everything else is on the **icon toolbar** at the bottom (hover an icon for its name):

- **MoonPad** (tablet): text any villager who's moved in to get to know them. Texts are just conversation: villagers remember what you tell them (saved on the server with the colony) and friendship grows, shown as hearts. Ask for real work over text and they'll invite you to their house; tasks only run when you ask in person, and those visits count double toward friendship. A red badge means new replies.
- **Supply Pod** (crate): 12 decorations from a 25¢ flag to a 120¢ habitat dome (prices are checked on the server).
- **Quests** (scroll) · **Help** (?)
- **Call** (phone): lights up at a villager's door when they're out; they walk home. There's also a CALL button at the door itself, and E works too.
- **Edit layout** (pencil): pick up any building, plot or decoration and set it down anywhere on the island. Everything snaps to the 16px tile grid; the footprint turns green where it fits and red where it doesn't (tiles must be on the island and free, the plaza and your ship stay clear, and buildings keep the tile row in front of their door open). Paths, lamps and doorbells follow the building. The banner above the toolbar has SELL (for decorations), CANCEL and DONE. Positions are saved on the server and checked there too.
- **Action button** (right end): its icon shows whatever you're standing next to: talk, read a letter, build, pop a clod, grab a moon-rock, hold to sweep, or arrange a decoration.

Keys are optional shortcuts: E (action/call), SPACE (pop/grab, hold to sweep), B (Supply Pod), ESC (put down / leave edit mode).

## Texting the colony (Photon Spectrum, iMessage)

Set `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET` (Photon dashboard → Settings) and `PLAYER_PHONE`
in `.env`. The Jade Rabbit texts you when you land. Text any villager by name to chat
(`Stargazer: how was stargazing?`); anything else goes to the Rabbit; like the MoonPad, texts build
the friendship and real work waits for a visit; `help` lists who's
around. Approval letters also arrive as texts: reply YES or NO. No credentials yet? `PHOTON_TERMINAL=1`
runs the same flow in Photon's terminal chat.

The buildings sit evenly on one circle around the central plaza, each with a single path.

## Pixel-perfect rendering

The game renders at art resolution and the browser upscales it by a whole number, so every pixel on
screen is the same size, text included (a hand-placed bitmap font). Sprites are never scaled or rotated.

## Layout

```
shared/game.ts            contract: buildings, villagers, quests, events, snapshot
server/src/connectors/    real Gmail + Calendar (Google OAuth) and Canvas
server/src/services.ts    live-or-sample routing, residents, quest chain
server/src/agents.ts      villager tool-use loops (Claude or Groq), approvals
client/                   Phaser 3 + Vite; all art generated from code
```
