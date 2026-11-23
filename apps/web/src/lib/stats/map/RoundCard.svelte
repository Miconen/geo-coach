<script lang="ts">
  // The open Round, docked at the top right so it never covers its own pins and lines.
  // A stand-in for the Round view (#33): Game state, every guess, Street View links.
  import {
    STARTING_HP,
    answerStreetViewUrl,
    getCountryName,
    googleMapsPointUrl,
    mapRoundClass,
    mistakeCountryCode,
    panoStreetViewUrl,
    regionName,
    roundGameState,
    slowerDuoGuess,
    type GameMode,
    type StatsGuess,
    type StatsPayload,
  } from "@geo-coach/shared";
  import { formatNumber, formatSigned } from "../overview-text.js";
  import { CLASS_LABEL, OPPONENT_COLOR, classColor, initial } from "./colors.js";
  import { formatKm } from "./features.js";
  import Flag from "./Flag.svelte";
  import type { PlacedRound } from "./geo.js";
  import { nearestOfficialPano } from "./streetview.js";

  let {
    round,
    payload,
    colors,
    gameRounds,
    gameShown,
    onclose,
    ontogglegame,
    onopenround,
  }: {
    round: PlacedRound;
    payload: StatsPayload;
    colors: readonly string[];
    /** The Game's placed Rounds, in order. */
    gameRounds: readonly PlacedRound[];
    gameShown: boolean;
    onclose: () => void;
    ontogglegame: () => void;
    onopenround: (roundId: string) => void;
  } = $props();

  const MODE_LABEL: Record<GameMode, string> = { moving: "Moving", nm: "No move", nmpz: "NMPZ" };

  const cls = $derived(mapRoundClass(round));
  const game = $derived(payload.games.find((g) => g.id === round.gameId) ?? null);
  const gameState = $derived(roundGameState(payload.rounds, round));
  const slower = $derived(slowerDuoGuess(round));
  const guesses = $derived(
    [...round.guesses].sort((a, b) => Number(b.isDuo) - Number(a.isDuo) || b.score - a.score),
  );
  const answerCountry = $derived(mistakeCountryCode(round.countryCode, round.regionCode));

  function playerIndex(g: StatsGuess) {
    return payload.players.findIndex((p) => p.id === g.playerId);
  }
  function guessName(g: StatsGuess) {
    if (!g.isDuo) return "Opponent";
    return payload.players[playerIndex(g)]?.displayName ?? "?";
  }
  function guessColor(g: StatsGuess) {
    return g.isDuo ? (colors[playerIndex(g)] ?? "#9ca3af") : OPPONENT_COLOR;
  }
  const wrongCountry = (g: StatsGuess) =>
    g.countryCode !== null && mistakeCountryCode(g.countryCode, g.regionCode) !== answerCountry;

  let note = $state<string | null>(null);
  $effect(() => {
    void round.id;
    note = null;
  });

  function openAnswerStreetView() {
    const url = answerStreetViewUrl(round);
    note = null;
    if (url) window.open(url, "_blank", "noreferrer");
  }

  /** The nearest official pano to a guess. The tab opens first, so it isn't blocked as a popup. */
  async function openGuessStreetView(g: StatsGuess) {
    if (g.lat === null || g.lng === null) return;
    const who = guessName(g);
    const tab = window.open("about:blank", "_blank");
    note = `Looking for Street View near ${who}'s guess…`;
    const found = await nearestOfficialPano(g.lat, g.lng);
    if (found.found) {
      note = `Nearest Google Street View is ${formatKm(found.distanceMeters)} from ${who}'s guess.`;
      if (tab) tab.location.href = panoStreetViewUrl(found);
      return;
    }
    note =
      found.reason === "no-key"
        ? "No PUBLIC_GOOGLE_MAPS_API_KEY is set, so this opened the map instead of Street View."
        : found.reason === "none"
          ? `No official Street View within 50 km of ${who}'s guess. Opened the map instead.`
          : `Street View lookup failed (${found.message ?? "unknown error"}). Opened the map instead.`;
    if (tab) tab.location.href = googleMapsPointUrl(g.lat, g.lng);
  }

  const hpRows = $derived([
    { label: "Us", before: gameState.before.duo, after: gameState.after.duo, color: "#22c55e" },
    { label: "Them", before: gameState.before.opponents, after: gameState.after.opponents, color: OPPONENT_COLOR },
  ]);
  const pct = (hp: number) => `${(hp / STARTING_HP) * 100}%`;
</script>

<div class="flex items-center gap-2">
  <Flag code={round.countryCode} />
  <span class="text-base font-bold">{round.countryCode ? getCountryName(round.countryCode) : "Unknown country"}</span>
  <span class="truncate text-xs text-indigo-300">{regionName(round.regionCode) ?? ""}</span>
  <button type="button" class="ml-auto text-white/60 hover:text-white" onclick={onclose} title="Close (Esc)" aria-label="Close">✕</button>
</div>
<div class="mt-0.5 text-xs text-white/60">
  {new Date(round.startedAtMs).toLocaleDateString(undefined, { dateStyle: "medium" })} · Round {round.roundNumber} ·
  <span style="color: {classColor(cls)}">{cls ? CLASS_LABEL[cls] : "Unclassified"}</span>
</div>

<div class="mt-2 flex gap-5">
  <div>
    <div class="text-lg font-bold {round.hpDelta < 0 ? 'text-red-400' : 'text-green-400'}">{formatSigned(round.hpDelta)}</div>
    <div class="stat-label" title="Score gap × the multiplier of the team that dealt it">
      DAMAGE{round.damageMultiplier !== 1 ? ` ×${round.damageMultiplier}` : ""}
    </div>
  </div>
  <div>
    <div class="text-lg font-bold">{formatNumber(round.duoBestScore)}</div>
    <div class="stat-label">OUR BEST</div>
  </div>
  <div>
    <div class="text-lg font-bold">{formatNumber(round.opponentBestScore)}</div>
    <div class="stat-label">THEIRS</div>
  </div>
</div>

<div class="mt-3 rounded-xl bg-white/5 p-2.5 text-xs">
  <div class="mb-1 flex flex-wrap gap-x-2 text-white/60">
    {#if game?.mode}<span class="rounded bg-white/10 px-1.5 font-semibold text-white/80">{MODE_LABEL[game.mode]}</span>{/if}
    {#if game?.mapName}<span class="truncate">{game.mapName}</span>{/if}
  </div>
  <div class="mb-1.5 flex justify-between text-white/60">
    <span>Round {gameState.roundNumber} of {gameState.roundCount} · ×{gameState.multiplier}</span>
    {#if game?.won != null}
      <span class={game.won ? "text-green-400" : "text-red-400"}>{game.won ? "Game won" : "Game lost"}</span>
    {/if}
  </div>
  {#each hpRows as row (row.label)}
    <div class="mb-1 flex items-center gap-2">
      <span class="w-9 font-semibold">{row.label}</span>
      <div class="relative h-2.5 flex-1 overflow-hidden rounded-full bg-white/10" title="HP going into the Round → after it">
        <div class="absolute inset-y-0 left-0 rounded-full bg-red-500/70" style="width: {pct(row.before)}"></div>
        <div class="absolute inset-y-0 left-0 rounded-full" style="width: {pct(row.after)}; background: {row.color}"></div>
      </div>
      <span class="w-24 text-right font-mono">{formatNumber(row.before)} → {formatNumber(row.after)}</span>
    </div>
  {/each}
  {#if game?.ratingBefore != null}
    <div class="text-white/50">
      Rating {game.ratingBefore}{game.opponentRatingBefore != null ? ` vs ${game.opponentRatingBefore}` : ""}
    </div>
  {/if}
</div>

<ul class="mt-2 space-y-1 text-sm">
  {#each guesses as g, i (i)}
    <li class="grid grid-cols-[1.25rem_1fr_auto_3.5rem_1.75rem] items-center gap-x-2">
      <span class="avatar" style="background: {guessColor(g)}">{g.isDuo ? initial(guessName(g)) : "O"}</span>
      <span class="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        <span class="truncate">{guessName(g)}{g.isBestForTeam ? " ★" : ""}</span>
        {#if wrongCountry(g)}<Flag code={g.countryCode} size="sm" />{/if}
      </span>
      <span class="whitespace-nowrap text-right font-mono text-xs text-white/80">{formatNumber(g.score)} · {formatKm(g.distanceMeters)}</span>
      <span
        class="text-right font-mono text-xs {slower === g ? 'text-orange-300' : 'text-white/50'}"
        title={g.timedOut
          ? "Timed out: the timer submitted this pin"
          : slower === g
            ? "The Duo's slower guess"
            : "Seconds from the Round's start to this guess"}
      >
        {g.secondsToGuess === null ? "–" : `${g.secondsToGuess.toFixed(1)}s`}{g.timedOut ? " ⏱" : ""}
      </span>
      {#if g.lat === null || g.lng === null}
        <span></span>
      {:else}
        <button
          type="button"
          class="whitespace-nowrap text-xs text-sky-300 hover:underline"
          title="Nearest official Google Street View to this guess"
          onclick={() => openGuessStreetView(g)}>SV ↗</button
        >
      {/if}
    </li>
  {/each}
</ul>

<button
  type="button"
  class="mt-3 w-full rounded-full py-1.5 text-sm font-semibold {gameShown ? 'bg-yellow-400 text-black' : 'bg-white/10 hover:bg-white/20'}"
  onclick={ontogglegame}
>
  {gameShown ? "Hide the other Rounds" : `Show all ${gameState.roundCount} Rounds of this Game`}
</button>
{#if gameShown}
  <ol class="mt-2 space-y-0.5 text-sm">
    {#each gameRounds as x (x.id)}
      {@const xCls = mapRoundClass(x)}
      <li>
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-white/10 {x.id === round.id ? 'bg-white/10' : ''}"
          onclick={() => onopenround(x.id)}
        >
          <span class="w-6 font-mono text-xs text-yellow-300">R{x.roundNumber}</span>
          <Flag code={x.countryCode} size="sm" />
          <span class="truncate">{x.countryCode ? getCountryName(x.countryCode) : "?"}</span>
          <span class="inline-block size-2 shrink-0 rounded-full" style="background: {classColor(xCls)}" title={xCls ? CLASS_LABEL[xCls] : "Unclassified"}></span>
          {#if x.damageMultiplier !== 1}<span class="ml-auto font-mono text-[10px] text-white/50">×{x.damageMultiplier}</span>{/if}
          <span class="{x.damageMultiplier !== 1 ? '' : 'ml-auto '}font-mono text-xs {x.hpDelta < 0 ? 'text-red-400' : 'text-green-400'}">{formatSigned(x.hpDelta)}</span>
        </button>
      </li>
    {/each}
  </ol>
{/if}

<div class="mt-2 flex gap-2 text-sm font-semibold">
  <button type="button" class="flex-1 rounded-full bg-white/10 py-1.5 text-center hover:bg-white/20" onclick={openAnswerStreetView}>Street View ↗</button>
  <a class="flex-1 rounded-full bg-white/10 py-1.5 text-center hover:bg-white/20" href={googleMapsPointUrl(round.lat, round.lng)} target="_blank" rel="noreferrer">Answer on map ↗</a>
</div>
{#if note}<p class="mt-2 text-xs text-sky-200">{note}</p>{/if}
<p class="mt-2 text-[11px] text-white/40">Stand-in until the Round view exists (#33 covers side-by-side Google Maps).</p>

<style>
  .stat-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: rgb(255 255 255 / 0.6);
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 9999px;
    border: 2px solid #fff;
    font-size: 9px;
    font-weight: 700;
  }
</style>
