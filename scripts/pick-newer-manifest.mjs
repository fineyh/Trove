// CI-only (update-channels.yml): write whichever of two updater manifests has
// the higher semver `version` to <out>. The second may be missing (first run).
//
// Usage:  node scripts/pick-newer-manifest.mjs <candidate.json> <current.json> <out.json>
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [candidatePath, currentPath, outPath] = process.argv.slice(2);
if (!candidatePath || !currentPath || !outPath) {
  throw new Error("Usage: node pick-newer-manifest.mjs <candidate.json> <current.json> <out.json>");
}

// The updater wants UTF-8 without a BOM; strip one if a tool added it.
const read = (p) => readFileSync(p, "utf8").replace(/^﻿/, "");

function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v);
  if (!m) throw new Error(`Not a semver version: ${v}`);
  return { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".") : [] };
}

/** Semver precedence: -1, 0, 1. */
function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  // A release ranks above any of its prereleases.
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && +p !== +q) return +p < +q ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    if (!pn && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

const candidate = read(candidatePath);
const candidateVersion = JSON.parse(candidate).version;

let current = null;
let currentVersion = null;
if (existsSync(currentPath)) {
  current = read(currentPath);
  currentVersion = JSON.parse(current).version;
}

const keepCurrent = current !== null && compare(currentVersion, candidateVersion) > 0;
writeFileSync(outPath, keepCurrent ? current : candidate);
console.log(
  keepCurrent
    ? `beta.json stays at ${currentVersion} (newer than ${candidateVersion})`
    : `beta.json → ${candidateVersion}${currentVersion ? ` (was ${currentVersion})` : ""}`,
);
