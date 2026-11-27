import type { ReactNode } from "react";

/**
 * V0.19 · Markdown LISIBLE dans le chat (au lieu d'astérisques et de dièses affichés tels quels) : titres, listes,
 * gras, italique, code. Construit des nœuds React (jamais de HTML injecté) : un texte venu de Claude ou du web reste
 * du texte.
 */
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const t = m[0];
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (t.startsWith("**") || t.startsWith("__")) out.push(<strong key={i++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={i++}>{t.slice(1, -1)}</code>);
    // « _ » au milieu d'un mot (noms de fichiers, identifiants) : laissé tel quel
    else if (t.startsWith("_") && /\w/.test(text[m.index! - 1] ?? "")) out.push(t);
    else out.push(<em key={i++}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { kind: "p" | "h"; text: string } | { kind: "ul" | "ol"; items: string[] };

export function blocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const h = /^#{1,6}\s+(.*)$/.exec(line.trim());
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (h) (flush(), out.push({ kind: "h", text: h[1] }));
    else if (ul || ol) {
      flush();
      const kind = ul ? "ul" : "ol";
      const prev = out[out.length - 1];
      if (prev && prev.kind === kind) prev.items.push((ul ?? ol)![1]);
      else out.push({ kind, items: [(ul ?? ol)![1]] });
    } else para.push(line);
  }
  flush();
  return out;
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const bs = blocks(text);
  if (bs.length <= 1 && bs[0]?.kind === "p") return <p className={className}>{inline(bs[0].text)}</p>;
  return (
    <div className={`${className ?? ""} rt`}>
      {bs.map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{inline(b.text)}</p>
        ) : b.kind === "h" ? (
          <p key={i} className="rt__h"><strong>{inline(b.text)}</strong></p>
        ) : b.kind === "ul" ? (
          <ul key={i}>{b.items.map((t: string, j: number) => <li key={j}>{inline(t)}</li>)}</ul>
        ) : b.kind === "ol" ? (
          <ol key={i}>{b.items.map((t: string, j: number) => <li key={j}>{inline(t)}</li>)}</ol>
        ) : null,
      )}
    </div>
  );
}
