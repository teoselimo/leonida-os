# Rare Vehicle Locator V1 · Sprint 1 (V0.16)

Relevé du 23/11/2026, sur la branche `experiment/claude-artifact`. Base stable conservée : V0.15.1.

## Ce qui a été livré

- Un **référentiel vérifié à la main**, dans `src/data/rareVehicles.ts`. Il couvre cinq véhicules et prévoit déjà :
  - plusieurs emplacements par véhicule ;
  - plusieurs variantes d'un même modèle ;
  - la nature de la présence : fixe, en mouvement ou aléatoire ;
  - les conditions d'accès et la conservation ;
  - des preuves rattachées à chaque affirmation.
- Un **modèle de preuve réutilisable**, dans `src/lib/evidence.ts`. Il est indépendant de la catégorie (véhicule, secret, mission, manquable) et servira de base au Social Discovery Engine.
  - Plateformes prévues : guide, vidéo, Reddit, Instagram, capture, joueur, officiel.
  - Positions possibles d'une source : confirme, nuance ou contredit.
  - **Règle d'indépendance** : les reposts et les pages d'un même site comptent pour une seule source. Le regroupement se fait par origine déclarée, sinon par domaine, sinon par créateur.
  - **Niveau de confiance** :

    | Niveau | Condition |
    |---|---|
    | Vérifié | au moins 2 sources indépendantes, sans contradiction |
    | Probable | 1 source, ou des sources contredites |
    | Non confirmé | aucune source, ou seulement le joueur |

- La **preuve ajoutée par le joueur** (un lien, ou une capture réduite à 640 px) est enregistrée dans la sauvegarde sous `proofs[id]`. Il y a au plus 4 preuves par véhicule.
  - Elle n'est jamais comptée comme une source.
  - Aucune extraction automatique n'est faite.
  - Aucun connecteur Meta n'est développé.
- L'**accessibilité est calculée par joueur**, dans `src/lib/rvl.ts`. Elle tient compte :
  - du chapitre atteint ;
  - de la mission préalable déclarée dans Partie ;
  - de l'édition.

  Un véhicule n'est jamais « accessible » par défaut.
- Les **fiches du flux sont corrigées** par le référentiel (fonction `withRvl`). Les identifiants restent les mêmes, donc la sauvegarde `vehicles[id]` existante est reprise telle quelle.
  - Le flux plaçait le Vamos à Port Gellhorn. C'était faux : la zone a été retirée.
  - Pour les livraisons à Moses, la conservation n'est pas documentée. La règle d'immatriculation que le flux en déduisait a été retirée.
- La **fiche véhicule** (iPhone et iPad) affiche :
  - l'accès pour ce joueur ;
  - quatre actions : « Voir sur la carte », « Je l'ai trouvé », « Je l'ai récupéré », « Je l'ai conservé ». Elles s'appuient sur les états de garage existants (repéré, volé, véhicule personnel) ;
  - la précision réelle et la nature de la présence ;
  - la méthode qui a servi à tracer la zone ;
  - le niveau de confiance et le nombre de sources indépendantes ;
  - les preuves.
- Le **copilote** comprend les surnoms (« la voiture de Paul Walker », « le buggy »…). Il répond à partir du référentiel : emplacement, zone, présence garantie ou non, accès, conservation. Les noms de missions à venir sont masqués.

## Les cinq véhicules

| Véhicule | Où | Précision sur notre carte | Présence | Accès | Le garder |
|---|---|---|---|---|---|
| '97 Maibatsu Penumbra FF | Garage d'une villa, île de Vespucci (Rialto Islands) | Zone documentée : l'île elle-même, identifiée par sa forme ovale et son ordre sur la chaussée (≈ 540 m) | Fixe | Chapitre 1, dès l'exploration libre | Oui, immatriculation à partir du chapitre 2 |
| BF Bandito | Boucle de terre, marais de Buckskin | Zone estimée : centrée sur 7 repères « Buckskin » (≈ 640 m) | **En mouvement** (un guide l'a trouvé garé : nuance affichée) | Chapitre 2, après la mission préalable, 4ᵉ cible de la série | Non établi |
| Annis Hellion | Allée d'une maison, Orchard Avenue, sud de Port Gellhorn | Zone large : rue non nommée sur notre carte (≈ 1,3 km) | Fixe | Chapitre 2, 3ᵉ cible | Non établi |
| Karin Futo | Box au bout ouest d'un bâtiment des docks, sud de Draper Island | Zone estimée : centrée sur le repère « Draper Island » (≈ 900 m) | Fixe | Chapitre 2, 2ᵉ cible | Non établi |
| Declasse Vamos | Abri au nord-est de Grayson (code 2727) | **Inconnue** : Grayson n'est pas repéré sur notre carte, donc pas d'épingle | Fixe | Chapitre 2, 5ᵉ cible | Non établi |

Aucune position n'est un point exact : aucune n'a été relevée en jeu. Le lien « Signaler la position exacte » reste disponible pour une validation humaine.

## Sources indépendantes

- **Penumbra** : AlcastHQ, GamesRadar+, GTA Xtreme, Insider Gaming, Gfinity, games.gg, FandomWire, GamesHorizon, BGR.
  - BGR reprend Vice : il est marqué comme repost de Vice.
- **Série de Moses** : PowerPyx et GTA BOOM pour les quatre véhicules, plus PC Gamer pour le Bandito et le Vamos.

## Limites connues

- Les zones « estimées » et « large » ne sont pas des emplacements : en jeu, la mission affiche sa propre zone de recherche.
- Pour les livraisons à Moses, les sources ne disent pas si on peut garder le véhicule. Le statut « Je l'ai conservé » reste disponible, car c'est le joueur qui l'indique.
- La 6ᵉ cible de la série, Western Nightblade, est volontairement absente. Elle relève du chapitre final, et la position de son garage n'est pas repérée sur notre carte.
- Les captures sont des simulations Playwright. Elles ne remplacent pas un test sur un iPhone ou un iPad réel.
