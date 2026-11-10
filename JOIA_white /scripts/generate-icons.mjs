// Generates PWA icons from a monogram. PLACEHOLDER artwork — regenerate from the final brand
// mark by replacing public/brand/app-icon-source.svg and running: node scripts/generate-icons.mjs
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";

const src = await readFile("public/brand/app-icon-source.svg");
const out = [
  ["public/icons/icon-192.png", 192],
  ["public/icons/icon-512.png", 512],
  ["public/icons/icon-maskable-512.png", 512],
  ["public/icons/apple-touch-icon.png", 180],
  ["public/icons/badge-72.png", 72],
];
for (const [file, size] of out) {
  await writeFile(file, await sharp(src).resize(size, size).png().toBuffer());
  console.log("wrote", file);
}
