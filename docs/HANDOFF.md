# HANDOFF — état du projet pour le prochain agent

> À tenir à jour à la fin de CHAQUE intervention (Claude ou Codex). Règles complètes : `AGENTS.md`.

**Intégration en cours :** Codex — issue #17, V0.21

| | |
| --- | --- |
| Version en cours | **V0.20.2** (`src/lib/version.ts`) — détail `docs/V0.20.2.md` (audit chapitre 2 + section « Intégration ») |
| Branche d'intégration | `experiment/claude-artifact` (PR brouillon #11 ; ne jamais fusionner vers `main` sans Théo) |
| Dernier commit vérifié | `2a76974` (code final V0.20.2 : fusion `e743e5a` de `codex/chapter2-story@7595d77` + correctif `2a76974`) |
| Artifact publié | version `1795608546-b457` (vérifiée : 472 fichiers, empreintes identiques au build, `tiles/3` = 30) — https://claude.ai/artifact/AdLjrvTSQdxHGewPtWa8YS (publication : Claude seulement) |
| Dernier passage complet des tests | **559 réussis, 0 échec, 4 ignorés** (24,9 min, sur `2a76974`, Claude simulé) ; unitaires 242 / 242 ; pipeline Python 21 / 21 |
| Mis à jour le | 25/11/2026, par Claude |

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
2. Revue puis intégration de `codex/data-engine-v1` (après ses corrections P0/P1), en conservant les identifiants du chapitre 2.
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
