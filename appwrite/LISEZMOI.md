# Mettre CompteAssist en ligne avec Appwrite

Sans la fonction Appwrite, l'application garde tout dans le navigateur, comme avant. Avec elle :

- chaque utilisateur a un vrai compte (e-mail + mot de passe, 8 caractères minimum) ;
- les données de l'entreprise sont enregistrées sur le serveur et se retrouvent sur tout appareil ;
- chaque entreprise est une « équipe » Appwrite : personne d'autre ne peut lire ses données ;
- toute écriture passe par la fonction `compteassist`, qui applique les règles comptables : écriture équilibrée,
  montants au centime, écriture validée jamais modifiée (contrepassation), période clôturée verrouillée,
  journal d'audit de chaque modification.

Le projet est déjà indiqué dans `index.html` :

```js
const APPWRITE={endpoint:"https://fra.cloud.appwrite.io/v1",projet:"6ae2faf3002f5b7a082c",fonction:"compteassist"};
```

Ces trois valeurs ne sont pas secrètes. **Ne mettez jamais de clé API dans `index.html` ni dans le dépôt** :
la fonction reçoit sa clé d'Appwrite elle-même à chaque exécution.

## 1. Déclarer l'adresse de l'application (plateforme Web)

Dans la console Appwrite, ouvrez le projet, puis **Overview > Add platform > Web**.
Comme nom d'hôte (*Hostname*), mettez l'adresse où l'application est ouverte, sans `https://` :

- sur GitHub Pages : `sitdoworldinformatique-web.github.io` ;
- pour des essais sur votre ordinateur : `localhost`.

Ajoutez une plateforme par adresse. Sans cela, Appwrite refuse la connexion (« Invalid Origin »).
Le fichier ouvert directement depuis le disque (`file://…`) ne peut pas se connecter : passez par une adresse web.

## 2. Créer la fonction

**Functions > Create function**, à partir du dépôt GitHub :

1. Connectez GitHub et choisissez le dépôt `ASSISTANT-COMPTABLE-IA`.
2. **Function ID** : `compteassist` (cliquez sur l'identifiant proposé pour le modifier).
   Si vous en gardez un autre, remplacez `compteassist` par cet identifiant dans `index.html`.
3. **Runtime** : Node.js 22 (ou la version Node la plus récente proposée).
4. **Branche** : `main` ; **Root directory** : `appwrite/fonction` ; **Entrypoint** : `src/main.js` ;
   **Build commands** : `npm install`.
5. **Execute access** : **Users** (tout utilisateur connecté). La fonction vérifie elle-même à quelle entreprise
   chacun a droit.
6. **Scopes** (permissions de la clé que la fonction reçoit) : cochez
   `databases.read`, `databases.write`, `tables.read`, `tables.write`, `columns.read`, `columns.write`,
   `indexes.read`, `indexes.write`, `rows.read`, `rows.write`, `teams.read`, `teams.write`, `users.read`.
7. Dans **Settings > Timeout**, mettez **60** secondes : au tout premier appel, la fonction crée la base
   `compteassist` et ses tables, ce qui peut prendre un peu de temps.

Vous n'avez rien à créer dans **Databases** : la fonction s'en charge au premier appel.

## 3. Vérifier

Ouvrez l'application à l'adresse déclarée, créez un compte, saisissez une écriture. Sous le nom de l'entreprise
s'affiche « ☁ Données enregistrées en ligne ». Dans la console, **Databases > compteassist > ecritures** montre la
ligne (montants en centimes), et **Auth > Teams** l'équipe de l'entreprise.

En cas de problème, **Functions > compteassist > Executions** affiche les erreurs de la fonction.

## Fonctionnement

- **Inscription** : le compte est créé dans Appwrite, puis la fonction crée l'entreprise (une équipe dont
  l'utilisateur est propriétaire). Si le navigateur contenait déjà des données, l'application demande
  l'accord avant de les envoyer ; une copie reste dans le navigateur (`compteassist.v1.avant-connexion`).
- **Saisie** : chaque modification est envoyée à la fonction. Hors ligne, elle attend sur l'appareil et part
  au retour du réseau. Ce que le serveur refuse est signalé sous le nom de l'entreprise.
- **Lecture** : l'application lit directement les tables ; chaque ligne n'est lisible que par l'équipe de
  son entreprise.
- **Rôles** : `owner` (propriétaire) et `comptable` peuvent modifier, `lecteur` seulement consulter.
  Pour inviter quelqu'un : **Auth > Teams > (l'entreprise) > Create membership**, avec le rôle voulu.
- **Déconnexion** : les données quittent le navigateur (elles restent sur le serveur).

## Pour les développeurs

- `appwrite/fonction/src/regles.js` : les contrôles ; `gestionnaire.js` : installation de la base et accès Appwrite.
- `appwrite/fonction/src/moteur.cjs` est une copie du moteur de `index.html` : après toute modification du
  moteur, lancez `npm run fonction` (un test vérifie que la copie est à jour).
- `npm test` lance aussi les tests de la fonction, sur une imitation d'Appwrite en mémoire.
