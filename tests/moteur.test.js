const test=require("node:test"),assert=require("node:assert/strict");
const M=require("./charger-moteur");

const E=(date,piece,libelle,lignes)=>({id:piece,date,piece,libelle,lignes:lignes.map(([compte,debit,credit])=>({compte,debit,credit}))});
// Jeu de données de référence (montants connus) : apport, achat, loyer, facture, encaissement, vente comptant.
const jeu=()=>[
  E("2026-01-02","E1","Apport en capital",[["521",10000,0],["101",0,10000]]),
  E("2026-01-05","E2","Achat ordinateur",[["244",1200,0],["521",0,1200]]),
  E("2026-01-10","E3","Loyer",[["622",800,0],["521",0,800]]),
  E("2026-02-03","F0001","Facture Client A",[["411",2320,0],["706",0,2000],["4431",0,320]]),
  E("2026-02-20","F0001","Encaissement F0001",[["552",2320,0],["411",0,2320]]),
  E("2026-03-04","E4","Vente marchandises",[["571",1500,0],["701",0,1500]]),
];

test("arrondis : calculs en centimes sans erreur de virgule flottante",()=>{
  assert.equal(M.enCentimes(1.005),101);
  assert.equal(M.enCentimes(-1.005),-101);
  assert.equal(M.enCentimes(0.1)+M.enCentimes(0.2),M.enCentimes(0.3));
  assert.equal(M.arrondir(0.1+0.2),0.3);
  assert.equal(M.enCentimes("abc"),0);
  // 1000 lignes de 0,10 donnent exactement 100,00
  const L=Array.from({length:1000},()=>({compte:"571",debit:0.1,credit:0}));
  assert.equal(M.enUnites(M.somme(L,"debit")),100);
});

test("écriture : partie double, refus si déséquilibrée",()=>{
  const ok=[{compte:"622",debit:0.1,credit:0},{compte:"622",debit:0.2,credit:0},{compte:"571",debit:0,credit:0.3}];
  assert.equal(M.equilibree(ok),true);
  assert.deepEqual(M.verifierLignes(ok,()=>true),[]);
  const ko=[{compte:"622",debit:100,credit:0},{compte:"571",debit:0,credit:99.99}];
  assert.ok(M.verifierLignes(ko,()=>true).includes("Débit et crédit doivent être égaux."));
  assert.ok(M.verifierLignes([{compte:"622",debit:10,credit:0}],()=>true).includes("Au moins deux lignes."));
  assert.ok(M.verifierLignes([{compte:"999",debit:5,credit:0},{compte:"571",debit:0,credit:5}],c=>c!=="999")[0].includes("absent du plan"));
  assert.ok(M.verifierLignes([{compte:"622",debit:5,credit:5},{compte:"571",debit:0,credit:0}],()=>true).some(e=>e.includes("pas les deux")));
});

test("test 1 : facture de vente (totaux, TVA, client, produit)",()=>{
  const f=M.calculFacture(2000,16);
  assert.deepEqual(f,{ht:2000,tva:320,ttc:2320});
  const L=M.lignesFacture({...f,compte:"706"});
  assert.equal(M.equilibree(L),true);
  assert.deepEqual(L,[{compte:"411",debit:2320,credit:0},{compte:"706",debit:0,credit:2000},{compte:"4431",debit:0,credit:320}]);
  // TVA arrondie au centime
  assert.deepEqual(M.calculFacture(33.33,18),{ht:33.33,tva:6,ttc:39.33});
  // Sans TVA : pas de ligne 4431
  assert.equal(M.lignesFacture({...M.calculFacture(500,0),compte:"701"}).length,2);
});

test("test 4 : le grand livre reprend exactement les écritures sources",()=>{
  const ecr=jeu();
  const g=M.grandLivre(ecr,"521");
  assert.equal(g.mouvements.length,3);
  assert.equal(g.td,10000);assert.equal(g.tc,2000);assert.equal(g.cloture,8000);
  assert.deepEqual(g.mouvements.map(m=>m.solde),[10000,8800,8000]);
  // Avec une période : solde d'ouverture = écritures antérieures
  const p=M.grandLivre(ecr,"411","2026-02-10","2026-12-31");
  assert.equal(p.ouverture,2320);assert.equal(p.tc,2320);assert.equal(p.cloture,0);
  // Période sans mouvement : le solde de clôture est le solde d'ouverture
  const v=M.grandLivre(ecr,"521","2026-03-01");
  assert.equal(v.mouvements.length,0);assert.equal(v.cloture,8000);
  // Pour chaque compte, grand livre = soldes calculés
  const s=M.soldes(ecr);
  Object.keys(s).forEach(c=>assert.equal(M.grandLivre(ecr,c).cloture,M.sd(s,c),c));
});

test("test 5 : balance équilibrée et cohérente avec les écritures",()=>{
  const b=M.balance(jeu());
  assert.equal(b.equilibre,true);
  assert.equal(b.td,b.tc);
  assert.equal(b.td,10000+1200+800+2320+2320+1500);
  const total=b.lignes.reduce((a,l)=>a+M.enCentimes(l.solde),0);
  assert.equal(total,0);
  assert.deepEqual(b.lignes.find(l=>l.compte==="411"),{compte:"411",d:2320,c:2320,solde:0});
});

test("test 10 : résultat et bilan concordent avec la balance",()=>{
  const ecr=jeu(),r=M.resultat(ecr);
  assert.deepEqual(r,{prod:3500,ch:800,hao:0,res:2700});
  const b=M.bilan(ecr);
  assert.equal(b.equilibre,true);
  assert.equal(b.ta,b.tp);
  assert.equal(b.r,2700);
  assert.equal(b.ta,1200+8000+2320+1500);
  assert.deepEqual(b.passif,[["101",10000],["4431",320]]);
});

test("restauration : une sauvegarde valide est acceptée",()=>{
  assert.deepEqual(M.controleSauvegarde({ecritures:jeu(),factures:[{num:"F0001",ht:2000,tva:320,ttc:2320}],comptes:[{num:"5211",nom:"Rawbank"}]}),[]);
});

test("restauration : sauvegardes altérées refusées",()=>{
  assert.equal(M.controleSauvegarde(null).length,1);
  assert.equal(M.controleSauvegarde({ecritures:[]}).length,1);
  const deseq=jeu();deseq[0].lignes[0].debit=9999;
  assert.match(M.controleSauvegarde({ecritures:deseq,factures:[]})[0],/pas égaux/);
  const piege=jeu();piege[0].id="x');alert(1);//";
  assert.match(M.controleSauvegarde({ecritures:piege,factures:[]})[0],/identifiant invalide/);
  assert.match(M.controleSauvegarde({ecritures:[],factures:[{num:"<img src=x>",ht:1,tva:0,ttc:1}]})[0],/numéro invalide/);
  assert.match(M.controleSauvegarde({ecritures:[],factures:[],comptes:[{num:"1'><b>",nom:"x"}]})[0],/compte invalide/);
  const neg=jeu();neg[1].lignes[0].debit=-5;
  assert.match(M.controleSauvegarde({ecritures:neg,factures:[]})[0],/montant invalide/);
  const date=jeu();date[2].date="10/01/2026";
  assert.match(M.controleSauvegarde({ecritures:date,factures:[]})[0],/date invalide/);
});

test("facture sur plusieurs lignes : quantité × prix unitaire, TVA sur le total",()=>{
  const r=M.calculFactureLignes([{des:"Audit comptable",qte:1,pu:1800000},{des:"Formation SYSCOHADA",qte:2,pu:350000}],16);
  assert.equal(r.ht,2500000);assert.equal(r.tva,400000);assert.equal(r.ttc,2900000);
  assert.deepEqual(r.lignes.map(l=>l.montant),[1800000,700000]);
  // Arrondi au centime ligne par ligne : 3 × 33,333 = 99,99 (pas 100)
  assert.equal(M.calculFactureLignes([{des:"x",qte:3,pu:33.333}],0).ht,99.99);
  // Quantité décimale
  assert.equal(M.calculFactureLignes([{des:"x",qte:1.5,pu:10.01}],0).ht,15.02);
  // Mêmes montants que la facture sur une ligne
  assert.deepEqual((({ht,tva,ttc})=>({ht,tva,ttc}))(M.calculFactureLignes([{des:"x",qte:1,pu:2000}],16)),M.calculFacture(2000,16));
});

test("contrepassation : comptes identiques, débit et crédit inversés, origine intacte",()=>{
  const e=jeu()[3],avant=JSON.stringify(e);
  const c=M.contrepasser(e,{id:"c1",date:"2026-03-31"});
  assert.equal(JSON.stringify(e),avant);
  assert.equal(c.contrepasse,"F0001");assert.equal(c.statut,"validee");assert.equal(c.piece,"F0001");
  assert.deepEqual(c.lignes,[{compte:"411",debit:0,credit:2320},{compte:"706",debit:2000,credit:0},{compte:"4431",debit:320,credit:0}]);
  assert.equal(M.equilibree(c.lignes),true);
  // Écriture + contrepassation : tous les comptes reviennent à zéro.
  const s=M.soldes([e,c]);
  ["411","706","4431"].forEach(k=>assert.equal(M.sd(s,k),0));
  assert.equal(M.resultat([e,c]).res,0);
});

test("exercices : chevauchement refusé, période clôturée détectée",()=>{
  const ex=[{id:"x2025",debut:"2025-01-01",fin:"2025-12-31",cloture:true},{id:"x2026",debut:"2026-01-01",fin:"2026-12-31",cloture:false}];
  assert.deepEqual(M.controleExercice(ex,{id:"n",debut:"2027-01-01",fin:"2027-12-31"}),[]);
  assert.equal(M.controleExercice(ex,{id:"n",debut:"2026-07-01",fin:"2027-06-30"}).length,1);
  assert.equal(M.controleExercice(ex,{id:"n",debut:"2027-12-31",fin:"2027-01-01"}).length,1);
  assert.equal(M.controleExercice(ex,{id:"x2026",debut:"2026-01-01",fin:"2026-12-31"}).length,0,"un exercice ne se chevauche pas lui-même");
  assert.equal(M.exerciceClos(ex,"2025-06-15").id,"x2025");
  assert.equal(M.exerciceClos(ex,"2026-06-15"),null);
  assert.equal(M.exerciceClos(ex,"2024-12-31"),null);
});

test("clôture : refusée tant qu'une écriture de l'exercice est au brouillard",()=>{
  const x={id:"x2026",debut:"2026-01-01",fin:"2026-12-31"},E2=jeu();
  assert.match(M.controleCloture(E2,x)[0],/6 écriture\(s\).*brouillard/);
  E2.forEach(e=>e.statut="validee");
  assert.deepEqual(M.controleCloture(E2,x),[]);
  // Une écriture hors de l'exercice ne bloque pas.
  E2.push({...E2[0],id:"z",date:"2027-01-02",statut:undefined});
  assert.deepEqual(M.controleCloture(E2,x),[]);
});

test("sauvegarde : statut et exercices contrôlés",()=>{
  const d={ecritures:jeu(),factures:[],exercices:[{id:"x1",debut:"2026-01-01",fin:"2026-12-31",cloture:false}]};
  assert.deepEqual(M.controleSauvegarde(d),[]);
  d.ecritures[0].statut="effacee";
  d.exercices[0].fin="2025-01-01";
  const err=M.controleSauvegarde(d);
  assert.equal(err.length,2);
});
