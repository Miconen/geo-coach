<script lang="ts">
  // A focused Round on the map (#79): a callout beside each guess pin (Player, score, km, seconds to guess, ★ ⏱ ⚡)
  // and a summary card above the answer (Damage, both bests, HP before → after). Positions come from the shared map's
  // projection, so they follow the camera. Under Recall only the callouts' names show.
  import {
    STARTING_HP,
    answerStreetViewUrl,
    googleMapsPointUrl,
    panoStreetViewUrl,
    type GameMode,
  } from "@geo-coach/shared";
  import { OPPONENT_COLOR } from "$lib/player-color.js";
  import type { SharedMap } from "$lib/map/shared-map.svelte.js";
  import { formatKm } from "$lib/stats/map/features.js";
  import { nearestOfficialPano } from "$lib/stats/map/streetview.js";
  import type { Debrief, DebriefGuess, DebriefRound } from "./types.js";
  import { flag, onDark, placeCallouts, playerName, signed } from "./view.js";

  let {
    map,
    debrief,
    round,
    masked,
    hoverPlayer,
  }: { map: SharedMap; debrief: Debrief; round: DebriefRound; masked: boolean; hoverPlayer: string | null } = $props();

  const MODE: Record<GameMode, string> = { moving: "Moving", nm: "No move", nmpz: "NMPZ" };
  let note = $state<string | null>(null);

  const who = (g: DebriefGuess) => playerName(debrief, g);
  const color = (g: DebriefGuess) => (g.isDuo ? (debrief.players[g.playerId ?? ""]?.color ?? "#60a5fa") : OPPONENT_COLOR);
  const ink = (g: DebriefGuess) => (g.isDuo ? onDark(color(g)) : "#ffffff");

  const placed = $derived.by(() => {
    void map.tick;
    const pins = round.guesses.flatMap((g) => {
      if (g.lat === null || g.lng === null) return [];
      const p = map.project(g.lng, g.lat);
      return p ? [{ item: g, x: p.x, y: p.y }] : [];
    });
    return placeCallouts(pins, masked ? 30 : 46);
  });
  const answer = $derived.by(() => {
    void map.tick;
    return round.lat !== null && round.lng !== null ? map.project(round.lng, round.lat) : null;
  });

  async function guessStreetView(g: DebriefGuess) {
    if (g.lat === null || g.lng === null) return;
    const tab = window.open("about:blank", "_blank");
    note = `Looking for Street View near ${who(g)}'s guess…`;
    const found = await nearestOfficialPano(g.lat, g.lng);
    if (found.found) {
      note = `Street View ${formatKm(found.distanceMeters)} from ${who(g)}'s guess.`;
      if (tab) tab.location.href = panoStreetViewUrl(found);
    } else {
      note = found.reason === "no-key" ? "No Street View key: opened the map." : "No Street View near that guess: opened the map.";
      if (tab) tab.location.href = googleMapsPointUrl(g.lat, g.lng);
    }
  }
  const pct = (hp: number) => `${(hp / STARTING_HP) * 100}%`;
</script>

<!-- Street View (a person) and the point on Google Maps (a pin), lined up after a name. -->
{#snippet linkIcons(sv: () => void, mapUrl: string, what: string)}
  <span class="inline-flex shrink-0 items-center gap-0.5">
    <button
      type="button"
      class="inline-flex size-4 items-center justify-center rounded p-0 leading-none text-sky-300 hover:bg-white/15"
      title="Street View {what}"
      aria-label="Street View {what}"
      onclick={sv}
    >
      <svg viewBox="0 0 24 24" class="block size-3" fill="currentColor" aria-hidden="true"
        ><circle cx="12" cy="4.5" r="2.5" /><path d="M9 8.5h6a1.5 1.5 0 0 1 1.5 1.5v4.5H15V22h-6v-7.5H7.5V10A1.5 1.5 0 0 1 9 8.5z" /></svg
      >
    </button>
    <a
      class="inline-flex size-4 items-center justify-center rounded p-0 leading-none text-sky-300 hover:bg-white/15"
      href={mapUrl}
      target="_blank"
      rel="noreferrer"
      title="{what} on Google Maps"
      aria-label="{what} on Google Maps"
    >
      <svg viewBox="0 0 24 24" class="block size-3" fill="currentColor" aria-hidden="true"
        ><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg
      >
    </a>
  </span>
{/snippet}

<div class="pointer-events-none absolute inset-0 z-[5] overflow-hidden" data-testid="round-callouts">
  <svg class="absolute inset-0 h-full w-full" aria-hidden="true">
    {#each placed as c, i (i)}
      {#if c.y !== c.pin.y}
        <line x1={c.pin.x} y1={c.pin.y} x2={c.pin.x + 16} y2={c.y} stroke={color(c.item)} stroke-width="1.5" opacity="0.8" />
      {/if}
    {/each}
  </svg>

  {#each placed as c, i (i)}
    {@const g = c.item}
    <div
      class="pointer-events-auto absolute flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-lg border bg-black/80 px-2 py-1 text-[11px] text-white shadow-lg backdrop-blur transition-[box-shadow,transform] {hoverPlayer &&
      g.isDuo &&
      g.playerId === hoverPlayer
        ? 'scale-110 ring-2'
        : ''}"
      style="left:{c.pin.x + 16}px;top:{c.y}px;border-color:{color(g)};--tw-ring-color:{color(g)}"
      data-testid="guess-callout"
      data-player={g.playerId ?? "opponent"}
      data-highlighted={hoverPlayer !== null && g.isDuo && g.playerId === hoverPlayer}
    >
      <span class="grid size-5 place-items-center rounded-full border-2 border-white text-[9px] font-bold" style="background:{color(g)}"
        >{g.isDuo ? (debrief.players[g.playerId ?? ""]?.initial ?? "?") : "O"}</span
      >
      <span class="leading-tight">
        <span class="flex items-center gap-1 font-semibold">
          <span style="color:{ink(g)}">{who(g)}</span>{#if g.isBestForTeam && !masked}<span title="Best guess for the team">★</span>{/if}
          {#if !masked && g.countryCode && g.countryCode !== round.countryCode}<span class="leading-none" title="Wrong country">{flag(g.countryCode)}</span>{/if}
          {#if !masked && g.lat !== null && g.lng !== null}
            {@const lat = g.lat}
            {@const lng = g.lng}
            {@render linkIcons(() => guessStreetView(g), googleMapsPointUrl(lat, lng), `near ${who(g)}'s guess`)}
          {/if}
        </span>
        {#if !masked}
          <span class="block font-mono text-white/80">
            {g.score.toLocaleString("en-US")} · {formatKm(g.distanceMeters)} ·
            <span class={g.slower ? "text-orange-300" : ""} title={g.slower ? "The Duo's slower guess" : "Seconds to guess"}
              >{g.secondsToGuess === null ? "–" : `${g.secondsToGuess.toFixed(1)}s`}</span
            >{#if g.timedOut}<span class="ml-1" title="Timed out: the timer submitted it">⏱</span>{/if}{#if g.guessedFirst}<span
                class="ml-1 text-amber-300"
                title="Guessed first: started the Countdown">⚡</span
              >{/if}
          </span>
        {/if}
      </span>
    </div>
  {/each}

  {#if answer && !masked}
    <div
      class="pointer-events-auto absolute w-[250px] -translate-x-1/2 -translate-y-[calc(100%+18px)] rounded-xl border border-white/20 bg-black/85 p-2.5 text-xs text-white shadow-2xl backdrop-blur"
      style="left:{answer.x}px;top:{answer.y}px"
      data-testid="answer-card"
    >
      <div class="flex items-center gap-1.5">
        <span class="text-base">{flag(round.countryCode)}</span>
        <span class="font-bold">{round.countryName ?? "?"}</span>
        <span class="truncate text-indigo-300">{round.regionName ?? ""}</span>
        {#if round.lat !== null && round.lng !== null}
          {@render linkIcons(
            () => {
              const url = answerStreetViewUrl(round);
              if (url) window.open(url, "_blank", "noreferrer");
            },
            googleMapsPointUrl(round.lat, round.lng),
            "the answer",
          )}
        {/if}
      </div>
      <div class="mt-1 flex items-end gap-3">
        <div>
          <p class="text-lg font-bold leading-none {round.hpDelta < 0 ? 'text-red-400' : round.hpDelta > 0 ? 'text-green-400' : ''}">{signed(round.hpDelta)}</p>
          <p class="text-[9px] font-bold tracking-wide text-white/60">DAMAGE{round.damageMultiplier !== 1 ? ` ×${round.damageMultiplier}` : ""}</p>
        </div>
        <div>
          <p class="font-bold leading-none">{round.duoBestScore.toLocaleString("en-US")}</p>
          <p class="text-[9px] font-bold tracking-wide text-white/60">OUR BEST</p>
        </div>
        <div>
          <p class="font-bold leading-none">{round.opponentBestScore.toLocaleString("en-US")}</p>
          <p class="text-[9px] font-bold tracking-wide text-white/60">THEIRS</p>
        </div>
      </div>
      {#each [{ k: "Us", b: round.hpBefore.duo, a: round.hpAfter.duo, c: "#22c55e" }, { k: "Them", b: round.hpBefore.opponents, a: round.hpAfter.opponents, c: "#9ca3af" }] as row (row.k)}
        <div class="mt-1 flex items-center gap-1.5" data-testid="hp-{row.k.toLowerCase()}">
          <span class="w-8 font-semibold">{row.k}</span>
          <div class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div class="absolute inset-y-0 left-0 bg-red-500/70" style="width:{pct(row.b)}"></div>
            <div class="absolute inset-y-0 left-0" style="width:{pct(row.a)};background:{row.c}"></div>
          </div>
          <span class="w-[86px] text-right font-mono text-[10px]">{row.b.toLocaleString("en-US")} → {row.a.toLocaleString("en-US")}</span>
        </div>
      {/each}
      <p class="mt-1 truncate text-[10px] text-white/50">
        Round {round.roundNumber} of {round.roundCount}{round.mode ? ` · ${MODE[round.mode]}` : ""}{round.mapName ? ` · ${round.mapName}` : ""}
      </p>
      {#if note}<p class="mt-1 text-[10px] text-sky-200">{note}</p>{/if}
    </div>
  {/if}
</div>
