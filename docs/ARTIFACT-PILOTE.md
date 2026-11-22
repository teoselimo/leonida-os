# LEONIDA OS — Pilote Claude dans un Artifact (issue #10)

Branche `experiment/claude-artifact`. **`main` et GitHub Pages ne sont pas modifiés.**
Artifact pilote (privé tant que tu ne le partages pas) : https://claude.ai/artifact/AdLjrvTSQdxHGewPtWa8YS

## 1. Ce qui a été vérifié

| Question | Réponse |
|---|---|
| Un Artifact peut-il appeler un vrai Claude sans clé API ? | **Oui.** Capacité `sample` du runtime Artifact (contrat 0.2.98). Les appels consomment l'usage Claude **de la personne qui ouvre l'Artifact**, dans les limites de son abonnement. Aucune clé, aucun proxy, aucune facture API. |
| Faut-il un accord ? | Oui : au premier appel, Claude demande à l'utilisateur d'autoriser l'Artifact. En cas de refus, l'app répond en mode direct et le dit. |
| L'app complète tient-elle dans un Artifact ? | Oui : export statique Next (190 fichiers, 22,4 Mio, dont les tuiles de la carte et les 3 663 lieux). Limites : 256 fichiers, 20 Mio par fichier, 64 Mio au total. |
| La carte MapLibre fonctionne-t-elle ? | Oui : tuiles, lieux et icônes sont des fichiers de l'Artifact (aucun serveur de polices ou de glyphes : icônes et libellés dessinés sur canvas). |
| Le flux LEONIDA RADAR en direct ? | **Non.** La politique de sécurité des Artifacts bloque toute requête vers un autre domaine (GitHub compris). L'Artifact embarque donc un **instantané daté** de `radar.json` (branche `data`), affiché comme tel (« Instantané de la veille », bandeau dédié), jamais présenté comme live. |
| Sauvegarde de la progression ? | Oui : localement (comme avant) **et** dans le stockage personnel de l'Artifact (`db`, sous-arbre privé `data/users/<id>/`, lié au compte Claude). La copie la plus récente l'emporte au chargement. Export / import manuel dans Profil. |

## 2. Limites des Artifacts (et alternative retenue)

- **Pas de flux en direct** → instantané daté ; pour le rafraîchir : `node scripts/artifact-build.mjs` puis republier (section 6). Piste future : un connecteur (capacité `mcp`) côté utilisateur, non utilisée ici.
- **Pas de `window.open` ni d'`alert`** → liens sources ouverts par un lien `<a target="_blank">`.
- **Chemins commençant par `_` réservés** par l'hébergeur → le build renomme `_next/` en `nx/` et réécrit les références.
- **Claude sans mémoire ni prompt système** → les règles partent en premier tour « user », l'historique (8 derniers messages) est renvoyé à chaque question.
- **Quota** : celui de l'abonnement de l'utilisateur ; s'il est atteint, réponse directe + message honnête.
- **Pas d'installation PWA ni de mode hors ligne** dans l'Artifact (la version GitHub Pages les conserve).
- **Validation iPhone réel** : non faite par Claude (Claude in Chrome non connecté, pas d'appareil). Les tests tournent sous Chromium et sous WebKit (moteur de Safari) aux formats iPhone et iPad — ce n'est pas un iPhone réel.

## 3. Architecture portable

```
UI (React)                src/components/AiCopilot.tsx, écrans, carte
 └─ Profil / progression  src/lib/store.tsx              (indépendant du fournisseur)
 └─ Connaissance          src/lib/ai/engine.ts           recherche déterministe, preuves, actions autorisées
                          src/lib/poi.ts                 catégories et recherche des 3 663 lieux
 └─ Conversation          src/lib/copilot/engine.ts      preuves → LLM → validation → actions contrôlées
                          src/lib/copilot/context.ts     contexte joueur + preuves (bornées)
                          src/lib/copilot/prompt.ts      règles versionnées (PROMPT_VERSION)
 └─ Fournisseur LLM       src/lib/copilot/transports/
                            claudeArtifact.ts   ACTIF  — seul fichier qui connaît window.claude (avec runtime/cloud.ts)
                            claudeApi.ts        INACTIF — futur backend API, désactivé par défaut
```

Garde-fous appliqués à **chaque** réponse de Claude :
- il ne voit que des preuves issues de LEONIDA RADAR et du contexte joueur ; les articles collectés sont marqués comme données, jamais comme consignes ;
- tout nombre absent des preuves (récompense, prix, montant…) fait **écarter** la réponse au profit de la réponse vérifiée ;
- les actions (carte, fiche) sont choisies **par index** dans la liste proposée par l'app ; les sources, uniquement parmi les identifiants de preuves ;
- niveau de confiance limité à officiel / recoupé / signalé / non établi / déclaré par toi ;
- les repères gtadb restent « repère communautaire, non confirmé comme interactif en jeu ».

## 4. Tests

- `tests/pilote.unit.spec.ts` (13) : lieux (24/7 Supermarket, Wonder Whale, The Rusty Anchor à Key Lento, « station Key Lento »), réponses du moteur, protocole de sortie, requête envoyée, suivi, rejet des chiffres inventés, filtrage des actions et sources, consentement refusé / quota.
- `tests/pilote.spec.ts` (7 parcours × iPhone, iPad, WebKit) avec un **runtime Artifact simulé** : Donnie, Penumbra + suivi, magasin à Key Lento, arme gratuite, action → fiche de lieu, « C'est fait » sauvegardé (local + `db`) puis restauré, aller-retour IA ↔ carte sans recréer la carte ni perdre les filtres.
- Ces tests prouvent le câblage, **pas** la qualité des réponses du vrai Claude : elle se vérifie dans l'Artifact publié (section 5).

## 5. Vérification sur ton compte (iPhone, app Claude)

Ouvre l'Artifact, accepte l'autorisation à la première question, puis :
1. « Je suis sur le point de lancer Find Donnie's Package. »
2. « Où trouver la Penumbra FF ? » puis « Et comment je la garde définitivement ? »
3. « Je cherche un magasin à Key Lento » → bouton carte.
4. « Quelle arme gratuite puis-je récupérer maintenant ? »
5. « Où est The Rusty Anchor à Key Lento ? » → fiche du lieu.
6. Accueil → « C'est fait » sur une recommandation, ferme et rouvre l'Artifact.
7. Depuis la carte, ouvre l'IA, suis une action, reviens : filtres et conversation conservés.

Chaque réponse rédigée par Claude porte la mention « Rédigé par Claude … à partir des données LEONIDA RADAR ».

## 6. Rafraîchir l'instantané

```
node scripts/artifact-build.mjs   # récupère origin/data:radar.json, build, prépare out-artifact/ + manifest.json
```
Puis republier les fichiers de `out-artifact/` sur le même Artifact (les tuiles ne changent pas : seuls `index.html`, `nx/…` et `data/radar.json` sont à renvoyer).

## 7. Migration vers l'API Claude (quand une dépense sera décidée)

Rien n'est activé aujourd'hui (budget 0 €). Le jour venu :
1. Backend (ex. `proxy/`) : authentification de l'utilisateur, clé API **côté serveur uniquement** (jamais `NEXT_PUBLIC_*`, localStorage, Git ou logs), quotas atomiques par utilisateur, plafond de dépense mensuel, journalisation sans contenu personnel.
2. Endpoint `POST { messages, tier }` → flux SSE ou texte, même protocole `réponse @@@ {json}`.
3. Côté app : `NEXT_PUBLIC_AI_API_ENABLED=1` et `NEXT_PUBLIC_AI_API_URL=https://…` ; `pickTransport()` bascule seul sur `claudeApi.ts`. Moteur de connaissance, prompts, validation et UI restent identiques.
4. Le flux live redevient accessible (hors Artifact) : plus d'instantané.

Ce qui distingue les deux : l'abonnement Claude grand public (usage personnel dans l'Artifact) **n'est pas** une clé API ; l'API est un contrat distinct, facturé à l'usage.

## 8. V0.8 « En partie » (22/11/2026) — même Artifact, republié

Objectif : utiliser LEONIDA pendant une session de jeu, sur iPhone et iPad.

| Fonction | État | Détail |
|---|---|---|
| Copilote naturel (#14) | **Opérationnel** | Nouvelles consignes : Claude mène la conversation (ton de pote, réponses courtes adaptatives, messages elliptiques compris, 16 derniers échanges). Le moteur LEONIDA fournit des faits vérifiés et des actions possibles, plus un texte à reformuler. Garde-fous conservés (chiffres hors preuves rejetés — sauf petits nombres ≤ 20 de la conversation —, actions par index, sources par id). |
| Anti-spoiler aucun / léger / complet | **Opérationnel** | Puce sur chaque écran (toucher = niveau suivant) et Profil ; transmis à Claude ; ancien réglage migré. |
| Missions terminée / en cours / objectifs | **Opérationnel** | « Mission en cours » déclarée par le joueur, jamais déduite ; « Je l'ai terminée » demande confirmation. Objectifs facultatifs cochables (vérifié / incertain / noté par toi), sauvegardés (local + stockage personnel). |
| « Rien à manquer » | **Opérationnel** (qualité à juger en vrai) | Claude analyse les fiches LEONIDA RADAR de la mission (+ web si branché). Chaque point doit citer une preuve existante ; « vérifié » exige une fiche officielle ou recoupée, sinon « incertain ». Bouton « + Objectif » sur chaque point. |
| Recherche web (Exa) | **Branché (22/11, 00:50)** | Connecteur Exa ajouté au compte. Format réel vérifié par un appel Exa depuis la session de développement : blocs texte « Title / URL / Published / Author / Highlights » séparés par « --- », champ `objective` obligatoire (absent de la 1re version : corrigé en V0.8.1). L.appel depuis l.Artifact lui-même reste à confirmer sur l.iPhone (1re recherche = demande d.accord). Un résultat web seul n'est jamais « officiel » ni « vérifié ». |
| IA → carte (#15) | **Opérationnel** | Commande acquittée (`data-place-ack`), lieu ou zone introuvable signalé par une notification ; bouton carte conservé quand le joueur demande « montre-moi ». Le lieu choisi reste visible malgré un filtre. |
| Carte lisible (#13) | **Amélioré** | Seuils de zoom entiers (MapLibre filtre au zoom de tuile : 3,4 valait 4) ; repères dès la vue d'ensemble, commerces / stations / garages dès le quartier, noms un cran après. |
| Scroll du chat iPhone (#12) | **Opérationnel** | Fiche IA déplaçable uniquement par sa poignée, un seul conteneur de défilement, bouton Fermer ; les autres fiches ne volent plus le geste d'un contenu imbriqué qui peut défiler. |
| Données | Instantané du 21/11/2026 21:44 UTC | Toujours pas de flux live dans un Artifact. |

Tests : `tests/enpartie.unit.spec.ts` (16) et `tests/enpartie.spec.ts` (4 parcours × iPhone, iPad, WebKit). Suite complète : 200+ tests.
Non vérifiable ici : rendu et gestes sur iPhone réel, ton des réponses du vrai Claude, réponses réelles d'Exa.

## 9. V0.9 « Préventif » (22/11/2026, 01:15) — même Artifact

| Fonction | État | Ce qui a réellement été vérifié |
|---|---|---|
| Progression corrigée | **Fait** | Stockage personnel de l'Artifact (`data/users/<id>/progress`) réécrit à la demande du joueur : Swamped terminée, Don Gone prochaine mission **non lancée**. Relu après publication : intact. |
| Écran mission | **Opérationnel** | État À venir / En cours / Terminée (confirmation), analyse, alertes prioritaires, question libre, objectifs. Tests iPhone, iPad, WebKit (Playwright). |
| « Rien à manquer » préventif | **Opérationnel** | Lancé automatiquement une fois par mission, stocké par mission (jamais mélangé). Deux recherches Exa (déroulé + manquables), extrait ciblé des pages longues. Chaque élément cite ses preuves ; **statut calculé par l'app** : fiche fiable ou ≥ 2 sites distincts = confirmé, divergence = contradictoire, sinon une source. |
| Détection de l'arme de Don Gone | **Données vérifiées, rendu Claude à confirmer** | Les deux requêtes exactes de l'app, lancées sur le vrai Exa le 22/11, renvoient 7 pages qui citent le revolver du coffre (PowerPyx, wiki, GTABase, GTA BOOM, Game8, ViceBoard, CryptoGames). Sur 3 d'entre elles, l'info est au-delà du 1 200ᵉ caractère : l'extrait ciblé la conserve (test unitaire). Que Claude la remonte en alerte, c'est ce que le joueur verra sur l'iPhone. |
| Exa depuis l'Artifact publié | **Non vérifiable d'ici** | Diagnostic réel dans Profil › Recherche web : vrai appel, statut, nombre de résultats lus, taille brute, durée. Aucune simulation. Le premier appel déclenche la demande d'accord du connecteur. |
| Réponses | Consignes renforcées | Court par défaut + bouton « Détaille » ; confirmé / contradictoire / une source / hypothèse ; anti-spoiler strict appliqué aux guides web (action de jeu sans intrigue) ; puces de sources visibles. |

Tests : 219 passés (2 ignorés) — dont `tests/preventif.unit.spec.ts` (9) et `tests/preventif.spec.ts` (3 × iPhone, iPad, WebKit). Claude y est simulé ; le web y est absent (l'app doit le dire).

## 10. V0.10 « Compact » (22/11/2026, 02:45) — même Artifact, renommé « LEONIDA OS »

**Modifié** : en-tête d'accueil d'une ligne (marque + salutation + anti-spoiler réduit) à la place de « Ta session Leonida » ; bandeau « Instantané du … » retiré de l'accueil (toujours visible dans le Radar) ; fiche mission resserrée ; « Rien à manquer » = une seule alerte visible, le reste dans « Voir plus », un point passé en objectif n'est plus répété, résumé de Claude et ligne Radar par défaut retirés, sources en texte discret ; champ de question et bouton « Préparer / Aide en mission » retirés de la fiche (le bouton LEONIDA flottant est la seule entrée conversationnelle) ; bouton flottant 56 px aligné sur la barre de navigation, respect des safe areas, vérifié à 375 × 667 et 393 × 852 (jamais sur la navigation) ; nouvelle icône (soleil de Leonida + L en tracé de route + point de destination) en 16 → 1024 px, favicon SVG, manifeste ; instantané du flux du 22/11 01:43 UTC.

**Icône d'écran d'accueil — limite Claude** : sur iPhone, l'icône d'un raccourci « Sur l'écran d'accueil » vient du document de premier niveau (la page claude.ai), via ses balises `apple-touch-icon` / manifeste. LEONIDA tourne dans un cadre isolé sur un autre domaine : ses propres balises (présentes depuis la V0.4) sont ignorées, ce que confirme l'icône générique observée. Seuls réglages exposés par l'hébergeur : le **titre** de l'Artifact (renommé « LEONIDA OS », probable nom proposé par iOS) et un mot d'icône d'onglet générique (`icon`) dont l'effet sur l'écran d'accueil n'est pas documenté. Contournements réels : Raccourcis iOS (action « Ouvrir l'URL » + image personnalisée — mais l'ouverture se fait alors dans Safari, avec sa barre) ; version GitHub Pages (icône respectée, mais sans Claude ni Exa).

Tests : 222 passés (2 ignorés), dont un test de compacité (en-tête < 56 px, mission < 260 px du haut, une seule alerte, bouton sans chevauchement).
