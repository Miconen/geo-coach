import type {
  WorkbenchData,
  WorkbenchGame,
  WorkbenchLearning,
  WorkbenchPlayer,
  WorkbenchRound,
  WorkbenchUtterance,
} from "$lib/server/workbench/view-model.js";

/** One Round plus only the Utterances and Players it renders. */
export interface RoundSlice {
  round: WorkbenchRound;
  /** The Round's Utterances in `round.utteranceIds` order; ids missing from the Workbench are skipped. */
  utterances: WorkbenchUtterance[];
  /** Players who speak or guess in this Round, keyed by Player id. */
  players: Record<string, WorkbenchPlayer>;
}

/** One Game plus the slices of its Rounds and the Learnings they link. */
export interface GameSlice {
  game: WorkbenchGame;
  /** In `game.roundIds` order; ids missing from the Workbench are skipped. */
  rounds: RoundSlice[];
  /** Learnings linked from any of the Game's Rounds, in Workbench order. */
  learnings: WorkbenchLearning[];
}

/** A Game a Learning came from, with the linked Rounds in play order. */
export interface LearningGameLink {
  game: WorkbenchGame;
  rounds: WorkbenchRound[];
}

type RoundSource = Pick<WorkbenchData, "roundsById" | "utterancesById" | "players">;
type GameSource = RoundSource & Pick<WorkbenchData, "gamesById" | "learnings">;

export function learningGameLinks(
  wb: Pick<WorkbenchData, "roundsById" | "gamesById">,
  roundIds: string[],
): LearningGameLink[] {
  const byGame = new Map<string, LearningGameLink>();
  for (const id of roundIds) {
    const round = wb.roundsById[id];
    const game = round ? wb.gamesById[round.gameId] : undefined;
    if (!round || !game) continue;
    const link = byGame.get(game.id) ?? { game, rounds: [] };
    link.rounds.push(round);
    byGame.set(game.id, link);
  }
  const links = [...byGame.values()];
  for (const link of links) link.rounds.sort((a, b) => a.roundNumber - b.roundNumber);
  return links.sort((a, b) => Date.parse(a.game.startedAt) - Date.parse(b.game.startedAt));
}

export function roundSlice(wb: RoundSource, roundId: string): RoundSlice | null {
  const round = wb.roundsById[roundId];
  if (!round) return null;

  const utterances = round.utteranceIds
    .map((id) => wb.utterancesById[id])
    .filter((u): u is WorkbenchUtterance => Boolean(u));

  const players: Record<string, WorkbenchPlayer> = {};
  const playerIds = [
    ...utterances.map((u) => u.playerId),
    ...round.guesses.map((g) => g.playerId).filter((id): id is string => id !== null),
  ];
  for (const id of playerIds) {
    const player = wb.players[id];
    if (player) players[id] = player;
  }

  return { round, utterances, players };
}

export function gameSlice(wb: GameSource, gameId: string): GameSlice | null {
  const game = wb.gamesById[gameId];
  if (!game) return null;

  const rounds = game.roundIds
    .map((id) => roundSlice(wb, id))
    .filter((r): r is RoundSlice => r !== null);

  const learningIds = new Set(rounds.flatMap((r) => r.round.learningIds));
  const learnings = wb.learnings.filter((l) => learningIds.has(l.id));

  return { game, rounds, learnings };
}
