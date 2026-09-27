// Pre-compresses the build: writes a .gz (gzip level 9) next to every text-ish
// asset in dist/ over 1 KB, so the server can send it as-is to browsers that
// accept gzip. Run after `vite build`.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { constants, gzipSync } from "node:zlib";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const EXTS = new Set([".js", ".css", ".html", ".svg", ".json", ".wasm", ".txt"]);
const MIN_BYTES = 1024;

let count = 0;
let raw = 0;
let packed = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else if (EXTS.has(extname(name)) && st.size > MIN_BYTES) {
      const gz = gzipSync(readFileSync(path), { level: constants.Z_BEST_COMPRESSION });
      writeFileSync(path + ".gz", gz);
      count++;
      raw += st.size;
      packed += gz.length;
    }
  }
}
walk(DIST);
console.log(`compress: ${count} file(s), ${(raw / 1024).toFixed(1)} kB -> ${(packed / 1024).toFixed(1)} kB gzip`);
