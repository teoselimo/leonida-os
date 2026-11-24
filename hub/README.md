# LEONIDA DATA HUB

Couche de données GTA VI commune à tous les modules (Story / Autopilot, Knowledge / LEONIDA AI, Garage, Encyclopédie).
Exécutée **hors de l'app** (Python 3, `curl`, `git`, Node pour lire les entités LEONIDA) ; l'app ne lit que des bundles
statiques : aucune connexion à GTABase ou GTADB pendant une partie.

## Actualiser

```bash
python3 hub/refresh.py              # GTADB (git) + GTABase (sitemap → cache → extraction) + liaison + rapport + bundles
python3 hub/refresh.py --offline    # aucune requête : rejoue l'extraction sur le cache local (hub/cache, non versionné)
python3 hub/refresh.py --source gtadb | --source gtabase
python3 hub/refresh.py --max 50     # essai : 50 téléchargements au plus
python3 -m unittest discover -s hub/tests -v     # tests du pipeline
```

Puis : `node scripts/artifact-build.mjs`, tests, publication (voir docs/ARTIFACT-PILOTE.md).

Durées mesurées le 24/11/2026 : collecte initiale ≈ 25 min (1 403 pages du sitemap puis 208 par liens internes, ~1,2 page/s,
0,6 s minimum entre deux requêtes) ; `--offline` 3 s. Actualisation en ligne suivante : non chronométrée ; elle relit les
9 fichiers du sitemap puis seulement les pages dont la date `lastmod` a changé (la 2e exécution du jour a téléchargé 211 pages, essentiellement les fiches découvertes par liens internes).

## Étapes

1. **Découverte** — GTADB : `git fetch` du dépôt public (clone épars `map/data/6`). GTABase : sitemap officiel
   (`sitemap-4seo.xml`, 8 sous-sitemaps anglais, plafonnés à 8 000 URL) **complété par les liens internes** des pages lues
   (208 fiches GTA 6 absentes du sitemap retrouvées ainsi).
2. **Index et cache** — `hub/state/gtabase-index.json` (URL, section, `lastmod`, origine), `hub/state/gtabase-fetch.json`
   (date de lecture, empreinte, dernière erreur). Reprise : une page déjà en cache et inchangée n'est jamais relue.
3. **Extraction** — `adapters/html_fields.py` (champs du CMS), `adapters/gtabase.py` (normalisation par catégorie),
   `unlocks.py` (phrases « How To Unlock » → missions préalables, fenêtre de perte, conditions), `adapters/gtadb.py`.
4. **Déduplication** (`dedup.py`) — même entité sous deux URL = un enregistrement, toutes les provenances, écarts de champs
   conservés comme contradictions. Modèle / variante / exemplaire unique restent distincts et reliés.
5. **Liaison** — aux entités déjà intégrées (graphe de progression, inventaire Story, Knowledge, Rare Vehicle Locator,
   établissements, repères GTADB) par nom et alias ; correspondances manuelles justifiées dans `aliases.json`.
6. **Changements** (`diff.py`) — ajouts, suppressions, champs ou relations modifiés → `history/changes.jsonl`.
7. **Rapport** — `reports/latest.{json,md}` : état de chaque source, pages en échec, comptes, liaisons, doublons,
   contradictions, lacunes de couverture, taille des bundles.
8. **Bundles** — `src/data/hub/{missions,meta}.json` (embarqués), `public/data/hub/{vehicles,catalog,places}.json` (à la demande).

## Format commun d'un enregistrement

`{ id, type, name, fields, rel[], prov[{source, url, modified, collectedAt, license}], conf, cov{present, missing}, conflicts?, leonida? }`
— voir `src/lib/hub/model.ts`. Une valeur absente reste absente ; une seule source = confiance « moyenne » au plus.

## Règles

- Repères GTADB bruts (`public/data/landmarks.json`) séparés de l'enrichissement (`public/data/hub/places.json`) ;
  les positions calibrées du Rare Vehicle Locator ne sont jamais modifiées.
- Le graphe de progression audité n'est jamais modifié par l'import ; une différence de prérequis est signalée.
- GTABase : faits et liens uniquement (pas de texte rédigé, pas d'image). GTADB : CC BY 4.0, attribution conservée.
- Une page non lue est signalée (`failed`) ; sa dernière copie en cache est marquée `stale`, jamais complétée.
- L'endpoint `/media/com_jamegafilter/en_gb/1.json` (403) n'est pas utilisé.
