<script lang="ts">
  interface Props {
    duoId: string;
    utterance: { id: string; text: string; rawText: string };
    /** The Round's country, offered as a rule scope. */
    countryCode?: string | null;
    /** Shows the fix control. Off for read-only excerpts. */
    editable?: boolean;
    /** Refreshes the page data after a saved fix (the page's live refresh, never invalidateAll). */
    onSaved?: () => unknown;
  }

  let { duoId, utterance, countryCode = null, editable = true, onSaved }: Props = $props();

  let open = $state(false);
  let find = $state("");
  let replacement = $state("");
  let busy = $state(false);
  let error = $state("");

  const corrected = $derived(utterance.rawText !== utterance.text);

  function startFix() {
    const selected = window.getSelection()?.toString().trim() ?? "";
    find = selected && utterance.rawText.includes(selected) ? selected : "";
    replacement = "";
    error = "";
    open = true;
  }

  async function save(scope: "once" | "always" | "country") {
    if (busy) return;
    busy = true;
    error = "";
    try {
      const res = await fetch(`/api/duos/${duoId}/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fixUtterance",
          utteranceId: utterance.id,
          find,
          replacement,
          scope,
          countryCode: scope === "country" ? countryCode : null,
        }),
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        error = out.error ?? "Could not save that fix.";
        return;
      }
      open = false;
      await onSaved?.();
    } catch {
      error = "Could not reach the server.";
    } finally {
      busy = false;
    }
  }
</script>

<span class="ml-1" title={corrected ? `Whisper heard: ${utterance.rawText}` : undefined}>{utterance.text}</span>
{#if editable}
  <button
    type="button"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => (open ? (open = false) : startFix())}
    aria-expanded={open}
    class="ml-1.5 text-[10px] text-[var(--muted)] hover:text-[var(--accent)] hover:underline"
  >
    Fix
  </button>
{/if}
{#if open}
  <span class="mt-1.5 flex flex-wrap items-end gap-2 rounded border border-[var(--border)] bg-[var(--surface)] p-2">
    <span class="w-full text-[11px] text-[var(--muted)]">Whisper heard: {utterance.rawText}</span>
    <label class="text-[11px]">
      Misheard words
      <input bind:value={find} maxlength="120" class="mt-0.5 block rounded border border-[var(--border-strong)] px-1.5 py-0.5 text-xs" />
    </label>
    <label class="text-[11px]">
      Should be
      <input bind:value={replacement} maxlength="120" class="mt-0.5 block rounded border border-[var(--border-strong)] px-1.5 py-0.5 text-xs" />
    </label>
    <span class="flex flex-wrap gap-2.5 text-xs">
      <button type="button" disabled={busy || !find.trim() || !replacement.trim()} onclick={() => save("once")} class="font-semibold text-[var(--accent)] hover:underline disabled:opacity-50">
        Just here
      </button>
      {#if countryCode}
        <button type="button" disabled={busy || !find.trim() || !replacement.trim()} onclick={() => save("country")} class="text-[var(--accent)] hover:underline disabled:opacity-50">
          Always in {countryCode}
        </button>
      {/if}
      <button type="button" disabled={busy || !find.trim() || !replacement.trim()} onclick={() => save("always")} class="text-[var(--accent)] hover:underline disabled:opacity-50">
        Always
      </button>
    </span>
    {#if error}
      <span role="alert" class="w-full text-[11px] text-[var(--danger)]">{error}</span>
    {/if}
  </span>
{/if}
