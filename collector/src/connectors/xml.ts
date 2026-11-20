import { XMLParser } from "fast-xml-parser";

export const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", parseTagValue: false, trimValues: true });

export const arr = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Texte d'un nœud XML, qu'il soit une chaîne, un objet {#text} ou un CDATA. */
export function txt(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return txt(v[0]);
  const o = v as Record<string, unknown>;
  return txt(o["#text"] ?? o["__cdata"] ?? "");
}
