// Charge le moteur comptable directement depuis index.html (bloc <script id="moteur">),
// pour tester exactement le code que l'application exécute.
const fs=require("fs"),path=require("path"),vm=require("vm");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const m=html.match(/<script id="moteur">([\s\S]*?)<\/script>/);
if(!m)throw new Error("Bloc <script id=\"moteur\"> introuvable dans index.html");
const module_={exports:{}};
// Même contexte que les tests, pour que deepEqual compare des objets du même « monde » JavaScript.
vm.runInThisContext("(function(module){"+m[1]+"\n})",{filename:"index.html#moteur"})(module_);
module.exports=module_.exports;
