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

## 11. V0.11 « Identité » (22/11/2026, 03:35) — même Artifact

**Audit** : le logo in-app était l'icône d'écran d'accueil (soleil à bandes + palmiers) réduite à 26–38 px : détails illisibles, ressemblance « pin », image matricielle floue. Le bandeau « LEONIDA / Bonne nuit » n'informait de rien. Le bouton flottant recopiait ce logo : il ne disait pas « conversation ». Le badge « Complet » nommait un niveau sans dire ce qu'il protège.

**Fait** : logo de marque vectoriel (tuile à angles continus violet → rose, monogramme L épais + étincelle), net à toute taille ; bouton flottant = icône d'action (bulle de dialogue + étincelle) sur le dégradé de marque, libellé « Demander à LEONIDA » sur iPad ; bandeau d'état de session (mission active + état, alertes prioritaires de l'analyse et nombre vérifié, fraîcheur, ou « Copilote prêt · web actif » / « Analyse en cours… », pastille de couleur) ; zone droite = anti-spoiler explicite « Spoilers · Masqués / Floutés / Visibles » (couleur et icône par niveau, confirmation au toucher) ; plus de doublon du nom de mission entre bandeau et fiche ; iPad : logo seulement dans la barre latérale.

Tests : 222 passés (2 ignorés) ; captures iPhone 393 × 852 et 375 × 667, iPad 1194 × 834.

## 12. V0.12 « Copilote contextuel » (22/11/2026) — même Artifact

### Audit des quatre limites signalées
| Limite | Constat dans le code | Correction |
|---|---|---|
| Catalogue de missions | `missions.ts` reconstruit des noms à partir des titres du RADAR : aucun prérequis, aucun déblocage, aucun manquable structuré | Graphe sourcé `src/data/progression.ts` (chapitre 1) + moteur `src/lib/progress.ts` |
| Progression | `store.tsx` ne garde que lastMission / nextMission / missionsDone / missionInProgress, sans relations | Statuts calculés (terminé déclaré ou déduit, en cours, accessible, potentiellement accessible, verrouillé, inconnu, plus disponible), contexte permanent pour Claude, intentions « j'ai terminé / je l'ai / la suivante » |
| Déclenchement d'Exa | regex « cherche / web » ou Radar muet + question courte : les questions naturelles ne cherchaient pas | Planificateur (appel court à Claude) qui décide et écrit 1–2 requêtes anglaises ; repli heuristique ; reformulation si rien ; cache 30 min |
| Saisie | `<input>` monoligne, 300 caractères | `<textarea>` adaptatif 1 → 6 lignes, 2 000 caractères, brouillon persistant |

### Limites réelles qui demeurent
- **Graphe non exhaustif** : chapitre 1 seulement (missions principales Gear Up → Discharge Time, facultatives et activités de Key Lento). Les missions sans prérequis écrit restent « inconnues » ; celles placées avant une mission faite dans le Story Recap sont « probablement faites » (jamais comptées comme terminées). Pas de lecture de la sauvegarde PS5.
- **Planificateur** : un appel Claude supplémentaire (modèle rapide) par question factuelle, sur le quota de l'abonnement ; si ce planificateur échoue, une règle simple prend le relais.
- **Établissements** : 11 à Key Lento ; 2 seulement ont une position sur la carte (repère gtadb de même nom : The Wonder Whale, The Rusty Anchor) ; les autres ont une indication sourcée en clair ou « position non établie ».
- **Données** : instantané du flux ; Claude ne voit que ce que l'app lui transmet.

### Progression réelle du joueur
La sauvegarde (22/11, 04:03 UTC, écrite par l'app) indique **Don Gone terminée** et « Talk to Lucia » comme prochaine mission (= Recalibration sur la carte, d'après PowerPyx). Elle est plus récente que la consigne « Don Gone en cours » : **elle n'a pas été écrasée**. Les noms de carte (Talk to Lucia, Head to Donnie's Trailer, Fix Your Car, Take Up Mattia's Offer) sont désormais reconnus.

### Preuve d'Exa depuis l'Artifact publié
Les analyses enregistrées par l'app dans la sauvegarde du joueur portent `web: ok, 8 résultats` pour Don Gone et Talk to Lucia : la recherche Exa fonctionne depuis l'Artifact publié (appels réels, sources citées).

### Tests
`tests/contexte.unit.spec.ts` (15) et `tests/contexte.spec.ts` (4 × iPhone, iPad, WebKit) : scénarios A (« je peux faire quoi maintenant ? »), B (« j'ai terminé » → confirmation → déblocages), C (vêtements à Key Lento → référentiel + web automatique + carte), D (activité verrouillée, prérequis sans spoiler), E (emplacement incertain conservé), F (1 000 caractères), G (progression, historique et brouillon après rechargement). Claude et Exa y sont simulés.

## 13. V0.13 « Plus rapide, plus pertinent » (22/11/2026) — même Artifact

### Recherche : un seul appel Claude par question
- **Recherche web native de Claude dans l'Artifact : non disponible.** La documentation de la capacité `sample` (contrat 0.2.98) le dit : Claude « cannot browse » et n'a d'autres outils que les fonctions de la page. Exa reste donc l'outil web.
- **Planificateur supprimé par défaut** (`src/lib/copilot/route.ts`). La décision et la requête anglaise sont calculées localement, sans appel :
  1. conversation ou action dans l'app → pas de web ;
  2. données sourcées suffisantes (progression, référentiel d'établissements hors question d'évaluation, fiche officielle ou recoupée, « montre-moi sur la carte ») → pas de web, sauf demande explicite ;
  3. sinon, question factuelle → Exa automatique. Requête construite avec un glossaire FR→EN, les noms propres et la mission si la question en dépend, puis une reformulation si rien ne sort.
- L'ancien planificateur reste activable pour comparer (Profil › Recherche web › « Comparer »).
- **Mesures** : chaque réponse enregistre ses appels Claude, ses recherches, le temps jusqu'au premier texte et le temps total (`state.metrics`, 30 dernières, sauvegardées et synchronisées). Les médianes s'affichent dans Profil › Recherche web.
- **Banc simulé** (`npx tsx scripts/bench-router.ts`, 10 questions de session) :
  - routage local : 10 appels Claude, 5 recherches ;
  - planificateur : 19 appels Claude, 9 recherches.
  - Avec un modèle de délai de 1,5 s par appel et 2,5 s par recherche, cela donne environ 27,5 s contre 51 s cumulés. C'est une estimation : le planificateur simulé répond toujours « chercher ». La mesure réelle vient de l'Artifact publié.
- **Consigne** : plus de « je n'ai pas l'information ici ». Claude dit laquelle des situations s'applique :
  - le web n'a pas été consulté, et il propose de vérifier ;
  - le web a été consulté sans résultat fiable ;
  - le web est indisponible.

### Cartographie : sources étudiées
| Source | Ce que c'est | Licence | Décision |
|---|---|---|---|
| github.com/rolux/gtadb.org (map.gtadb.org) | Repères communautaires (3 754, dont 3 663 positionnés) au format `landmarks.json`, coordonnées de jeu, tags | Code MIT, données et tuiles **CC BY 4.0** ; « ne pas interroger le site en direct, faire un `git pull` » | **Conservée** (déjà le fond de carte et les repères). V0.13 garde désormais les **types de commerce** `#clothes`, `#hair`, `#tattoos`, `#modshop`… qui étaient filtrés. |
| api.gtadb.org | API Flask du même dépôt (`/landmarks`, `/geocode`, `/elevation`, `/staticmap`) | idem | Non utilisée : l'Artifact ne peut pas faire d'appel réseau (CSP), et l'instantané du dépôt contient les mêmes données. |
| github.com/navanem/gta6-leonida-atlas | Atlas MapLibre local-first, dérivé de gtadb (commit du 17/11, plus ancien que le nôtre) | Code **AGPL-3.0**, données CC BY via gtadb | Code non repris (licence). On adopte sa méthode : « unknown locations remain unknown ». |
| gtadb.**net** (/gta-6-map/interactive) | Site distinct de gtadb.org | Non vérifiable : page inaccessible depuis cet environnement | Non intégré, pour ne pas confondre les deux sites. |
| gtamap.io | Carte tierce | Non vérifiable : page inaccessible ici | Non intégrée. |
| PowerPyx — clothing stores | Guide : 67 boutiques par type et par comté, plus des captures | Contenu protégé | Seuls les **faits** sont repris (nom, type, comté), avec un lien. Ni capture ni texte. |

### Établissements : trois niveaux de précision (`src/lib/places.ts`)
- **Point** : position placée par le joueur en jeu, ou repère gtadb portant le même nom (The Wonder Whale, The Rusty Anchor).
- **Zone probable** : rayon de quelques centaines d'unités, jamais un quartier. Elle vient de deux types d'indices :
  - un voisin cité par la source (« à l'est de la maison de Jason » pour Chuck's) ;
  - un type de commerce gtadb unique dans le quartier et cohérent avec la description (#hair au sud pour Barnacle Beauties, #tattoos pour The Inked Mermaid, #modshop au sud pour Coastal Auto Care).
- **Position inconnue** : description et source, sans point (Billie's, Key Lento Kahuna, Leroy's). Le repère `#clothes` non nommé de Route 1 n'est attribué à aucune boutique : rien ne dit laquelle c'est.
- **Recherche de la carte** : les établissements confirmés apparaissent en premier, avec leur précision, même sans coordonnées.
- **Zone de quartier supprimée** : les actions de l'IA ouvrent la liste de la carte (`show_place.query`) ou l'établissement (`show_place.estId`).
- **« Je l'ai trouvé : le placer »** : le joueur pose le point depuis la carte. Il est enregistré dans la sauvegarde (`pins`, date, provenance « joueur »), toujours affiché, et peut être corrigé ou retiré.
- Ajouts PowerPyx (comté de Mariana, île non précisée) : Nifty Threads Island Wear et Lost Mines Souvenirs, « signalé ».
- **Plus tard — capture PS5** : une capture de la carte en jeu ne sera convertie en coordonnées qu'après un calage vérifié sur plusieurs repères connus. Pas d'extraction automatique annoncée sans ce calage.

### Accueil « À découvrir maintenant » (`src/lib/discover.ts`, `DiscoverNow.tsx`)
- Placé juste sous la mission principale, avec 4 suggestions et « Tout voir ».
- **Sources des suggestions** :
  - activités facultatives accessibles selon le moteur de progression ;
  - fiches Radar actionnables (argent, objets, armes, secrets) ;
  - véhicules récupérables.
- **Ordre** : pertes définitives vérifiées, puis découvertes rares, puis activités annexes. Une arme rare n'est jamais « haute » sans perte documentée.
- **Chaque ligne** : pictogramme, catégorie, statut (vérifié / probable), point de non-retour nommé sans spoiler, nombre de sources.
- **Détail dépliable** :
  - où et condition ;
  - liens vers les sources ;
  - « Fait », avec confirmation ;
  - « Voir sur la carte », seulement si la position est fiable.
- **Sans doublon** avec « Rien à manquer » (manquables de la mission), les objectifs, « Avant de la lancer » et « Envie de t'amuser ».
- **« Fait »** écrit dans `state.done`, en gardant la date. Une activité facultative cochée ouvre sa suite (Get Shirley's Rum → Steal the Scooter) sans déclarer de mission principale.

### Chat
- À l'ouverture et après rechargement, le dernier message s'affiche directement, sans animation interrompue.
- Le fil suit le contenu (streaming, bulles qui grandissent, clavier iOS, ressort de la fiche) **seulement si le joueur est en bas**. Seul un geste du joueur le décroche.
- Un bouton « Dernier message » apparaît quand quelque chose arrive pendant la lecture.
- Correction annexe : la barre du mode cartographe était cachée par le dock sur iPhone ; elle est maintenant au-dessus.

## 14. V0.14 « Stabilisation et refonte UX » (22/11/2026) — même Artifact, version `1795374071-b58f`

Suite de l'audit UX V0.13 (note 5/10). Aucune donnée de la veille supprimée, stockages inchangés.

**P0 — fiabilité**
- Anti-spoiler appliqué à la source (`src/lib/spoiler.ts`) : plan de session, « Avant de continuer », Guide, fiches, chat (texte, actions, sources, suggestions) et sortie du moteur. En strict, une mission future est remplacée par « une mission à venir ».
- Bouclier : un toucher ouvre un menu ; baisser la protection demande une confirmation qui ne révèle rien.
- Accueil : « Rien à manquer », « À découvrir » et « Avant de la lancer » fusionnés à l'affichage (`src/lib/before.ts`), sans fusion des données. Quatre natures distinguées (pendant la mission, avant, disparaît plus tard, opportunité). Une seule mention du point de non-retour. Aucune promesse « rien à manquer ».
- Après « Terminée » : `progressDelta` montre missions accessibles, potentielles, activités ouvertes, contenus perdus et prochain point de non-retour ; le joueur choisit la suite.
- Vocabulaire de confiance unique : Vérifié / Probable / Non confirmé (« Vérifié » exige deux sites indépendants). Précision des lieux : placée par toi / repère communautaire / zone estimée / position inconnue.
- Version centralisée (`src/lib/version.ts`), affichage du stockage réel (compte Claude via l'Artifact, ou navigateur seul).

**P1 — UX**
- Dock à cinq positions Accueil | Carte | LEONIDA | Guide | Partie ; bouton flottant supprimé.
- Carte : recherche toujours visible, filtres Commerces / Voitures / Repères / Plus, Cartographe et anti-spoiler dans le menu « ⋯ », résultats en feuille basse avec précision et action (Voir / Zone / Placer). Premier cadrage : quartier documenté de la mission (≥ 5 repères communautaires), sinon dernière vue. Pas de position du personnage.
- LEONIDA : en-tête court (contexte de mission), menu « ⋯ » (mode, réponses approfondies, Effacer avec confirmation), une ligne de confiance repliable par réponse, deux actions visibles au plus. Demi-fiche depuis la carte (iPhone) ; panneau à côté de la carte (iPad).
- Guide (ex-Radar) et Partie (ex-Profil) : progression, journal daté « Récupéré / Fait » avec annulation par type (`src/lib/journal.ts`), Réglages, Avancé (diagnostic Exa, mesures, sauvegarde, démo, crédits).
- « Fait » unifié avec annulation de 5 s ; « Réinitialiser la démonstration » conserve désormais aussi positions, analyses et mesures.

**Tests** : `tests/v014.unit.spec.ts`, `tests/v014.spec.ts` (iPhone, iPad, WebKit) ; anciens tests adaptés.
**À vérifier sur l'iPhone réel** : clavier avec message long, demi-fiche du chat depuis la carte, synchro iPhone ↔ iPad, lisibilité des puces de filtres.

## 15. V0.14.1 « Chat iPhone et iPad » (22/11/2026) — même Artifact, version `1795378386-05ba`

- Chat iPhone : la bande sombre venait de `.ai__input { background: #0d0a16 }` (ajout V0.14), un rectangle opaque plein cadre sous la saisie, prolongé par la marge de la zone d'accueil. Fond transparent (hérite du verre arrondi de la fiche), marge basse = zone d'accueil seulement, ramenée à 8 px clavier ouvert (`data-kb` sur la fiche), bouton Envoyer aligné sur le champ (44 px).
- « Salut » / « merci » : réponse locale immédiate (mission du joueur seulement), sans Claude, sans web, sans contexte narratif, sans badge de confiance. Règle ajoutée au prompt : ne pas dérouler spontanément conséquences, pertes ou point de non-retour ; niveau de preuve réel sinon « d'après une source ».
- iPad (proposition A retenue contre B « onglets en haut / dock bas ») : rail compact de 84 px ; LEONIDA devient une action en bas du rail (plus un onglet) ; en paysage le copilote est un panneau intégré de 360 px et le contenu se range à côté (carte comprise) ; en portrait, volet par-dessus avec voile, refermable sans perdre la conversation ; accueil en deux colonnes (container queries) avec « Ta partie » ; inspecteur de carte (300 px) rempli au repos par les établissements confirmés du quartier de la mission.
