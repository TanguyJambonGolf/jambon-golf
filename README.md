# Appli Golf - étapes 1 et 2 (base, moteur de calcul, appli de saisie sur téléphone)

## Contenu
- `db/schema.sql` : tables, règles d'intégrité, journal des modifications, saisie ouverte par code de groupe, compte admin.
- `db/test/` : scénario de test de la base (voir plus bas).
- `db/seed.sql` : 11 parcours (par, index, tees hommes avec CR et slope), 22 joueurs, réglages (9 cartes retenues, 4 parties par invité).
- `engine/engine.js` : toutes les règles de calcul (handicap de jeu, coups reçus, Stableford, croix, carte gross, classements jour et annuel, invités, nearest).
- `engine/engine.test.js` : 21 tests. Lancer avec `npm test` (Node 18 ou plus, aucune installation).
- `data/courses.json`, `data/players.json` : parcours et joueurs en JSON (source du seed, utilisés par le mode démo).
- `app/` : l'appli de saisie (étape 2), pages web simples sans installation ni compilation.

**Pour mettre en ligne et tester, suivre `GUIDE-MISE-EN-LIGNE.md` (pas à pas).**

## Installer la base (Supabase)
1. Créer un projet Supabase.
2. Éditeur SQL : exécuter `db/schema.sql`, puis `db/seed.sql`.
3. Dans l'éditeur SQL : `select init_member_code('un-code-long-et-secret-24-car');` (c'est le code contenu dans le lien WhatsApp).
4. Authentication : créer le compte admin (e-mail + mot de passe), puis ajouter sa ligne dans `app_users` (`insert into app_users (user_id, player_id) values ('<id du compte>', '<id du joueur>')`).
5. Si le lien fuite : l'admin change le code (`admin_set_member_code`) et renvoie un nouveau lien.

## Appli de saisie (étape 2)
Essayer tout de suite en mode démo (données fictives, rien n'est envoyé) : depuis le dossier du projet, `python3 -m http.server 8000`, puis ouvrir `http://localhost:8000/app/?demo` (sur téléphone : l'adresse de l'ordinateur sur le réseau local). Choisir un nom, ouvrir la journée du jour, saisir, passer à vérifier, changer de nom pour valider.

Mise en ligne : héberger le dossier du projet entier (le dossier `app/` importe `engine/` et `data/`) sur un hébergeur de pages statiques gratuit (GitHub Pages, Netlify, Cloudflare Pages). Puis :
1. Renseigner `app/config.js` avec l'adresse du projet Supabase et la clé publique « anon ».
2. Le lien à envoyer une seule fois dans le groupe WhatsApp : `https://<ton-site>/app/#c=<le code>`. Le code est dans la partie après `#c=`, qui n'est jamais envoyée à un serveur et disparaît de la barre d'adresse à l'ouverture.
3. Sur iPhone : Partager > Sur l'écran d'accueil, pour l'avoir comme une appli.

Fonctionnement : choix du nom une seule fois (retenu sur le téléphone) ; saisie trou par trou pour tout le groupe, + et − partent du par, la croix ✗ apparaît quand le score ne rapporte plus de point (= ramassé) ; l'appli fonctionne uniquement en ligne (décision du 27/11/2026) : une saisie est envoyée tout de suite, et réessayée toute seule si la connexion saute quelques secondes, sans rien garder sur le téléphone ; les saisies des autres s'affichent toutes les 10 secondes ; récap par joueur, « passer à vérifier » puis validation par un autre joueur du groupe. Hors tirage : consultation seulement.
Tests : `npm test` (moteur, file hors ligne, accès Supabase simulé, droits). Pas encore testé sur ton vrai Supabase : à faire en premier au branchement.

## Classement, tirage et administration (étapes 3 à 5)
- **Classement** (onglet) : classement annuel par saison (touche un joueur pour sa fiche : cartes, cartes retenues, carte gross, moyenne), nearest annuel, suivi des invités (parties jouées sur le plafond), partage WhatsApp.
- **Admin** (onglet, compte e-mail + mot de passe créé dans Supabase, voir plus haut) : nouvelle journée avec tirage (présents, invités ajoutés à la main, groupes de 3 ou 4 (petits d'abord), groupes et paires imposés, horaires réglables par golf, échange de joueurs, tee et index par joueur, marqueur par groupe, texte WhatsApp), gestion d'une journée (tee, retrait, rouvrir ou valider une carte, remise au net d'une carte gross par erreur, terminer la journée), carte gross depuis la fiche du joueur, réglages (cartes retenues, plafond invités), lien d'accès WhatsApp (génère un nouveau code et le lien à envoyer).
- Tirage : groupes de 3 ou 4, toujours les petits groupes en premier et les groupes de 4 en dernier. On peut imposer des joueurs dans un groupe précis, imposer des paires (ou trios) à garder dans un même groupe, ajuster le 1er départ, l'intervalle entre départs et l'heure de chaque groupe, et mémoriser les horaires de chaque golf.
- Mode démo : 3 journées passées fictives pour voir le classement ; connexion admin avec n'importe quel e-mail.

## Règles à retenir
- HJ = arrondi de index x slope / 113 + (CR - par). Stableford à 100 %.
- Carte gross : sort définitivement du net. Remplacer la carte gross ne rend jamais l'ancienne au net.
- Cartes validées uniquement dans les classements annuels. Scores verrouillés après validation.
- Invités : jamais dans l'annuel ni les nearest, plafond de 4 parties par an.
- Saisie ouverte à tout membre qui a le code ET qui est dans le tirage de la journée (sinon consultation seulement). Validation d'une carte par un autre joueur du même groupe, carte complète, puis verrouillage.
- Le nom choisi à l'ouverture de l'appli est déclaratif : le journal trace qui a modifié quoi, il ne prouve pas l'identité.

## Hypothèses à confirmer
- Gymkhana (tee blanc par défaut) et Paradis (tee Men) : confirmés par Tanguy, CR/slope à recontrôler sur une carte récente.
- Les ratings viennent de la Fédération mauricienne de golf (hommes) ; les cartes d'archive de Constance et d'Île aux Cerfs ont d'autres chiffres, non retenus.

## Tester la base en local (facultatif)
Il faut un PostgreSQL 14 ou plus. Dans une base vide, exécuter dans l'ordre : `db/test/stub_supabase.sql` (simule Supabase), `db/schema.sql`, `db/seed.sql`, puis `db/test/scenario.sql` avec `psql -v ON_ERROR_STOP=1`. Le dernier message attendu est « TOUS LES TESTS BASE v2 : OK ».

## Partage en images (WhatsApp)
Sur une journée : bouton « Partager en images » → le tirage (avant la partie) puis classement du jour, nearest du jour, nearest annuel, classement général annuel (après). Sur l'onglet Classement : classement annuel + nearest annuel. Les images (1080 px, logo Jambon Golf) sont générées dans le téléphone ; le bouton ouvre la feuille de partage (choisir WhatsApp). Sur ordinateur : téléchargement. Le tirage est aussi visible par tous les joueurs sur l'écran de la journée.
