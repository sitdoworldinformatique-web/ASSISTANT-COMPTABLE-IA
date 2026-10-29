# CompteAssist – Assistant comptable SYSCOHADA

Application web autonome (un seul fichier `index.html`) : ouvrez-la simplement dans un navigateur.

## Moteur comptable et tests

Les calculs comptables (équilibre des écritures, soldes, balance, grand livre, résultat, bilan, factures,
contrôle des sauvegardes) sont regroupés dans le bloc `<script id="moteur">` de `index.html`.
Toutes les sommes y sont faites en centimes entiers.

Les tests automatisés lisent ce bloc directement dans `index.html` :

```
npm test
```

(Node.js 20 ou plus récent ; lancez `npm ci` une première fois.) Ils tournent aussi sur GitHub à chaque PR.

## Validation, contrepassation et clôture

Une écriture saisie est d'abord au **brouillard** : elle reste modifiable. Une fois **validée**, elle ne peut plus
être modifiée ni supprimée : on la corrige par **contrepassation** (écriture inverse, l'originale reste visible).
Les **exercices comptables** se définissent dans Paramètres ; la clôture d'un exercice exige que toutes ses
écritures soient validées et verrouille sa période. En ligne, la fonction serveur Appwrite applique les mêmes règles.

## Comptes et données en ligne (Appwrite)

Facultatif : sans réglage, tout reste dans le navigateur. Pour de vrais comptes, des données partagées
entre appareils et l'isolation entre entreprises, suivez [appwrite/LISEZMOI.md](appwrite/LISEZMOI.md).

L'application ne fait que lire la base ; toute écriture passe par la fonction `appwrite/fonction`, qui
reprend le moteur de `index.html` (copie mise à jour par `npm run fonction`) et refuse ce qui n'est pas
conforme : écriture déséquilibrée, écriture validée modifiée, période clôturée, entreprise d'un autre.
Ses tests (`tests/fonction.test.mjs`) tournent avec `npm test`, sur une imitation d'Appwrite en mémoire.
