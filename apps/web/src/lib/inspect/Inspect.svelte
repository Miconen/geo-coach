<script lang="ts" module>
  const DEPTH_KEY = Symbol("inspect-depth");
</script>

<script lang="ts">
  import { getContext, setContext, type Snippet } from "svelte";
  import { getDeveloperMode } from "$lib/developer-mode.svelte.js";
  import JsonTreeNode from "./JsonTreeNode.svelte";

  interface Props {
    /** Component name, shown as the panel title. */
    name: string;
    /** The props the wrapped component receives. */
    props: Record<string, unknown>;
    /** Classes for the wrapper, which only exists in Developer mode (e.g. to keep a parent's spacing). */
    class?: string;
    children: Snippet;
  }

  let { name, props, class: className = "", children }: Props = $props();

  // Nested inspectors shift their badge left so it never sits on top of an outer one.
  const depth = getContext<number | undefined>(DEPTH_KEY) ?? 0;
  setContext(DEPTH_KEY, depth + 1);

  let open = $state(false);
  let badge = $state<HTMLButtonElement>();
  let panel = $state<HTMLElement>();

  $effect(() => {
    if (!open) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        open = false;
        badge?.focus();
      }
    };
    const onPointerdown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && (panel?.contains(target) || badge?.contains(target))) return;
      open = false;
    };
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("pointerdown", onPointerdown, true);
    return () => {
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("pointerdown", onPointerdown, true);
    };
  });
</script>

{#if getDeveloperMode()}
  <div class="relative {className}">
    {@render children()}

    <button
      bind:this={badge}
      type="button"
      onclick={() => (open = !open)}
      aria-expanded={open}
      aria-label="Inspect {name} props"
      title="Inspect {name} props"
      class="mono absolute top-0 z-10 -translate-y-1/2 cursor-pointer rounded border border-[var(--accent)] px-1 text-[10px] font-semibold leading-4 text-[var(--accent)] shadow-sm hover:bg-[var(--accent-soft)] {open
        ? 'bg-[var(--accent-soft)]'
        : 'bg-[var(--surface)]'}"
      style="right: {0.5 + depth * 2}rem"
    >
      {"{ }"}
    </button>

    {#if open}
      <div
        bind:this={panel}
        role="dialog"
        aria-label="{name} props"
        class="fixed right-4 top-4 z-50 flex max-h-[calc(100vh-2rem)] w-[min(28rem,calc(100vw-2rem))] flex-col rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] text-left shadow-[var(--shadow-card)]"
      >
        <div class="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
          <div class="text-sm font-semibold text-[var(--ink)]">
            {name}
            <span class="ml-1 text-xs font-normal text-[var(--muted)]">props</span>
          </div>
          <button
            type="button"
            onclick={() => (open = false)}
            class="rounded px-1.5 text-xs text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <ul class="mono overflow-auto py-2 pl-6 pr-3 text-[11px]">
          {#each Object.entries(props) as [key, value] (key)}
            <JsonTreeNode name={key} {value} ancestors={[props]} />
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{:else}
  {@render children()}
{/if}
