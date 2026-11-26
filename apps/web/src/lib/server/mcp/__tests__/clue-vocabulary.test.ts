import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadClueVocabulary, loadPromptInstructions, parseClueVocabulary } from "../prompts.js";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../prompts");

// The families and seed values of the #90 resolution, copied from the issue.
const FROM_90: Record<string, string[]> = {
  "Road lines": ["Yellow/orange centre line", "White centre line", "Double yellow/orange centre line", "Mixed yellow-and-white centre line", "Short-dash centre line", "Yellow/orange outer line", "White outer line", "Dashed outer line", "No outer lines"],
  "Road surface and markings": [],
  Chevrons: ["Yellow/orange chevron with black arrows", "Black chevron with yellow/orange arrows", "White chevron with red arrows", "Red chevron with white arrows", "Black chevron with white arrows", "Blue chevron with white arrows", "Blue chevron with yellow/orange arrows"],
  Bollards: ["White bollard with black band", "Red-top bollard", "Wedge bollard", "Flat bollard", "Yellow/orange bollard reflector", "Red bollard reflector", "Striped pointed bollard"],
  "Guardrails and barriers": ["Yellow/orange guardrail reflector", "Red guardrail reflector", "No guardrail reflector", "B-profile guardrail", "Double guardrail", "Black-and-white striped barrier", "Yellow/orange-and-black striped barrier"],
  Poles: ["Wooden pole", "Round concrete pole", "Square concrete pole", "Holey pole", "Octagonal metal pole", "Stobie pole", "Trapezoid pole top", "A-frame pole top", "Off-centre crossbar", "Hanging insulators"],
  "Pole markings": ["Yellow/orange-and-black striped pole", "Black-and-white striped pole", "Red-and-white striped pole", "Yellow/orange pole plate", "Pole sticker"],
  Lamps: ["Striped lamp base", "Double lamp post"],
  Signs: ["Black sign back", "Green direction sign", "Blue direction sign", "Yellow/orange warning sign", "Yellow/orange signpost", "Striped signpost", "PARE stop sign", "Text stop sign"],
  "Road markers": ["Kilometre marker"],
  Plates: ["No front plate", "Yellow/orange rear plate", "Long white plate with EU strip", "Two-strip plate", "Black plate", "Blue plate", "Red plate"],
  "Google car": ["Pickup truck", "White car", "Black car", "Red car", "Blue car", "Grey/silver car", "Roof rack", "Snorkel", "Long antenna", "Stubby antenna", "No antenna", "Follow car"],
  Camera: ["Gen 2", "Gen 3", "Gen 4", "Smallcam", "Low-cam", "Shitcam", "Trekker", "Boat"],
  "Driving side": ["Left-hand traffic", "Right-hand traffic"],
  "Script and language": ["Cyrillic script", "Greek script", "Arabic script", "Thai script", "Ø (o with a slash)", "Å (a with a ring)", "Ł (l with a stroke)", "ß (sharp s)", "Š (s with a hat)"],
  Architecture: ["Red brick building", "Orange tiled roof", "Metal sheet roof", "Flat roof", "White-walled house", "Dark red wooden house"],
  "Vegetation and landscape": ["Eucalyptus", "Palm trees", "Rice paddies", "Pine plantation", "Red soil", "Wind turbines", "Snow"],
};

describe("the Clue vocabulary prompt (#90)", () => {
  it("holds the 17 families and the seed values from #90, in order", () => {
    const vocab = parseClueVocabulary(readFileSync(path.join(dir, "clue-vocabulary-v1.md"), "utf8"), "clue-vocabulary-v1");
    expect(vocab.families.map((f) => f.family)).toEqual(Object.keys(FROM_90));
    expect(Object.fromEntries(vocab.families.map((f) => [f.family, f.seeds]))).toEqual(FROM_90);
  });

  it("is what the Claim tagger prompt includes and get_instructions serves", async () => {
    const { promptVersion, instructions } = await loadPromptInstructions("clue-tag");
    expect(promptVersion).toBe("clue-tag-v3");
    expect(instructions).not.toContain("{{include");
    expect(instructions).toContain("17. **Vegetation and landscape:** Eucalyptus");
    expect((await loadClueVocabulary()).families).toHaveLength(17);
  });
});
