"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { useLiveRadar } from "@/lib/live";
import { LIVE_CATEGORY, spoilerVisibility } from "@/lib/feed";
import type { RadarRecord } from "@/lib/feed";
import { frHeadline } from "@/lib/fr";
import { glossaryOf, nk } from "@/lib/missions";
import { viewOf } from "@/lib/garage";
import { computeProgress, shownName } from "@/lib/progress";
import { ESTABLISHMENTS, EST_CATS } from "@/data/establishments";
import { useRedact } from "@/lib/useRedact";
const FEED_SNAPSHOT = process.env.NEXT_PUBLIC_FEED_SNAPSHOT === "1";
import { LiveCard } from "./LiveRadar";
import { Icon } from "./ui/Icon";

/**
 * Guide (V0.14, ex-Radar) : retrouver vite une information EXPLOITABLE. Le moteur RADAR reste intact en arrière-plan :
 * une fiche masquée ici (actualité, fiche sans aucun champ établi) reste dans la base de connaissances du copilote.
 * Données datées honnêtement : un instantané n'est jamais présenté comme un flux en direct.
 */
type Cat = "tout" | "annexes" | "armes" | "vehicules" | "argent" | "secrets" | "lieux";
const CATS: Array<{ id: Cat; label: string }> = [
  { id: "tout", label: "Tout" },
  { id: "annexes", label: "Missions annexes" },
  { id: "armes", label: "Armes et objets" },
  { id: "vehicules", label: "Véhicules" },
  { id: "argent", label: "Argent" },
  { id: "secrets", label: "Secrets" },
  { id: "lieux", label: "Lieux utiles" },
];
const catOf = (r: RadarRecord): Cat | null =>
  r.category === "weapon" || r.category === "unique_item" ? "armes" : r.category === "money" ? "argent" : r.category === "easter_egg" ? "secrets" : r.category === "side_mission" ? "annexes" : r.category === "vehicle" ? "vehicules" : r.category === "missable" || r.category === "mechanic" || r.category === "guide" ? "secrets" : null;
/** Une fiche est utile en liste si elle établit au moins un fait exploitable. */
const useful = (r: RadarRecord) => r.status === "active" && r.category !== "news" && r.category !== "patch" && !!(r.details?.place || r.conditions.reward || r.details?.mission || r.details?.unlockAfter || r.advice);
const TRUST = (rel: string) => (rel === "official" || rel === "confirmed" ? "Vérifié" : rel === "reported" ? "Probable" : "Non confirmé");
const TCLS = (t: string) => (t === "Vérifié" ? "ok" : t === "Probable" ? "warn" : "low");

interface Row {
  id: string;
  cat: Cat;
  icon: string;
  color: string;
  title: string;
  sub: string;
  trust: string;
  done: boolean;
  open: () => void;
  record?: RadarRecord;
}

export function Guide() {
  const { feed, fetchedAt } = useLiveRadar();
  const { state, radarFocus, filterRadar, focusVehicle, showPlace, setGuideView } = useStore();
  const redact = useRedact();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Cat>("tout");
  const [openId, setOpenId] = useState<string | null>(null);
  const p = state.profile;

  // action « ouvrir la fiche » depuis le copilote ou l'accueil
  useEffect(() => {
    if (!radarFocus.nonce) return;
    if (radarFocus.id) {
      setOpenId(radarFocus.id);
      setCat("tout");
      setQ("");
      setTimeout(() => document.querySelector(`[data-testid="live-${radarFocus.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    }
    if (radarFocus.category) {
      const r = { category: radarFocus.category } as RadarRecord;
      setCat(catOf(r) ?? "tout");
      filterRadar(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarFocus.nonce]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const gl = glossaryOf(feed);
    for (const r of feed?.items ?? []) {
      const c = catOf(r);
      if (!c || !useful(r) || r.category === "vehicle") continue;
      const vis = spoilerVisibility(r, p.spoilerMode, p.chapter);
      if (vis === "hidden") continue;
      const lc = LIVE_CATEGORY[r.category] ?? LIVE_CATEGORY.other;
      const place = r.details?.place?.value;
      out.push({
        id: r.id,
        cat: c,
        icon: lc.icon,
        color: lc.color,
        title: vis === "blurred" ? `${lc.label} · chapitre plus avancé` : redact(frHeadline(r, gl)),
        sub: vis === "blurred" ? "Contenu flouté (anti-spoiler léger)" : redact([r.conditions.reward, place ? `${place.name}${place.district ? ` · ${place.district}` : ""}` : null].filter(Boolean).join(" · ") || lc.label),
        trust: TRUST(r.reliability),
        done: !!state.done[r.id],
        open: () => setOpenId((x) => (x === r.id ? null : r.id)),
        record: r,
      });
    }
    // missions annexes du graphe de progression (statut calculé, jamais de mission principale future)
    const v = computeProgress(state);
    for (const st of v.states) {
      if (st.node.kind === "main") continue;
      // V0.20 : missions du Data Hub des chapitres non atteints → masquées sauf anti-spoiler désactivé
      if (st.node.chapter > p.chapter && p.spoilerMode !== "off" && st.status !== "terminé") continue;
      const status = st.status === "terminé" ? "Faite" : st.status === "plus disponible" ? "Plus disponible" : st.status === "accessible" ? "Accessible" : st.status === "potentiellement accessible" ? "Probablement accessible" : st.status === "verrouillé" ? `Après ${st.missing?.map((m) => shownName(v.byId.get(m.id)!, p.spoilerMode)).join(", ")}` : "Disponibilité inconnue";
      out.push({ id: `prog:${st.node.id}`, cat: "annexes", icon: "flag", color: "#FF3D8B", title: st.node.name, sub: redact(`${status}${st.node.where ? ` · ${st.node.where}` : ""}`), trust: st.node.origin === "hub" ? "Probable" : (st.node.prereq?.sources.length ?? 0) >= 2 ? "Vérifié" : "Probable", done: st.status === "terminé", open: () => setOpenId((x) => (x === `prog:${st.node.id}` ? null : `prog:${st.node.id}`)) });
    }
    for (const veh of feed?.vehicles ?? []) {
      const x = viewOf(veh, state);
      if (x.hidden) continue;
      out.push({ id: `veh:${veh.id}`, cat: "vehicules", icon: "car", color: "#5AB8FF", title: veh.name, sub: [veh.location.district, x.now ? "accessible maintenant" : x.later ? `chapitre ${x.need}` : null].filter(Boolean).join(" · ") || "Lieu dans la fiche", trust: TRUST(veh.reliability), done: !!x.owned && x.owned !== "spotted", open: () => focusVehicle(veh.id) });
    }
    for (const e of ESTABLISHMENTS) {
      out.push({ id: `est:${e.id}`, cat: "lieux", icon: "map", color: "#7CF29A", title: e.name, sub: `${e.cats.map((c) => EST_CATS[c].label).join(", ")} · ${e.district === "Mariana County" ? "comté de Mariana" : e.district}`, trust: e.verification === "confirmé" ? "Vérifié" : "Probable", done: false, open: () => showPlace({ estId: e.id }) });
    }
    return out;
  }, [feed, state, p.spoilerMode, p.chapter, redact, focusVehicle, showPlace]);

  const n = nk(q);
  const list = rows.filter((r) => (cat === "tout" || r.cat === cat) && (!n || nk(`${r.title} ${r.sub}`).includes(n)));
  // ordre : à faire avant le fait ; vérifié avant probable
  list.sort((a, b) => Number(a.done) - Number(b.done) || (a.trust === b.trust ? 0 : a.trust === "Vérifié" ? -1 : b.trust === "Vérifié" ? 1 : 0));
  const shown = list.slice(0, 80);
  const date = feed ? new Date(feed.generatedAt) : null;

  return (
    <div className="guide" data-testid="guide">
      <p className="guide__fresh" data-testid="guide-date">
        <Icon name="clock" size={13} />
        {date
          ? `${FEED_SNAPSHOT ? "Données de la veille arrêtées au" : "Données collectées le"} ${date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} à ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${FEED_SNAPSHOT ? " (instantané, mis à jour avec l'app)" : fetchedAt ? "" : ""}`
          : "Chargement des données…"}
      </p>
      <div className="guide__search">
        <Icon name="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Arme, véhicule, magasin, mission…" aria-label="Rechercher dans le Guide" data-testid="guide-search" />
        {q && <button onClick={() => setQ("")} aria-label="Effacer la recherche"><Icon name="close" size={14} /></button>}
      </div>
      <div className="guide__cats" role="tablist">
        {CATS.map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id} className={`fchip${cat === c.id ? " is-on" : ""}`} onClick={() => setCat(c.id)} data-testid={`guide-cat-${c.id}`}>{c.label}</button>
        ))}
      </div>
      {cat === "vehicules" && <button className="btn btn--sm guide__garage" onClick={() => setGuideView("garage")} data-testid="guide-open-garage"><Icon name="car" size={15} /> Ouvrir le Garage : tout le catalogue, filtres et fiches</button>}
      <ul className="glist" data-testid="live-list">
        {shown.length === 0 && <li className="card empty">Rien ici pour l&apos;instant.</li>}
        {shown.map((r) => (
          <li key={r.id} className={`gl${r.done ? " is-done" : ""}`} data-testid={`guide-${r.id}`}>
            <button className="gl__row" onClick={r.open} aria-expanded={openId === r.id}>
              <span className="gl__ico" style={{ color: r.color, background: `${r.color}1f` }}><Icon name={r.icon} size={16} /></span>
              <span className="gl__body"><strong>{r.title}</strong><em>{r.sub}</em></span>
              <span className={`trust trust--${TCLS(r.trust)}`}>{r.done ? "Fait" : r.trust}</span>
            </button>
            {openId === r.id && r.record && <LiveCard r={r.record} focused={false} blurred={spoilerVisibility(r.record, p.spoilerMode, p.chapter) === "blurred"} />}
          </li>
        ))}
      </ul>
      {list.length > shown.length && <p className="fineprint">{list.length - shown.length} autres résultats : précise ta recherche.</p>}
    </div>
  );
}
