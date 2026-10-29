// Copie générée depuis index.html par « npm run fonction » : ne pas modifier ici.
// ---------- Moteur comptable ----------
// Calculs purs, sans écran ni stockage : testés par tests/moteur.test.js.
// Les montants restent enregistrés en unités (ex. 1234.5), mais toutes les sommes se font en centimes entiers
// pour éviter les erreurs d'arrondi des nombres à virgule.
const Moteur=(()=>{
  "use strict";
  // 1.005 * 100 vaut 100.4999… en virgule flottante : le petit décalage corrige ce cas.
  const enCentimes=n=>{const v=Number(n);if(!isFinite(v))return 0;return Math.sign(v)*Math.round(Math.abs(v)*100+1e-6)};
  const enUnites=c=>(c||0)/100;
  const arrondir=n=>enUnites(enCentimes(n));
  const classe=c=>String(c)[0];
  const somme=(lignes,k)=>lignes.reduce((a,l)=>a+enCentimes(l[k]||0),0);
  const equilibree=lignes=>somme(lignes,"debit")===somme(lignes,"credit");

  // Contrôle des lignes d'une écriture ; existe(compte) dit si le compte est dans le plan.
  function verifierLignes(L,existe){
    const err=[];
    if(L.length<2)err.push("Au moins deux lignes.");
    L.forEach((l,i)=>{
      const n="Ligne "+(i+1)+" : ";
      if(!l.compte)err.push(n+"compte manquant.");
      else if(existe&&!existe(l.compte))err.push(n+"compte "+l.compte+" absent du plan (vous pouvez l'ajouter dans « Plan comptable »).");
      if(l.debit<0||l.credit<0)err.push(n+"pas de montant négatif.");
      if(l.debit&&l.credit)err.push(n+"mettez soit un débit, soit un crédit, pas les deux.");
      if(!l.debit&&!l.credit)err.push(n+"montant manquant.");
    });
    if(!equilibree(L))err.push("Débit et crédit doivent être égaux.");
    return err;
  }

  // Totaux débit / crédit par compte, recalculés à partir des seules écritures.
  function soldes(ecritures){
    const cts={};
    ecritures.forEach(e=>e.lignes.forEach(l=>{
      const s=cts[l.compte]=cts[l.compte]||{d:0,c:0};
      s.d+=enCentimes(l.debit||0);s.c+=enCentimes(l.credit||0);
    }));
    const s={};
    Object.keys(cts).forEach(c=>s[c]={d:enUnites(cts[c].d),c:enUnites(cts[c].c)});
    return s;
  }
  const sd=(s,c)=>arrondir((s[c]?.d||0)-(s[c]?.c||0));

  function resultat(ecritures){
    let prod=0,ch=0,hao=0;
    ecritures.forEach(e=>e.lignes.forEach(l=>{
      const k=classe(l.compte),net=enCentimes(l.credit||0)-enCentimes(l.debit||0);
      if(k==="7")prod+=net;
      if(k==="6")ch-=net;
      if(k==="8")hao+=net;
    }));
    return {prod:enUnites(prod),ch:enUnites(ch),hao:enUnites(hao),res:enUnites(prod-ch+hao)};
  }

  // Bilan simplifié : chaque compte de classe 1 à 5 va à l'actif ou au passif selon son solde.
  function bilan(ecritures){
    const s=soldes(ecritures),actif=[],passif=[];
    Object.keys(s).sort().forEach(c=>{
      const k=classe(c),v=enCentimes(sd(s,c));
      if("678".includes(k)||v===0)return;
      if(k==="1")passif.push([c,-v]);                  // capitaux, emprunts
      else if(k==="2"||k==="3")actif.push([c,v]);      // immobilisations (amortissements en moins), stocks
      else if(v>0)actif.push([c,v]);                   // créances, trésorerie positive
      else passif.push([c,-v]);                        // dettes, découvert
    });
    const r=enCentimes(resultat(ecritures).res);
    const ta=actif.reduce((a,x)=>a+x[1],0),tp=passif.reduce((a,x)=>a+x[1],0)+r;
    const u=L=>L.map(([c,v])=>[c,enUnites(v)]);
    return {actif:u(actif),passif:u(passif),r:enUnites(r),ta:enUnites(ta),tp:enUnites(tp),equilibre:ta===tp};
  }

  function balance(ecritures){
    const s=soldes(ecritures);let td=0,tc=0;
    const lignes=Object.keys(s).sort().map(c=>{td+=enCentimes(s[c].d);tc+=enCentimes(s[c].c);return {compte:c,d:s[c].d,c:s[c].c,solde:sd(s,c)}});
    return {lignes,td:enUnites(td),tc:enUnites(tc),equilibre:td===tc};
  }

  // Grand livre d'un compte : solde d'ouverture (écritures avant « du »), mouvements de la période, solde courant.
  function grandLivre(ecritures,compte,du,au){
    let ouv=0,solde=0,td=0,tc=0;const mouvements=[];
    [...ecritures].sort((a,b)=>a.date.localeCompare(b.date)).forEach(e=>e.lignes.forEach(l=>{
      if(l.compte!==compte)return;
      const d=enCentimes(l.debit||0),c=enCentimes(l.credit||0);
      if(du&&e.date<du){ouv+=d-c;return}
      if(au&&e.date>au)return;
      if(!mouvements.length)solde=ouv;
      solde+=d-c;td+=d;tc+=c;
      mouvements.push({e,l,solde:enUnites(solde)});
    }));
    if(!mouvements.length)solde=ouv;
    return {ouverture:enUnites(ouv),mouvements,td:enUnites(td),tc:enUnites(tc),cloture:enUnites(solde)};
  }

  // Facture de vente sur une ligne : TVA et TTC arrondis au centime.
  function calculFacture(ht,taux){
    const h=enCentimes(ht),tva=Math.round(h*(Number(taux)||0)/100);
    return {ht:enUnites(h),tva:enUnites(tva),ttc:enUnites(h+tva)};
  }
  // Facture sur plusieurs lignes : montant de chaque ligne = quantité × prix unitaire, arrondi au centime.
  function calculFactureLignes(lignes,taux){
    const L=lignes.map(l=>{const qte=Number(l.qte)||0,pu=Number(l.pu)||0,c=Math.round(enCentimes(pu)*qte);return {des:l.des,qte,pu:arrondir(pu),montant:enUnites(c),c}});
    const h=L.reduce((a,l)=>a+l.c,0),tva=Math.round(h*(Number(taux)||0)/100);
    return {lignes:L.map(({c,...l})=>l),ht:enUnites(h),tva:enUnites(tva),ttc:enUnites(h+tva)};
  }
  function lignesFacture({ht,tva,ttc,compte}){
    const L=[{compte:"411",debit:ttc,credit:0},{compte,debit:0,credit:ht}];
    if(enCentimes(tva))L.push({compte:"4431",debit:0,credit:tva});
    return L;
  }

  // ---------- Validation, contrepassation et exercices ----------
  // Une écriture validée ne se modifie plus et ne se supprime plus : on la corrige par contrepassation.
  // Une écriture sans statut (anciennes données) est au brouillard, donc encore modifiable.
  const estValidee=e=>e.statut==="validee";
  // Exercice clôturé qui contient cette date, ou null si la période est ouverte.
  const exerciceClos=(exercices,date)=>(exercices||[]).find(x=>x.cloture&&date>=x.debut&&date<=x.fin)||null;
  // Contrepassation : mêmes comptes et montants, débit et crédit inversés. L'écriture d'origine reste intacte.
  function contrepasser(e,{id,date}){
    return {id,date,piece:e.piece||"",libelle:("Contrepassation : "+e.libelle).slice(0,300),contrepasse:e.id,statut:"validee",valideeLe:date,
      lignes:e.lignes.map(l=>({compte:l.compte,debit:l.credit||0,credit:l.debit||0}))};
  }
  function controleExercice(exercices,x){
    if(!DATE.test(String(x.debut))||!DATE.test(String(x.fin)))return ["Dates de l'exercice invalides."];
    if(x.fin<x.debut)return ["La fin de l'exercice doit être après son début."];
    const autre=(exercices||[]).find(y=>y.id!==x.id&&x.debut<=y.fin&&y.debut<=x.fin);
    return autre?[`Cet exercice chevauche l'exercice du ${autre.debut} au ${autre.fin}.`]:[];
  }
  // Conditions de clôture : toutes les écritures de l'exercice validées, et équilibrées.
  function controleCloture(ecritures,x){
    const dans=ecritures.filter(e=>e.date>=x.debut&&e.date<=x.fin),err=[];
    const b=dans.filter(e=>!estValidee(e)).length;
    if(b)err.push(`${b} écriture(s) de l'exercice sont encore au brouillard : validez-les avant la clôture.`);
    if(!equilibree(dans.flatMap(e=>e.lignes)))err.push("Les écritures de l'exercice ne sont pas équilibrées.");
    return err;
  }

  // Contrôle d'une sauvegarde avant restauration : structure, dates, comptes, montants, équilibre.
  // Les identifiants et numéros sont insérés dans la page : ils doivent rester de simples codes.
  const CODE=/^[A-Za-z0-9_-]{1,40}$/,DATE=/^\d{4}-\d{2}-\d{2}$/,COMPTE=/^[1-9]\d{1,7}$/;
  const montantOk=v=>v===undefined||v===null||(typeof v==="number"&&isFinite(v)&&v>=0);
  function controleSauvegarde(d){
    const err=[];
    if(!d||typeof d!=="object"||!Array.isArray(d.ecritures)||!Array.isArray(d.factures))return ["Ce fichier n'est pas une sauvegarde CompteAssist."];
    d.ecritures.forEach((e,i)=>{
      const n=`Écriture ${i+1} : `;
      if(!e||typeof e!=="object"){err.push(n+"illisible.");return}
      if(e.id!==undefined&&!CODE.test(String(e.id)))err.push(n+"identifiant invalide.");
      if(!DATE.test(String(e.date)))err.push(n+"date invalide.");
      if(e.statut!==undefined&&e.statut!=="brouillon"&&e.statut!=="validee")err.push(n+"statut invalide.");
      if(e.contrepasse!==undefined&&!CODE.test(String(e.contrepasse)))err.push(n+"référence de contrepassation invalide.");
      if(!Array.isArray(e.lignes)||e.lignes.length<2){err.push(n+"au moins deux lignes requises.");return}
      if(e.lignes.some(l=>!l||!COMPTE.test(String(l.compte))))err.push(n+"numéro de compte invalide.");
      if(e.lignes.some(l=>l&&(!montantOk(l.debit)||!montantOk(l.credit))))err.push(n+"montant invalide.");
      else if(!equilibree(e.lignes))err.push(n+"débit et crédit ne sont pas égaux.");
    });
    d.factures.forEach((f,i)=>{
      const n=`Facture ${i+1} : `;
      if(!f||!CODE.test(String(f.num)))err.push(n+"numéro invalide.");
      else if(!["ht","tva","ttc"].every(k=>montantOk(f[k])))err.push(n+"montant invalide.");
    });
    if(d.exercices!==undefined&&(!Array.isArray(d.exercices)||d.exercices.some(x=>!x||!CODE.test(String(x.id))||!DATE.test(String(x.debut))||!DATE.test(String(x.fin))||x.fin<x.debut)))err.push("Exercices comptables : dates ou identifiant invalides.");
    if(d.comptes!==undefined&&(!Array.isArray(d.comptes)||d.comptes.some(c=>!c||!COMPTE.test(String(c.num)))))err.push("Plan comptable : numéro de compte invalide.");
    return err;
  }

  return {enCentimes,enUnites,arrondir,somme,equilibree,verifierLignes,soldes,sd,resultat,bilan,balance,grandLivre,calculFacture,calculFactureLignes,lignesFacture,
    estValidee,exerciceClos,contrepasser,controleExercice,controleCloture,controleSauvegarde};
})();
if(typeof module==="object"&&module.exports)module.exports=Moteur;
