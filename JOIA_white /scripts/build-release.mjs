#!/usr/bin/env node
/**
 * Builds an upload-ready release of the app: `npm run release`.
 *
 * Output: release/club-joia-300-white/ and release/club-joia-300-white-<date>.zip — a self-contained
 * Node.js server (server.js + only the node_modules it needs), the database migrations, deploy
 * tools (migrate, create-admin, optional demo seed) and server templates from ./deploy.
 * No `npm install` or build step is needed on the server; only Node.js 20.19+ and PostgreSQL.
 *
 * The local .env is never copied into the release.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const root = process.cwd();
const NAME = "club-joia-300-white";
const DIST = ".next-release";
const outDir = join(root, "release");
const app = join(outDir, NAME);
const stamp = new Date().toISOString().slice(0, 10);
const zipPath = join(outDir, `${NAME}-${stamp}.zip`);

// Native modules are traced for the build machine only (e.g. macOS). Their Linux builds are added
// so the same bundle runs on typical Linux servers (glibc and musl/Alpine, x64 and arm64).
const LINUX_ARCHES = ["x64", "arm64"];

const run = (cmd, args, env = {}) => execFileSync(cmd, args, { stdio: "inherit", cwd: root, env: { ...process.env, ...env } });
const step = (msg) => console.log(`\n▸ ${msg}`);

step("Building production bundle (standalone)");
rmSync(join(root, DIST), { recursive: true, force: true });
run("npx", ["prisma", "generate"]);
run("npx", ["next", "build"], {
  NODE_ENV: "production",
  NEXT_DIST_DIR: DIST,
  NEXT_OUTPUT: "standalone",
  // Build-time only: enables the HTTPS security headers (HSTS, upgrade-insecure-requests).
  // The real address is read at runtime from the server's .env.
  NEXT_PUBLIC_APP_URL: "https://release.invalid",
  NEXT_TELEMETRY_DISABLED: "1",
});

step("Assembling release folder");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(join(root, DIST, "standalone"), app, { recursive: true, verbatimSymlinks: true });
cpSync(join(root, DIST, "static"), join(app, DIST, "static"), { recursive: true });
cpSync(join(root, "public"), join(app, "public"), { recursive: true });
cpSync(join(root, "prisma", "migrations"), join(app, "prisma", "migrations"), { recursive: true });
cpSync(join(root, "deploy"), app, { recursive: true });
// Never ship local secrets, caches or uploads.
for (const f of readdirSync(app)) if (f.startsWith(".env") && f !== ".env.example") rmSync(join(app, f), { force: true });
for (const p of [join(app, DIST, "cache"), join(app, ".data"), join(app, "release")]) rmSync(p, { recursive: true, force: true });
chmodSync(join(app, "start.sh"), 0o755);

step("Bundling demo seed (tools/seed-demo.mjs)");
run("npx", [
  "esbuild", "prisma/seed.ts",
  "--bundle", "--platform=node", "--format=esm", "--target=node20",
  `--outfile=${join(app, "tools", "seed-demo.mjs")}`,
  "--external:@node-rs/argon2", "--external:pg", "--external:@prisma/client",
  "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  "--log-level=warning",
]);

step("Adding Linux builds of native modules");
const pkgJson = (name) => JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));
const argon = pkgJson("@node-rs/argon2");
const sharp = pkgJson("sharp");
const linuxPkgs = [
  ...LINUX_ARCHES.flatMap((arch) => [`argon2-linux-${arch}-gnu`, `argon2-linux-${arch}-musl`].map((n) => `@node-rs/${n}@${argon.version}`)),
  // sharp: only needed by Next.js image optimisation; added so it never fails on Linux.
  ...Object.entries(sharp.optionalDependencies)
    .filter(([n]) => LINUX_ARCHES.some((arch) => n.endsWith(`linux-${arch}`) || n.endsWith(`linuxmusl-${arch}`)))
    .map(([n, v]) => `${n}@${v}`),
];
const tmp = mkdtempSync(join(tmpdir(), "joia-release-"));
for (const spec of linuxPkgs) {
  const name = spec.slice(0, spec.lastIndexOf("@"));
  const tgz = execFileSync("npm", ["pack", spec, "--silent", "--pack-destination", tmp], { cwd: tmp }).toString().trim().split("\n").pop();
  const dest = join(app, "node_modules", ...name.split("/"));
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  execFileSync("tar", ["-xzf", join(tmp, tgz), "-C", dest, "--strip-components=1"]);
  console.log(`  + ${spec}`);
}
rmSync(tmp, { recursive: true, force: true });

step("Checking for other native modules");
const natives = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".node")) natives.push(relative(app, p));
  }
})(join(app, "node_modules"));
const unexpected = natives.filter((p) => !/@node-rs\/argon2-|@img\/sharp-/.test(p));
if (unexpected.length) console.warn(`  ⚠ Platform-specific files that may need a Linux build:\n    ${unexpected.join("\n    ")}`);
else console.log("  Only @node-rs/argon2 and sharp are native — Linux builds added above.");

writeFileSync(join(app, "RELEASE.txt"), `CLUB JOIA 300 — white edition\nBuilt: ${new Date().toISOString()}\nNode.js: 20.19 or newer\nSee README-DEPLOY.md\n`);

step("Creating zip");
execFileSync("zip", ["-qry", zipPath, NAME], { cwd: outDir });
const mb = (statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`\n✔ Release ready:\n  folder: ${relative(root, app)}\n  zip:    ${relative(root, zipPath)} (${mb} MB)\n`);
if (!existsSync(join(app, "server.js"))) throw new Error("server.js missing from release");
