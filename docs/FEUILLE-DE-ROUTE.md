# LEONIDA OS — feuille de route

Mise à jour : 23/11/2026, après validation de la V0.15 sur appareils réels.

## Ordre des prochaines versions

1. **V0.15.1 — finitions cartographiques** (livrée) : crédits compacts « ⓘ GTADB », commandes de carte réduites à + et −.
2. **Rare Vehicle Locator V1** : prochaine priorité de développement.
3. **Social Discovery Engine** : élargissement progressif du moteur de découvertes communautaires (cadrage ci-dessous, rien d'implémenté).

## Social Discovery Engine — cadrage (pas encore une fonctionnalité)

### Rôle

Instagram, mais aussi YouTube, Reddit et les guides web, ne servent pas qu'au Rare Vehicle Locator. Une même publication peut alimenter plusieurs fonctionnalités :

- localisations de véhicules rares ;
- easter eggs et secrets ;
- missions difficiles et astuces ;
- objets ou événements manquables ;
- collectibles ;
- méthodes pour gagner de l'argent ;
- nouvelles découvertes de gameplay.

### Principes d'architecture

- **Collecte indépendante des catégories.** On ingère d'abord une *publication source* (lien, créateur, date, plateforme, médias, texte, transcription éventuelle). On en extrait ensuite des *affirmations*. Chaque affirmation est rattachée à une ou plusieurs fiches (véhicule, secret, manquable…). Une publication → N affirmations → N fiches.
- **Traçabilité systématique.** Pour chaque affirmation : lien, créateur, date de publication, date de collecte, extrait ou horodatage de la preuve (capture, minute de vidéo), niveau de confiance, contradictions connues.
- **Indépendance des sources.** Un repost, un remontage ou une reprise d'une même découverte compte pour **une** source, pas plusieurs confirmations. On regroupe par découverte d'origine (même créateur ou même média d'origine, ressemblance du média, citation explicite) avant de compter les confirmations. Ce regroupement s'appuie sur la règle déjà appliquée par le copilote (« Vérifié » = au moins deux sites indépendants).
- **Contradictions conservées.** Deux sources qui divergent (position, prérequis, chapitre) restent visibles côte à côte, avec leur date ; on n'écrase pas l'une par l'autre.
- **Vocabulaire de confiance inchangé.** Vérifié / Probable / Non confirmé, plus anti-spoiler à la source sur tout ce qui est collecté.
- **Mêmes garde-fous que la veille LEONIDA RADAR.** Aucun média tiers rehébergé sans droit, on garde le lien vers l'original. Pas de clés ni de jetons côté client. Budget 0 € tant qu'un usage payant n'est pas validé.

### Instagram : à valider avant tout développement

- La connexion Meta officielle et l'accès aux Reels de comptes tiers restent à tester techniquement (API, permissions, conditions d'usage).
- **Aucun connecteur complet avant un test concluant.** Le premier livrable sera un test d'accès documenté (ce qui est possible, ce qui ne l'est pas, à quel coût).
- YouTube, Reddit et les guides web peuvent être prototypés indépendamment d'Instagram.
