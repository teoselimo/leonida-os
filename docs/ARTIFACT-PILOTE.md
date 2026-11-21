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
