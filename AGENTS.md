# AGENTS.md — LEONIDA OS

Guide pour tout agent de développement (Claude, Codex ou autre) qui travaille sur ce dépôt. **GitHub est la seule source
de vérité** : ce fichier, `docs/HANDOFF.md` et les `docs/V*.md` contiennent le contexte produit nécessaire. Ne pas
dépendre d'un historique de conversation.

LEONIDA OS est le copilote **non officiel** de GTA VI de Théo (iPhone / iPad, en français) : carte (GTADB), suivi des
missions (Story Intelligence, Mission Autopilot), Guide (infos, Garage, Encyclopédie), LEONIDA AI (chat avec images).
Projet personnel, sans lien avec Rockstar Games ni Take-Two.

## 1. Branches et règles GitHub

| Branche | Rôle | Qui écrit |
| --- | --- | --- |
| `main` | app GitHub Pages historique (veille en direct) | **personne sans instruction explicite de Théo** |
| `experiment/claude-artifact` | **branche d'intégration** de la version Artifact (PR brouillon #11) | un seul agent à la fois (voir §9) |
| `codex/<sujet>` | travail de Codex, créée depuis un HEAD vérifié de l'intégration | Codex |
| `claude/<sujet>` | travail long de Claude en parallèle (facultatif) | Claude |
| `data` | flux `radar.json` écrit par la collecte automatique | GitHub Actions uniquement |
| `experiment/openai-gpt-leonida` | expérimentation GPT | ne pas toucher |

Règles :
1. Jamais de `git push --force` ni de réécriture d'historique sur une branche partagée.
2. Jamais de commit sur `main`, jamais de fusion vers `main`, sauf instruction explicite de Théo.
3. Chaque intervention se termine par des commits identifiés (préfixe de version, ex. `V0.20.1 : …`), des tests exécutés
   et un résumé dans `docs/HANDOFF.md`.
4. Avant d'intégrer : `git fetch`, relire `git log HEAD..origin/experiment/claude-artifact` et le diff, résoudre les
   changements concurrents, relancer les tests.
5. Les messages de commit et la documentation sont en français.

## 2. Ne jamais toucher (sans discussion préalable avec Théo)

- `main`, la branche `data`, les workflows `.github/workflows/*` (collecte, Pages, validation).
- Infrastructure GPT et Cloudflare : `proxy/` (Worker Cloudflare, `wrangler.toml`), `collector/` (veille RADAR, exécutée
  par GitHub Actions), tout secret. **Budget supplémentaire : 0 €.** Aucune clé API ni secret dans le code, Git,
  localStorage ou les journaux.
- Les **sauvegardes du joueur** : clé `localStorage` `leonida-os/progress/v1`, schéma `PersistedState`
  (`src/lib/types.ts`), migration `migrate()` (`src/lib/store.tsx`, révision 9). Un champ nouveau doit être facultatif et
  migré ; jamais écraser un état plus récent par un état de test ; toute modification durable de progression est
  confirmée par le joueur.
- Les positions calibrées du Rare Vehicle Locator (`src/data/rareVehicles.ts`) et les repères GTADB bruts
  (`public/data/landmarks.json`).
- Le graphe de progression audité (`MANUAL_PROGRESSION` dans `src/data/progression.ts`) : on l'enrichit par le Data Hub,
  on ne remplace pas ses prérequis par une source unique.
- Dans l'Artifact publié : ne jamais republier `data/radar.json`.

## 3. Principes produit (non négociables)

- Ne jamais inventer : coordonnées, positions, montants, missions, identifications. Une hypothèse n'est jamais montrée
  comme une position exacte ; pas de précision métrique non calibrée.
- Une seule source = « Probable » / « à confirmer », jamais « Vérifié » (≥ 2 sources indépendantes de qualité).
- Anti-spoiler à la source (modes strict / léger / désactivé) : rien d'un chapitre non atteint en mode strict.
- Distinguer tests simulés (Claude simulé), tests d'intégration réels et tests sur iPhone réel par Théo. Ne jamais
  annoncer une publication ou des tests réussis avant leur exécution réelle ; un test rouge n'est jamais « validé ».
- Pas de sixième onglet ; conserver l'identité visuelle (sombre, néon rose / turquoise).
- Licences : GTADB CC BY 4.0 (attribution conservée) ; GTABase : faits, liens et images exactes de fiches validées par
  Théo, pas de texte rédigé.

## 4. Architecture

```
src/app            Next.js 15 (App Router), export statique
src/screens        Accueil, Carte, Guide (RadarScreen), Partie (ProfileScreen)
src/components     UI (Garage, Encyclopedia, AiCopilot, VisionAttach, StoryLaunch, RareLocator…)
src/lib            moteurs : progress (graphe), autopilot, story/engine, knowledge/engine, copilot/* (LEONIDA AI),
                   hub/* (Data Hub côté app : missions, garage, media, visionRefs, knowledge), store (état + migration)
src/data           référentiels versionnés : progression (graphe audité), story, knowledge, rareVehicles,
                   establishments, hub/{missions,meta}.json (générés)
public/data        landmarks.json (GTADB brut), hub/*.json (générés), hub/refs/*.jpg (références Vision),
                   hub/vehicles/*.jpg (images Garage)
public/tiles       tuiles de carte GTADB (z0–z5, 2048 px)
hub/               Data Hub (Python) : acquisition, normalisation, liaison, rapport — voir hub/README.md
scripts/           build Artifact, assets carte, calibrations
tests/             Playwright : *.unit.spec.ts (moteurs, Node) et *.spec.ts (navigateur iPhone / iPad / WebKit)
collector/, proxy/ veille RADAR et Worker Cloudflare — ne pas toucher (§2)
```

LEONIDA AI dans l'Artifact appelle Claude via le runtime Artifact (`window.claude.use("sample")`, images autorisées par la
déclaration `sample: { images: true }`) et Exa via le connecteur `mcp` de Théo. Hors Artifact (tests, GitHub Pages),
Claude est absent ou simulé.

## 5. Installation

```bash
node -v                      # 22.x
npm ci
npx playwright install chromium webkit   # ou CHROME_PATH=/chemin/vers/chrome
python3 -m pip install --user pillow     # Data Hub et scripts d'images (Python 3.11+)
```

## 6. Build

```bash
npx tsc --noEmit -p .            # typecheck
npm run build                    # build standard → out/ (veille en direct)
node scripts/artifact-build.mjs  # build Artifact → out-artifact/ (veille figée : instantané radar.json)
```

`artifact-build.mjs` réécrit aussi `out/` : relancer `npm run build` avant la suite complète si besoin.

## 7. Tests

```bash
npx playwright test --project=unit                     # moteurs (≈ 15 s, sans navigateur)
python3 -m unittest discover -s hub/tests -v           # pipeline Data Hub
npm run build && npx playwright test                   # SUITE COMPLÈTE sur le build standard (≈ 20 min)
SERVE_DIR=out-artifact PORT=4397 npx playwright test tests/v0201.spec.ts --project=iphone   # contrôle du build Artifact
```

- La suite complète se lance **sur `out/` (build standard)** : sur `out-artifact`, deux tests de la veille en direct
  échouent par construction.
- Projets : `unit`, `iphone`, `ipad`, `iphone-webkit` ; un nouveau fichier e2e doit être ajouté aux `testMatch` de
  `playwright.config.ts`.
- Tous les tests de LEONIDA AI utilisent un Claude simulé (`window.claude` remplacé dans `addInitScript`).

## 8. Data Hub (résumé — détail dans hub/README.md)

```bash
python3 hub/refresh.py            # GTADB (git) + GTABase (sitemap + liens internes) → référentiel + rapport + bundles
python3 hub/refresh.py --offline  # rejoue sur le cache local (hub/cache, non versionné, ≈ 160 Mo)
python3 hub/vision_refs.py        # références visuelles Vision (photos en jeu GTADB, 640 px, ≤ 70 Ko)
python3 hub/vehicle_media.py --allow gtabase   # images exactes du Garage (validé par Théo le 24/11/2026)
```

Sans cache, `--offline` ne peut rien relire : lancer la commande en ligne (≈ 25 min, 0,6 s entre requêtes). Les fichiers
générés (`hub/records`, `hub/reports`, `src/data/hub`, `public/data/hub`) sont versionnés.

## 9. Collaboration Claude ↔ Codex

- Claude est le constructeur principal ; Codex prend le relais quand Claude n'est pas disponible.
- **Un seul agent intègre à la fois** sur `experiment/claude-artifact`. Verrou : la ligne « Intégration en cours » de
  `docs/HANDOFF.md`. Avant d'intégrer : la mettre à `<agent> depuis <date heure>` dans un commit poussé ; à la fin :
  la remettre à `personne`. Si elle n'est pas à `personne`, ne pas intégrer : travailler sur sa branche.
- Codex : `git fetch && git switch -c codex/<sujet> origin/experiment/claude-artifact` depuis le « dernier commit vérifié »
  de HANDOFF ; commits identifiés ; tests ; mise à jour de HANDOFF ; push de la branche ; intégration par fusion
  (`git merge --no-ff`) après revue du diff et relance des tests, jamais par écrasement.
- Fin d'intervention, quel que soit l'agent : mettre à jour `docs/HANDOFF.md` (version, dernier commit vérifié, ce qui
  est fait / partiel, bugs connus, prochaines tâches).

## 10. Publication de l'Artifact (accès Claude uniquement)

L'Artifact privé de Théo (`https://claude.ai/artifact/AdLjrvTSQdxHGewPtWa8YS`, slug
`4df53030-50de-465e-b0d1-5abe15214f73`) se publie **uniquement avec les outils Artifact de Claude sur claude.ai** (compte de
Théo). **Codex n'a pas cet accès** : il s'arrête à « commit poussé + build vérifié » et l'indique dans HANDOFF
(« publication en attente »). Procédure Claude :
1. `node scripts/artifact-build.mjs` puis contrôle (`tests/v0201.spec.ts` sur `out-artifact`).
2. `list_files` de l'Artifact, comparaison des empreintes sha256 avec `out-artifact/`.
3. `publish_files` en mode patch : fichiers modifiés + nouveaux (≤ 256 par appel), `remove` pour les anciens fichiers
   `nx/…` disparus ; **jamais `data/radar.json`** ; vérifier que `tiles/3/` reste présent (30 fichiers).
4. `list_files` à nouveau : empreintes identiques au build. Noter la version dans `docs/ARTIFACT-PILOTE.md` et HANDOFF.
La déclaration de capacités (`sample` avec images, Exa via `mcp`) n'est pas modifiée sans raison.

## 11. Conventions

- TypeScript strict, React 19 ; texte d'interface en français ; commentaires en français ; `data-testid` sur tout
  élément testé.
- Une fonctionnalité = moteur testable (`src/lib`) + UI + tests unitaires + test e2e iPhone / iPad / WebKit.
- Données générées : ne pas les modifier à la main, relancer le script qui les produit.
- Version affichée : `src/lib/version.ts` (`APP_VERSION`), documentée dans `docs/V<version>.md`.

## 12. Contrôles avant commit

1. `npx tsc --noEmit -p .`
2. `npx playwright test --project=unit` et, si le Data Hub a changé, `python3 -m unittest discover -s hub/tests`.
3. Tests e2e des fichiers touchés sur iphone, ipad, iphone-webkit ; avant une livraison : suite complète.
4. `git status` : pas de cache (`hub/cache`, `__pycache__`), pas de secret, pas de fichier hors périmètre (§2).
5. Mettre à jour `docs/HANDOFF.md` (et `docs/V<version>.md` pour une livraison).
