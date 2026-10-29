// Fonction Appwrite : contrôles, droits, isolation, validation et clôture, sur une imitation en mémoire d'Appwrite.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {creerGestionnaire,SCHEMA} from "../appwrite/fonction/src/gestionnaire.js";
import {fauxAppwrite} from "./appwrite/faux-appwrite.mjs";

const require=createRequire(import.meta.url);
process.env.APPWRITE_FUNCTION_API_ENDPOINT="https://exemple.test/v1";
process.env.APPWRITE_FUNCTION_PROJECT_ID="projet";

function monter(){
  const f=fauxAppwrite(),gerer=creerGestionnaire(f.sdk,{attendre:async()=>{}});
  const appeler=async(jwt,corps,entetes={})=>{
    let sortie;
    await gerer({req:{headers:{"x-appwrite-key":"cle-serveur",...entetes},bodyText:JSON.stringify({jwt,...corps})},
      res:{json:(corps,statut=200)=>sortie={statut,corps}},log:()=>{},error:()=>{}});
    return sortie;
  };
  return {f,appeler};
}
const E=(id,date,lignes,x={})=>({id,date,piece:"",libelle:"Écriture "+id,lignes:lignes.map(([compte,debit,credit])=>({compte,debit,credit})),...x});
const op=(type,donnees)=>({type,donnees});
async function entreprise(appeler,jwt,nom="Awa SARL"){
  const r=await appeler(jwt,{action:"creerEntreprise",donnees:{nom,pays:"CI",devise:"XOF",params:{societe:nom,devise:"XOF"}}});
  assert.equal(r.statut,200,JSON.stringify(r));return r.corps.entreprise;
}

test("la copie du moteur dans la fonction est à jour (npm run fonction)",()=>{
  const attendu=require("../scripts/copier-moteur.js");
  assert.equal(fs.readFileSync(new URL("../appwrite/fonction/src/moteur.cjs",import.meta.url),"utf8"),attendu);
});

test("installation : base, tables, colonnes et index créés une seule fois",async()=>{
  const {f,appeler}=monter(),a=f.utilisateur("awa");
  await entreprise(appeler,a);
  const tables=f.etat.bases.compteassist.tables;
  assert.deepEqual(Object.keys(tables).sort(),Object.keys(SCHEMA).sort());
  for(const [t,cols] of Object.entries(SCHEMA)){
    assert.deepEqual(tables[t].colonnes.map(c=>c.key),cols.map(c=>c[0]),t);
    assert.equal(tables[t].rowSecurity,true,"permissions par ligne sur "+t);
  }
  assert.deepEqual(tables.ecritures.index.map(i=>i.columns),[["entreprise","date"]]);
  // Une nouvelle instance de la fonction (redémarrage) ne recrée rien.
  const g=creerGestionnaire(f.sdk,{attendre:async()=>{}});let s;
  await g({req:{headers:{"x-appwrite-key":"k"},bodyText:JSON.stringify({jwt:a,action:"mesEntreprises"})},res:{json:(c,st=200)=>s={c,st}},log(){},error(){}});
  assert.equal(s.st,200);assert.equal(tables.ecritures.colonnes.length,SCHEMA.ecritures.length);
});

test("connexion : sans jeton ou avec un jeton invalide, rien n'est possible",async()=>{
  const {f,appeler}=monter(),a=f.utilisateur("awa");
  assert.equal((await appeler(undefined,{action:"mesEntreprises"})).statut,401);
  assert.equal((await appeler("faux",{action:"mesEntreprises"})).statut,401);
  assert.equal((await appeler(a,{action:"mesEntreprises"},{"x-appwrite-user-id":"bako"})).statut,401);
  assert.deepEqual((await appeler(a,{action:"mesEntreprises"})).corps,{entreprises:[]});
});

test("écritures : enregistrées en centimes, refusées si incorrectes",async()=>{
  const {f,appeler}=monter(),a=f.utilisateur("awa"),eid=await entreprise(appeler,a);
  const r=await appeler(a,{action:"lot",entreprise:eid,operations:[
    op("ecriture",E("e1","2026-10-01",[["411",1234.5,0],["701",0,1000],["4431",0,234.5]])),
    op("ecriture",E("x1","2026-10-01",[["601",100,0],["571",0,99.99]])),
    op("ecriture",E("x2","2026-10-01",[["601",0.001,0],["571",0,0.001]])),
    op("ecriture",E("x3","2026-10-01",[["601",5,0]])),
    op("ecriture",E("x4","2026-10-01",[["601",-5,0],["571",0,-5]])),
    op("ecriture",E("x5","2026-10-01",[["601",5,5],["571",0,0]])),
    op("ecriture",E("x6","2026-10-01",[["abc",5,0],["571",0,5]])),
    op("ecriture",E("x7","01/10/2026",[["601",5,0],["571",0,5]])),
    op("ecriture",E("x8","2026-10-01",[["601","5",0],["571",0,5]])),
    op("inconnue",{})]});
  assert.equal(r.statut,200);
  const R=r.corps.resultats;
  assert.equal(R[0].ok,true);
  [["ne sont pas égaux"],["deux décimales"],["deux lignes"],["négatif"],["soit un débit"],["compte invalide"],["date invalide"],["montant invalide"],["inconnue"]]
    .forEach(([m],i)=>{assert.equal(R[i+1].ok,false);assert.match(R[i+1].erreur,new RegExp(m),R[i+1].erreur)});
  const L=f.lignes("ecritures");
  assert.equal(L.length,1);
  assert.deepEqual(JSON.parse(L[0].lignes),[{compte:"411",debit:123450,credit:0},{compte:"701",debit:0,credit:100000},{compte:"4431",debit:0,credit:23450}]);
  assert.deepEqual(L[0].$permissions,[`read("team:${eid}")`]);
  assert.equal(f.lignes("audit").filter(x=>x.objet==="ecriture e1").length,1);
});

test("isolation : un autre utilisateur ne peut ni écrire ni modifier l'entreprise",async()=>{
  const {f,appeler}=monter(),a=f.utilisateur("awa"),b=f.utilisateur("bako");
  const ea=await entreprise(appeler,a),eb=await entreprise(appeler,b,"Bako & Fils");
  const r=await appeler(b,{action:"lot",entreprise:ea,operations:[op("ecriture",E("z1","2026-10-01",[["601",5,0],["571",0,5]]))]});
  assert.equal(r.statut,403);assert.match(r.corps.erreur,/Accès refusé/);
  assert.deepEqual((await appeler(b,{action:"mesEntreprises"})).corps.entreprises.map(x=>x.id),[eb]);
  // Toutes les lignes d'Awa ne sont lisibles que par son équipe.
  assert.ok(f.lignes("ecritures").concat(f.lignes("entreprises"),f.lignes("audit")).filter(x=>x.entreprise===ea||x.$id===ea).every(x=>x.$permissions.join()===`read("team:${ea}")`));
  // Un lecteur voit mais ne modifie pas.
  f.ajouterMembre(ea,"bako",["lecteur"]);
  const l=await appeler(b,{action:"lot",entreprise:ea,operations:[op("ecriture",E("z2","2026-10-01",[["601",5,0],["571",0,5]]))]});
  assert.equal(l.statut,403);assert.match(l.corps.erreur,/lecture seule/);
  f.ajouterMembre(ea,"carl",["comptable"]);const c=f.utilisateur("carl");
  assert.equal((await appeler(c,{action:"lot",entreprise:ea,operations:[op("ecriture",E("z3","2026-10-01",[["601",5,0],["571",0,5]]))]})).corps.resultats[0].ok,true);
});

test("validation : une écriture validée ne se modifie ni ne se supprime ; la contrepassation passe",async()=>{
  const {f,appeler}=monter(),a=f.utilisateur("awa"),eid=await entreprise(appeler,a);
  const lot=async(...o)=>(await appeler(a,{action:"lot",entreprise:eid,operations:o})).corps.resultats;
  const v=E("v1","2026-03-10",[["622",800,0],["521",0,800]]);
  assert.deepEqual(await lot(op("ecriture",v),op("ecriture",{...v,statut:"validee"})),[{ok:true},{ok:true}]);
  const R=await lot(op("ecriture",{...v,statut:"validee",libelle:"Modifiée"}),op("ecriture",{...v,statut:"brouillon"}),op("supprEcriture",{id:"v1"}));
  R.forEach(r=>{assert.equal(r.ok,false);assert.match(r.erreur,/contrepassation/)});
  const cp={...E("cp1","2026-03-11",[["622",0,800],["521",800,0]]),statut:"validee",contrepasse:"v1"};
  assert.deepEqual(await lot(op("ecriture",cp)),[{ok:true}]);
  const L=f.lignes("ecritures");
  assert.equal(L.find(x=>x.cle==="v1").libelle,"Écriture v1");
  assert.equal(L.find(x=>x.cle==="cp1").contrepasse,"v1");
  assert.ok(L.find(x=>x.cle==="v1").valideLe);
});

test("exercices : chevauchement refusé, clôture refusée avec du brouillard, période verrouillée ensuite",async()=>{
  const {f,appeler}=monter(),a=f.utilisateur("awa"),eid=await entreprise(appeler,a);
  const lot=async(...o)=>(await appeler(a,{action:"lot",entreprise:eid,operations:o})).corps.resultats;
  const b=E("b1","2026-06-01",[["601",50,0],["571",0,50]]),x={id:"x2026",debut:"2026-01-01",fin:"2026-12-31",cloture:false};
  assert.deepEqual(await lot(op("ecriture",b),op("exercice",x)),[{ok:true},{ok:true}]);
  let R=await lot(op("exercice",{...x,cloture:true}),op("exercice",{id:"xbis",debut:"2026-07-01",fin:"2027-06-30"}));
  assert.match(R[0].erreur,/brouillard/);assert.match(R[1].erreur,/chevauche/);
  assert.deepEqual(await lot(op("ecriture",{...b,statut:"validee"}),op("exercice",{...x,cloture:true})),[{ok:true},{ok:true}]);
  R=await lot(op("ecriture",E("n1","2026-08-01",[["601",5,0],["571",0,5]])),op("exercice",{...x,cloture:false}),op("supprExercice",{id:"x2026"}),
    op("ecriture",{...E("cp2","2027-01-05",[["601",0,50],["571",50,0]]),statut:"validee",contrepasse:"b1"}));
  assert.match(R[0].erreur,/clôturée/);assert.match(R[1].erreur,/ne peut plus être modifié/);assert.match(R[2].erreur,/ne peut pas être supprimé/);
  assert.equal(R[3].ok,true,"contrepassation datée dans l'exercice suivant");
  assert.equal(f.lignes("audit").filter(y=>y.action==="cloture").length,1);
});

test("factures, comptes et paramètres",async()=>{
  const {f,appeler}=monter(),a=f.utilisateur("awa"),eid=await entreprise(appeler,a);
  const R=(await appeler(a,{action:"lot",entreprise:eid,operations:[
    op("facture",{num:"F0001",date:"2026-10-02",client:"Client A",ht:1000,tva:160,ttc:1160,payee:null}),
    op("facture",{num:"F0002",date:"2026-10-02",client:"B",ht:1000,tva:160,ttc:1100}),
    op("compte",{num:"6011",nom:"Achats locaux"}),op("compte",{num:"x",nom:"?"}),
    op("params",{societe:"Awa SA",pays:"CI",devise:"XOF",tva:18}),op("params",{societe:"Awa",devise:"francs"})]})).corps.resultats;
  assert.deepEqual(R.map(r=>r.ok),[true,false,true,false,true,false]);
  assert.equal(f.lignes("factures")[0].ttc,116000);
  assert.equal(JSON.parse(f.lignes("factures")[0].donnees).client,"Client A");
  assert.equal(f.lignes("entreprises")[0].nom,"Awa SA");
  assert.equal(f.etat.equipes[eid].nom,"Awa SA");
  assert.equal((await appeler(a,{action:"lot",entreprise:eid,operations:[op("supprCompte",{num:"6011"}),op("supprFacture",{num:"F0001"})]})).corps.resultats.every(r=>r.ok),true);
  assert.equal(f.lignes("comptes").length+f.lignes("factures").length,0);
});

test("lot : 100 opérations au plus ; une erreur Appwrite inattendue renvoie 500 sans détail interne",async()=>{
  const {f,appeler}=monter(),a=f.utilisateur("awa"),eid=await entreprise(appeler,a);
  assert.equal((await appeler(a,{action:"lot",entreprise:eid,operations:Array(101).fill(op("compte",{num:"601",nom:"x"}))})).statut,400);
  f.etat.bases.compteassist.tables.comptes.colonnes[2].status="failed";
  const r=await appeler(a,{action:"lot",entreprise:eid,operations:[op("compte",{num:"6011",nom:"x"})]});
  assert.equal(r.statut,500);assert.doesNotMatch(r.corps.erreur,/column/i);
});
