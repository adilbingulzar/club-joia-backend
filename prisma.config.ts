import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Not env("DATABASE_URL"): that throws when the variable is missing, which breaks
    // `npm install` (postinstall runs `prisma generate`) on a fresh checkout without a .env.
    // Commands that really connect (migrate, seed, studio) still fail clearly without it.
    url: process.env.DATABASE_URL ?? "",
  },
});
