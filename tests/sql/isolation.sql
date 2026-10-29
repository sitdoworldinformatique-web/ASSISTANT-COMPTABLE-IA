-- Tests de la base Supabase : isolation entre entreprises, contrôles des écritures, droits.
-- Lancés par tests/sql/lancer.sh sur une base vide (simulation-supabase.sql puis schema.sql).
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

-- doit_echouer(requête, extrait du message attendu) : la requête doit être refusée.
create or replace function public.doit_echouer(q text, attendu text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if position(lower(attendu) in lower(sqlerrm)) = 0 then
      raise exception 'Refus inattendu pour [%] : %', q, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Aurait dû être refusé : %', q;
end $$;
grant execute on function public.doit_echouer(text, text) to anon, authenticated;

create or replace function public.connecter(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false)
$$;
grant execute on function public.connecter(uuid) to anon, authenticated;

insert into auth.users(id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'awa@exemple.cd', '{"nom":"Awa","tel":"+243 812345678","pays":"CD"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bako@exemple.ci', '{"nom":"Bako","tel":"pas un numéro","pays":"CI"}');

-- Test 1 : le profil est créé à l'inscription, un téléphone mal formé est ignoré.
do $$ begin
  assert (select tel from profils where nom = 'Awa') = '+243 812345678', 'profil Awa';
  assert (select tel is null and pays = 'CI' from profils where nom = 'Bako'), 'profil Bako';
end $$;

-- Chaque utilisateur crée son entreprise.
set role authenticated;
select connecter('00000000-0000-0000-0000-00000000000a');
select creer_entreprise('Awa SARL', 'CD', 'CDF');
select connecter('00000000-0000-0000-0000-00000000000b');
select creer_entreprise('Bako & Fils', 'CI', 'XOF');
reset role;
-- ea() et eb() : identifiants des deux entreprises, figés pour les tests.
do $$ declare a uuid := (select id from entreprises where nom = 'Awa SARL'); b uuid := (select id from entreprises where nom = 'Bako & Fils');
begin
  execute format('create or replace function public.ea() returns uuid language sql immutable as %L', format('select %L::uuid', a));
  execute format('create or replace function public.eb() returns uuid language sql immutable as %L', format('select %L::uuid', b));
end $$;
grant execute on function public.ea(), public.eb() to authenticated, anon;

set role authenticated;
select connecter('00000000-0000-0000-0000-00000000000a');

-- Test 2 : une écriture équilibrée est enregistrée en centimes entiers.
select enregistrer_ecriture(ea(), '{"id":"e1","date":"2026-10-01","piece":"F001","libelle":"Vente","lignes":[
  {"compte":"411","debit":1234.5,"credit":0},{"compte":"701","debit":0,"credit":1000},{"compte":"4431","debit":0,"credit":234.5}]}');
do $$ begin
  assert (select sum(debit) from lignes where ecriture_id = 'e1') = 123450, 'débit en centimes';
  assert (select sum(credit) from lignes where ecriture_id = 'e1') = 123450, 'crédit en centimes';
  assert (select count(*) from lignes where ecriture_id = 'e1') = 3, '3 lignes';
end $$;

-- Test 3 : les écritures incorrectes sont refusées par le serveur.
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"x1","date":"2026-10-01","libelle":"Déséquilibrée","lignes":[{"compte":"601","debit":100},{"compte":"571","credit":99.99}]}')$q$, 'ne sont pas égaux');
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"x2","date":"2026-10-01","libelle":"Flottant","lignes":[{"compte":"601","debit":0.30000000000000004},{"compte":"571","credit":0.3}]}')$q$, 'deux décimales');
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"x3","date":"2026-10-01","libelle":"Seule","lignes":[{"compte":"601","debit":100}]}')$q$, 'deux lignes');
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"x4","date":"2026-10-01","libelle":"Négatif","lignes":[{"compte":"601","debit":-5},{"compte":"571","credit":-5}]}')$q$, 'négatif');
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"x5","date":"2026-10-01","libelle":"Double","lignes":[{"compte":"601","debit":5,"credit":5},{"compte":"571","debit":0,"credit":0}]}')$q$, 'lignes_check');
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"x6","date":"2026-10-01","libelle":"Compte","lignes":[{"compte":"abc","debit":5},{"compte":"571","credit":5}]}')$q$, 'lignes_compte_check');
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"x7","date":"01/10/2026","libelle":"Date","lignes":[{"compte":"601","debit":5},{"compte":"571","credit":5}]}')$q$, 'date invalide');
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"x8","date":"2026-10-01","libelle":"Texte","lignes":[{"compte":"601","debit":"5"},{"compte":"571","credit":5}]}')$q$, 'montant invalide');
do $$ begin assert (select count(*) from ecritures where id like 'x%') = 0, 'aucune écriture refusée enregistrée'; end $$;

-- Test 4 : on ne peut pas contourner les contrôles en écrivant directement dans les tables.
select doit_echouer($q$insert into ecritures(entreprise_id, id, date, libelle) values (ea(), 'y1', '2026-10-01', 'direct')$q$, 'permission denied');
select doit_echouer($q$insert into lignes(entreprise_id, ecriture_id, rang, compte, debit) values (ea(), 'e1', 9, '601', 1)$q$, 'permission denied');
select doit_echouer($q$update lignes set debit = 1 where ecriture_id = 'e1'$q$, 'permission denied');
select doit_echouer($q$insert into abonnements(user_id, plan, fin) values (auth.uid(), 'a2', now() + interval '10 years')$q$, 'permission denied');

-- Test 5 : la modification remplace les lignes et laisse une trace avec l'état d'avant.
select enregistrer_ecriture(ea(), '{"id":"e1","date":"2026-10-02","piece":"F001","libelle":"Vente corrigée","lignes":[
  {"compte":"411","debit":1500,"credit":0},{"compte":"701","debit":0,"credit":1500}]}');
do $$ begin
  assert (select count(*) from lignes where ecriture_id = 'e1') = 2, 'anciennes lignes remplacées';
  assert (select avant->>'libelle' from journal_audit where objet = 'ecriture e1' and action = 'modification') = 'Vente', 'audit avant';
end $$;

-- Test 6 : facture contrôlée (HT + TVA = TTC, centimes).
select enregistrer_facture(ea(), '{"num":"F001","date":"2026-10-02","client":"Client A","ht":1000,"tva":160,"ttc":1160,"payee":null}');
select doit_echouer($q$select enregistrer_facture(ea(), '{"num":"F002","date":"2026-10-02","client":"Client B","ht":1000,"tva":160,"ttc":1100}')$q$, 'différent du ttc');
do $$ begin assert (select ttc from factures where num = 'F001') = 116000, 'TTC en centimes'; end $$;

-- Test 7 (test 8 de la mission) : isolation entre entreprises.
select connecter('00000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from entreprises) = 1, 'Bako ne voit que son entreprise';
  assert (select count(*) from ecritures) = 0, 'Bako ne voit pas les écritures d''Awa';
  assert (select count(*) from lignes) = 0, 'ni leurs lignes';
  assert (select count(*) from factures) = 0, 'ni ses factures';
  assert (select count(*) from journal_audit where entreprise_id = ea()) = 0, 'ni son journal d''audit';
  assert (select count(*) from profils) = 1, 'ni son profil';
end $$;
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"z1","date":"2026-10-01","libelle":"Intrus","lignes":[{"compte":"601","debit":5},{"compte":"571","credit":5}]}')$q$, 'accès refusé');
select doit_echouer($q$select supprimer_ecriture(ea(), 'e1')$q$, 'accès refusé');
select doit_echouer($q$select enregistrer_facture(ea(), '{"num":"F009","date":"2026-10-02","ht":1,"tva":0,"ttc":1}')$q$, 'accès refusé');
select doit_echouer($q$select inviter_membre(ea(), 'bako@exemple.ci', 'comptable')$q$, 'propriétaire');
update entreprises set nom = 'Piratée' where id = ea();
insert into comptes_perso(entreprise_id, num, nom) select eb(), '6011', 'Achats locaux';
select doit_echouer($q$insert into comptes_perso(entreprise_id, num, nom) values (ea(), '6012', 'Intrus')$q$, 'row-level security');
reset role;
do $$ begin
  assert (select nom from entreprises where id = ea()) = 'Awa SARL', 'nom non modifiable par un autre';
  assert (select count(*) from lignes where ecriture_id = 'e1') = 2, 'écriture intacte';
end $$;

-- Test 8 : un lecteur voit les données mais ne peut rien modifier.
set role authenticated;
select connecter('00000000-0000-0000-0000-00000000000a');
select inviter_membre(ea(), 'BAKO@exemple.ci', 'lecteur');
select connecter('00000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from ecritures where entreprise_id = ea()) = 1, 'le lecteur voit les écritures';
  assert mon_role(ea()) = 'lecteur', 'rôle lecteur';
end $$;
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"z2","date":"2026-10-01","libelle":"Lecteur","lignes":[{"compte":"601","debit":5},{"compte":"571","credit":5}]}')$q$, 'accès refusé');

-- Test 9 : sans connexion, aucun accès.
reset role;
set role anon;
select connecter(null);
select doit_echouer('select count(*) from ecritures', 'permission denied');
select doit_echouer($q$select creer_entreprise('Anonyme', 'CD', 'CDF')$q$, 'permission denied');
reset role;

-- Test 10 : la suppression est tracée avec le contenu supprimé.
set role authenticated;
select connecter('00000000-0000-0000-0000-00000000000a');
select supprimer_ecriture(ea(), 'e1');
do $$ begin
  assert (select count(*) from ecritures where id = 'e1') = 0, 'écriture supprimée';
  assert (select jsonb_array_length(avant->'lignes') from journal_audit where objet = 'ecriture e1' and action = 'suppression') = 2, 'lignes conservées dans l''audit';
end $$;
reset role;

-- Test 11 : une écriture validée ne se modifie plus et ne se supprime plus ; la contrepassation passe.
set role authenticated;
select connecter('00000000-0000-0000-0000-00000000000a');
select enregistrer_ecriture(ea(), '{"id":"v1","date":"2026-03-10","libelle":"Loyer","lignes":[{"compte":"622","debit":800},{"compte":"521","credit":800}]}');
select enregistrer_ecriture(ea(), '{"id":"v1","date":"2026-03-10","libelle":"Loyer","statut":"validee","lignes":[{"compte":"622","debit":800},{"compte":"521","credit":800}]}');
do $$ begin assert (select statut = 'validee' and valide_le is not null from ecritures where id = 'v1'), 'validée'; end $$;
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"v1","date":"2026-03-10","libelle":"Loyer modifié","statut":"validee","lignes":[{"compte":"622","debit":900},{"compte":"521","credit":900}]}')$q$, 'contrepassation');
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"v1","date":"2026-03-10","libelle":"Loyer","statut":"brouillon","lignes":[{"compte":"622","debit":800},{"compte":"521","credit":800}]}')$q$, 'contrepassation');
select doit_echouer($q$select supprimer_ecriture(ea(), 'v1')$q$, 'contrepassation');
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"v9","date":"2026-03-10","libelle":"X","statut":"effacee","lignes":[{"compte":"622","debit":1},{"compte":"521","credit":1}]}')$q$, 'statut invalide');
select enregistrer_ecriture(ea(), '{"id":"cp1","date":"2026-03-11","libelle":"Contrepassation : Loyer","statut":"validee","contrepasse":"v1","lignes":[{"compte":"622","credit":800},{"compte":"521","debit":800}]}');
do $$ begin
  assert (select sum(debit) - sum(credit) from lignes where entreprise_id = ea() and compte = '622' and ecriture_id in ('v1','cp1')) = 0, 'contrepassation annule le loyer';
  assert (select contrepasse from ecritures where id = 'cp1') = 'v1', 'lien de contrepassation';
end $$;

-- Test 12 : clôture refusée tant qu'il reste du brouillard dans l'exercice ; chevauchement refusé.
select enregistrer_ecriture(ea(), '{"id":"b1","date":"2026-06-01","libelle":"Brouillon","lignes":[{"compte":"601","debit":50},{"compte":"571","credit":50}]}');
select enregistrer_exercice(ea(), '{"id":"x2026","debut":"2026-01-01","fin":"2026-12-31","cloture":false}');
select doit_echouer($q$select enregistrer_exercice(ea(), '{"id":"x2026","debut":"2026-01-01","fin":"2026-12-31","cloture":true}')$q$, 'brouillard');
select doit_echouer($q$select enregistrer_exercice(ea(), '{"id":"xbis","debut":"2026-07-01","fin":"2027-06-30"}')$q$, 'chevauche');

-- Test 13 : après clôture, la période est verrouillée et l'exercice ne se rouvre pas.
select enregistrer_ecriture(ea(), '{"id":"b1","date":"2026-06-01","libelle":"Brouillon","statut":"validee","lignes":[{"compte":"601","debit":50},{"compte":"571","credit":50}]}');
select enregistrer_exercice(ea(), '{"id":"x2026","debut":"2026-01-01","fin":"2026-12-31","cloture":true}');
do $$ begin assert (select cloture and cloture_le is not null from exercices where id = 'x2026'), 'exercice clôturé'; end $$;
select doit_echouer($q$select enregistrer_ecriture(ea(), '{"id":"n1","date":"2026-08-01","libelle":"Tardive","lignes":[{"compte":"601","debit":5},{"compte":"571","credit":5}]}')$q$, 'clôturée');
select doit_echouer($q$select enregistrer_exercice(ea(), '{"id":"x2026","debut":"2026-01-01","fin":"2026-12-31","cloture":false}')$q$, 'ne peut plus être modifié');
select doit_echouer($q$select supprimer_exercice(ea(), 'x2026')$q$, 'ne peut pas être supprimé');
-- Une erreur d'un exercice clos se corrige par contrepassation datée dans l'exercice suivant.
select enregistrer_ecriture(ea(), '{"id":"cp2","date":"2027-01-05","libelle":"Contrepassation : Brouillon","statut":"validee","contrepasse":"b1","lignes":[{"compte":"601","credit":50},{"compte":"571","debit":50}]}');
do $$ begin assert (select count(*) from journal_audit where objet = 'exercice x2026' and action = 'cloture') = 1, 'clôture tracée'; end $$;

-- Test 14 : un autre utilisateur ne voit pas les exercices et ne peut pas en créer chez Awa.
select connecter('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from exercices where entreprise_id = ea()) = 1, 'Bako, lecteur chez Awa, voit l''exercice'; end $$;
select doit_echouer($q$select enregistrer_exercice(ea(), '{"id":"pirate","debut":"2030-01-01","fin":"2030-12-31"}')$q$, 'accès refusé');
reset role;

\echo 'Base Supabase : tous les tests sont passés.'
