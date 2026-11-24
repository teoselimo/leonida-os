# Rapport d'import du Data Hub — 2026-11-24T12:12:37+0100

Mode : hors ligne.

## Sources

### GTABase (www.gtabase.com, sitemap public) — partiel
- license : GTABase.com — tous droits réservés : faits et liens uniquement, pas de texte ni d'image repris
- sitemapUrls : 1611
- discoveredAt : 2026-11-24T11:55:52+0100
- read : 1610
- notFetchedYet : 0
- crawler : FIN {'cached': 1610, 'fetched': 0, 'failed': 0, 'offline-miss': 1, 'cached-stale': 0} index 1611
- Endpoint /media/com_jamegafilter/en_gb/1.json (403) non utilisé.
- Aucune API supposée : lecture du HTML public et du sitemap.
- pages en échec (1) :
  - https://www.gtabase.com/gta-6/vehicles/speeder — HTTP 404

### GTADB (github.com/rolux/gtadb.org) — ok
- license : CC BY 4.0
- revision : d406fea099e1df2bce42fd6b87eed04bce646629
- revisionDate : 2026-11-19T17:51:06+01:00
- ourRevision : d406fea099e1df2bce42fd6b87eed04bce646629
- upToDate : True

## Entités importées

**gtadb** : place 3754, placeAvecPosition 3663, placeSansPosition 91, photosEnJeuDisponibles 2487
**gtabase** : vehicle 589, animal 245, weapon 212, article 189, mission 120, character 71, stranger 51, map-feature 29, property 22, radio 21, activity 16, other 12, list-page 10, gang 4, cheat 3, guide 1, random-event 1
**gtabaseMissionIndex** : 134

## Changements depuis la dernière exécution

{'firstRun': False, 'added': 0, 'removed': 0, 'changed': 0, 'examplesChanged': [], 'examplesRemoved': []}

## Liaisons aux entités LEONIDA

- mission→Story : 9
- mission nouvelle : 146
- mission→graphe : 30
- character→Knowledge : 2
- property→Knowledge : 2
- propriété→repère GTADB : 4
- prérequis lus dans « How To Unlock » : 67
- fenêtres de perte lues : 1
- mission→LEONIDA (alias manuel) : 2
- Knowledge→repère GTADB : 13
- établissement→repère GTADB : 2
- relations non résolues (page absente du sitemap) : 0

## Doublons fusionnés (14)

- mission « Thrillbillies » : gtabase:missions/thrillbillies → gtabase:strangers/thrillbillies
- mission « Yasmani's Jewelry Jobs » : gtabase:missions/yasmanis-jewelry-jobs → gtabase:strangers/yasmanis-jewelry-jobs
- mission « That's Where the Money Is… » : gtabase:missions/thats-where-the-money-is → gtabase:strangers/thats-where-the-money-is
- mission « Get Shirley's Rum » : gtabase:missions/get-shirleys-rum → gtabase:strangers/get-shirleys-rum
- mission « Steal the Scooter » : gtabase:missions/steal-the-scooter → gtabase:strangers/steal-the-scooter
- mission « Pick Up a Gun » : gtabase:missions/pick-up-a-gun → gtabase:strangers/pick-up-a-gun
- mission « Twist Wrist, Smash, Grab » : gtabase:missions/twist-wrist-smash-grab → gtabase:strangers/twist-wrist-smash-grab
- mission « Hit Avery Pawn » : gtabase:missions/hit-avery-pawn → gtabase:strangers/hit-avery-pawn
- mission « Hit Kingpin Bowling » : gtabase:missions/hit-kingpin-bowling → gtabase:strangers/hit-kingpin-bowling
- mission « Impounded Vehicle » : gtabase:missions/impounded-vehicle → gtabase:strangers/impounded-vehicle
- mission « Get Your Wheels » : gtabase:missions/get-your-wheels → gtabase:strangers/get-your-wheels
- mission « Race Against Yago » : gtabase:missions/race-against-yago → gtabase:strangers/race-against-yago
- mission « Pick Up Shayna » : gtabase:missions/this-is-a-free-call-from → gtabase:strangers/this-is-a-free-call-from
- mission « Bad Driver! » : gtabase:missions/bad-driver → gtabase:strangers/bad-driver

## Contradictions conservées, non appliquées (0)


## Lacunes de couverture (enregistrements sans le champ)

- stranger : {'chapter': 0, 'giver': 1, 'protagonist': 10, 'rewards': 14, 'unlockedBy': 12}
- mission : {'number': 0, 'chapter': 0, 'missionType': 0, 'protagonist': 3, 'giver': 9, 'rewards': 44, 'unlockedBy': 85, 'objectives': 0}
- character : {'role': 0, 'occupation': 21, 'location': 34}
- property : {'propertyType': 0, 'location': 0, 'price': 14, 'howToUnlock': 2, 'capacity': 7}
- vehicle : {'class': 0, 'manufacturer': 29, 'stats': 148, 'seats': 89, 'drivetrain': 154, 'price': 587, 'howToGet': 575}
- weapon : {'category': 1, 'stats': 38, 'price': 130}
- activity : {'location': 11, 'rewards': 16, 'unlockedBy': 15}

## Bundles

- src/data/hub/missions.json : 85 Ko
- public/data/hub/vehicles.json : 221 Ko
- public/data/hub/catalog.json : 154 Ko
- public/data/hub/places.json : 51 Ko
- src/data/hub/meta.json : 1 Ko
