// Human-in-the-loop gate. A tool that needs the player's OK awaits one of
// these; the player answers in-game (letter at their house) or by texting back.

import type { Approval } from "../../shared/game.js";
import { world } from "./world.js";

const waiters = new Map<string, (approved: boolean) => void>();

export function waitForApproval(a: Approval): Promise<boolean> {
  return new Promise((resolve) => waiters.set(a.id, resolve));
}

/** Returns the resolved approval, or undefined if it wasn't pending. */
export function resolveApproval(approvalId: string, approved: boolean): Approval | undefined {
  const a = typeof approvalId === "string" && Object.hasOwn(world.approvals, approvalId) ? world.approvals[approvalId] : undefined;
  const waiter = waiters.get(approvalId);
  if (!a || a.status !== "pending" || !waiter) return undefined;
  a.status = approved ? "approved" : "denied";
  waiters.delete(approvalId);
  waiter(approved);
  return a;
}

/** Answer "no" to every open question (the save is changing under them, e.g. dev mode). */
export function denyAllPending() {
  for (const [id, waiter] of waiters) {
    const a = world.approvals[id];
    if (a?.status === "pending") a.status = "denied";
    waiter(false);
  }
  waiters.clear();
}

/** The phone channel has no ids — "yes" answers the oldest open question. */
export function oldestPending(): Approval | undefined {
  return Object.values(world.approvals).find((a) => a.status === "pending" && waiters.has(a.id));
}
