import type { RadarFeed } from "./live";
import { liveAdvice, LIVE_CATEGORY } from "./live";
import { vehicleRecommendations } from "./garage";
import type { MediaRef } from "../../collector/src/types";
import type { PersistedState } from "./types";

/**
 * « Que faire maintenant ? » : une seule liste ordonnée, construite à partir des vraies données
 * (conseils de la veille + Garage des légendes), filtrée par la progression réelle du joueur.
 * Jamais de démo ici : la démo a son propre espace, clairement étiqueté.
 */
export interface NowPick {
  id: string;
  kind: "advice" | "vehicle";
  title: string;
  gain: string | null;
  where: string | null;
  access: string;
  urgent: boolean;
  reliability: "official" | "confirmed" | "reported" | "rumor" | "personal";
  ultimate: boolean;
  media: MediaRef | null;
  icon: string;
  color: string;
  text: string;
  recordId?: string;
  vehicleId?: string;
}

/** Le gain et le lieu sont déjà dans le titre : le texte ne garde que le contexte (mission, fenêtre). */
export function dedupe(text: string): string {
  const out = text
    .replace(/^[^·.]*·[^.]*?(?=\s(pendant|via)\s)/, "")
    .replace(/^[^·.]*·[^.]*\.\s*/, "")
    .replace(/^\s*\.\s*/, "")
    .trim();
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : text;
}

export function nowPicks(feed: RadarFeed | null, s: Pick<PersistedState, "profile" | "vehicles" | "done">, limit = 4): NowPick[] {
  if (!feed) return [];
  const out: NowPick[] = [];
  for (const a of liveAdvice(feed, s.profile, s.done).now) {
    const r = a.r;
    const cat = LIVE_CATEGORY[r.category] ?? LIVE_CATEGORY.other;
    out.push({
      id: `a-${r.id}`,
      kind: "advice",
      title: frTitle(r),
      gain: r.conditions.reward,
      where: r.details?.place ? `${r.details.place.value.name}${r.details.place.value.district ? `, ${r.details.place.value.district}` : ""}` : r.location.place,
      access: a.urgency === "now" ? "À faire avant de continuer" : "Accessible maintenant",
      urgent: a.urgency === "now",
      reliability: r.reliability,
      ultimate: false,
      media: r.media,
      icon: cat.icon,
      color: cat.color,
      // le gain et le lieu sont déjà dans le titre : le texte ne garde que le contexte
      text: dedupe(a.text),
      recordId: r.id,
    });
  }
  for (const x of vehicleRecommendations(feed.vehicles ?? [], s, 4)) {
    out.push({
      id: `v-${x.v.id}`,
      kind: "vehicle",
      title: x.v.name,
      gain: x.v.kind === "delivery" ? "Bonus remis au joueur" : "Véhicule à récupérer",
      where: x.v.location.district ?? (x.v.location.text ? "Lieu cité" : null),
      access: x.urgent ? `Seulement jusqu'au chapitre ${x.v.access.until?.value}` : "Accessible maintenant",
      urgent: x.urgent,
      reliability: x.v.reliability,
      ultimate: x.v.edition.exclusive === "ultimate",
      media: x.v.media,
      icon: "car",
      color: "#5AB8FF",
      text: x.v.kind === "delivery" ? "Suis la notification en jeu pour le récupérer." : x.v.location.precision === "zone" ? `Zone de recherche : ${x.v.location.district}.` : "Emplacement cité par les guides.",
      vehicleId: x.v.id,
    });
  }
  const RW = { official: 3, confirmed: 2, reported: 1, rumor: 0, personal: 0 } as const;
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || RW[b.reliability] - RW[a.reliability] || Number(b.kind === "advice") - Number(a.kind === "advice")).slice(0, limit);
}

const CAT_FR: Record<string, string> = {
  money: "Argent", weapon: "Arme", vehicle: "Véhicule", easter_egg: "Secret", side_mission: "Mission secondaire", unique_item: "Objet unique", missable: "À ne pas rater", mechanic: "Astuce", guide: "Guide", news: "Actualité", patch: "Mise à jour",
};

/** Titre français construit à partir des faits établis ; le titre original reste affiché en sous-titre. */
export function frTitle(r: RadarFeed["items"][number]): string {
  const d = r.details;
  if (!d || (!d.money && !d.place)) return r.title;
  const what = CAT_FR[r.category] ?? "Découverte";
  const place = d.place?.value.name;
  if (r.category === "money" && r.conditions.reward) return `${r.conditions.reward} à récupérer${place ? ` — ${place}` : ""}`;
  return `${what}${place ? ` — ${place}` : ""}`;
}
