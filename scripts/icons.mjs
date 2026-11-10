// Regenerate every app icon under src-tauri/icons from the three SVG sources:
//
//   source.svg        everything, except
//   source-small.svg  32 px and below (simplified art): the small .ico layers,
//                     32x32.png and Square30x30Logo.png
//   source-mac.svg    icon.icns (the bubble on a tile, as macOS expects)
//
// Usage:  npm run icons
import { execSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const icons = join(root, "src-tauri", "icons");
const SMALL_MAX = 32;

function generate(source, outDir) {
  execSync(`npx tauri icon "${join(icons, source)}" -o "${outDir}"`, { cwd: root, stdio: "pipe" });
}

/** An .ico is a 6-byte header, one 16-byte entry per layer, then the layers. */
function readIco(path) {
  const buf = readFileSync(path);
  return Array.from({ length: buf.readUInt16LE(4) }, (_, i) => {
    const entry = 6 + i * 16;
    const size = buf.readUInt32LE(entry + 8);
    const offset = buf.readUInt32LE(entry + 12);
    return {
      px: buf[entry] || 256, // a width byte of 0 means 256
      head: buf.subarray(entry, entry + 12),
      data: buf.subarray(offset, offset + size),
    };
  });
}

function writeIco(path, layers) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(layers.length, 4);
  let offset = 6 + 16 * layers.length;
  const entries = layers.map((layer) => {
    const entry = Buffer.alloc(16);
    layer.head.copy(entry);
    entry.writeUInt32LE(offset, 12);
    offset += layer.data.length;
    return entry;
  });
  writeFileSync(path, Buffer.concat([header, ...entries, ...layers.map((l) => l.data)]));
}

const tmp = mkdtempSync(join(tmpdir(), "trove-icons-"));
try {
  const small = join(tmp, "small");
  const mac = join(tmp, "mac");
  generate("source.svg", icons);
  generate("source-small.svg", small);
  generate("source-mac.svg", mac);

  for (const name of ["32x32.png", "Square30x30Logo.png"]) copyFileSync(join(small, name), join(icons, name));
  copyFileSync(join(mac, "icon.icns"), join(icons, "icon.icns"));

  const smallLayers = new Map(readIco(join(small, "icon.ico")).map((l) => [l.px, l]));
  const layers = readIco(join(icons, "icon.ico")).map((l) => (l.px <= SMALL_MAX ? smallLayers.get(l.px) ?? l : l));
  writeIco(join(icons, "icon.ico"), layers);

  console.log(`icons: wrote ${icons} (.ico layers: ${layers.map((l) => l.px).join(", ")})`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
