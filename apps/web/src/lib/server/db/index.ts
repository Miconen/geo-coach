import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

let cachedDb: AppDb | null = null;
let cachedSql: postgres.Sql | null = null;

export function getDb(): AppDb {
  if (cachedDb) return cachedDb;
  const url =
    process.env.DATABASE_URL ?? "postgres://geocoach:geocoach@localhost:5432/geocoach";
  // JIT compiles plans whose cost estimates run high (the scope checks' subplans), adding ~15 ms to queries that run
  // in a few: off for this OLTP workload.
  cachedSql = postgres(url, { max: 10, connection: { jit: "off" } });
  cachedDb = drizzle(cachedSql, { schema });
  return cachedDb;
}

export async function checkDbReachable(db: AppDb = getDb()): Promise<boolean> {
  try {
    await db.execute("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export { schema };
