import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function imageInfo(bytes) {
  let width, height, extension;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    extension = "png"; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) {
    extension = "gif"; width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8);
  } else if (bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    extension = "webp";
    const type = bytes.toString("ascii", 12, 16);
    if (type === "VP8X") { width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1; }
    else if (type === "VP8 ") { width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff; }
    else if (type === "VP8L") { const bits = bytes.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
  } else if (bytes.length >= 26 && bytes.toString("ascii", 0, 2) === "BM") {
    extension = "bmp"; width = Math.abs(bytes.readInt32LE(18)); height = Math.abs(bytes.readInt32LE(22));
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    extension = "jpg";
    for (let i = 2; i + 4 <= bytes.length;) {
      if (bytes[i++] !== 0xff) break;
      while (bytes[i] === 0xff) i++;
      const marker = bytes[i++];
      if (marker === 0xda || marker === 0xd9 || i + 2 > bytes.length) break;
      const size = bytes.readUInt16BE(i);
      if (size < 2 || i + size > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && size >= 7) {
        height = bytes.readUInt16BE(i + 3); width = bytes.readUInt16BE(i + 5); break;
      }
      i += size;
    }
  } else {
    const source = bytes.toString("utf8"), tag = source.match(/<svg\b([^>]*)>/i)?.[1];
    if (!tag) return null;
    // Native previews do not load scripts, external documents, or local-file references.
    const externalCss = [...source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)].some(match => !match[2].trim().startsWith("#"));
    if (externalCss || /<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|\b(?:href|src)\s*=\s*["'](?!#)/i.test(source)) throw new Error("SVG preview requires a self-contained image without external resources");
    extension = "svg";
    const box = tag.match(/\bviewBox\s*=\s*["']([^"']+)/i)?.[1].trim().split(/[\s,]+/).map(Number);
    width = Number(tag.match(/\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i)?.[1]) || box?.[2];
    height = Number(tag.match(/\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i)?.[1]) || box?.[3];
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (width * height > 64000000 || width > 32768 || height > 32768) throw new Error("Image exceeds the 64 megapixel preview limit");
  return { width, height, extension, bytes: bytes.length };
}

export async function cacheImage(bytes, directory) {
  if (bytes === null) return null;
  const info = imageInfo(bytes);
  if (!info) throw new Error("Unsupported or invalid image data");
  const filename = `${createHash("sha256").update(bytes).digest("hex")}.${info.extension}`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { await writeFile(path.join(directory, filename), bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  return { ...info, path: `data/gitdeck-images/${filename}` };
}
