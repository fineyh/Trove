#!/usr/bin/env node
// Local build for daily use (Windows) — ADR-052.
//
//   npm run local
//
// Builds a release exe without installers (`tauri build --no-bundle`: no
// signing key needed), copies it to <repo>/.local/Trove.exe and points the
// "Trove Dev" desktop shortcut at it.
//
// The copy lives outside target/ so a running Trove doesn't block the next
// build. If the copy itself is running, it is renamed aside (Windows allows
// renaming a running exe) and the new one takes its place; restart to use it.
//
// Not under AppData: when run from a packaged (MSIX) app's terminal, writes
// there are silently redirected into that app's private storage.
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function die(msg) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}

if (process.platform !== "win32") die("npm run local is Windows-only for now.");

const build = spawnSync("npx", ["tauri", "build", "--no-bundle"], { cwd: root, stdio: "inherit", shell: true });
if (build.status !== 0) die("Build failed.");

const built = join(root, "src-tauri", "target", "release", "trove.exe");
if (!existsSync(built)) die(`Built exe not found: ${built}`);

const dir = join(root, ".local");
const exe = join(dir, "Trove.exe");
const old = join(dir, "Trove.old.exe");
mkdirSync(dir, { recursive: true });

// Leftover from last time; still locked if that instance is still open.
try { rmSync(old, { force: true }); } catch {}

let running = false;
if (existsSync(exe)) {
  try {
    rmSync(exe);
  } catch {
    if (existsSync(old)) die("Trove Dev is still open from two builds ago. Close it and run again.");
    renameSync(exe, old);
    running = true;
  }
}
copyFileSync(built, exe);

// Desktop shortcut, (re)pointed at this copy every run. The desktop may be
// redirected (OneDrive) and have a non-ASCII name, which doesn't survive
// PowerShell's console encoding — so the path is resolved and used entirely
// inside PowerShell.
const q = (s) => `'${s.replace(/'/g, "''")}'`;
const changed = execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$l = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Trove Dev.lnk'; ` +
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut($l); ` +
      `if ($s.TargetPath -ne ${q(exe)}) { ` +
      `$s.TargetPath = ${q(exe)}; $s.WorkingDirectory = ${q(dir)}; $s.Save(); 'changed' }`,
  ],
  { encoding: "utf8" },
).trim();
if (changed === "changed") console.log("Shortcut: Desktop\\Trove Dev.lnk");

console.log(`\x1b[32m✓ ${exe}\x1b[0m`);
if (running) console.log("Trove Dev is open — restart it to use the new build.");
