# Rare Vehicle Locator · V0.16.1 : positions précises

Relevé du 23/11/2026, branche `experiment/claude-artifact`.

## Constat sur la V0.16

| Véhicule | Zone V0.16 | Contenait la voiture ? |
|---|---|---|
| Penumbra FF | 540 m (toute l'île de Vespucci) | Oui |
| Karin Futo | 900 m, centrée sur un repère « Draper Island » | **Non** (642 m à côté) |
| Annis Hellion | 1,3 km sur Port Gellhorn | **Non** (824 m à côté) |
| BF Bandito | 640 m sur les repères « Buckskin » | **Non** (≈ 980 m à côté) |
| Declasse Vamos | aucune | Grayson introuvable : le bourg s'appelle « Yorktown » sur GTADB |

## Positions V0.16.1

Les cinq véhicules sont localisés au bâtiment ou au parcours.

**Aucune position n'a été testée en jeu.** Toutes sont *calibrées* à partir de captures de la carte du jeu, et l'interface l'affiche.

| Véhicule | Où | Coordonnées GTADB | Marge | Méthode |
|---|---|---|---|---|
| Penumbra FF | Villa grise au nord de la chaussée, entre les deux rues de Vespucci | (532, 1305) | ±35 m | Carte GamesHorizon recalée sur 4 repères, plus le bloc décrit par 3 sources |
| Karin Futo | Box au bout ouest de l'entrepôt Postal, quai sud de Draper Island | (−7655, 4684) | ±20 m | Homographie sur 7 repères (capture GTA BOOM) |
| Annis Hellion | Bungalow, rangée ouest de la boucle d'Orchard Ave | (−6509, 2924) | ±40 m | Maison identifiée sur deux captures, sans calage numérique |
| BF Bandito | Circuit de terre de l'île en Y, nord-est du marais | parcours (5 tracés) | ±15 m | Affine sur 6 jonctions de pistes (capture GTA BOOM) |
| Declasse Vamos | Garage à l'est de la maison aux panneaux, Rockledge Rd | (−5075, 7066) | ±30 m | Affine sur 5 repères (carte 2D Push Square) |

**Contrôles indépendants**

- **Futo :** les extrémités de l'entrepôt, non utilisées pour le calage, retombent à 3 m de celles de GTADB.
- **Épingles GTA6GPS :** elles utilisent le même système que GTADB, vérifié sur Sunrise RV Park (écart de 3 m). Leur écart avec les marqueurs recalés :
  - Futo : 8 m ;
  - Bandito : 5 m.

**Le Bandito** est un véhicule mobile. La fiche montre son parcours, jamais un point d'apparition garanti.

### Reproduire une calibration

- **Script :** `python3 scripts/rvl_calibrate.py docs/rvl-calibration/<fichier>.json`.
  - Il calcule une homographie (≥ 4 points) ou une transformation affine (3 points et plus).
  - Il donne les écarts et la validation croisée « en retirant un point ».
- **Captures :** les captures sources ne sont pas dans le dépôt, pour des raisons de droits. Les fichiers JSON indiquent les pixels et les coordonnées utilisés.
- **Planche :** `python3 scripts/rvl_planche.py docs/rvl-calibration/planche-cars.json docs/rvl-v0161-comparaison.jpg`.

## Modèle

- **`RvlPoint`** : `{ x, y, errorM, method, methodNote, sources, date, status, check }`.
  - `status` vaut `calibre` (calibré) ou `teste-en-jeu` (testé en jeu).
  - `check` décrit le contrôle indépendant.
- **`RvlRoute`** : décrit un parcours (véhicule mobile).
- **`withRvl()`** conserve désormais le point validé du flux. Une position calibrée n'est jamais montrée comme une épingle « validée » : la carte affiche une pastille et son cercle d'incertitude.
- **Trois fiabilités distinctes** sont affichées séparément dans la fiche et dans les réponses du copilote :

  | Fiabilité | Ce qu'elle mesure |
  |---|---|
  | Existence | Nombre de sources indépendantes |
  | Emplacement | Calibré / testé en jeu, avec la marge |
  | Présence | Garantie ou non |

## Ordre des commandes de Moses

**Ce que disent les sources**

- GTA BOOM procède par lots : d'abord Yosemite et Futo, puis Hellion, Bandito et Vamos.
- PowerPyx donne les commandes une par une : Yosemite, Futo, Hellion, Bandito, Vamos, Nightblade.

**Règle appliquée par l'app**

- Une voiture de Moses n'est « Accessible maintenant » qu'une fois la commande confirmée par le joueur, avec le bouton « Moses m'a envoyé cette commande ».
  - La confirmation est sauvegardée dans `done["order:<id>"]`.
  - Elle apparaît dans le journal et peut être annulée.
- **Avant la confirmation** : le lieu est indiqué comme accessible, mais la voiture n'y est pas garantie.
- **En anti-spoiler strict avant le chapitre 2** : la mission, le donneur et les voitures du lot ne sont pas nommés.

## Images

Aucune image intégrée, pour trois raisons :

- l'Artifact bloque les images distantes ;
- aucune image GTA VI de ces véhicules exacts n'a de droit d'intégration établi ;
- recopier les captures des guides ou les miniatures YouTube serait les republier sans autorisation.

**Ce que montre chaque fiche à la place**

- Un bandeau avec la variante exacte.
- Un lien vers une vidéo qui montre la voiture :
  - Maka91Productions pour la Penumbra ;
  - Trophygamers pour les voitures de Moses.
- Un bouton « Ma capture » : ta capture, réduite à 960 px et sauvegardée dans ta partie, devient l'image de la fiche.

## Limites

- **Testé en jeu :** aucune des cinq positions.
- **Hellion :** une à deux maisons d'écart sont possibles.
- **Penumbra :**
  - la validation croisée sur des étiquettes d'îles va jusqu'à 37 m ;
  - la porte exacte du garage n'est pas placée.
- **Captures :** elles sont simulées (Playwright) et ne remplacent pas un test sur un iPhone ou un iPad réel.
