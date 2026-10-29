// Imitation en mémoire des services Appwrite utilisés par la fonction (TablesDB, Teams, Users, Account).
// Query, ID, Permission et Role sont ceux du vrai SDK node-appwrite : les requêtes ont donc leur vrai format.
// Les signatures suivent celles du SDK (paramètres objet) et les erreurs portent un code HTTP comme AppwriteException.
import * as vrai from "node-appwrite";

class Erreur extends Error{constructor(code,m){super(m);this.code=code}}
const copie=o=>JSON.parse(JSON.stringify(o));

export function fauxAppwrite(){
  const etat={bases:{},equipes:{},utilisateurs:{},jetons:{},appels:[]};
  const verifier=(p,requis)=>{for(const k of requis)if(p[k]===undefined)throw new Error(`Paramètre ${k} manquant`)};
  const table=(db,t)=>{const b=etat.bases[db];if(!b)throw new Erreur(404,"Database not found");const x=b.tables[t];if(!x)throw new Erreur(404,"Table not found");return x};
  const controlerDonnees=(tb,data)=>{
    for(const [k,v] of Object.entries(data)){
      const c=tb.colonnes.find(c=>c.key===k);if(!c)throw new Erreur(400,`Unknown column: "${k}"`);
      if(c.status!=="available")throw new Erreur(400,`Column ${k} not available`);
      if(v===null)continue;
      if(c.type==="varchar"&&(typeof v!=="string"||v.length>c.size))throw new Erreur(400,`Invalid ${k}: varchar(${c.size})`);
      if(c.type==="mediumtext"&&typeof v!=="string")throw new Erreur(400,`Invalid ${k}: text`);
      if(c.type==="bigint"&&!Number.isInteger(v))throw new Erreur(400,`Invalid ${k}: bigint`);
      if(c.type==="boolean"&&typeof v!=="boolean")throw new Erreur(400,`Invalid ${k}: boolean`);
    }
  };
  const filtre=q=>{const {method:m,attribute:a,values:v}=JSON.parse(q);
    if(m==="equal")return r=>v.includes(r[a]);
    if(m==="notEqual")return r=>!v.includes(r[a]);
    if(m==="greaterThanEqual")return r=>r[a]>=v[0];
    if(m==="lessThanEqual")return r=>r[a]<=v[0];
    if(["limit","cursorAfter","orderAsc"].includes(m))return null;
    throw new Error("Requête non imitée : "+m)};
  const lister=(lignes,queries=[])=>{
    let L=lignes.filter(r=>queries.map(filtre).filter(Boolean).every(f=>f(r)));
    L.sort((a,b)=>a.$id<b.$id?-1:1);
    for(const q of queries){const {method:m,values:v}=JSON.parse(q);
      if(m==="cursorAfter"){const i=L.findIndex(r=>r.$id===v[0]);L=L.slice(i+1)}}
    const lim=queries.map(q=>JSON.parse(q)).find(q=>q.method==="limit");
    return lim?L.slice(0,lim.values[0]):L.slice(0,25);
  };
  class TablesDB{
    constructor(c){this.c=c}
    async get({databaseId}){if(!etat.bases[databaseId])throw new Erreur(404,"Database not found");return {$id:databaseId}}
    async create(p){verifier(p,["databaseId","name"]);etat.bases[p.databaseId]={tables:{}};return {$id:p.databaseId}}
    async getTable({databaseId,tableId}){table(databaseId,tableId);return {$id:tableId}}
    async createTable(p){verifier(p,["databaseId","tableId","name"]);etat.bases[p.databaseId].tables[p.tableId]={rowSecurity:p.rowSecurity,colonnes:[],index:[],lignes:{}};return {$id:p.tableId}}
    async listColumns({databaseId,tableId}){const tb=table(databaseId,tableId);
      // Une colonne passe « processing » puis « available » à la lecture suivante, comme en arrière-plan.
      const r={columns:copie(tb.colonnes)};tb.colonnes.forEach(c=>c.status="available");return r}
    ajout(p,type,extra={}){verifier(p,["databaseId","tableId","key","required"]);table(p.databaseId,p.tableId).colonnes.push({key:p.key,type,required:p.required,status:"processing",...extra})}
    async createVarcharColumn(p){verifier(p,["size"]);this.ajout(p,"varchar",{size:p.size})}
    async createMediumtextColumn(p){this.ajout(p,"mediumtext")}
    async createBigIntColumn(p){this.ajout(p,"bigint")}
    async createBooleanColumn(p){this.ajout(p,"boolean")}
    async listIndexes({databaseId,tableId}){return {indexes:copie(table(databaseId,tableId).index)}}
    async createIndex(p){verifier(p,["key","type","columns"]);const tb=table(p.databaseId,p.tableId);
      if(!p.columns.every(c=>tb.colonnes.some(x=>x.key===c&&x.status==="available")))throw new Erreur(400,"Index on unavailable column");
      tb.index.push({key:p.key,type:p.type,columns:p.columns})}
    async getRow({databaseId,tableId,rowId}){const r=table(databaseId,tableId).lignes[rowId];if(!r)throw new Erreur(404,"Row not found");return copie(r)}
    async listRows({databaseId,tableId,queries}){etat.appels.push(["listRows",tableId]);const L=lister(Object.values(table(databaseId,tableId).lignes),queries);return {total:L.length,rows:copie(L)}}
    async createRow(p){verifier(p,["databaseId","tableId","rowId","data"]);const tb=table(p.databaseId,p.tableId);
      if(p.rowId.length>36||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p.rowId))throw new Erreur(400,"Invalid rowId");
      if(tb.lignes[p.rowId])throw new Erreur(409,"Row already exists");
      for(const c of tb.colonnes)if(c.required&&(p.data[c.key]===undefined||p.data[c.key]===null||p.data[c.key]===""))throw new Erreur(400,`Missing required column "${c.key}"`);
      controlerDonnees(tb,p.data);tb.lignes[p.rowId]={$id:p.rowId,$permissions:p.permissions||[],...copie(p.data)};return copie(tb.lignes[p.rowId])}
    async updateRow(p){const tb=table(p.databaseId,p.tableId),r=tb.lignes[p.rowId];if(!r)throw new Erreur(404,"Row not found");
      controlerDonnees(tb,p.data||{});Object.assign(r,copie(p.data||{}));if(p.permissions)r.$permissions=p.permissions;return copie(r)}
    async upsertRow(p){const tb=table(p.databaseId,p.tableId);return tb.lignes[p.rowId]?this.updateRow(p):this.createRow(p)}
    async deleteRow({databaseId,tableId,rowId}){const tb=table(databaseId,tableId);if(!tb.lignes[rowId])throw new Erreur(404,"Row not found");delete tb.lignes[rowId];return {}}
  }
  class Teams{
    async create(p){verifier(p,["teamId","name"]);etat.equipes[p.teamId]={nom:p.name,membres:[]};return {$id:p.teamId}}
    async createMembership(p){verifier(p,["teamId","roles"]);const e=etat.equipes[p.teamId];if(!e)throw new Erreur(404,"Team not found");
      if(!p.userId&&!p.email)throw new Error("userId ou email requis");
      e.membres.push({userId:p.userId,teamId:p.teamId,teamName:e.nom,roles:p.roles,confirm:true});return {}}
    async listMemberships({teamId,queries=[]}){const e=etat.equipes[teamId];if(!e)throw new Erreur(404,"Team not found");
      const L=lister(e.membres.map((m,i)=>({$id:"m"+i,...m})),queries);return {total:L.length,memberships:copie(L)}}
    async updateName({teamId,name}){const e=etat.equipes[teamId];if(!e)throw new Erreur(404,"Team not found");e.nom=name;e.membres.forEach(m=>m.teamName=name);return {}}
  }
  class Users{
    async listMemberships({userId}){const L=Object.values(etat.equipes).flatMap(e=>e.membres).filter(m=>m.userId===userId);return {total:L.length,memberships:copie(L)}}
  }
  class Account{
    constructor(c){this.c=c}
    async get(){const u=etat.jetons[this.c.jwt];if(!u)throw new Erreur(401,"Invalid JWT");return {$id:u}}
  }
  class Client{
    setEndpoint(v){this.endpoint=v;return this}setProject(v){this.project=v;return this}
    setKey(v){this.key=v;return this}setJWT(v){this.jwt=v;return this}
  }
  const sdk={...vrai,Client,TablesDB,Teams,Users,Account};
  return {sdk,etat,
    // Crée un utilisateur et renvoie un jeton de session valide pour lui.
    utilisateur(id){etat.utilisateurs[id]={};const j="jwt-"+id;etat.jetons[j]=id;return j},
    // Ajoute un membre à une équipe (comme le ferait l'invitation d'un collaborateur).
    ajouterMembre(teamId,userId,roles){const e=etat.equipes[teamId];e.membres.push({userId,teamId,teamName:e.nom,roles,confirm:true})},
    lignes:(t)=>Object.values(etat.bases.compteassist.tables[t].lignes)};
}
