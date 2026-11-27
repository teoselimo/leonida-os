def render(r):
    L = [f"# Rapport d'import du Data Hub — {r['runAt']}", "", f"Mode : {r['mode']}.", "", "## Sources", ""]
    for k, s in r["sources"].items():
        L.append(f"### {s.get('name', k)} — {s.get('status')}")
        for kk in ("license", "revision", "revisionDate", "ourRevision", "upToDate", "rawLandmarks", "tiles", "sitemapUrls", "discoveredAt", "read", "notFetchedYet", "crawler", "error"):
            if s.get(kk) is not None:
                L.append(f"- {kk} : {s[kk]}")
        for n in s.get("notes", []):
            L.append(f"- {n}")
        if s.get("failed"):
            L.append(f"- pages en échec ({len(s['failed'])}) :")
            L += [f"  - {x['url']} — {x.get('error')}" for x in s["failed"][:50]]
        if s.get("sitemapFailures"):
            L.append(f"- sitemaps en échec : {s['sitemapFailures']}")
        L.append("")
    L += ["## Entités importées", ""]
    for src, c in r["counts"].items():
        if isinstance(c, dict):
            L.append(f"**{src}** : " + ", ".join(f"{k} {v}" for k, v in c.items()))
        else:
            L.append(f"**{src}** : {c}")
    L += ["", "## Changements depuis la dernière exécution", "", str(r["changes"]), "", "## Liaisons aux entités LEONIDA", ""]
    L += [f"- {k} : {v}" for k, v in r["links"].items()]
    L += ["", f"## Doublons fusionnés ({len(r['duplicates'])})", ""] + [f"- {d['type']} « {d['name']} » : {d['merged']} → {d['kept']}" for d in r["duplicates"][:80]]
    L += ["", f"## Contradictions conservées, non appliquées ({len(r['conflicts'])})", ""] + [f"- {c}" for c in r["conflicts"][:80]]
    L += ["", "## Lacunes de couverture (enregistrements sans le champ)", ""] + [f"- {t} : {g}" for t, g in r["gaps"].items()]
    L += ["", "## Bundles", ""] + [f"- {k} : {v/1024:.0f} Ko" for k, v in r.get("bundles", {}).items()]
    return "\n".join(L) + "\n"
