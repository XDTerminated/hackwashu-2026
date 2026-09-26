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

## Play it online (everyone gets their own village)

The hosted version's title screen has a **SIGN IN WITH GOOGLE** button: everyone signs in before landing
(and "signed in as ... · sign out" sits in the corner after). Each account gets
its own private copy of the colony server: its own village and save, and its own connections (their
Gmail and Calendar, their Canvas, their Claude Code in the Office). Nobody shares anything.

- **Signing in** only asks for name and email. Gmail and Calendar are requested later, in the game,
  when Hoot moves in (the same Google app; the sign-in suggests the account you logged in with).
- **Canvas** online: GET A TOKEN opens your school's Canvas settings; make a token and paste it.
  (The automatic Canvas sign-in window only works when the game runs on your own computer.)
- **The Office** is already built in a new online village. Press E at the board → **LINK**: it shows
  one command to paste into a terminal on your own computer (needs Node.js 18+):
  `curl -fsSL https://<site>/bridge/<you>/script | node - ABCD-EFGH`. That small script (the Office's
  own log reader, `server/src/bridge.ts`) watches your Claude Code there and sends what it sees to your
  village only; your subagents walk into your Office live. `--summary` sends less; Ctrl+C unlinks.
  The code works once, for 10 minutes. REPLAY plays a recorded, scrubbed session (`server/demo/`).
- Texting (iMessage) is only on the host's own computer, never online.
- **Help → MY ACCOUNT**: sign out, or **DELETE MY DATA** (village, connections and account).

How it works: `server/src/gateway.ts` is the front door. It handles Google sign-in (signed session
cookies), starts each player's copy of `server/src/index.ts` on demand (`MOON_HOSTED=1`, its own
`MOON_DATA_DIR`), passes that player's pages and live connection (WebSocket) to their copy only, and
stops copies after 15 minutes idle (saves stay on disk). Each copy is about 70-130 MB of memory.

### Deploying (Railway)

1. Push the repo to GitHub and create a Railway service from it. `railway.json` sets the build
   (`npm run build`: the game plus the link script) and start (`npm start`: the gateway) commands.
2. Add a **volume** (for example mounted at `/data`) so villages survive redeploys, and give the
   service about **2 GB of memory** (roughly 15-25 players at once).
3. Generate a domain (Settings → Networking), then set these variables:

   | Variable | Value |
   |---|---|
   | `MOON_PUBLIC_URL` | `https://<your-app>.up.railway.app` |
   | `MOON_DATA_ROOT` | `/data` (the volume) |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | your Web OAuth client |
   | `GROQ_API` | the villagers' brain |
   | `SESSION_SECRET` | any long random string |

4. In Google Cloud → your OAuth client → **Authorized redirect URIs**, add both:
   `https://<your-app>.up.railway.app/auth/google/callback` (signing in) and
   `https://<your-app>.up.railway.app/oauth/google/callback` (connecting Gmail + Calendar).
   On the consent screen, add the domain under Authorized domains and the privacy page
   (`https://<your-app>.up.railway.app/privacy`). Until Google verifies the app, up to 100 people
   can grant Gmail access, after a "Google hasn't verified this app" screen.

Test the online setup on your own computer: `npm run build`, then
`cd server && MOON_DEV_LOGIN=1 PORT=8090 npx tsx src/gateway.ts` and open http://localhost:8090. The title
screen shows SIGN IN WITH GOOGLE; to sign in without Google while testing, open
http://localhost:8090/auth/dev?email=you@example.com (only with `MOON_DEV_LOGIN=1`; never set it on the real site).

## The story

The first time you land, an animated intro (about a minute and a half, drawn in code like the rest
of the art) shows how you got here:

1. **Earth, at night.** A full moon over the city; the camera pans down to one lit window.
2. **Dinner.** You won't stop talking about AI agents. Dad: "Every. Single. Dinner." Grandma looks out at the moon: "...You know, there's plenty of room on the Moon."
3. **The vote.** 4 to 1. A one-way ticket slides in and gets stamped APPROVED.
4. **Launch.** The family waves a BYE!! banner; countdown, liftoff.
5. **The trip.** Day 2, the snacks run out; day 3, the Wi-Fi. Your texts home come back "Not Delivered".
6. **The Moon.** Population: one rabbit, one stargazer. Yutu tells you every line home went quiet, but each neighbor who moves in brings one back... and the neighbors are AI agents. "This is the BEST DAY OF MY LIFE."

SPACE hurries it along, ESC skips. Replay it from the title screen (I) or from the Quests dialog (WATCH INTRO).

Each neighbor who moves in opens the next chapter, and a card announces it (Chapter 2: Keeping Time when
Hoot arrives, 3: The Scholar when Cog does). When the last neighbor moves in, the **finale** plays: a night on the Moon
with every neighbor home and fireworks overhead, then four bars of signal and a video call from the
family at the same dinner table ("...Every. Single. Call."). Rewatch it from the Quests dialog.

## Unlocking the colony

The villagers: **Yutu the Jade Rabbit** (your guide), **Nova the Stargazer** (web research), **Hoot the Postmaster** (Gmail),
**Cog the Timekeeper** (Calendar) and **Mabel the Scholar** (Canvas). Text them by name or role ("Nova: ..." or "Stargazer: ...").

You start with Yutu and Nova. The other neighbors are waiting on Earth, and each one's lot on the Moon is an
old ruin. Like moving villagers in in Animal Crossing, each lot has a **checklist** (on its sign, in Quests,
and the gold ★ always points at the next step):

1. **Clear the rubble** off the lot (press E on each pile; each gives a moonstone).
2. **Repair the foundation** with materials you collect around the island.
3. **Build the house** with coins.
4. **Decorate:** put something they love in the yard (hover a decoration, or check the Supply Pod, to see who loves it).

Then they move in (with a hello and a housewarming gift), the next lot opens, and a new chapter starts.
**Connecting your real account comes after they move in**: the first time you talk to them they ask for
it (or try them on sample data), and then they work with your real mail, calendar or classes.

| Neighbor | Lot | Rubble | Foundation needs | House | Yard |
|---|---|---|---|---|---|
| Hoot the Postmaster | Post Office | 3 | 3 moonstone, 2 stardust | 30¢ | 1 thing Hoot loves |
| Cog the Timekeeper | Clock Tower | 3 | 4 moonstone, 3 stardust, 1 moon shard | 60¢ | 2 things Cog loves |
| Mabel the Scholar | Library | 4 | 5 moonstone, 3 stardust, 2 moon shards | 90¢ | 2 things Mabel loves |

**Materials:** moonstone from clearing boulders (free now: small rocks give 1, big ones 2 or 3), rubble and
fallen meteor rocks; stardust from sweeping moondust drifts; moon shards from the 12 glinting in the wilds
(spending them doesn't un-find them: find all 12 and the beacon still relights). **Coins** come from popping
clods after your neighbors finish work (so using them pays), sweeping, meteors, requests and shards.
Hoot moving in also opens an upgrade for his Post Office: the **Mail Rocket** (free), built onto its east wall with a brass mail tube from the Post Office into the rocket. It lets him send your replies, with your OK, and it moves with the Post Office in edit mode.
Saves from the old quest chain carry over: anyone who had a house counts as moved in.

## The Office (for developers)

The other buildings are everyday agents. The **Office** (a 120¢ plot northeast of the plaza, open from
the start) is for developers: a live view of your **coding agents**. When Claude Code spins up subagents
and the work takes a while, walk in and watch them.

- **Your Claude Code session is the Team Lead**, standing by the board. **Every subagent it sends out is a
  worker**: it walks in from the elevator when it's spawned, takes one of twelve desks, and works there.
  Its monitor shows code scrolling while it uses tools, "..." while it thinks, "?" if it's waiting on you,
  a green ✓ when it's done (or red if it stopped); after a while finished workers head home.
- Over each desk: what that agent is doing right now ("Reading GameScene.ts", "Running npm test",
  "Searching for \"shardSpots\""); walk close to see its name too. The board says LEAD / WORKING / DONE, and
  the top-left panel sums it up ("LIVE · 3 working · 1 done").
- **Walk up to anyone (E) to watch their live feed**: their task (the prompt they were given), then
  everything as it happens: thinking, messages, each tool call with its input (the command, the file, the
  edit), and a preview of what came back, plus elapsed time, tool calls, tokens and model. PREV / NEXT
  step through the team. The board (E) lists everyone; INSPECT and LEAD jump to a feed, SWITCH flips
  between sessions if you have several running.
- **Nothing running? REPLAY** (at the board) plays back your most recent past session that used subagents,
  sped up to about a minute and a half, so the Office is never empty in a demo.
- While you're outside, a toast says when new agents start work.
- **How it works:** Claude Code writes each session to `~/.claude/projects/<project>/<session>.jsonl` as it
  goes, and each subagent gets its own file (plus a small meta file with its task) under
  `<session>/subagents/`. The server tails those files every second (`server/src/agentwatch.ts`); there's
  nothing to install or configure. It's read-only: the Office never steers your agents. Use
  `CLAUDE_PROJECTS_DIR` to point it somewhere else.
- **Other tools** (Codex, Gemini, your own scripts) can put their agents in the Office by POSTing JSON to
  `http://localhost:8787/agents/event`:
  `{"session":"s1","title":"Fix login bug","agent":"w1","name":"Write failing test","tool":"Running npm test","status":"working"}`
  (fields: `session`, `title`, `project`, `agent` (omit or `"lead"` for the lead), `name`, `parent`,
  `status` thinking/working/waiting/done/failed, `activity`, `say`, `tool`, `result`, `model`).
- **Privacy:** the feed includes your code, commands and their output, so it's only ever sent to a game
  running on the same computer (never to another device on the network, never to your phone), and the
  event endpoint only accepts reports from this computer.

## Accounts

**Connections live in the MoonPad.** It's a phone (status bar, notch, home bar) with two tabs: **CHATS**
(text your neighbors) and **CONNECT**: Google (Gmail + Calendar), Canvas (any school), your phone
(iMessage) and Claude Code (for the Office), each ✓ / ● sample / ○ with a button where there's something
to do, plus **TEST CONNECTIONS**, whose results appear on each row. The very first time you land, the
MoonPad opens on this screen as a **WELCOME** setup (skip anything, then START PLAYING). Help → ACCOUNTS
opens the same screen.

Villagers also ask at the moment it's useful: Nova needs nothing (quest 1 works with
zero setup); Hoot's door asks for Google (and Cog then moves in without asking again, same account);
Mabel's door asks for your school's Canvas; the first letter that needs your OK offers to text these to
your phone. Sample data always works, and a villager on sample
data mentions (once per visit) that your real account is one sign-in away.

**Help → ACCOUNTS** is also a "connect everything now" checklist (handy before a demo): Google, Canvas,
your phone and Claude Code, each ✓ / ● sample / ○ with a button, ticking itself off live. **TEST** runs a
real, read-only check of each one (reads a few emails and this week's calendar, checks which Google
permissions were granted, fetches your Canvas courses, checks the phone link, checks Claude Code for the Office, pings the villagers' AI) and reports
✓, or ✗ with what to do in plain words (e.g. "the Gmail API is turned off in your Google Cloud project:
enable it here"). It shows every connection in one place (Google for Hoot and Cog, Canvas for Mabel,
your phone for iMessage) with a button to connect whatever isn't yet. When a villager is still on Earth,
their door's CALL dialog connects the account they need. **Sign in with Google** needs a one-time setup by whoever runs the colony: open
`http://localhost:8787/setup/google` (or press SET UP GOOGLE in Help → ACCOUNTS). It walks through
creating the Google Cloud project, turning on the Gmail and Calendar APIs, and making a Web OAuth client
with the redirect URI it shows, then takes the Client ID and secret in a form (saved to
`server/data/google-client.json`, owner-only; `.env` works too). After that, every player's CONNECT GOOGLE
opens the real Google sign-in. Publish the app (Google Auth Platform → Audience) so anyone can sign in;
until Google verifies it, players click through a "Google hasn't verified this app" screen (Advanced →
Go to Moon Village). Until it's set up, the dialogs offer **sample data** instead of a dead end. **Canvas works at any school.** Mabel's connect dialog asks which school you're at and searches Canvas's
public school directory (the one the official Canvas app's "Find your school" uses), or you can type a
Canvas address like `canvas.myschool.edu` directly. The choice is remembered (CHANGE SCHOOL to switch).
**Sign in with Canvas** then opens a Chrome window at *that* school's Canvas: log in the
normal way (SSO, Duo), and the game asks Canvas for a personal access key for Mabel from inside that
signed-in page (the same thing Canvas settings → "+ New Access Token" does), connects, and closes the
window. No developer key from the school is needed. If Canvas won't make the key directly, the same
window goes straight to Canvas settings with the "New Access Token" dialog already open: click
**Generate Token** and the game picks the token up and closes the window, with no copy and paste.
It follows whatever address you ended up signed in at, so custom school domains work. Mabel only ever reads.

If Google sign-in is set up but Google would refuse it (the redirect URI isn't registered, or the Client
ID is wrong), CONNECT GOOGLE shows exactly what to fix instead of Google's error page.

For testing without touching your save: `MOON_DATA_DIR=/some/folder PORT=8797 npm run dev:server`
runs a server with its own data, and `http://localhost:5173/?server=8797` points the game at it.

## Clearing rocks

Rocks outside your buildings can be cleared: click one (or stand by it and press the action button)
to haul it away for good. Pebbles 10¢, boulders 25¢, spires 30¢, crystal outcrops 40¢, stone arches 60¢.
Sometimes there's something underneath (loose change, a lost trinket, raw moon-crystal): crystal outcrops
always pay out, arches usually do, pebbles rarely.

## Earning coins

- **Pop clods**: every real tool call a villager makes leaves a clod worth a few coins.
- **Moondust**: drifts pile up by the solar lamps and dim them, even while you're away. Hold E (or SPACE) by one to sweep it (3¢).
- **Meteors**: a shadow and a whistle, then a glowing moon-rock. Grab it (E) before it cools (8¢). Sometimes a shower comes.
- **Colony requests**: three small goals a day from the neighbors who live here (sweep drifts, catch a meteor, clear a rock, decorate a yard, find a shard, text someone, ask for help in person, pop clods), paid when done. New ones each day; the gold badge on the Quests button counts what's left, and the Quests list shows them first.
- **Moon Shards**: 12 glowing pieces of the old colony's broken beacon are hidden across the wilds. Walk over one to pick it up (15¢); find all 12 and Nova relights the beacon (+200¢). The first shard you find, Nova explains all this; halfway she cheers you on, and the Quests list tracks them.
- **Villager chores** (opt-in, per villager): tick **[ ] CHORES** in their dialog and, when idle, they do a small real check every 15 minutes (unread mail, next 24h, what's due, space news). Each round uses real API calls. Chores never count toward quests.

Coins you earn fly from where you earned them into your wallet. Hold a direction to break from a walk into a run
(with a trail of moondust), and villagers say hi by name as you pass. The music is played live in the browser
(a soft procedural lullaby, no audio files); the note button on the toolbar mutes it, and the choice is remembered.

When they're not working, villagers wander, visit each other and gossip: scripted lines plus small talk about
what they actually fetched for you (no extra API calls).

## Every game element is something an agent is actually doing

| On the island | What the agent is doing |
|---|---|
| Villager walks to a building | Using that tool: Mailbox = read inbox, Post Office = draft, Mail Rocket = send, Clock Tower = calendar, Library = Canvas, Observatory = web |
| Thought bubble over a villager (click it) | Its latest reasoning |
| Baby clod runs off, then glows | One real tool call finished. E pops it for the result and coins |
| Two villagers meet, a letter flies | A handoff between agents |
| Villager at your door with ❗ and a letter | Needs your OK to send an email or book an event. The same letter texts your phone |
| Building smokes | A tool failed ("the post office is closed") |
| Lantern rises | Task done; the lantern ring at the plaza is your history |

## Talking to villagers

Talking happens right where you stand. Walk up to a villager and press **E** (or **Enter**) to
text-chat: a chat bar opens above the toolbar with the conversation so far, **Enter** sends (the bar
stays open for your next line), and **ESC** or an empty **Enter** closes it. They stop, turn to you, think ("..."), and answer out loud in bubbles over their own head, a
sentence or two at a time. They greet you once; come back within five minutes and they skip the
hello. Walk away and the conversation ends. (Letters to approve and account connections still open
their own windows.)

- **Speak instead of typing**: tap or hold **TAB** next to a villager.
- **Open mic** (the **mic** button on the toolbar): always listening while you stand next to someone,
  so you can just talk. It pauses while they answer, so it never hears itself.

- **Voices**: every villager has their own ElevenLabs voice (set `ELEVENLABS_API_KEY`; the free plan
  works). Each reply's first couple of sentences are spoken, the rest types out, and every line is
  cached in `server/data/voice/`, so repeats cost no credits. No key, out of credits, or offline?
  The browser's built-in voices take over. `BROWSER_VOICES=1` keeps ElevenLabs off while you
  develop. The **sound** button on the toolbar mutes voices along with sound effects.
- **Voice input** uses the browser's speech recognition: Chrome, Edge or Safari, online, on
  localhost or https.
- **Conversation, not reports**: in person, villagers answer in a sentence or three and offer more.
  If a lookup comes back long (a web search, an inbox rundown), they retell the highlight and keep
  the rest in mind, so "tell me more" picks up without searching again.

## Safety

- Sending email and creating calendar events always need your approval. Reading never changes anything, and Canvas is read-only.
- Villagers treat email, Canvas and web content as data, never as instructions (prompt-injection guard).
- Tokens live in `server/data/` (gitignored, owner-only permissions). Revoke any time from Google or Canvas settings.

## Controls

Walk with **WASD** / arrow keys. Everything else is on the **icon toolbar** at the bottom (hover an icon for its name):

- **MoonPad** (tablet): text any villager who's moved in to get to know them. Texts are just conversation: villagers remember what you tell them (saved on the server with the colony) and friendship grows, shown as hearts. Ask for real work over text and they'll invite you to their house; tasks only run when you ask in person, and those visits count double toward friendship. A red badge means new replies.
- **Supply Pod** (crate): 34 decorations in four tabs (Garden, Cozy, Sci-Fi, Party), from a 20¢ shrub to a 150¢ Star Portal (prices are checked on the server). Each tile shows who loves it.
- **Quests** (scroll) · **Help** (?)
- **Music** (note) and **Sound effects** (speaker): separate mutes, remembered per browser.
- **Edit layout** (pencil): drag any building, plot, decoration or task lantern (the stone lanterns planted when villagers finish real work) anywhere on the island, or click a decoration to sell it. Task lanterns can be moved but not sold. Everything snaps to the 16px tile grid; the footprint turns green where it fits and red where it doesn't (tiles must be on the island and free, the plaza and your ship stay clear, and buildings keep the tile row in front of their door open). Paths, lamps and doorbells follow the building. The banner above the toolbar has SELL (for decorations), CANCEL and DONE. Positions are saved on the server and checked there too.
- **Action button** (right end): does exactly what E would, and its icon shows what that is: calling a villager home from their door (also a CALL button at the door itself), talk, read a letter, build, pop a clod, grab a moon-rock, hold to sweep, or switch a light on or off. Lights (the Glow Lamp and the Habitat Dome) are the only decorations you interact with outside edit mode; moving and selling happen in edit mode.

**Decorations are part of the daily requests.** Every day one neighbor who lives here makes a **wish**
for a decoration they love that isn't in their yard yet ("Hoot: I'd love an Owl Birdbath by my home!").
Put it in their yard and the wish pays out (20¢ + half the item's price) on top of the happiness. There's
also a "place 3 new decorations" request in the mix. In the Supply Pod every tile shows the little heads of
the villagers who love it, a gold ★ marks today's wished-for item, and hovering a tile (or any decoration
already placed in the world) says who loves it and, in the world, whose yard it's brightening.

**Decorations make villagers happy.** Each villager has favorite items (the Supply Pod lists who loves what). A decoration in a villager's yard (3 tiles around their house) adds happiness: +3 for a favorite, +1 for anything else, each kind counted once, up to 12. Happiness adds to friendship hearts, the villager reacts when you place something, and they mention their decorated home in conversation. While carrying a decoration, yards are outlined and a label previews whose happiness it would change.

**Meteors** show on the minimap (red and blinking while falling, orange once landed), and when one is off-screen a marker on the screen edge points to it. Villagers show on the minimap as little head icons, the same ones as in the top-left list.

**The gold ★** always marks your current goal: over the villager's head when they're on screen, an arrow at the screen edge (named) when they're not. It points to the plot to build, then the door to call from, then the villager. New players get a one-time hint at the top of the screen for walking, then for following the ★.

**E or SPACE interacts with whatever is closest** (talk, call, build, read a letter, pop, grab, switch a light; hold to sweep): the two keys are interchangeable everywhere, including the Office. Next to a villager, Enter types to them and TAB speaks. Other keys: B (Supply Pod), M (music), ESC (close any window / put down / leave edit mode). While a window is open (dialog, MoonPad, shop), keys go to it, not to walking.

## Texting the colony (Photon Spectrum, iMessage)

Set `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET` (Photon dashboard → Settings) and `PLAYER_PHONE`
in `.env`. The Jade Rabbit texts you when you land. Text any villager by name to chat
(`Stargazer: how was stargazing?`); anything else goes to the Rabbit; like the MoonPad, texts build
the friendship and real work waits for a visit; `help` lists who's
around. Approval letters also arrive as texts: reply YES or NO. No credentials yet? `PHOTON_TERMINAL=1`
runs the same flow in Photon's terminal chat.

The buildings sit evenly on one circle around the central plaza, each with a single path. They're full estates (all hand-built pixel art at native size): a turreted manor with a smoking chimney, the Jade Rabbit's hollow under a giant blossoming tree, a colonnaded post office with a bell cupola (and, once upgraded, a mail rocket on a gantry beside it), a 180px clock tower whose clock shows the real time, an observatory with a giant brass telescope, a domed library with twin towers. Before a building is built, its plot is staked out at its real footprint. Each home has its own forecourt, in the character of whoever lives there: brick herringbone and tulip boxes at your house, a lawn with stepping stones and a carrot patch at Yutu's, star-inlaid navy slate and glowing crystals at Nova's, a blue-and-cream checkerboard with parcels at the Post Office, cobbles around a brass compass rose at the Clock Tower, a reading deck with a rug and lavender at the Library, and lit concrete with a </> inlay at the Office. Windows glow. The grand plaza is marble laid in rings with gold and coral inlays, around the three-tier Earthrise Fountain (the coral spark turns on top), kept wide open to walk around: lampposts stand on the rim and gold-tipped obelisks just outside it, both in the gaps between the paths. Moon rocks (boulders, spires, arches and glowing crystal outcrops) are scattered over the island; they sit on the tile grid and take up their tiles like everything else.

**Dev mode** (Help → DEV MODE): switches to a separate showcase save (`server/data/world-dev.json`, made from a copy of your colony the first time) with every estate built, every villager moved in, every quest done and 5000¢. Your real save is written out first and never touched; EXIT (top of the screen) brings it back exactly as it was.

## Pixel-perfect rendering

The game renders at art resolution and the browser upscales it by a whole number, so every pixel on
screen is the same size, text included (a hand-placed bitmap font). Sprites are never scaled or rotated.

## Layout

```
shared/game.ts            contract: buildings, villagers, quests, events, snapshot
server/src/connectors/    real Gmail + Calendar (Google OAuth) and Canvas
server/src/services.ts    live-or-sample routing, residents, quest chain
server/src/agents.ts      villager tool-use loops (Claude or Groq), approvals
server/src/voice.ts       ElevenLabs voices for the talk dialog, cached on disk
client/                   Phaser 3 + Vite; all art generated from code
client/src/panel.ts       dialogs: letters, connections, the Office boards
client/src/neartalk.ts    talking in place: speech bubbles, TAB, the open mic
```
