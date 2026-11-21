import { getDb } from "./index.js";
import { rebuildDerivedGamesForDuo } from "../services/geoguessr.js";

async function main() {
  const db = getDb();
  const allDuos = await db.query.duos.findMany();
  let total = 0;
  for (const duo of allDuos) {
    const count = await rebuildDerivedGamesForDuo(db, duo.id);
    total += count;
    console.log(`Rebuilt ${count} Game(s) for Duo ${duo.name}`);
  }
  console.log(`Done. Rebuilt ${total} Game(s) across ${allDuos.length} Duo(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Rebuild failed:", err);
  process.exit(1);
});
