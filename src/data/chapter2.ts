import type { Prereq } from "./progression";

// Conditions explicitement citées par le guide joué. La fiche GTABase décrit souvent
// les objectifs seulement et ne compte donc pas comme seconde preuve du déblocage.
function guide(page: string, all: string[], condition?: string): Prereq {
  return { all, condition, basis: "explicite", sources: [{ name: "PowerPyx", url: `https://www.powerpyx.com/gta-6-${page}-walkthrough/` }] };
}

const opener = "whats-in-the-bag";
const trip = "girls-trip";
const coffee = "coffee-break";
export const MOTEL_UNLOCKS: Record<string, Prereq | undefined> = {
  [opener]: guide(opener, ["discharge-time"]),
  "ambulance-chaser": guide("ambulance-chaser-move-the-ambulance", [opener], "sortir de la chambre"),
  "take-care-of-jason": guide("take-care-of-jason", [opener]),
  "overnight-charges": guide("overnight-charges-see-linda-the-manager", [opener]),
  "just-moved-in": guide("just-moved-in", [opener]),
  [trip]: guide("girls-trip-find-painkillers", ["overnight-charges", "just-moved-in"]),
  "pick-up-a-gun": guide("pick-up-a-gun", [trip]),
  moses: guide("moses-take-a-vehicle-to-moses", [trip]),
  "how-do-i-look": guide("how-do-i-look", [trip]),
  "painkiller-supplier": guide("painkiller-supplier", [trip], "attendre l’appel de Dunk"),
  "new-look": guide("new-look", [trip]),
  "steal-vehicles-for-moses": guide("steal-vehicles-for-moses", ["daily-driver"], "attendre les commandes de Moses"),
  "collect-moses-gift": guide("collect-moses-gift", ["steal-vehicles-for-moses"], "livrer tous les véhicules puis lire le SMS"),
  "check-out-mckittrick-farm": guide("check-out-mckittrick-farm", [], "lire une affiche de Kyle"),
  "brets-hunting-decks": { all: ["veteran-hunted"], basis: "explicite", sources: [{ name: "PowerPyx", url: "https://www.powerpyx.com/gta-6-100-completion-checklist-guide/" }] },
  "daily-driver": guide("daily-driver-steal-the-crawler-for-moses", ["moses"]),
  "behind-on-payments": guide("behind-on-payments", ["overnight-charges"]),
  "slam-dunk": guide("slam-dunk", ["painkiller-supplier"], "vérifier les principales encore actives et les appels de Dunk"),
  "checking-out": guide("checking-out-move-to-vice-city", ["prepare-for-vice-city"], "réunir au moins 15 000 $, terminer les principales du journal et attendre l’appel au motel"),
  "breakfast-run": guide("breakfast-run-check-on-jason", ["slam-dunk"], "attendre l’appel de Jason"),
  [coffee]: guide(coffee, ["breakfast-run"]),
  "hit-avery-pawn": guide("hit-avery-pawn", [coffee]),
  "hit-kingpin-bowling": guide("hit-kingpin-bowling", [coffee]),
  "impounded-vehicle": guide("impounded-vehicle", [coffee]),
  "prepare-for-vice-city": guide("prepare-for-vice-city", [coffee]),
  "afternoon-delight": guide("afternoon-delight-rob-vickis-boss", [coffee], "finir les principales en attente et attendre l’appel de Vicki"),
};

export const MOTEL_CARDS = "Cherche Vicki dans les toilettes du bureau de réception et Victor Maravilla sur le réfrigérateur de la cuisine. Chaque carte a un double ailleurs.";
export const MOTEL_POSTERS = "Les affiches de personnes disparues dans le hall donnent une piste annexe.";
export const POSTER_SOURCE = "https://www.windowscentral.com/gaming/how-to-start-and-complete-the-creepy-photos-missing-persons-side-mission-in-gta-6-chapter-2";

export const MOTEL_REPORTS = [
  { id: "ambulance-chaser", pattern: /(?:disparaitre|brul\w*|detru\w*|deplac\w*).{0,24}ambulance/, advice: "Si le joueur déclare la tâche accomplie, proposer de confirmer la mission terminée." },
  { id: "just-moved-in", pattern: /(?:provisions|groceries|courses).{0,30}jason|jason.{0,30}(?:provisions|groceries|courses)/, advice: "Les provisions sont une étape. Demander si elles ont été rapportées à la chambre et si le jeu confirme la fin." },
  { id: "overnight-charges", pattern: /(?:parl\w*|conversation|discut\w*).{0,35}(?:proprio|gerante|linda)/, advice: "Identification probable. Demander quel objectif est affiché avant de proposer un statut." },
];
