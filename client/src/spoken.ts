// Spoken email addresses, put back together for the mail.

const SPOKEN: Record<string, string> = { dot: ".", period: ".", point: ".", underscore: "_", dash: "-", hyphen: "-", minus: "-" };
const TLD = /^(com|org|edu|net|io|co|us|gov|ai|dev|me|app|uk|ca|info)$/;
/** Words that come right before "at" in ordinary talk ("look at", "meet me at"): never the start of an address. */
const NOT_A_NAME = new Set(["look", "looking", "me", "you", "him", "her", "them", "it", "us", "this", "that", "is", "are", "was", "arrive", "arrived", "meet", "see", "stay", "be", "home", "work", "school"]);
const bare = (t: string) => t.toLowerCase().replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9]+$/, "");

/**
 * Speech recognition hears "jordan dot lee at gmail dot com" or "j o r d a n
 * at wustl dot edu": put the address back together (jordan.lee@gmail.com).
 * Spelled-out letters join up; one ordinary word before "at" is kept.
 */
export function spokenEmails(text: string): string {
  const w = text.split(/\s+/);
  for (let i = 1; i < w.length - 1; i++) {
    const at = bare(w[i]);
    if (at !== "at" && w[i] !== "@") continue;
    // the domain: words after "at", up to "dot <tld>" (or an already-dotted "gmail.com")
    let domain = "";
    let end = -1;
    const first = w[i + 1].toLowerCase().replace(/[^a-z0-9.-]+$/, "");
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,4}$/.test(first) && TLD.test(first.split(".").pop()!)) {
      domain = first;
      end = i + 1;
    } else {
      for (let j = i + 1; j < Math.min(w.length, i + 10); j++) {
        const t = bare(w[j]);
        if (SPOKEN[t] === "." && j + 1 < w.length && TLD.test(bare(w[j + 1]))) {
          domain += `.${bare(w[j + 1])}`;
          end = j + 1;
          break;
        }
        domain += SPOKEN[t] ?? t;
      }
    }
    if (end < 0 || !domain) continue;
    // the name part: spelled letters, digits and "dot"/"underscore" freely, plus one ordinary word
    let local = "";
    let k = i - 1;
    let plain = 0;
    // (a word joined on by "dot" or "underscore" is part of the name too: "jordan dot lee")
    let joined = false;
    for (; k >= 0; k--) {
      const t = bare(w[k]);
      if (SPOKEN[t]) (local = SPOKEN[t] + local), (joined = true);
      else if (t.length === 1 || /^\d+$/.test(t)) (local = t + local), (joined = false);
      else if ((!plain || joined) && /^[a-z0-9]+$/.test(t) && !(plain === 0 && NOT_A_NAME.has(t))) (local = t + local), plain++, (joined = false);
      else break;
    }
    local = local.replace(/^[._-]+/, "");
    if (!local) continue;
    const trailing = w[end].match(/[.,!?;:]+$/)?.[0] ?? "";
    w.splice(k + 1, end - k, `${local}@${domain}${trailing === "." ? "" : trailing}`);
    return spokenEmails(w.join(" "));
  }
  return text;
}
