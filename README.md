# LEONIDA OS — V0.5

Copilote GTA VI pour iPhone/iPad, alimenté par **une veille automatique** :
une collecte planifiée (GitHub Actions) trouve les nouvelles informations publiques sur GTA VI,
les trie, les classe par fiabilité et les publie dans le Radar de l'app, sans intervention ni redéploiement.

- Application : https://teoselimo.github.io/leonida-os/
- Flux de veille : branche [`data`](../../tree/data) (`radar.json`)
- Architecture, sources, coûts, limites : [docs/V0.5-VEILLE.md](docs/V0.5-VEILLE.md)


Copilote d'exploration pour GTA VI, pensé iPhone / iPad. Prototype interactif, **données de démonstration**.

## Lancer

```bash
npm ci
npm run dev          # http://localhost:3000 — ouvrir depuis l'iPhone/iPad via l'IP locale du Mac
npm run build        # vérifie les assets carte puis exporte dans ./out
npm run serve        # sert ./out sur http://localhost:4321
```

Les tuiles de carte (`public/tiles/`, ~19 Mo) sont incluses : le build est reproductible sans réseau.
Si elles manquent, `npm run build` s'arrête avec la commande à lancer pour les régénérer.

## Tests

```bash
npx playwright install chromium     # une fois (ou CHROME_PATH=/chemin/vers/chrome)
npm run test:all                    # typecheck + build + 38 tests (unitaires, iPhone, iPad)
```

- `tests/unit.spec.ts` : moteur (anti-spoiler, recommandations, progression), modèle de fiabilité, migration.
- `tests/e2e.spec.ts` : 3 parcours essentiels, persistance, anti-spoiler, navigation, carte (tuiles, instance unique, caméra), fiche glissante, relevés, responsive.
- Captures de référence : `captures/`. Rapport HTML : `test-report/`.

Sur iPhone : Safari → Partager → « Sur l'écran d'accueil » pour un lancement plein écran.

## Carte (V0.2)

La carte utilise **MapLibre GL** (moteur de carte open source, rendu GPU, gestes natifs iOS) avec le fond de carte
et les 3 663 lieux de la **carte communautaire gtadb.org** (licence CC BY 4.0 — attribution affichée sur la carte et dans le Profil).
Ce n'est pas la carte officielle de Rockstar.

Mettre à jour la carte (à relancer quand la communauté publie des corrections) :

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/rolux/gtadb.org ../gtadb
git -C ../gtadb sparse-checkout set map/data/6 maps/tiles/6/day
pip install pillow
python3 scripts/build_gtadb_assets.py ../gtadb      # → public/tiles + public/data
npm run build
```

`npm run package:artifact` produit `out-artifact/` (export sans dossiers préfixés « _ ») pour l'hébergement en artifact.

## Architecture

```
src/
  app/            layout, page unique, styles (design tokens dans globals.css)
  components/
    map/          LeonidaMap (MapLibre + tuiles gtadb, marqueurs React) · types.ts = contrat MapViewProps
    LandmarkCard  fiche d'un lieu gtadb (équivalent réel en Floride, découverte proche)
    ui/           icônes et primitives (anneau, badges, anti-spoiler, segmented…)
    AppShell, DiscoveryDetail, RecoCard, ShieldChip
  screens/        Accueil, Carte, Radar, Profil
  lib/
    types.ts      modèle de domaine
    engine.ts     statuts, recommandations, progression, alertes (fonctions pures)
    gtadb.ts      projection coordonnées de jeu ↔ carte, chargement des lieux, attribution
    repository.ts ContentRepository (démo → API/PostgreSQL) · ProgressStore (localStorage)
    store.tsx     état React + persistance + navigation par ancre (#accueil #carte #radar #profil)
  data/demo.ts    jeu de données fictif, chaque objet marqué provenance "demo"
db/schema.sql     schéma PostgreSQL cible (V1)
```

### Brancher PostgreSQL (V1)
1. Appliquer `db/schema.sql`, importer `data/demo.ts` comme seed.
2. Retirer `output: "export"` de `next.config.ts`, ajouter `src/app/api/*`.
3. Implémenter `ContentRepository` et `ProgressStore` côté API. L'UI ne change pas.

## Données
- Officiel : noms des six régions de Leonida, sortie le 19/11/2026 (PS5 / Xbox Series X|S).
- Communautaire (gtadb.org, CC BY 4.0) : fond de carte et lieux — reconstitution, pas la carte Rockstar.
- Fictif, étiqueté « DÉMO » : découvertes, prérequis, récompenses, signaux radar (posés sur des emplacements réels de la carte).
