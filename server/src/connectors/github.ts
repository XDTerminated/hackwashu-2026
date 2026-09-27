// Real GitHub, for Tinker the Mechanic: a token the player pastes (a
// fine-grained or classic personal access token), or, on the player's own
// computer, the GitHub CLI's saved login (`gh auth token`). The token lives in
// server/data/github.json (only readable by you) and never reaches the game.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { DATA_DIR, HOSTED } from "../env.js";

const TOKEN_FILE = join(DATA_DIR, "github.json");
const run = promisify(execFile);

let saved: { token: string; login: string } | null = null;
let cliToken: string | null = null;

export function githubStatus() {
  return { connected: !!saved, account: saved?.login, cli: !!cliToken };
}

async function whoAmI(token: string): Promise<string> {
  const res = await fetch("https://api.github.com/user", { headers: headers(token) });
  if (res.status === 401) throw new Error("GitHub didn't accept that token (it may have expired, or been copied wrong).");
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  return ((await res.json()) as { login: string }).login;
}

function save(token: string, login: string) {
  saved = { token, login };
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(saved), { mode: 0o600 });
}

/** Restore a saved token; and on your own computer, notice whether the GitHub CLI is signed in. */
export async function initGithub() {
  try {
    if (existsSync(TOKEN_FILE)) saved = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
    if (saved) console.log(`[github] restored sign-in for ${saved.login}`);
  } catch {
    saved = null;
  }
  if (HOSTED) return;
  try {
    const { stdout } = await run("gh", ["auth", "token"], { timeout: 4000 });
    cliToken = stdout.trim() || null;
  } catch {
    cliToken = null; // no GitHub CLI, or not signed in
  }
}

/** Connect with a pasted token. Returns the GitHub username. */
export async function connectGithub(raw: string): Promise<string> {
  const token = raw.trim();
  if (!/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(token)) throw new Error("That doesn't look like a GitHub token: they start with ghp_ or github_pat_.");
  const login = await whoAmI(token);
  save(token, login);
  return login;
}

/** Connect with the GitHub CLI's login on this computer. */
export async function connectGithubCli(): Promise<string> {
  if (!cliToken) throw new Error("The GitHub CLI isn't signed in on this computer (run `gh auth login` first).");
  const login = await whoAmI(cliToken);
  save(cliToken, login);
  return login;
}

export function disconnectGithub() {
  saved = null;
  rmSync(TOKEN_FILE, { force: true });
}

function headers(token: string) {
  return { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "fl-ai-me-to-the-moon" };
}

export async function gh<T>(method: string, path: string, body?: object): Promise<T> {
  if (!saved) throw new Error("GitHub isn't connected yet.");
  const res = await fetch(`https://api.github.com${path}`, { method, headers: { ...headers(saved.token), ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok) throw new Error(res.status === 404 ? "GitHub couldn't find that (check the owner/repo name, and that your token can see it)." : (json?.message ?? `GitHub said ${res.status}`));
  return json as T;
}

export const githubLogin = () => saved?.login ?? "";

// ---------------------------------------------------------------- what Tinker looks at

type Item = { number: number; title: string; html_url: string; draft?: boolean; updated_at: string; repository_url: string; pull_request?: unknown; user?: { login: string } };
const repoOf = (url: string) => url.replace("https://api.github.com/repos/", "");
const ago = (iso: string) => {
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  return h < 1 ? "just now" : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
};

/** Open pull requests you wrote, or that are waiting on your review. */
export async function myPullRequests() {
  const q = async (query: string) => (await gh<{ items: Item[] }>("GET", `/search/issues?q=${encodeURIComponent(query)}&sort=updated&per_page=10`)).items;
  const login = githubLogin();
  const [mine, review] = await Promise.all([q(`is:pr is:open author:${login}`), q(`is:pr is:open review-requested:${login}`)]);
  const view = (i: Item) => ({ repo: repoOf(i.repository_url), number: i.number, title: i.title, draft: !!i.draft, updated: ago(i.updated_at), by: i.user?.login });
  return { yours: mine.map(view), waiting_on_your_review: review.map(view) };
}

export async function repoIssues(repo: string) {
  const items = await gh<Item[]>("GET", `/repos/${repo}/issues?state=open&per_page=15&sort=updated`);
  return items.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, by: i.user?.login, updated: ago(i.updated_at) }));
}

type CheckRun = { name: string; status: string; conclusion: string | null };

/** How a branch or pull request's checks (CI) are doing. */
async function checksFor(repo: string, ref: string) {
  const runs = (await gh<{ check_runs: CheckRun[] }>("GET", `/repos/${repo}/commits/${encodeURIComponent(ref)}/check-runs?per_page=30`)).check_runs;
  const failed = runs.filter((r) => r.conclusion && !["success", "skipped", "neutral"].includes(r.conclusion)).map((r) => r.name);
  const running = runs.filter((r) => r.status !== "completed").map((r) => r.name);
  return { total: runs.length, passed: runs.filter((r) => r.conclusion === "success").length, failed, running };
}

export async function prStatus(repo: string, number: number) {
  const pr = await gh<{ title: string; state: string; merged: boolean; draft: boolean; mergeable_state?: string; head: { sha: string; ref: string }; html_url: string; comments: number; review_comments: number }>("GET", `/repos/${repo}/pulls/${number}`);
  return { title: pr.title, state: pr.merged ? "merged" : pr.state, draft: pr.draft, branch: pr.head.ref, mergeable: pr.mergeable_state, comments: pr.comments + pr.review_comments, checks: await checksFor(repo, pr.head.sha), url: pr.html_url };
}

export async function recentCommits(repo: string, branch?: string) {
  const list = await gh<{ sha: string; commit: { message: string; author: { name: string; date: string } } }[]>("GET", `/repos/${repo}/commits?per_page=6${branch ? `&sha=${encodeURIComponent(branch)}` : ""}`);
  return list.map((c) => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split("\n")[0], by: c.commit.author.name, when: ago(c.commit.author.date) }));
}

/** The repo a project folder (from Claude Code) most likely is: one of yours with the same name, most recently pushed first. */
export async function findRepo(folder: string): Promise<string | null> {
  const repos = await gh<{ full_name: string; name: string }[]>("GET", "/user/repos?per_page=100&sort=pushed");
  const want = folder.toLowerCase();
  return (repos.find((r) => r.name.toLowerCase() === want) ?? repos.find((r) => want.startsWith(r.name.toLowerCase()) || r.name.toLowerCase().startsWith(want)))?.full_name ?? null;
}

/** A branch's pull request (if it has one) and how its checks are doing. */
export async function branchStatus(repo: string, branch: string) {
  const owner = repo.split("/")[0];
  const prs = await gh<{ number: number; title: string; state: string; html_url: string }[]>("GET", `/repos/${repo}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=1`);
  const checks = await checksFor(repo, branch).catch(() => null);
  return { repo, branch, pull_request: prs[0] ? { number: prs[0].number, title: prs[0].title, state: prs[0].state, url: prs[0].html_url } : null, checks };
}

export async function createIssue(repo: string, title: string, body: string) {
  const i = await gh<{ number: number; html_url: string }>("POST", `/repos/${repo}/issues`, { title, body });
  return { number: i.number, url: i.html_url };
}

export async function comment(repo: string, number: number, body: string) {
  const c = await gh<{ html_url: string }>("POST", `/repos/${repo}/issues/${number}/comments`, { body });
  return { url: c.html_url };
}
