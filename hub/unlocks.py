"""Lecture des phrases « How To Unlock » : seuls des FAITS en ressortent (missions citées, fenêtre de perte, conditions).
La phrase d'origine n'est pas reprise dans l'app ; un nom non reconnu est ignoré (jamais deviné)."""
import re

COND = [
    (r"\bnight[- ]only\b|\bonly be played at night\b|\bat night\b", "de nuit"),
    (r"\bLucia[- ]only\b|\bas Lucia\b|\bplaying as Lucia\b", "en jouant Lucia"),
    (r"\bJason[- ]only\b|\bas Jason\b|\balone as Jason\b", "en jouant Jason"),
    (r"\bwait(?:ing)? (?:about |for |a few |several |a couple of )", "après un délai (message ou appel)"),
    (r"\btext|\bcall(?:s)?\b|\bmessage\b|\bgets in touch\b", "lancée par un appel ou un message"),
    (r"\bUltimate Edition\b", "édition Ultimate"),
    (r"\bhourglass\b|\blimited[- ]time\b", "durée limitée"),
    (r"\bstarts? (?:right|straight) after\b|\bstarts automatically\b", "démarre automatiquement"),
]

def build_name_index(records, nk):
    ix = {}
    for r in records:
        for n in [r["name"]] + r.get("aliases", []):
            k = nk(n)
            if len(k) >= 4:
                ix.setdefault(k, r["id"])
    # plus longs d'abord : « Pete's Deliveries: Avery Allen & Co. » avant « Pete's Deliveries »
    return sorted(ix.items(), key=lambda kv: -len(kv[0]))

def parse(text, self_id, names, nk):
    out = {"after": [], "lostAtStart": [], "conditions": [], "missable": False, "allOtherMains": None}
    if not text:
        return out
    first = re.split(r"(?<=\w)\.\s+(?=[A-Z])", text, maxsplit=1)[0]
    m0 = re.search(r"\b(?:completing|finishing|after)\b(.*)", first, re.I)
    # seulement la liste qui suit « completing » : s'arrête à « then », « : », « and waiting », « , after which »…
    seg = re.split(r",\s*then\b|\bthen\b|:|;|,\s*after which|\band\s+(?!the\b)\w+ing\b|,\s*\w+ing\b|\bas it starts\b|\bwhich\b|\bwhen\b|\bwhile\b|\bduring\b|\bbefore\b|\buntil\b", m0.group(1))[0] if m0 else ""
    out["weak"] = bool(re.search(r"\busually\b|\btypically\b|\bmay\b", first, re.I))
    norm_first = " " + nk(seg) + " "
    norm_all = " " + nk(text) + " "
    if seg:
        taken = norm_first
        for k, rid in names:
            if rid != self_id and f" {k} " in taken:
                out["after"].append(rid)
                taken = taken.replace(f" {k} ", " # ")
    m = re.search(r"(?:unavailable|locked|lost|gone) once you (?:start|begin|complete) ([^.,;]+)", text, re.I)
    if m:
        seg = " " + nk(m.group(1)) + " "
        for k, rid in names:
            if f" {k} " in seg and rid != self_id:
                out["lostAtStart"].append(rid); break
    if re.search(r"\bmissable\b", text, re.I):
        out["missable"] = True
    m = re.search(r"other (?:remaining )?Chapter (\d) main missions", text, re.I)
    if m:
        out["allOtherMains"] = int(m.group(1))
    for rx, label in COND:
        if re.search(rx, text, re.I) and label not in out["conditions"]:
            out["conditions"].append(label)
    if "démarre automatiquement" in out["conditions"] and "après un délai (message ou appel)" in out["conditions"]:
        out["conditions"].remove("démarre automatiquement")
    return out
