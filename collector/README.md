# Collecteur LEONIDA OS

Moteur de veille exécuté par GitHub Actions (`.github/workflows/collect.yml`, toutes les 15 min) : collecte → tri → lecture des guides autorisés → extraction sourcée → recoupement → flux `radar.json` sur la branche `data`.

- Architecture et sources : [`docs/V0.5-VEILLE.md`](../docs/V0.5-VEILLE.md)
- Extraction, recoupement, conseils, santé : [`docs/V0.5.1-EXTRACTION.md`](../docs/V0.5.1-EXTRACTION.md)
- Tests : `npm test` · diagnostic sans écriture : `npm run diagnose`
