// Conversation pictures live in the library (ADR-050).
//
// A picture picked from disk starts out as a file path. The WebView reads it
// once through `trove://`, shrinks it to a small square and hands the bytes
// back to be stored in the library — the same division of labour as
// thumbnails (ADR-037): Rust has no image decoder, the WebView has them all.

import * as ipc from "../ipc/client";

const SIZE = 256;
const QUALITY = 0.82;

/**
 * Take a conversation's file-path avatar into the library. Resolves to
 * whether it was stored; throws when the file can't be read or decoded
 * (the avatar then simply stays what it was).
 */
export async function adoptAvatar(lib: string, convId: number): Promise<boolean> {
  const resp = await fetch(ipc.avatarSrc(lib, convId));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  // Applies EXIF orientation by default.
  const bmp = await createImageBitmap(await resp.blob());
  try {
    // Centre square, the same crop `object-cover` shows; never enlarged.
    const side = Math.min(bmp.width, bmp.height);
    const out = Math.min(SIZE, side);
    const canvas = new OffscreenCanvas(out, out);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: QUALITY });
    return await ipc.adoptConversationAvatar(
      lib,
      convId,
      blob.type || "image/webp",
      new Uint8Array(await blob.arrayBuffer()),
    );
  } finally {
    bmp.close();
  }
}
