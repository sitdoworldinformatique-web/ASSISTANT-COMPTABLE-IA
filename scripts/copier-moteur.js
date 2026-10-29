// Copie le moteur comptable d'index.html dans la fonction Appwrite,
// pour que le serveur applique exactement les mêmes contrôles que l'application.
// Usage : npm run fonction   (les tests vérifient que la copie est à jour)
const fs=require("fs"),path=require("path");
const racine=path.join(__dirname,"..");
const m=fs.readFileSync(path.join(racine,"index.html"),"utf8").match(/<script id="moteur">([\s\S]*?)<\/script>/);
if(!m)throw new Error("Bloc <script id=\"moteur\"> introuvable dans index.html");
const contenu="// Copie générée depuis index.html par « npm run fonction » : ne pas modifier ici.\n"+m[1].trim()+"\n";
fs.writeFileSync(path.join(racine,"appwrite","fonction","src","moteur.cjs"),contenu);
module.exports=contenu;
