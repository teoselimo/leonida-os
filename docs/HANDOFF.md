# HANDOFF — état du projet pour le prochain agent

> À tenir à jour à la fin de CHAQUE intervention (Claude ou Codex). Règles complètes : `AGENTS.md`.

**Intégration en cours :** personne

| | |
| --- | --- |
| Version en service | **V0.21** — [note de version](V0.21.md) |
| Branche d’intégration | `experiment/claude-artifact` |
| SHA de fusion et du code final | `7f12e5aa1ddb0222be5a871de8e8932f5bc24d0d` |
| Artifact en service | **V0.21, version `1795644634-44cf`**, publiée le 25/11/2026 depuis `7f12e5a` — 472 fichiers distants, 61 743 736 octets ; 471 / 471 fichiers applicatifs identiques au build ; `data/radar.json` distant conservé (voir ci-dessous). Précédente : V0.20.2 `1795608546-b457`. |
| Tests sur le code final | Hub Python 39/39. Playwright standard 559 réussis, 4 ignorés, 0 échec, dont 242 unitaires. Artifact ciblé 90/90. |
| Mis à jour le | 25/11/2026, par Claude (publication V0.21) |

## Publication V0.21 (25/11/2026, Claude)

- HEAD vérifié avant publication : `ead6aa8` (seule la documentation diffère de `7f12e5a`). Build reconstruit depuis `7f12e5a` dans un arbre de travail propre : `node scripts/artifact-build.mjs` → 472 fichiers publiables, 62 119 737 octets ; `python3 hub/verify_manifest.py` et `--export out-artifact` : contrat v1 vérifié ; `data/hub/manifest.json` = `17fbee0d…d7ab` (identique à l'attendu).
- Patch sur `1795608546-b457` → **`1795644634-44cf`** : 15 fichiers envoyés (dont 10 nouveaux chemins : `data/hub/manifest.json` + 9 chunks), 10 retirés (9 anciens chunks + `manifest.json` racine, liste de conditionnement locale publiée par erreur depuis les versions précédentes, non utilisée par l'app). Déclaration de capacités inchangée.
- Contrôle distant par chemin : **472 fichiers, 61 743 736 octets ; 471 / 471 fichiers applicatifs aux empreintes identiques au build ; 0 fichier en trop ; `tiles/3/` = 30.**
- **Écart RADAR (volontaire)** : `data/radar.json` non republié. Distant : 1 148 843 octets, SHA-256 `be277561…4361` (flux antérieur déjà en service). Build : instantané `origin/data` du 25/11/2026 13:48:12 UTC, 1 524 844 octets, `3d6a1d35…dce2`. Le distant reste le flux d'origine de l'Artifact ; le mettre à jour est une décision à part (Théo).
- Chapitre 2 et progression : `git diff 7eed616 7f12e5a -- src` ne touche que `src/lib/version.ts` ; sauvegarde, graphe, Autopilot, Story Intelligence, chapitre 2 et Rare Vehicle Locator inchangés. Parcours chapitre 2 sur le build publié : **27 / 27** (iPhone, iPad, WebKit, Claude simulé).
- Reste à faire par Théo sur iPhone : ouvrir l'Artifact, vérifier « V0.21 » dans Partie › À propos, que sa partie (chapitre 2, Ambulance Chaser) est intacte, et ouvrir Guide › Garage.

## Issue #17 — Data Engine V0.21 intégré

Fusion de `codex/data-engine-v1-fix@5dc287c29a58cc7a5f6ca22b6637e9fb77e50c3f` sur la V0.20.2 publiée (`7eed616`, verrou `90e05d8`). Le moteur sépare la collecte et la production des cinq projections. Le rejeu hors ligne du dernier snapshot accepté a reproduit les sept fichiers attendus. La collecte exhaustive GTABase fera l’objet d’un chantier séparé. [Données et mesures](DATA-ENGINE.md)

L’export contient **472 fichiers publiables sur 512**, pour **62 119 769 octets**, dont les 30 tuiles de `tiles/3/`. SHA-256 du manifeste de données `data/hub/manifest.json` : `17fbee0d362905a8d4e1d8b9974c86b0b3dcbab3797083c9e324f0c3037ad7ab`. Le manifeste de conditionnement à la racine est un fichier local supplémentaire.

### Reprise de publication par Claude (faite le 25/11/2026, voir ci-dessus)

1. Prendre le verrou et utiliser le package validé de `7f12e5a` ou reconstruire ce code avec `node scripts/artifact-build.mjs`. En cas de reconstruction, comparer les empreintes du nouveau build et vérifier ses parcours sur `SERVE_DIR=out-artifact` avant l’envoi.
2. Dans l’Artifact LEONIDA OS existant, suivre `AGENTS.md` §10. Comparer `list_files` au build, appliquer le patch, retirer les anciens chunks et conserver le flux RADAR distant. Les 30 tuiles de niveau 3 doivent rester présentes.
3. Revérifier les empreintes distantes par chemin, consigner tout écart de RADAR séparément, puis noter la version distante dans ce fichier et `docs/ARTIFACT-PILOTE.md`. Libérer le verrou.

Le contrôle automatique a refusé l’accès navigateur à l’Artifact privé depuis Codex. La publication et la comparaison distante des SHA-256 nécessitent les outils Artifact de Claude.

## V0.20.2 intégrée — issue #18 (25/11/2026, Claude)

- Fusion `--no-ff` de `codex/chapter2-story@7595d77` (code `2216a95`) sur `9822856` → `e743e5a`. Aucun conflit ; `docs/HANDOFF.md` fusionné automatiquement. `codex/data-engine-v1` **non fusionnée** (revue séparée : relation Maverick, URLs sans lastmod).
- Suite complète sur la fusion `e743e5a` : **556 réussis, 0 échec, 4 ignorés** (25,7 min). Les deux échecs iPad vus par Codex sur `46abfa2` ne se sont pas reproduits.
- **Défaut trouvé par les captures, corrigé dans `2a76974`** : au chapitre 2, l'accueil affichait encore « ≈ 1 000–1 400 $ — Three Sheets Liquor · disparaît au début de Tourist Trap » et la règle « vêtements d'Andy avant Coming Home ». Une mission principale d'un chapitre quitté est désormais passée pour les pertes datées (`progress.ts`), les fiches Radar (`discover.ts`) et Story Intelligence (`story/engine.ts`) — sans rien déclarer fait dans la sauvegarde. Tests : `tests/v0202.unit.spec.ts` (3).
- Suite complète relancée sur `2a76974` : **559 réussis, 0 échec, 4 ignorés**. Sur le build Artifact : `v018` + `v020` + `v0201` complets **90 / 90** (iPhone, iPad, WebKit).
- Captures (build Artifact, Claude simulé) : `docs/v0202-captures.jpg` — transition ch1→2, accueil ch2 strict après Ambulance Chaser, chat du motel.
- Publication en patch : 5 fichiers, 1 ancien chunk retiré ; `data/radar.json` non renvoyé ; déclaration inchangée.

### Reste à tester sur iPhone réel avec le vrai Claude (Théo)

1. Partie › chapitre : la sauvegarde réelle est-elle déjà au chapitre 2 ? Sinon, bouton « Mon jeu affiche le chapitre 2 · confirmer le passage » sur l'accueil.
2. Accueil : « Ambulance Chaser » en dernière mission, aucune mission principale future nommée, aucune alerte du chapitre 1.
3. Chat : « j'ai ramassé les provisions pour Jason », puis « je parle avec la proprio » → propositions à confirmer ; vérifier qu'**Annuler** ne change rien, puis confirmer seulement ce que le jeu affiche (fin de Just Moved In, objectif de la gérante).
4. « Quelque chose à manquer au motel ? » → cartes (Vicki, Victor Maravilla), affiches ; bouton carte sur le Starlet Motel.
5. Réponse du **vrai** Claude du runtime à une question libre du chapitre 2 (jamais testé : tous les tests simulent Claude), et latence.

## Terminé

- Carte GTADB (tuiles z0–z5, 3 663 repères), anti-spoiler à la source, navigation Accueil | Carte | LEONIDA | Guide | Partie.
- Rare Vehicle Locator (5 véhicules calibrés), RADAR (veille, instantané dans l'Artifact).
- Story Intelligence (22 règles), Mission Autopilot (V0.18 / V0.18.1), garde-fou au point de non-retour.
- Knowledge & Visual Grounding (V0.19) : 20 entités, zones de carte, extraction → ancrage → web si incertain.
- Data Hub (V0.20) : GTADB + GTABase (1 610 pages), graphe 33 → 173 nœuds, Garage (590 fiches), Encyclopédie.
- V0.20.2 : graphe du chapitre 2 (14 principales à lancer, 3 objectifs du journal, 11 secondaires, 2 activités), Autopilot chapitre 2, transition ch1→2 confirmée, Starlet Motel (formulations naturelles, cartes, affiches), anti-spoiler strict.
- V0.20.1 :
  - Vision compare la capture à des **photos de référence GTADB** (42 références, sélection avant comparaison, plafond de
    confiance « moyenne » pour une ressemblance photo, carte sur le lieu RETENU, doublon « Détaille » corrigé) ;
  - **soluces GTABase → faits structurés** (164 missions : étapes, entités, montants, manquables / choix / non-retour)
    utilisés par LEONIDA AI selon la question, l'Encyclopédie (repliée) et « Si je lance » ;
  - **Garage illustré** : 492 / 589 images exactes (GTABase, validé par Théo), photo du joueur prioritaire ;
  - `AGENTS.md` et ce fichier.

## Partiellement fait

- Reconnaissance visuelle : jamais essayée avec le **vrai** Claude du runtime (tous les tests utilisent un Claude simulé).
  À faire par Théo dans l'Artifact : capture de la maison de Jason, du Rusty Anchor, d'une marina, et d'un lieu sans
  référence ; noter ce que LEONIDA répond.
- Références visuelles : 42 / 2 487 photos GTADB disponibles ; Key Lento et chapitre 1 surtout.
- Graphe : chapitre 2 audité (V0.20.2) ; chapitres 3 à 5 = une source.
- Garage : 97 fiches sans image exacte (visuel de remplacement) ; prix connus pour 2 véhicules.
- Data Hub : actualisation manuelle (`python3 hub/refresh.py`) ; pas d'automatisation périodique.

## Bugs et limites connus

- La suite complète doit tourner sur `out/` (build standard) : sur `out-artifact`, deux tests de veille en direct
  échouent par construction (mode instantané).
- `node scripts/artifact-build.mjs` réécrit `out/` en mode instantané : relancer `npm run build` avant la suite complète.
- Détection des drapeaux de soluce par mots-clés : un « conseil » peut être générique ; noms courts ou génériques ignorés.
- Images de référence GTADB de qualité inégale (certaines viennent de bandes-annonces floues).
- `hub/refresh.py --offline` exige le cache local (`hub/cache`, non versionné) ; sans lui, lancer la version en ligne (≈ 25 min).
- Latence réelle sur iPhone non mesurée.
- Fin du chapitre 1 avant confirmation du passage : si Tourist Trap n'a jamais été déclarée, l'alerte d'argent de Three Sheets peut encore s'afficher (signal de veille `liveAdvice` fondé sur les missions déclarées) ; disparaît dès le chapitre 2 confirmé.

## Prochaines tâches prioritaires

1. Essai réel V0.20.2 au motel par Théo (liste ci-dessus).
2. Publication V0.21 dans le même Artifact par Claude et vérification des empreintes distantes (procédure ci-dessus).
3. Essai réel de Vision par Théo (voir ci-dessus) puis réglage des seuils et du lot de références selon les résultats.
2. Étendre les références visuelles (planques et lieux des chapitres 2 à 4) : `python3 hub/vision_refs.py --max 50`
   (adapter la sélection dans le script).
3. Recouper les prérequis des chapitres 2 à 5 avec une 2e source pour passer de « Probable » à « Vérifié ».
4. Relier les entités des soluces aux fiches (lieu → repère sur la carte, véhicule → Garage) dans l'Encyclopédie.
5. Actualisation périodique du Data Hub (P2) sans toucher aux workflows existants sans accord.

## Reprendre le travail sans perdre de modifications

```bash
git fetch origin
git status                                   # aucune modification locale non commitée ?
git switch experiment/claude-artifact && git pull --ff-only
git log --oneline -5                         # le « dernier commit vérifié » ci-dessus doit y être
# Codex : travailler sur une branche dédiée
git switch -c codex/<sujet> <dernier commit vérifié>
npm ci && npx tsc --noEmit -p . && npx playwright test --project=unit
```

- Si `git pull --ff-only` échoue : quelqu'un a poussé entre-temps. Ne pas forcer ; `git log HEAD..origin/experiment/claude-artifact`,
  relire le diff, fusionner, relancer les tests.
- Si « Intégration en cours » n'est pas `personne` : ne pas intégrer ; travailler et pousser sur sa branche.
- Publication de l'Artifact : impossible pour Codex. Terminer par « commit poussé + build vérifié » et écrire ici
  « Publication en attente : <commit> ».
