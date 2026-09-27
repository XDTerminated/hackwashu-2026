// Phone numbers, shared by a village's texting (photon.ts) and the hosted
// site's one iMessage line (phoneline.ts). No game state in here.

/** "•••0123": all anyone is shown of a number. */
export const mask = (phone: string) => `•••${phone.replace(/\D/g, "").slice(-4)}`;

/**
 * Accepts "(314) 555-0123", "314-555-0123", "+44 20 ..." → E.164, US by default.
 * Anything with stray characters (like "+!314...") is rejected rather than
 * guessed at — silently dropping a character can turn +1 314 into +31 (Netherlands).
 */
export function normalizePhone(input: string): string | null {
  if (!/^[\d\s+().-]+$/.test(input.trim()) || (input.match(/\+/g) ?? []).length > 1 || /.\+/.test(input.trim())) return null;
  const digits = input.replace(/[^\d+]/g, "");
  let e164 = digits.startsWith("+") ? "+" + digits.slice(1).replace(/\+/g, "") : digits;
  if (!e164.startsWith("+")) e164 = e164.length === 10 ? `+1${e164}` : e164.length === 11 && e164.startsWith("1") ? `+${e164}` : `+${e164}`;
  return /^\+\d{8,15}$/.test(e164) ? e164 : null;
}

/** What a village is told when it asks to link a phone. */
export type LinkResult = { ok: boolean; text: string; line?: string; code?: string; link?: string };
