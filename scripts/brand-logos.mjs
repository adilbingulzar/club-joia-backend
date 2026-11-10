// Derives web-sized logo files from the official artwork in public/brand (CJ300_Logo_*.png).
// The originals carry a lot of transparent padding; this trims it and caps the width so the
// header and card load a small file. The artwork itself is untouched.
// Re-run after replacing an official file: npm run brand:logos
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const sources = ["blk", "wht", "clr", "wht_rd"];
await mkdir("public/brand/web", { recursive: true });
for (const name of sources) {
  const src = `public/brand/CJ300_Logo_${name}.png`;
  const out = `public/brand/web/CJ300_Logo_${name}.png`;
  // threshold makes trim ignore near-transparent anti-aliasing noise around the artwork
  const trimmed = await sharp(src).trim({ threshold: 40 }).toBuffer();
  const info = await sharp(trimmed)
    .resize({ width: 800, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log("wrote", out, `${info.width}x${info.height}`);
}
