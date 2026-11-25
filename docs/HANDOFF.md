# HANDOFF — état du projet pour le prochain agent

> À tenir à jour à la fin de CHAQUE intervention (Claude ou Codex). Règles complètes : `AGENTS.md`.

**Intégration en cours :** Claude depuis le 25/11/2026 11:55 (intégration de codex/chapter2-story, V0.20.2)

| | |
| --- | --- |
| Version en cours | **V0.20.1** (`src/lib/version.ts`) — détail `docs/V0.20.1.md` |
| Branche d'intégration | `experiment/claude-artifact` (PR brouillon #11 ; ne jamais fusionner vers `main` sans Théo) |
| Dernier commit vérifié | `a256c6d` (V0.20.1 ; suite complète au vert sur ce code) |
| Artifact publié | version `1795534745-d773` (vérifiée : 472 fichiers, empreintes identiques au build) — https://claude.ai/artifact/AdLjrvTSQdxHGewPtWa8YS (publication : Claude seulement) |
| Dernier passage complet des tests | 538 réussis, 0 échec, 4 ignorés (21,7 min, Claude simulé) ; pipeline Python 21 / 21 |
| Mis à jour le | 24/11/2026, par Claude |

## Branche en revue — issue #18

**Reprise Claude** · `codex/chapter2-story`, base `experiment/claude-artifact@9822856`, code `2216a95` (V0.20.2). Les versions du tableau ci-dessus décrivent toujours l’intégration et l’Artifact en service. [Rapport par mission et références](V0.20.2.md).

Validation sur le code final `2216a95` : build standard et TypeScript réussis, 239 tests unitaires et 24 parcours ciblés réussis (8 iPhone, 8 iPad, 8 WebKit). Pipeline Python : 21 réussis. Passage général sur l’export antérieur `46abfa2` : 550 réussis, 4 ignorés, 2 échecs iPad. Les deux scénarios ont réussi en relance individuelle sur le code final. Le détail et les limites figurent dans le rapport.

1. Lire le rapport avant de rapprocher les données de cette branche du Data Engine en revue. Les relations sourcées sont dans `src/data/chapter2.ts` et les fiches GTABase générées sont conservées. Les mises à jour du Hub doivent conserver les identifiants ou expliciter leur correspondance.
2. Pour reprendre dans un checkout propre, utiliser `git fetch origin codex/chapter2-story` puis `git switch --track origin/codex/chapter2-story` (ou `git switch codex/chapter2-story` si elle existe). Installer avec `npm ci`, produire `out/` avec `npm run build`, puis lancer `npx playwright test`.
3. Sur un iPhone réel, vérifier avec Théo le journal affiché au motel, l’annulation d’une proposition et le repère du motel. L’ambulance est déclarée terminée. La fin des courses pour Jason et l’identité de la gérante restent à confirmer. Aucun profil de démonstration n’est injecté dans la partie.
4. Publication en attente de revue. L’issue reste ouverte et la branche d’intégration conserve sa version actuelle.

## Terminé

- Carte GTADB (tuiles z0–z5, 3 663 repères), anti-spoiler à la source, navigation Accueil | Carte | LEONIDA | Guide | Partie.
- Rare Vehicle Locator (5 véhicules calibrés), RADAR (veille, instantané dans l'Artifact).
- Story Intelligence (22 règles), Mission Autopilot (V0.18 / V0.18.1), garde-fou au point de non-retour.
- Knowledge & Visual Grounding (V0.19) : 20 entités, zones de carte, extraction → ancrage → web si incertain.
- Data Hub (V0.20) : GTADB + GTABase (1 610 pages), graphe 33 → 173 nœuds, Garage (590 fiches), Encyclopédie.
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
- Graphe : chapitre 2 partiel (GTABase ne cite pas les déblocages de 85 missions sur 120) ; chapitres 2 à 5 = une source.
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

## Prochaines tâches prioritaires

1. Essai réel de Vision par Théo (voir ci-dessus) puis réglage des seuils et du lot de références selon les résultats.
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
