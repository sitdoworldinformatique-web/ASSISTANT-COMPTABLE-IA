// Règles appliquées par le serveur, quel que soit l'écran : l'application n'écrit rien elle-même,
// tout passe par ces contrôles. Le stockage (Appwrite ou mémoire pour les tests) est fourni par « m ».
import Moteur from "./moteur.cjs";

const CODE=/^[A-Za-z0-9_-]{1,40}$/,DATE=/^\d{4}-\d{2}-\d{2}$/,COMPTE=/^[1-9]\d{1,7}$/,PAYS=/^[A-Z]{2}$/,DEVISE=/^[A-Z]{3}$/;
const ROLES_ECRITURE=["proprietaire","comptable"];

export class Refus extends Error{constructor(m,statut=400){super(m);this.statut=statut}}
const refuser=(m,statut)=>{throw new Refus(m,statut)};

// Montant en unités (ex. 1234.5) -> centimes entiers ; refuse plus de deux décimales.
function centimes(v,quoi){
  if(v===undefined||v===null)return 0;
  if(typeof v!=="number"||!isFinite(v))refuser(quoi+" : montant invalide");
  if(v<0)refuser(quoi+" : montant négatif");
  if(v>=1e13)refuser(quoi+" : montant trop grand");
  const c=Moteur.enCentimes(v);
  if(Math.abs(c-v*100)>1e-6)refuser(quoi+" : plus de deux décimales");
  return c;
}
const texte=(v,max,quoi,requis)=>{
  if(v===undefined||v===null||v==="")return requis?refuser(quoi+" requis"):"";
  if(typeof v!=="string"||v.length>max)refuser(quoi+" invalide");
  return v;
};

// Écriture reçue de l'application -> forme stockée (lignes en centimes), après contrôle complet.
export function controleEcriture(e){
  if(!e||typeof e!=="object"||!Array.isArray(e.lignes))refuser("Écriture illisible");
  if(!CODE.test(String(e.id)))refuser("Écriture : identifiant invalide");
  const n="Écriture "+e.id;
  if(!DATE.test(String(e.date)))refuser(n+" : date invalide");
  if(e.lignes.length<2)refuser(n+" : au moins deux lignes");
  if(e.lignes.length>500)refuser(n+" : trop de lignes");
  const statut=e.statut===undefined||e.statut===null?"brouillon":e.statut;
  if(statut!=="brouillon"&&statut!=="validee")refuser(n+" : statut invalide");
  if(e.contrepasse!==undefined&&e.contrepasse!==null&&!CODE.test(String(e.contrepasse)))refuser(n+" : référence de contrepassation invalide");
  if(e.lien!==undefined&&e.lien!==null&&!/^[a-z_]{1,30}$/.test(String(e.lien)))refuser(n+" : lien invalide");
  let td=0,tc=0;
  const lignes=e.lignes.map(l=>{
    if(!l||!COMPTE.test(String(l.compte)))refuser(n+" : numéro de compte invalide");
    const debit=centimes(l.debit,n),credit=centimes(l.credit,n);
    if((debit>0)===(credit>0))refuser(n+" : chaque ligne porte soit un débit, soit un crédit");
    td+=debit;tc+=credit;
    return {compte:String(l.compte),debit,credit};
  });
  if(td!==tc)refuser(`${n} : débit (${td/100}) et crédit (${tc/100}) ne sont pas égaux`);
  return {cle:e.id,date:e.date,piece:texte(e.piece,60,n+" : pièce"),libelle:texte(e.libelle,300,n+" : libellé",true),
    lien:e.lien||"",statut,contrepasse:e.contrepasse||"",lignes};
}

export function controleFacture(f){
  if(!f||typeof f!=="object")refuser("Facture illisible");
  if(!CODE.test(String(f.num)))refuser("Facture : numéro invalide");
  const n="Facture "+f.num;
  if(!DATE.test(String(f.date)))refuser(n+" : date invalide");
  const ht=centimes(f.ht,n),tva=centimes(f.tva,n),ttc=centimes(f.ttc,n);
  if(ht+tva!==ttc)refuser(n+" : HT + TVA différent du TTC");
  const donnees=JSON.stringify(f);
  if(donnees.length>60000)refuser(n+" : trop volumineuse");
  return {cle:f.num,date:f.date,client:texte(f.client,200,n+" : client"),ht,tva,ttc,donnees};
}

export function controleExerciceRecu(x){
  if(!x||!CODE.test(String(x.id)))refuser("Exercice : identifiant invalide");
  if(!DATE.test(String(x.debut))||!DATE.test(String(x.fin)))refuser("Exercice : dates invalides");
  if(x.fin<x.debut)refuser("Exercice : la fin doit être après le début");
  return {cle:x.id,debut:x.debut,fin:x.fin,cloture:x.cloture===true};
}

const exerciceClos=async(m,eid,date)=>(await m.lister("exercices",eid)).find(x=>x.cloture&&date>=x.debut&&date<=x.fin);
const periode=x=>`du ${x.debut} au ${x.fin}`;

// Une opération de la file d'envoi de l'application.
async function operation(m,eid,uid,op){
  const d=op&&op.donnees;
  switch(op&&op.type){
    case "ecriture":{
      const e=controleEcriture(d),avant=await m.lire("ecritures",eid,e.cle);
      if(avant&&avant.statut==="validee")refuser(`Écriture ${e.cle} validée : elle ne peut plus être modifiée. Corrigez-la par une contrepassation.`,409);
      const x=await exerciceClos(m,eid,e.date)||(avant&&await exerciceClos(m,eid,avant.date));
      if(x)refuser(`Écriture ${e.cle} : la période ${periode(x)} est clôturée`,409);
      if(e.statut==="validee")e.valideLe=avant&&avant.valideLe||m.aujourdhui();
      await m.ecrire("ecritures",eid,e.cle,e);
      return m.audit(eid,uid,avant?"modification":"creation","ecriture "+e.cle,avant,e);
    }
    case "supprEcriture":{
      const cle=String(d&&d.id),avant=await m.lire("ecritures",eid,cle);
      if(!avant)return;
      if(avant.statut==="validee")refuser(`Écriture ${cle} validée : elle ne peut plus être supprimée. Annulez-la par une contrepassation.`,409);
      const x=await exerciceClos(m,eid,avant.date);
      if(x)refuser(`Écriture ${cle} : la période ${periode(x)} est clôturée`,409);
      await m.supprimer("ecritures",eid,cle);
      return m.audit(eid,uid,"suppression","ecriture "+cle,avant,null);
    }
    case "facture":{
      const f=controleFacture(d),avant=await m.lire("factures",eid,f.cle);
      await m.ecrire("factures",eid,f.cle,f);
      return m.audit(eid,uid,avant?"modification":"creation","facture "+f.cle,avant,f);
    }
    case "supprFacture":{
      const cle=String(d&&d.num),avant=await m.lire("factures",eid,cle);
      if(!avant)return;
      await m.supprimer("factures",eid,cle);
      return m.audit(eid,uid,"suppression","facture "+cle,avant,null);
    }
    case "compte":{
      if(!d||!COMPTE.test(String(d.num)))refuser("Compte : numéro invalide");
      const c={cle:String(d.num),nom:texte(d.nom,160,"Compte "+d.num+" : intitulé",true)};
      return m.ecrire("comptes",eid,c.cle,c);
    }
    case "supprCompte":return m.supprimer("comptes",eid,String(d&&d.num));
    case "params":{
      if(!d||typeof d!=="object")refuser("Paramètres illisibles");
      const p=JSON.stringify(d);if(p.length>20000)refuser("Paramètres trop volumineux");
      if(d.pays&&!PAYS.test(d.pays))refuser("Pays invalide");
      if(!DEVISE.test(String(d.devise)))refuser("Devise invalide (3 lettres, ex. XOF)");
      return m.majEntreprise(eid,{nom:texte(d.societe||"Mon entreprise",160,"Nom de l'entreprise",true),pays:d.pays||"",devise:d.devise,params:p});
    }
    case "exercice":{
      const x=controleExerciceRecu(d),tous=await m.lister("exercices",eid),avant=tous.find(y=>y.cle===x.cle);
      if(avant&&avant.cloture)refuser(`Exercice ${periode(avant)} clôturé : il ne peut plus être modifié`,409);
      const autre=tous.find(y=>y.cle!==x.cle&&x.debut<=y.fin&&y.debut<=x.fin);
      if(autre)refuser(`Exercice : chevauche l'exercice ${periode(autre)}`);
      if(x.cloture){
        if(await m.brouillonEntre(eid,x.debut,x.fin))refuser("Clôture impossible : des écritures de l'exercice sont encore au brouillard",409);
        x.clotureLe=m.aujourdhui();
      }
      await m.ecrire("exercices",eid,x.cle,x);
      return m.audit(eid,uid,x.cloture?"cloture":avant?"modification":"creation","exercice "+x.cle,avant,x);
    }
    case "supprExercice":{
      const cle=String(d&&d.id),avant=await m.lire("exercices",eid,cle);
      if(!avant)return;
      if(avant.cloture)refuser("Exercice clôturé : il ne peut pas être supprimé",409);
      await m.supprimer("exercices",eid,cle);
      return m.audit(eid,uid,"suppression","exercice "+cle,avant,null);
    }
    default:refuser("Opération inconnue");
  }
}

// Point d'entrée : uid est l'utilisateur vérifié (jeton de session), jamais une valeur fournie par l'écran.
export async function traiter(m,uid,corps){
  if(!uid)refuser("Connexion requise",401);
  const {action,entreprise:eid}=corps||{};
  if(action==="mesEntreprises")return {entreprises:await m.mesEntreprises(uid)};
  if(action==="creerEntreprise"){
    const d=corps.donnees||{};
    if(!DEVISE.test(String(d.devise)))refuser("Devise invalide (3 lettres, ex. XOF)");
    if(d.pays&&!PAYS.test(d.pays))refuser("Pays invalide");
    if((await m.mesEntreprises(uid)).filter(x=>x.role==="proprietaire").length>=20)refuser("Nombre maximal d'entreprises atteint");
    const p=JSON.stringify(d.params||{});if(p.length>20000)refuser("Paramètres trop volumineux");
    const id=await m.creerEntreprise(uid,{nom:texte(d.nom||"Mon entreprise",160,"Nom de l'entreprise",true),pays:d.pays||"",devise:d.devise,params:p});
    await m.audit(id,uid,"creation","entreprise",null,{nom:d.nom,pays:d.pays,devise:d.devise});
    return {entreprise:id};
  }
  if(action!=="lot")refuser("Action inconnue");
  if(typeof eid!=="string"||!eid)refuser("Entreprise manquante");
  const role=await m.role(eid,uid);
  if(!role)refuser("Accès refusé à cette entreprise",403);
  if(!ROLES_ECRITURE.includes(role))refuser("Votre rôle (lecture seule) ne permet pas de modifier les données",403);
  const ops=corps.operations;
  if(!Array.isArray(ops)||ops.length>100)refuser("Liste d'opérations invalide (100 au plus)");
  // Chaque opération est traitée seule : une refusée n'empêche pas les suivantes.
  const resultats=[];
  for(const op of ops){
    try{await operation(m,eid,uid,op);resultats.push({ok:true})}
    catch(x){if(!(x instanceof Refus))throw x;resultats.push({ok:false,erreur:x.message})}
  }
  return {resultats};
}
