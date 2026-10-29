// Fonction Appwrite de CompteAssist : seule porte d'écriture vers la base.
// Le SDK est passé en paramètre (node-appwrite en production, une imitation en mémoire pour les tests).
import {createHash} from "node:crypto";
import {traiter,Refus} from "./regles.js";

export const BASE="compteassist";
// [colonne, type, taille] ; les colonnes « entreprise » et « cle » sont obligatoires, les autres facultatives.
export const SCHEMA={
  entreprises:[["nom","varchar",160],["pays","varchar",2],["devise","varchar",3],["params","mediumtext"]],
  ecritures:[["entreprise","varchar",36],["cle","varchar",40],["date","varchar",10],["piece","varchar",60],["libelle","varchar",300],
    ["lien","varchar",30],["statut","varchar",10],["valideLe","varchar",10],["contrepasse","varchar",40],["lignes","mediumtext"]],
  factures:[["entreprise","varchar",36],["cle","varchar",40],["date","varchar",10],["client","varchar",200],
    ["ht","bigint"],["tva","bigint"],["ttc","bigint"],["donnees","mediumtext"]],
  comptes:[["entreprise","varchar",36],["cle","varchar",40],["nom","varchar",160]],
  exercices:[["entreprise","varchar",36],["cle","varchar",40],["debut","varchar",10],["fin","varchar",10],["cloture","boolean"],["clotureLe","varchar",10]],
  audit:[["entreprise","varchar",36],["qui","varchar",36],["action","varchar",20],["objet","varchar",80],["avant","mediumtext"],["apres","mediumtext"]]
};
const INDEX={ecritures:[["par_entreprise",["entreprise","date"]]],factures:[["par_entreprise",["entreprise"]]],
  comptes:[["par_entreprise",["entreprise"]]],exercices:[["par_entreprise",["entreprise"]]],audit:[["par_entreprise",["entreprise"]]]};
const OBLIGATOIRE=new Set(["entreprise","cle","nom"]);

const introuvable=e=>e&&e.code===404;
// Identifiant de ligne déterministe (36 caractères au plus) : une écriture = une ligne, mise à jour sur place.
export const idLigne=(eid,cle)=>"r"+createHash("sha256").update(eid+"\u0000"+cle).digest("hex").slice(0,35);

// Crée la base, les tables, colonnes et index manquants. Sans effet s'ils existent déjà.
export async function installer(sdk,admin,attendre=ms=>new Promise(r=>setTimeout(r,ms))){
  const t=new sdk.TablesDB(admin);
  try{await t.get({databaseId:BASE})}catch(e){if(!introuvable(e))throw e;await t.create({databaseId:BASE,name:"CompteAssist"})}
  for(const [table,colonnes] of Object.entries(SCHEMA)){
    try{await t.getTable({databaseId:BASE,tableId:table})}
    catch(e){if(!introuvable(e))throw e;await t.createTable({databaseId:BASE,tableId:table,name:table,permissions:[],rowSecurity:true})}
    const deja=new Set((await t.listColumns({databaseId:BASE,tableId:table,queries:[sdk.Query.limit(100)]})).columns.map(c=>c.key));
    for(const [key,type,taille] of colonnes){
      if(deja.has(key))continue;
      const p={databaseId:BASE,tableId:table,key,required:OBLIGATOIRE.has(key)};
      if(type==="varchar")await t.createVarcharColumn({...p,size:taille});
      else if(type==="mediumtext")await t.createMediumtextColumn(p);
      else if(type==="bigint")await t.createBigIntColumn(p);
      else if(type==="boolean")await t.createBooleanColumn(p);
    }
    // Les colonnes sont créées en arrière-plan : on attend qu'elles soient prêtes avant les index.
    for(let i=0;;i++){
      const C=(await t.listColumns({databaseId:BASE,tableId:table,queries:[sdk.Query.limit(100)]})).columns;
      const ko=C.find(c=>c.status==="failed");if(ko)throw new Error(`Colonne ${table}.${ko.key} : création échouée (${ko.error||"?"})`);
      if(C.every(c=>c.status==="available"))break;
      if(i>=40)throw new Error(`Colonnes de ${table} pas encore prêtes : réessayez dans une minute`);
      await attendre(500);
    }
    const idx=new Set((await t.listIndexes({databaseId:BASE,tableId:table})).indexes.map(x=>x.key));
    for(const [key,cols] of INDEX[table]||[])
      if(!idx.has(key))await t.createIndex({databaseId:BASE,tableId:table,key,type:sdk.TablesDBIndexType.Key,columns:cols});
  }
}

// Accès aux données pour regles.js, par l'API serveur (clé de la fonction).
export function magasinAppwrite(sdk,admin){
  const t=new sdk.TablesDB(admin),teams=new sdk.Teams(admin),users=new sdk.Users(admin),Q=sdk.Query;
  const lecture=eid=>[sdk.Permission.read(sdk.Role.team(eid))];
  const versLigne=(table,o)=>{const d={...o};
    if(table==="ecritures")d.lignes=JSON.stringify(o.lignes);
    for(const k of Object.keys(d))if(d[k]===undefined)delete d[k];
    return d};
  const depuisLigne=(table,r)=>{const o={};
    for(const [k,type] of SCHEMA[table]){if(k==="entreprise")continue;o[k]=type==="bigint"&&r[k]!=null?Number(r[k]):r[k]}
    if(table==="ecritures")o.lignes=JSON.parse(r.lignes||"[]");
    return o};
  const ROLE={owner:"proprietaire",comptable:"comptable",lecteur:"lecteur"};
  const roleDe=m=>m&&m.confirm!==false?(m.roles.map(r=>ROLE[r]).find(Boolean)||null):null;
  return {
    aujourdhui:()=>new Date().toISOString().slice(0,10),
    async lire(table,eid,cle){
      try{return depuisLigne(table,await t.getRow({databaseId:BASE,tableId:table,rowId:idLigne(eid,cle)}))}
      catch(e){if(introuvable(e))return null;throw e}
    },
    async lister(table,eid){
      const L=[];let apres=null;
      for(;;){
        const q=[Q.equal("entreprise",[eid]),Q.limit(500)];if(apres)q.push(Q.cursorAfter(apres));
        const r=(await t.listRows({databaseId:BASE,tableId:table,queries:q})).rows;
        L.push(...r.map(x=>depuisLigne(table,x)));
        if(r.length<500)return L;apres=r[r.length-1].$id;
      }
    },
    async brouillonEntre(eid,du,au){
      const r=await t.listRows({databaseId:BASE,tableId:"ecritures",queries:[Q.equal("entreprise",[eid]),
        Q.greaterThanEqual("date",du),Q.lessThanEqual("date",au),Q.notEqual("statut","validee"),Q.limit(1)]});
      return r.rows.length>0;
    },
    ecrire:(table,eid,cle,o)=>t.upsertRow({databaseId:BASE,tableId:table,rowId:idLigne(eid,cle),data:{entreprise:eid,...versLigne(table,o)},permissions:lecture(eid)}),
    async supprimer(table,eid,cle){
      try{await t.deleteRow({databaseId:BASE,tableId:table,rowId:idLigne(eid,cle)})}catch(e){if(!introuvable(e))throw e}
    },
    audit:(eid,qui,action,objet,avant,apres)=>t.createRow({databaseId:BASE,tableId:"audit",rowId:sdk.ID.unique(),
      data:{entreprise:eid,qui,action,objet:objet.slice(0,80),avant:avant?JSON.stringify(avant):"",apres:apres?JSON.stringify(apres):""},permissions:lecture(eid)}),
    async role(eid,uid){
      try{const r=await teams.listMemberships({teamId:eid,queries:[Q.equal("userId",[uid])]});return roleDe(r.memberships[0])}
      catch(e){if(introuvable(e))return null;throw e}
    },
    async mesEntreprises(uid){
      const r=await users.listMemberships({userId:uid,queries:[Q.limit(100)]});
      return r.memberships.map(m=>({id:m.teamId,nom:m.teamName,role:roleDe(m)})).filter(x=>x.role);
    },
    async creerEntreprise(uid,e){
      const id=sdk.ID.unique();
      await teams.create({teamId:id,name:e.nom,roles:["owner"]});
      await teams.createMembership({teamId:id,roles:["owner"],userId:uid});
      await t.createRow({databaseId:BASE,tableId:"entreprises",rowId:id,data:e,permissions:lecture(id)});
      return id;
    },
    async majEntreprise(eid,e){
      await t.updateRow({databaseId:BASE,tableId:"entreprises",rowId:eid,data:e});
      await teams.updateName({teamId:eid,name:e.nom});
    }
  };
}

// Gestionnaire d'exécution : vérifie l'utilisateur par son jeton, installe la base si besoin, applique les règles.
export function creerGestionnaire(sdk,{attendre}={}){
  let pret=null;
  return async ({req,res,log,error})=>{
    const env=process.env,endpoint=env.APPWRITE_FUNCTION_API_ENDPOINT,projet=env.APPWRITE_FUNCTION_PROJECT_ID;
    const cle=req.headers["x-appwrite-key"]||env.APPWRITE_API_KEY;
    if(!endpoint||!projet||!cle)return res.json({erreur:"Fonction mal configurée : clé serveur absente (voir le guide d'installation)."},500);
    let corps;
    try{corps=req.bodyJson&&typeof req.bodyJson==="object"?req.bodyJson:JSON.parse(req.bodyText||req.body||"{}")}
    catch(e){return res.json({erreur:"Requête illisible"},400)}
    // L'utilisateur est celui du jeton de session, vérifié auprès d'Appwrite.
    let uid=null;
    if(corps.jwt){
      try{uid=(await new sdk.Account(new sdk.Client().setEndpoint(endpoint).setProject(projet).setJWT(corps.jwt)).get()).$id}
      catch(e){return res.json({erreur:"Session expirée : reconnectez-vous."},401)}
    }
    const entete=req.headers["x-appwrite-user-id"];
    if(uid&&entete&&entete!==uid)return res.json({erreur:"Utilisateur incohérent"},401);
    const admin=new sdk.Client().setEndpoint(endpoint).setProject(projet).setKey(cle);
    try{pret=pret||installer(sdk,admin,attendre);await pret}
    catch(e){pret=null;error(String(e&&e.stack||e));return res.json({erreur:"Préparation de la base impossible : "+e.message},503)}
    try{return res.json(await traiter(magasinAppwrite(sdk,admin),uid,corps))}
    catch(e){
      if(e instanceof Refus)return res.json({erreur:e.message},e.statut);
      error(String(e&&e.stack||e));return res.json({erreur:"Erreur du serveur, réessayez."},500);
    }
  };
}
