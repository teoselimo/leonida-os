# LEONIDA OS — Rapport V0.4 (finition iPhone / iPad)

## Problèmes identifiés (audit du 20/11/2026)
| # | Problème | Gravité |
|---|----------|---------|
| 1 | Build depuis le ZIP V0.3 : `public/tiles/` absent → carte vide, sans message | Bloquant |
| 2 | MapLibre détruit et recréé à chaque changement d'onglet, tuiles rechargées, caméra remise à zéro | Majeur |
| 3 | `<main key={view}>` : tous les écrans remontés à chaque onglet (filtres, recherche perdus) | Majeur |
| 4 | Relevé personnel enregistré avec la fiabilité « vérifié » → badge « Vérifié » affiché | Majeur (confiance) |
| 5 | Données de démo affichées « Officiel » ; un import pouvait se déclarer « officiel » | Majeur (confiance) |
| 6 | Fiche iPhone : fermeture seulement, pas d'agrandissement, conflit avec le défilement interne | Moyen |
| 7 | Accueil surchargé : progression avant l'action, doublons alerte/reco, 5 recos + 6 régions | Moyen |
| 8 | Rotation de la carte à deux doigts (désoriente), pas de retour visuel au toucher sur plusieurs boutons | Mineur |
| 9 | Notification masquant la barre cartographe / le bouton de la fiche sur iPhone | Mineur |
| 10 | Onglets du rail iPad : 38 px de haut (< 44 pt recommandés par Apple) — détecté par les tests | Mineur |

## Corrections
1. Tuiles incluses dans le projet + `prebuild` qui bloque le build si elles manquent (avec la commande de régénération) ; détection à l'exécution (« Fond de carte indisponible · Réessayer »).
2. La carte reste montée en arrière-plan après sa première ouverture (une seule instance MapLibre), position/zoom mémorisés aussi entre deux visites.
3. Seuls les écrans légers (Accueil, Radar, Profil) sont remontés ; l'état de la carte (filtres, recherche, cartographe) est conservé.
4–5. Modèle de fiabilité explicite : officiel / confirmé / signalé / rumeur / **personnel**. Tout relevé (création, import, données V0.3) passe par `asPlayerRecord()` qui force « personnel ». Plus aucune donnée inventée n'est marquée « officiel ».
6. Fiche à deux crans (mi-hauteur / plein écran) qui suit le doigt, fermeture par glissement rapide, toucher sur la poignée = basculer, défilement interne qui passe la main au geste.
7. Accueil recentré sur « Que faire maintenant ? » (une action, une raison, un bouton), puis « Ensuite » (3 + voir plus), alertes dédoublonnées (max 2), progression compacte, régions repliées.
8–10. Rotation désactivée, retours visuels au toucher, zones de sécurité iOS (encoche/paysage), notification en haut sur la carte iPhone, cibles tactiles ≥ 44 px.

## Résultats des tests (`npm run test:all`)
- Typecheck : OK · Build : OK
- 38 tests : **37 réussis, 1 ignoré volontairement** (fiche glissante, propre à l'iPhone, ignorée au format iPad)
  - Unitaires (10) : anti-spoiler ×4, progression/recos ×2, fiabilité/migration ×4
  - iPhone (14) et iPad (13) : 3 parcours essentiels, persistance, anti-spoiler, navigation, carte ×3, fiche glissante, relevés ×2, responsive ×2
- Version empaquetée pour l'hébergement (`out-artifact`) : parcours + carte relancés, 12/12 réussis.

## Limites connues
- Tests exécutés avec Chrome (WebGL logiciel) aux dimensions iPhone/iPad, pas sur Safari iOS réel : à valider sur appareil.
- La version publiée sur claude.ai n'a pas pu être ouverte depuis l'environnement de test ; le même paquet a été testé localement.
