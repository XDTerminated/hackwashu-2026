// A small, safe markdown-to-HTML renderer for Office reports: headings, bold,
// italics, code, links, lists, tables and rules. Everything is escaped first,
// so nothing the model writes can inject HTML.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_(?!\s)(.+?)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/【[^】]*】/g, "");
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      flushPara();
      closeList();
      continue;
    }
    // a table: a header row, a |---| row, then body rows
    if (t.startsWith("|") && /^\|?\s*:?-{2,}/.test((lines[i + 1] ?? "").trim())) {
      flushPara();
      closeList();
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const head = cells(t);
      i++;
      const body: string[][] = [];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith("|")) body.push(cells(lines[++i]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      flushPara();
      closeList();
      const n = Math.min(4, h[1].length + 1);
      out.push(`<h${n}>${inline(h[2])}</h${n}>`);
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(t)) {
      flushPara();
      closeList();
      out.push("<hr>");
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const kind = /\d/.test(li[2]) ? "ol" : "ul";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li${li[1].length >= 2 ? ' class="sub"' : ""}>${inline(li[3].replace(/^\[( |x)\]\s*/i, (_m, x) => (x.trim() ? "☑ " : "☐ ")))}</li>`);
      continue;
    }
    closeList();
    para.push(t);
  }
  flushPara();
  closeList();
  return out.join("\n");
}

/** The same text, flattened for the in-game pixel font (no markup). */
export function markdownToPlain(md: string): string {
  return md
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => !/^\s*\|?\s*:?-{2,}[-|:\s]*$/.test(l) && !/^\s*([-*_])\1{2,}\s*$/.test(l))
    .map((l) => l.replace(/^#{1,6}\s+/, "").replace(/^\s*\|(.*)\|\s*$/, (_m, row: string) => row.split("|").map((c) => c.trim()).join(" · ")))
    .join("\n")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/【[^】]*】/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
