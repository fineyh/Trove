// Shared changelog helpers, used by both scripts/release.mjs (validation) and
// scripts/ci-notes.mjs (extraction in CI).
//
// CHANGELOG.md      → English  → public GitHub Release body
// CHANGELOG.zh-CN.md → Chinese → in-app updater notes (latest.json `notes`)
import { readFileSync } from "node:fs";

export const CHANGELOG_EN = "CHANGELOG.md";
export const CHANGELOG_ZH = "CHANGELOG.zh-CN.md";

// Return the body of the `## [version]` section (the header line itself
// excluded), trimmed — or null if the file/section is missing or empty.
// Tolerates both `## [0.3.0] - 2026-05-30` and `## 0.3.0` heading styles.
export function extractSection(filePath, version) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/);
  const esc = version.replace(/\./g, "\\.");
  const headerRe = new RegExp(`^##\\s+\\[?${esc}\\]?(?:\\s|$)`);
  const start = lines.findIndex((l) => headerRe.test(l));
  if (start < 0) return null;

  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break; // next version section
    body.push(lines[i]);
  }
  return body.join("\n").trim() || null;
}
