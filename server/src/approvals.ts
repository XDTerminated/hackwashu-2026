// Human-in-the-loop gate. A tool that needs the player's OK awaits one of
// these; the player answers in-game (letter at their house) or by texting back.

import { randomInt } from "node:crypto";
import type { Approval } from "../../shared/game.js";
import { world } from "./world.js";

/** Nobody answered in this long: the answer is no. */
const EXPIRE_MS = 30 * 60_000;

const waiters = new Map<string, (approved: boolean) => void>();
const timers = new Map<string, NodeJS.Timeout>();
/** Each open question's short code, so a text reply says which one it answers. */
const codes = new Map<string, string>();
/** Too long to show whole in a text: only answerable in-game. */
const gameOnly = new Set<string>();

function forget(id: string) {
  waiters.delete(id);
  clearTimeout(timers.get(id));
  timers.delete(id);
  codes.delete(id);
  gameOnly.delete(id);
}

export function waitForApproval(a: Approval): Promise<boolean> {
  return new Promise((resolve) => {
    waiters.set(a.id, resolve);
    const t = setTimeout(() => resolveApproval(a.id, false), EXPIRE_MS);
    t.unref?.();
    timers.set(a.id, t);
  });
}

/** Returns the resolved approval, or undefined if it wasn't pending. */
export function resolveApproval(approvalId: string, approved: boolean): Approval | undefined {
  const a = typeof approvalId === "string" && Object.hasOwn(world.approvals, approvalId) ? world.approvals[approvalId] : undefined;
  const waiter = waiters.get(approvalId);
  if (!a || a.status !== "pending" || !waiter) return undefined;
  a.status = approved ? "approved" : "denied";
  forget(approvalId);
  waiter(approved);
  return a;
}

/** Answer "no" to every open question (the save is changing under them, e.g. dev mode). */
export function denyAllPending() {
  for (const [id, waiter] of [...waiters]) {
    const a = world.approvals[id];
    if (a?.status === "pending") a.status = "denied";
    forget(id);
    waiter(false);
  }
}

/** Answer "no" to one villager's open questions (their job fell over mid-way). */
export function denyPendingFor(villager: Approval["villager"]) {
  for (const id of [...waiters.keys()]) if (world.approvals[id]?.villager === villager) resolveApproval(id, false);
}

/** The short code a text reply uses for this approval ("YES 4821"). */
export function approvalCode(approvalId: string): string {
  let c = codes.get(approvalId);
  if (!c) {
    const taken = new Set(codes.values());
    do c = String(randomInt(1000, 10000));
    while (taken.has(c));
    codes.set(approvalId, c);
  }
  return c;
}

/** Only answerable in the colony (the text couldn't show all of it). */
export function markGameOnly(approvalId: string) {
  gameOnly.add(approvalId);
}

const open = () => Object.values(world.approvals).filter((a) => a.status === "pending" && waiters.has(a.id));

export function anyPending(): boolean {
  return open().length > 0;
}

/**
 * Which open question a text reply answers. With a code, that one. A bare NO
 * holds the only one waiting; a bare YES never counts (by the time it arrives,
 * the one waiting may not be the one they read). `problem` is what to text back instead.
 */
export function phoneTarget(code: string | undefined, approving: boolean): { approval: Approval } | { problem: string } {
  const list = open();
  const a = code ? list.find((x) => codes.get(x.id) === code) : !approving && list.length === 1 ? list[0] : undefined;
  if (!a) {
    if (code) return { problem: `Nothing's waiting on code ${code}. Check the code in the request text.` };
    // (never a real code in the example: a YES has to come from reading the request itself)
    return { problem: `Reply YES or NO with the code from the request you mean (like "YES 1234").` };
  }
  // (a NO is always fine by text; a YES only for what the text showed in full)
  if (approving && gameOnly.has(a.id)) return { problem: "That one's too long to show in full by text — please look it over and answer in the colony." };
  return { approval: a };
}
