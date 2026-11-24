<script lang="ts">
  import { beforeNavigate, pushState, replaceState } from "$app/navigation";
  import { page } from "$app/state";

  let { data } = $props();
  let beforeNavigateCount = $state(0);
  beforeNavigate(() => {
    beforeNavigateCount += 1;
  });

  // Typed page.state first; the URL is the cold-load fallback.
  const focus = $derived(page.state.focus ?? page.url.searchParams.get("focus") ?? "");
  const filter = $derived(page.state.filter ?? page.url.searchParams.get("f") ?? "");

  function setFilter(value: string) {
    const url = new URL(location.href);
    url.searchParams.set("f", value);
    replaceState(url, { ...page.state, filter: value });
  }

  function setFocus(value: string) {
    const url = new URL(location.href);
    url.searchParams.set("focus", value);
    pushState(url, { ...page.state, focus: value });
  }
</script>

<h1 data-testid="item-id">{data.id}</h1>
<p>loads <span data-testid="load-count">{data.loadCount}</span></p>
<p>duo <span data-testid="duo">{data.duo ?? ""}</span></p>
<p>focus <span data-testid="focus">{focus}</span></p>
<p>filter <span data-testid="filter">{filter}</span></p>
<p>beforeNavigate <span data-testid="before-navigate">{beforeNavigateCount}</span></p>
<button type="button" onclick={() => setFilter("es")}>filter es</button>
<button type="button" onclick={() => setFocus("r1")}>focus r1</button>
<a href="?duo={data.duo ?? ''}&learning=l1">pin learning</a>
<a href="?duo=other">other duo</a>
<a href="/spike/items/B">item B</a>
<a href="/spike/items/slowB">item slowB</a>
<a href="/spike/other">other route</a>
<a href="/spike/other?slow=1">other route slow</a>
