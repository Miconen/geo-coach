import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema.js";
import type { AppDb } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../../../../drizzle");

export interface TestDbHandle {
  db: AppDb;
  pglite: PGlite;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDbHandle> {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema });
  await migrate(db, { migrationsFolder });
  return {
    // PGlite drizzle instance implements the exact same query surface as postgres-js drizzle
    db: db as unknown as AppDb,
    pglite,
    close: async () => {
      await pglite.close();
    },
  };
}
