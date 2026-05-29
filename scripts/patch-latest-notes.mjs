// CI-only: overwrite the `notes` field of an updater manifest (latest.json)
// with the Chinese release notes, so the in-app updater shows Chinese while the
// public GitHub Release page stays English.
//
// Usage:  NOTES="中文说明" node scripts/patch-latest-notes.mjs latest.json
//
// Node's writeFileSync emits UTF-8 without a BOM — which the updater requires
// (serde_json does not skip a leading BOM; see docs/decisions.md ADR-015).
import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("Usage: node patch-latest-notes.mjs <latest.json>");

const notes = process.env.NOTES ?? "";
const manifest = JSON.parse(readFileSync(path, "utf8"));
manifest.notes = notes;
writeFileSync(path, JSON.stringify(manifest, null, 2));

console.log(`patched ${path} notes → ${notes.split("\n")[0]}`);
