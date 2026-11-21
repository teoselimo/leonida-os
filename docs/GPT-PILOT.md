# LEONIDA BRAIN — GPT privé (préparation API, NON activée)

Branche : experiment/openai-gpt-leonida. Base : experiment/claude-artifact, PR #11 de Claude. Les secrets et l'activation réelle sont exclusivement à la charge du propriétaire ; aucun appel API n'est réalisé par le build ni par les tests.

## Objectif / choix du modèle
- Profil du joueur + contexte GTA VI sourcé + personnalité naturelle / questions de suivi.
- Modèle initial : **gpt-6.1-terra**, coût standard API public (novembre 2026) : $0,50 / 1M tokens entrants et $2,50 / 1M sortants. Alternatives approuvées dans le serveur : gpt-6-luna et gpt-6.2-sol. Vérifier les tarifs avant tout changement.
- 20 questions/jour × 30 jours × (3 000 entrants, 400 sortants) : **~$1,50 HT/mois** pour Terra, hors effets du raisonnement et des contextes plus longs. Ce chiffre n'est pas une garantie de facture.
- Budget pilote : **$2/mois configurables** dans le Worker, pas $2/jour. Si tu ne veux aucune dépense : conserver AI_ENABLED=0.
- Tarif source : https://developers.openai.com/api/docs/pricing . API distincte de ChatGPT Plus. Aucun accès à la mémoire de cette discussion ChatGPT n'est transmis automatiquement.

## Architecture
- Frontend statique Next / GitHub Pages → transport GPT SSE → Cloudflare Worker privé → OpenAI Responses API.
- Secrets **OPENAI_API_KEY** et **LEONIDA_ACCESS_TOKEN** exclusivement dans Cloudflare. Le second est un code d'accès LEONIDA distinct de la clé OpenAI, saisi par l'utilisateur dans l'UI et conservé **uniquement en sessionStorage**. Ne jamais y coller une clé OpenAI.
- L'Origin est contrôlé, mais **CORS n'est pas une authentification**. Le jeton LEONIDA long et aléatoire sert d'authentification privée de ce prototype. Pour une app publique : comptes/session + anti-abus.
- La limite de dépenses **estimées** est réservée *avant* chaque appel dans un Durable Object SQLite Cloudflare (transactions synchrones) : dépense confirmée + réservations en cours + estimateur majorant les tokens. Après la réponse, la réserve est ajustée suivant l'usage réellement communiqué par OpenAI. Si l'usage manque, la réserve reste comptabilisée. Ce mécanisme concerne uniquement ce Worker, **pas** les autres projets/API clés OpenAI ni taxes, évolutions tarifaires ou frais hors tokens.
- Quotas également atomiques par minute et mois. Le budget est calculé en USD et ne garantit pas une limitation stricte au niveau de l'ensemble du compte OpenAI.
- Règles GTA VI côté serveur + preuves client ciblées. Ne pas halluciner : une validation des numéraux existe côté client mais n'est **pas** une garantie exhaustive contre les faits faux. Exiger tests humains sur le gameplay.

## Activer sur ton compte (quand tu décides d'utiliser l'API)
1. Créer une clé API dans https://platform.openai.com/api-keys avec un plafond/alertes au niveau du projet OpenAI ; la plateforme API et ChatGPT sont facturés séparément.
2. Créer un compte gratuit Cloudflare et un Worker ; l'exemple utilise un Durable Object SQLite (vérifier les limites et la disponibilité Free selon le compte).
3. Depuis un ordinateur dans le dépôt : copier proxy/wrangler.openai.toml.example vers proxy/wrangler.openai.toml, basculer AI_ENABLED="1", choisir MODEL, MONTHLY_BUDGET_USD. Garder le fichier local non commité.
4. Définir deux secrets avec Wrangler, indépendamment :
   - npx wrangler secret put OPENAI_API_KEY -c proxy/wrangler.openai.toml
   - npx wrangler secret put LEONIDA_ACCESS_TOKEN -c proxy/wrangler.openai.toml
   Utiliser un token long et aléatoire pour LEONIDA_ACCESS_TOKEN et le conserver dans un gestionnaire de mots de passe.
5. Déployer : npx wrangler deploy -c proxy/wrangler.openai.toml. L'endpoint sera : https://TON-WORKER.workers.dev/v1/chat (ne pas le deviner, récupérer l'URL réelle du déploiement).
6. Configurer **au build du frontend uniquement** :
   NEXT_PUBLIC_GPT_ENABLED=1 et NEXT_PUBLIC_GPT_PROXY_URL=https://TON-WORKER.workers.dev/v1/chat
   La PWA n'a jamais l'accès à OPENAI_API_KEY.
7. Dans LEONIDA AI : « Activer GPT » → saisir le code d'accès LEONIDA (pas une clé OpenAI) → tester un échange. Le bouton « Déconnecter GPT » supprime le code de la session.
8. Désactivation immédiate : AI_ENABLED=0 puis déployer ; sans clé, quota, ou Worker, app repasse en mode direct/Artifact.

**Aucune activation, dépense, ni URL définitive n'a été effectuée dans cette branche.**

## Critères de GO et bugs du chantier
- #12 : scroll chat iPhone (geste de fermeture limité à la poignée et bouton X).
- #13 : commerces visibles plus tôt (zoom quartier), pas de surcharge des 3663 repères. Les règles de zoom seules ne suffisent pas à atteindre l'expérience GTA VI : l'index catégoriel et l'essai iPhone restent nécessaires.
- #14 : conversation naturelle et contextualisée, ne pas réécrire mécaniquement le moteur déterministe.
- #15 : IA → carte/POI, bonne catégorie + bonne zone + caméra, pas de focus manqué.
- #9 : fiabilité GTADB, statut non confirmé en jeu.
- #8 : backend sécurisé et budget.
- Tests réels à faire par l'utilisateur : 1) Find Donnie's Package, 2) Penumbra FF + suivi, 3) 24/7 Supermarket Key Lento → carte, 4) 10 messages et scroll iPhone, 5) retour IA ↔ carte. La CI seule ne vérifie pas la qualité conversationnelle ni les gestes sur iPhone physique.

**La branche expérimentale ne doit pas être fusionnée dans main avant GO utilisateur.**
