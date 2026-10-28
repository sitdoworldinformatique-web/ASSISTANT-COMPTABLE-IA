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

(Node.js 20 ou plus récent, aucune dépendance à installer.) Ils tournent aussi sur GitHub à chaque PR.

## Comptes et données en ligne (Supabase)

Facultatif : sans réglage, tout reste dans le navigateur. Pour de vrais comptes, des données partagées
entre appareils et l'isolation entre entreprises, suivez [supabase/LISEZMOI.md](supabase/LISEZMOI.md).
Le schéma de la base est dans `supabase/schema.sql`, ses tests dans `tests/sql/` (`npm run test:base`).
