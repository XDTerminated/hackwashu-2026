// "TEST CONNECTIONS" in Help > ACCOUNTS: a real, read-only check of every
// connection, reported in plain words with what to do if something's wrong.
// Reads a little (a few emails' subjects count, this week's events, your
// Canvas profile, one tiny AI reply) and changes nothing.

import * as google from "./connectors/google.js";
import * as canvas from "./connectors/canvas.js";
import * as github from "./connectors/github.js";
import * as spotify from "./connectors/spotify.js";
import { photonReady, phoneLinked } from "./photon.js";
import { agentsState } from "./agentwatch.js";
import { world } from "./world.js";

export interface CheckResult {
  name: string;
  ok: boolean | null; // null: not set up (not a failure)
  detail: string;
}

const plain = (err: unknown) => {
  const m = err instanceof Error ? err.message : String(err);
  if (/has not been used|is disabled|accessNotConfigured/i.test(m)) {
    const api = /calendar/i.test(m) ? "Google Calendar API" : "Gmail API";
    return `the ${api} is turned off in your Google Cloud project: open Google Cloud > APIs & Services > Library, find it, and press Enable.`;
  }
  if (/invalid_grant|expired|revoked/i.test(m)) return "the sign-in expired or was revoked: press GOOGLE in Accounts to sign in again.";
  if (/insufficient|scope/i.test(m)) return "the sign-in didn't include that permission: sign in again and tick every box on Google's screen.";
  return m.slice(0, 140);
};

const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

export async function testConnections(): Promise<CheckResult[]> {
  const out: CheckResult[] = [];

  // Google: Gmail and Calendar
  const g = google.googleStatus();
  if (!g.connected) out.push({ name: "Google", ok: null, detail: world.progress.sandbox.google ? "on sample data (not signed in)" : g.configured ? "not signed in yet" : "sign-in isn't set up on this server yet" });
  else {
    const missing = google.missingScopes();
    if (missing.length) {
      const what = missing.map((s) => (s.endsWith("gmail.compose") ? "draft emails" : s.endsWith("calendar.events") ? "book calendar events" : "read mail")).join(" and ");
      out.push({ name: "Google permissions", ok: false, detail: `Google didn't give permission to ${what}. Press GOOGLE in Accounts and tick every box on Google's screen.` });
    } else out.push({ name: "Google permissions", ok: true, detail: "can read mail, draft replies and book events (sending always asks you first)" });
    try {
      const mail = await google.gmailList(false);
      out.push({ name: "Gmail", ok: true, detail: `read ${mail.length} recent message${mail.length === 1 ? "" : "s"}` });
    } catch (err) {
      out.push({ name: "Gmail", ok: false, detail: plain(err) });
    }
    try {
      const now = new Date();
      const ev = await google.calendarList(local(now), local(new Date(+now + 7 * 864e5)));
      out.push({ name: "Calendar", ok: true, detail: `read your week (${ev.length} event${ev.length === 1 ? "" : "s"})` });
    } catch (err) {
      out.push({ name: "Calendar", ok: false, detail: plain(err) });
    }
  }

  // Canvas
  const c = canvas.canvasStatus();
  if (!c.connected) out.push({ name: "Canvas", ok: null, detail: world.progress.sandbox.canvas ? "on sample data (not signed in)" : "not connected yet" });
  else {
    try {
      const courses = await canvas.canvasCourses();
      out.push({ name: "Canvas", ok: true, detail: `${c.account ?? "signed in"}: ${courses.length} active course${courses.length === 1 ? "" : "s"}` });
    } catch (err) {
      out.push({ name: "Canvas", ok: false, detail: /rejected/i.test(String(err)) ? "Canvas no longer accepts the key: press CANVAS in Accounts to sign in again." : plain(err) });
    }
  }

  // GitHub (Tinker): the token still works, and who it signs in as
  const gh = github.githubStatus();
  if (!gh.connected) out.push({ name: "GitHub", ok: null, detail: world.progress.sandbox.github ? "just chatting (not connected)" : "not connected yet" });
  else {
    try {
      const me = await github.gh<{ login: string }>("GET", "/user");
      out.push({ name: "GitHub", ok: true, detail: `signed in as ${me.login}` });
    } catch (err) {
      out.push({ name: "GitHub", ok: false, detail: /401|accept/i.test(String(err)) ? "GitHub no longer accepts the token: press SIGN IN on the GitHub row to connect again." : plain(err) });
    }
  }

  // Spotify (Echo): still signed in, and whether it can play here (Premium only)
  const sp = spotify.spotifyStatus();
  if (!sp.connected) out.push({ name: "Spotify", ok: null, detail: world.progress.sandbox.spotify ? "just chatting (not connected)" : sp.configured ? "not connected yet" : "not turned on here" });
  else {
    try {
      const me = await spotify.spotifyMe();
      const who = me?.display_name ?? me?.id ?? "signed in";
      out.push(me?.product === "premium" ? { name: "Spotify", ok: true, detail: `${who} (Premium): Echo can play music here` } : { name: "Spotify", ok: false, detail: `${who} is connected, but Spotify only lets Premium accounts play in other apps` });
    } catch (err) {
      out.push({ name: "Spotify", ok: false, detail: plain(err) });
    }
  }

  // Phone (iMessage)
  if (!photonReady()) out.push({ name: "Phone", ok: null, detail: "texting isn't set up on this server" });
  else out.push({ name: "Phone", ok: phoneLinked() ? true : null, detail: phoneLinked() ? "linked: texts reach your phone" : "not linked yet: MoonPad > LINK" });

  // Claude Code, for the Office
  const agents = agentsState();
  if (!agents.watching) out.push({ name: "Claude Code", ok: null, detail: "no Claude Code sessions on this computer yet (the Office can still replay)" });
  else {
    const live = agents.sessions.filter((x) => x.source === "claude-code").length;
    out.push({ name: "Claude Code", ok: true, detail: live ? `watching: ${live} live session${live === 1 ? "" : "s"}` : "watching: none running right now" });
  }

  // The villagers' AI brain
  const key = process.env.GROQ_API ?? process.env.GROQ_API_KEY;
  if (!key) out.push({ name: "AI", ok: null, detail: "no AI key on the server (villagers run scripted)" });
  else {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b", messages: [{ role: "user", content: "Reply with just: ok" }], max_tokens: 20 }),
      });
      out.push(res.ok ? { name: "AI", ok: true, detail: "Groq answered" } : { name: "AI", ok: false, detail: res.status === 429 ? "Groq's free limit is used up for now (it resets; villagers wait and retry)" : res.status === 401 ? "Groq rejected the key: check GROQ_API in .env" : `Groq error ${res.status}` });
    } catch (err) {
      out.push({ name: "AI", ok: false, detail: `couldn't reach Groq (${plain(err)})` });
    }
  }
  return out;
}
