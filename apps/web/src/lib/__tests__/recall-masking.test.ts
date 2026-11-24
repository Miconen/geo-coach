import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// #56 X4: every answer-bearing field on Review renders inside Masked (the one mask). The list is the per-surface
// table in docs/release/1b-live-ii-recall-surfaces.md; adding an answer field means adding it here.
const root = join(__dirname, "../../");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const ANSWER_FIELDS: Array<{ file: string; fields: string[] }> = [
  {
    file: "routes/duos/[duoId=uuid]/review/+page.svelte",
    fields: [
      "{item.text}",
      "item.topics as topic",
      "data-testid=\"learning-chips\"",
      "data-testid=\"from-game\"",
      "{activeLearning.text}",
      "{activeLearning.detail}",
      "{activeLearning.agentNote}",
      "<ClaimCard claim={activeLearningClaim}",
      "<ClaimCard {claim} {wb} compact",
      "View replacement",
      "View earlier",
      "onSelectUtterance={openUtterance}\n",
      "Cited Speech",
    ],
  },
  { file: "lib/components/ClaimCard.svelte", fields: ["{l.text}"] },
  { file: "lib/components/ClaimDrawer.svelte", fields: ["<ClaimCard {claim} {...card} />"] },
  { file: "routes/duos/[duoId=uuid]/knowledge/+page.svelte", fields: ["<ClaimCard {claim} {...cardProps} />"] },
  { file: "lib/components/GameCard.svelte", fields: ["{l.text}"] },
  { file: "lib/components/LearningRow.svelte", fields: ["{learning.text}"] },
  { file: "lib/components/ClaimRow.svelte", fields: ["{claim.text}"] },
  { file: "lib/components/TranscriptTimeline.svelte", fields: ["<GameCard", "betweenGame as u"] },
  {
    file: "routes/duos/[duoId=uuid]/games/[gameId=uuid]/rounds/[n=roundnumber]/+page.svelte",
    fields: [
      "<RoundCoachingCard round={slice.round} utterances={slice.utterances} players={slice.players} />",
      "slice.utterances as u",
      "p.round.lat.toFixed",
    ],
  },
];

function insideMasked(src: string, at: number): boolean {
  let depth = 0;
  const re = /<Masked\b|<\/Masked>/g;
  for (let m = re.exec(src); m && m.index < at; m = re.exec(src)) depth += m[0] === "</Masked>" ? -1 : 1;
  return depth > 0;
}

describe("Recall masking", () => {
  for (const { file, fields } of ANSWER_FIELDS) {
    const src = read(file);
    it.each(fields)(`${file}: %s is masked`, (field) => {
      let at = src.indexOf(field);
      expect(at, `${field} not found`).toBeGreaterThanOrEqual(0);
      while (at >= 0) {
        expect(insideMasked(src, at), `${field} at ${at}`).toBe(true);
        at = src.indexOf(field, at + 1);
      }
    });
  }

  it("app.html applies the preference before first paint and hooks expose the Player", () => {
    const html = read("app.html");
    expect(html).toContain(String.raw`/^\/duos\/([0-9a-f-]{36})(?:\/|$)/i`);
    expect(html).toContain('"recall:v1:" + playerId + ":" + m[1].toLowerCase()');
    expect(html.indexOf("data-recall")).toBeLessThan(html.indexOf("%sveltekit.head%"));
    expect(read("hooks.server.ts")).toContain("data-player-id");
  });
});
