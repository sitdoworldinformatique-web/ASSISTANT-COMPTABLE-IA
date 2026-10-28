# Mettre CompteAssist en ligne avec Supabase

Sans Supabase, l'application garde tout dans le navigateur, comme avant. Avec Supabase :

- chaque utilisateur a un vrai compte (e-mail + mot de passe gérés par Supabase) ;
- les données de l'entreprise sont sur le serveur et se retrouvent sur tous les appareils ;
- chaque entreprise ne voit que ses propres données (règles d'accès de PostgreSQL, testées) ;
- le serveur refuse toute écriture déséquilibrée ou mal formée, même si quelqu'un contourne l'écran ;
- chaque création, modification et suppression est tracée dans `journal_audit`.

## 1. Créer le projet (5 minutes)

1. Créez un compte sur https://supabase.com, puis **New project**. Choisissez une région proche
   de vos utilisateurs et notez le mot de passe de la base dans un endroit sûr.
2. Dans **SQL Editor**, collez tout le contenu de `supabase/schema.sql`, puis **Run**.
3. Dans **Authentication > URL Configuration**, mettez l'adresse où l'application est publiée dans
   **Site URL**. C'est vers elle que mène le lien de confirmation envoyé par e-mail.

## 2. Brancher l'application

Dans **Project Settings > API**, copiez :

- **Project URL** (par exemple `https://abcd1234.supabase.co`) ;
- la clé **anon public**.

Dans `index.html`, remplissez la ligne :

```js
const SUPABASE={url:"https://abcd1234.supabase.co",cle:"eyJ…clé anon…"};
```

La clé **anon** peut être publiée : elle ne donne accès qu'à ce que les règles autorisent.
La clé **service_role**, elle, contourne toutes les règles : ne la mettez jamais dans `index.html`,
ni dans le dépôt GitHub, ni dans un message.

## 3. Ce qui se passe pour l'utilisateur

- **Inscription** : le compte est créé chez Supabase. Si la confirmation par e-mail est active
  (réglage par défaut), l'utilisateur clique sur le lien reçu puis se connecte.
- **Première connexion** : son entreprise est créée. Si le navigateur contenait déjà des données
  hors ligne, l'application demande s'il faut les envoyer dans le compte en ligne.
- **Utilisation** : chaque modification part au serveur. Sans Internet, elle reste sur l'appareil
  (« Hors ligne » dans la carte de l'entreprise) et part dès le retour de la connexion.
- **Déconnexion** : les données sont retirées du navigateur ; elles restent sur le serveur.

## Limites actuelles

- L'abonnement et le paiement restent **simulés** et enregistrés dans le navigateur. La table
  `abonnements` est prête, mais elle ne pourra être écrite que par le futur service de paiement
  (clé service_role côté serveur), jamais par le navigateur.
- Une seule entreprise par utilisateur s'ouvre dans l'écran, même si la base en accepte plusieurs.
- Si deux appareils modifient la même écriture en même temps, la dernière modification l'emporte.
- Le service d'e-mails intégré de Supabase envoie peu de messages par heure. Pour un vrai lancement,
  il faudra brancher un service d'envoi d'e-mails (Authentication > SMTP Settings).

## Tests

`npm run test:base` (PostgreSQL 16 requis) installe le schéma sur une base vide, en simulant Supabase,
et vérifie l'isolation entre entreprises, les contrôles des écritures et les droits. Ces tests tournent
aussi sur GitHub à chaque PR.
