// CI-only: pull the release notes for the pushed tag's version out of the
// changelog files and expose them as step outputs `en` and `zh` for
// .github/workflows/release.yml.
//
// `en` (CHANGELOG.md)       → GitHub Release body (public, English).
// `zh` (CHANGELOG.zh-CN.md) → patched into latest.json `notes` (in-app, Chinese).
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CHANGELOG_EN, CHANGELOG_ZH, extractSection } from "./changelog.mjs";

const tag = process.env.TAG;
if (!tag) throw new Error("TAG env is required");
const version = tag.replace(/^v/, "");

const en = extractSection(CHANGELOG_EN, version) || `Trove ${tag}`;
const zh = extractSection(CHANGELOG_ZH, version) || en;

function setOutput(key, value) {
  const delim = `__${randomUUID()}__`;
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}<<${delim}\n${value}\n${delim}\n`);
}

setOutput("en", en);
setOutput("zh", zh);
console.log(`--- en (${CHANGELOG_EN}) ---\n${en}\n\n--- zh (${CHANGELOG_ZH}) ---\n${zh}`);
