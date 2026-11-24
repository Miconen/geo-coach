/**
 * A Source excerpt as plain blocks (#56 3a): paragraphs and fenced code only, no raw HTML, markdown library, lists,
 * links or inline code. Images in the ingestion syntax (`![alt](name "title")`, `<name>` allowed) resolve through
 * the caller (the version's Duo-scoped image rows); an unresolved name renders as its alt text.
 */
export type ExcerptPart = { text: string } | { img: { src: string; alt: string; title: string | null } };
export type ExcerptBlock = { kind: "p"; parts: ExcerptPart[] } | { kind: "code"; text: string };

const IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["']([^"']*)["'])?\s*\)/g;

function parts(text: string, resolve: (name: string) => string | null): ExcerptPart[] {
  const out: ExcerptPart[] = [];
  let last = 0;
  for (const m of text.matchAll(IMAGE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    const [, alt = "", target = "", title] = m;
    const src = /^(https?:|data:|\/\/)/i.test(target) ? null : resolve(target);
    out.push(src ? { img: { src, alt, title: title ?? null } } : { text: alt });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function parseExcerpt(body: string, resolve: (name: string) => string | null): ExcerptBlock[] {
  const blocks: ExcerptBlock[] = [];
  let para: string[] = [];
  let code: string[] | null = null;
  let fence = "";
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", parts: parts(para.join("\n"), resolve) });
    para = [];
  };
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (code) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else code.push(line);
    } else if (f) {
      flush();
      fence = f[1]!;
      code = [];
    } else if (line.trim() === "") flush();
    else para.push(line);
  }
  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  flush();
  return blocks;
}
