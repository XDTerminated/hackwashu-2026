// "Sign in with Canvas": opens a Chrome window at the school's Canvas, the
// player logs in the normal way (SSO, Duo, whatever their school uses), and
// then, inside that logged-in page, we ask Canvas for a personal access token
// for Mabel - the same thing "+ New Access Token" in Canvas settings does.
// No developer key from the school needed. Talks to Chrome over its DevTools
// protocol, so there's nothing extra to install; the window closes when done.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { DEFAULT_CANVAS } from "./canvas.js";

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Runs in any open page: is this Canvas, and are we signed in? Canvas pages
// define window.ENV; the school's sign-in pages (SSO, Duo) don't.
const SIGNED_IN = `(async () => {
  if (typeof window.ENV !== "object" || !window.ENV) return { waiting: true };
  const me = await fetch("/api/v1/users/self", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return me && me.name ? { name: me.name, origin: location.origin } : { waiting: true };
})()`;

// Ask Canvas for a key, the same thing "+ New Access Token" in settings does.
const MAKE_TOKEN = `(async () => {
  const csrf = decodeURIComponent((document.cookie.match(/(?:^|; )_csrf_token=([^;]+)/) || [])[1] || "");
  const body = new URLSearchParams({ "token[purpose]": "Fl-AI Me to the Moon (Mabel reads your courses)" });
  const r = await fetch("/api/v1/users/self/tokens", { method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": csrf, "Content-Type": "application/x-www-form-urlencoded" }, body }).catch(() => null);
  const t = r ? await r.json().catch(() => ({})) : {};
  return r && r.ok && t.visible_token ? { token: t.visible_token } : { error: "status " + (r ? r.status : "failed") };
})()`;

// On the settings page: open the "New Access Token" dialog and fill in the
// purpose, so all that's left is one click on Generate.
const OPEN_DIALOG = `(() => {
  const btn = document.querySelector(".add_access_token_link") || [...document.querySelectorAll("a,button")].find((b) => /new access token/i.test(b.textContent || ""));
  if (!btn) return { waiting: true };
  const shown = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  if (![...document.querySelectorAll("[role=dialog], .ui-dialog")].some(shown)) btn.click();
  setTimeout(() => {
    const purpose = [...document.querySelectorAll("input[name='token[purpose]'], #access_token_purpose, [role=dialog] input[type=text]")].find(shown);
    if (purpose && !purpose.value) {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(purpose, "Fl-AI Me to the Moon");
      purpose.dispatchEvent(new Event("input", { bubbles: true }));
      purpose.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, 400);
  return { opened: true };
})()`;

// Once the player clicks Generate, Canvas shows the new token once: read it.
// (Canvas tokens look like "1234~" + a long random string.)
const FIND_TOKEN = `(() => {
  const re = /\\b\\d{1,8}~[A-Za-z0-9]{40,}\\b/;
  const fields = [...document.querySelectorAll("input, textarea")].map((i) => i.value || "");
  for (const text of [document.body ? document.body.innerText : "", ...fields]) {
    const m = text.match(re);
    if (m) return { token: m[0] };
  }
  return { waiting: true };
})()`;

type Out = { waiting?: boolean; error?: string; token?: string; name?: string; origin?: string; opened?: boolean };
type Page = { id: string; type: string; url: string; webSocketDebuggerUrl?: string };

let running: Promise<{ token: string; name: string; base: string }> | null = null;

/**
 * Open Canvas, wait for the player to log in, and come back with a token.
 * If the school won't let us make one directly, the window goes to the
 * access-token settings with the dialog open, and picks the token up from
 * there once the player clicks Generate.
 */
export function canvasSignIn(
  baseUrl = DEFAULT_CANVAS,
  opts: { headless?: boolean; onStatus?: (text: string) => void } = {},
): Promise<{ token: string; name: string; base: string }> {
  running ??= signIn(baseUrl.replace(/\/$/, ""), opts).finally(() => (running = null));
  return running;
}

async function signIn(base: string, opts: { headless?: boolean; onStatus?: (text: string) => void }): Promise<{ token: string; name: string; base: string }> {
  const chrome = CHROMES.find((p) => existsSync(p));
  if (!chrome) throw new Error("couldn't find Chrome on this computer. Paste a token from Canvas settings instead.");
  const profile = mkdtempSync(join(tmpdir(), "moon-canvas-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc: ChildProcess = spawn(chrome, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check", "--window-size=900,800", ...(opts.headless ? ["--headless=new"] : []), `${base}/login`], { stdio: "ignore" });
  let exited = false;
  proc.on("exit", () => (exited = true));
  const cleanup = () => {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1500);
  };
  const pages = async () =>
    ((await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => [])) as Page[]).filter(
      (t) => t.type === "page" && t.webSocketDebuggerUrl && /^https?:/.test(t.url),
    );
  const alive = () => {
    if (exited) throw new Error("the Canvas window was closed before Mabel got her key");
  };
  try {
    const deadline = Date.now() + 10 * 60_000;
    // 1. Wait for the player to sign in (on whatever address their school uses).
    let who: { name: string; origin: string; page: Page } | null = null;
    while (!who) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the Canvas sign-in (10 minutes)");
      await sleep(2000);
      alive();
      for (const p of await pages()) {
        if (safePath(p.url).startsWith("/login")) continue;
        const out = await evaluate(p.webSocketDebuggerUrl!, SIGNED_IN);
        if (out?.name && out.origin) {
          who = { name: out.name, origin: out.origin, page: p };
          break;
        }
      }
    }
    // 2. Ask Canvas for a key directly.
    const made = await evaluate(who.page.webSocketDebuggerUrl!, MAKE_TOKEN);
    if (made?.token) return { token: made.token, name: who.name, base: who.origin };
    console.log(`[canvas] couldn't make a key directly (${made?.error ?? "no answer"}); opening token settings`);
    // 3. Otherwise go to the access-token settings and open the dialog for them.
    opts.onStatus?.(`Signed in as ${who.name}! Your school needs one more click: in the Canvas window, press GENERATE TOKEN and Mabel will grab it.`);
    await command(who.page.webSocketDebuggerUrl!, "Page.navigate", { url: `${who.origin}/profile/settings#access_tokens_holder` });
    let opened = false;
    while (Date.now() < deadline) {
      await sleep(1500);
      alive();
      for (const p of await pages()) {
        if (safeOrigin(p.url) !== who.origin) continue;
        const found = await evaluate(p.webSocketDebuggerUrl!, FIND_TOKEN);
        if (found?.token) return { token: found.token, name: who.name, base: who.origin };
        if (!opened && safePath(p.url).startsWith("/profile/settings")) opened = !!(await evaluate(p.webSocketDebuggerUrl!, OPEN_DIALOG))?.opened;
      }
    }
    throw new Error("timed out waiting for the new Canvas token (10 minutes)");
  } finally {
    cleanup();
  }
}

const safePath = (u: string) => {
  try {
    return new URL(u).pathname;
  } catch {
    return "";
  }
};

const safeOrigin = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return "";
  }
};

/** Run an expression in a page via the DevTools protocol. */
async function evaluate(wsUrl: string, expression: string): Promise<Out | null> {
  const r = (await command(wsUrl, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })) as { result?: { value?: unknown } } | null;
  return (r?.result?.value as Out | undefined) ?? null;
}

/** Send one DevTools command to a page and wait for its answer. */
function command(wsUrl: string, method: string, params: object): Promise<unknown> {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const done = (v: unknown) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* closed */
      }
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 15_000);
    ws.on("open", () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as { id?: number; result?: unknown };
      if (msg.id === 1) done(msg.result ?? null);
    });
    ws.on("error", () => done(null));
  });
}
