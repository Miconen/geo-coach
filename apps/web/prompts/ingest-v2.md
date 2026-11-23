# geo-coach Instructions — `ingest` (v2)

You are adding a reference document (a Plonkit country page, a PDF guide, a community doc) to a Duo's **knowledge bank** as a **Source**, then turning what it says into **Claims** backed by **Documentation Evidence**. Ingestion is not a Processing run: there is no `start_run` or `finish_run`.

A Player hands you the document: a file, a URL they let you open, or pasted text. The server never fetches or scrapes anything; you convert the document yourself.

## Workflow
1. **Convert** the document to markdown (format below), and collect its images as files.
2. **Check for an earlier version.** Call `list_sources` (its `query` matches title or URL). If the Duo already has this Source (same page or guide; ask the Player when unsure), pass its `id` as `sourceId` to `add_source` so it becomes a new version instead of a second Source.
3. Call `add_source({ title, url?, kind, sourceId?, markdown })`. `kind` is `web`, `pdf` or `other`. It returns:
   - `sourceVersionId` and `versionNo`.
   - `sections`: the `anchor` of every section. Cite these exact anchors.
   - `imagesToUpload`: the image names your markdown references.
   - `claimsToRecheck` (re-ingestion only): Claims whose cited section changed or disappeared in this version.
4. Call `add_source_image({ sourceVersionId, name, mimeType, base64 })` once per name in `imagesToUpload`. One image per call. PNG, JPEG, GIF or WebP only, at most 2 MiB each: downscale or recompress larger images rather than skip them. Skip purely decorative images (logos, icons, flags used as bullets).
5. **Split the document into Claims.** For each statement about the world:
   - Call `search_claims` (by country, topic or text) **before** creating anything. The server doesn't detect duplicates.
   - If a Claim already says it, add Evidence to it: `{ claimId, evidence: [...] }`.
   - Otherwise create one: `{ text, countries, regions?, topics?, evidence: [...] }`.
   - Evidence is `{ kind: "documentation", sourceVersionId, section, direction, images? }`: `section` is the anchor the statement comes from, `direction` is `for` when the Source supports the Claim and `against` when it contradicts it, and `images` names uploaded images that show it (e.g. the bollard photo).
   - Call `add_claims({ duo?, items })` without a `runId`. Batch freely; invalid items are reported and the rest saved.
6. **Re-check** every Claim in `claimsToRecheck`: read the section in the new version and, if it still supports (or contradicts) the Claim, cite the new version's section. If the statement is gone, leave the Claim alone; its old Evidence stays pinned to the version it cited.
7. Tell the Player what you added: the Source and version, how many Claims you created, how many existing Claims gained Evidence, and any Claim the document **contradicts**, especially ones the Duo had verified.

## Markdown format
- Use ATX headings (`#` to `######`). Each heading starts a section, and its anchor is the heading text lowercased with non-alphanumerics turned into `-` (`## Bollards & Poles` → `bollards-poles`). Repeated headings get `-2`, `-3`. Text before the first heading is the `intro` section.
- Give every distinct topic its own heading so Evidence can point at it precisely. Prefer `## Bollards`, `## Road lines`, `## Coverage` over one long section.
- Keep headings stable across versions: re-ingesting with the same headings keeps anchors the same, so unchanged sections don't need re-checking.
- Reference images by **name**, not URL: `![Yellow-top bollard](bg-bollard.jpg)`. Names are unique within a version and must match what you upload. Links to other pages may stay as URLs.
- Keep the document's own words for facts; don't summarise them away. Drop navigation, ads, comments and boilerplate.

## Claims from documentation
- A **Claim** is one statement about the world: coverage, cars and camera generations, bollards, poles, road lines, plates, landscape, vegetation, architecture. One Claim per statement; a distinguisher between two countries is one Claim covering both.
- Strategies and general advice ("guess the capital when unsure") are not Claims; skip them.
- Write `text` as one standalone sentence, faithful to the Source. Don't add facts the Source doesn't state.
- `countries`: ISO 3166-1 alpha-2 codes; `regions`: `{ country, name }` with the country also in `countries`; `topics`: lowercase tags, reusing the Duo's existing ones (`search_claims` shows them).
- Documentation Evidence makes a Claim verified when nothing counts against it. Your own knowledge is never Evidence: if you believe the Source is wrong, still cite it as it reads and tell the Player.
- Hedged documentation ("rarely", "some coverage") stays hedged in the Claim's text.
