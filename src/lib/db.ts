import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { createMySqlAdapter } from "@/lib/db-adapter";

/** One PrismaClient (and pool) per server process; survives dev hot-reloads. */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  return new PrismaClient({ adapter: createMySqlAdapter(process.env.DATABASE_URL) });
}

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
