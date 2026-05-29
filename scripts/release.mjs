#!/usr/bin/env node
// Release helper — single source of truth for the version number.
//
// Before running, add a `## [x.y.z]` section to BOTH CHANGELOG.md (English)
// and CHANGELOG.zh-CN.md (Chinese) describing this release. Then:
//
//   npm run release 0.3.0          # bump + commit + tag (does NOT push)
//   npm run release 0.3.0 --push   # also push branch + tag (triggers CI)
//
// It rewrites the version in all four files that must stay in sync, folds the
// changelog edits into a `chore(release): bump version to X` commit, and tags
// `vX`. CI reads the changelog sections for the release notes (English → the
// GitHub Release body, Chinese → the in-app updater). Pushing the tag triggers
// .github/workflows/release.yml (see ADR-016); it is opt-in because it is an
// outward-facing action.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CHANGELOG_EN, CHANGELOG_ZH, extractSection } from "./changelog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function die(msg) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}

// --- parse args: <version> [--push] ----------------------------------------
const argv = process.argv.slice(2);
const opts = { push: false };
const positionals = [];
for (const a of argv) {
  if (a === "--push") opts.push = true;
  else if (a.startsWith("-")) die(`Unknown flag: ${a}`);
  else positionals.push(a);
}
const version = positionals[0];
const doPush = opts.push;

if (!version) die("Usage: npm run release <version> [--push]   e.g. npm run release 0.3.0");
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`Not a valid x.y.z version: "${version}"`);

const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();

// The changelogs are expected to be edited (and not yet committed) when this
// runs — we fold them into the release commit. Anything else dirty is a sign of
// unrelated work that should not ride along, so refuse.
const allowedDirty = new Set([CHANGELOG_EN, CHANGELOG_ZH]);
// NB: read the status WITHOUT the trimming `git()` helper. Worktree-only changes
// start with a leading space (e.g. " M file"); a global trim() would eat the
// first line's leading space, shifting slice(3) and mangling that path.
const statusRaw = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
const stray = statusRaw
  .split("\n")
  .filter(Boolean)
  .map((l) => l.slice(3).trim())
  .filter((p) => !allowedDirty.has(p));
if (stray.length) {
  die(`Working tree has changes beyond the changelogs:\n  ${stray.join("\n  ")}\nCommit or stash them first.`);
}

// Fail early (before mutating anything) if either changelog lacks notes for
// this version — releasing with empty notes is the mistake we want to prevent.
for (const f of [CHANGELOG_EN, CHANGELOG_ZH]) {
  if (!extractSection(join(root, f), version)) {
    die(`${f} has no non-empty "## [${version}]" section. Add the release notes there first.`);
  }
}

// --- rewrite the four version files ----------------------------------------
const edits = [];

// package.json / tauri.conf.json (JSON, 2-space, keep trailing newline)
function bumpJson(rel) {
  const path = join(root, rel);
  const raw = readFileSync(path, "utf8");
  const json = JSON.parse(raw);
  const old = json.version;
  if (old === version) return edits.push(`= ${rel} already ${version}`);
  json.version = version;
  const nl = raw.endsWith("\n") ? "\n" : "";
  writeFileSync(path, JSON.stringify(json, null, 2) + nl);
  edits.push(`✎ ${rel}: ${old} → ${version}`);
}

// Replace the first `version = "x"` that follows a given anchor line (e.g.
// `name = "trove"`), so we only touch the trove package, not a dependency.
function bumpTomlLike(rel, anchorRe) {
  const path = join(root, rel);
  const raw = readFileSync(path, "utf8");
  const re = new RegExp(`(${anchorRe}\\s*\\n(?:[^\\n]*\\n)*?version = ")([^"]+)(")`);
  const m = raw.match(re);
  if (!m) die(`Could not find version line after /${anchorRe}/ in ${rel}`);
  const oldVal = m[2];
  if (oldVal === version) return edits.push(`= ${rel} already ${version}`);
  writeFileSync(path, raw.replace(re, `$1${version}$3`));
  edits.push(`✎ ${rel}: ${oldVal} → ${version}`);
}

bumpJson("package.json");
bumpJson("src-tauri/tauri.conf.json");
bumpTomlLike("src-tauri/Cargo.toml", 'name = "trove"');
bumpTomlLike("src-tauri/Cargo.lock", 'name = "trove"');

console.log(edits.join("\n"));

// --- commit + tag ----------------------------------------------------------
const tag = `v${version}`;
if (git("tag", "--list", tag)) die(`Tag ${tag} already exists.`);

git(
  "add",
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  CHANGELOG_EN,
  CHANGELOG_ZH,
);
git("commit", "-m", `chore(release): bump version to ${version}`);
git("tag", "-a", tag, "-m", `Trove ${tag}`);
console.log(`\x1b[32m✓ committed + tagged ${tag} (notes from CHANGELOG)\x1b[0m`);

if (doPush) {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  git("push", "origin", branch, "--follow-tags");
  console.log(`\x1b[32m✓ pushed ${branch} + ${tag} — CI will build the release\x1b[0m`);
} else {
  console.log(`\nNext: push to trigger the release workflow:\n  git push origin HEAD --follow-tags`);
}
