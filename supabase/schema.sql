-- =====================================================================
-- CompteAssist : base de données Supabase (PostgreSQL)
-- À coller une seule fois dans Supabase > SQL Editor, puis « Run ».
-- Le script peut être relancé : il ne supprime aucune donnée.
--
-- Principes :
--  * chaque entreprise ne voit que ses propres données (Row Level Security) ;
--  * les montants sont stockés en centimes entiers (bigint), jamais en flottants ;
--  * une écriture ne s'enregistre que par la fonction enregistrer_ecriture,
--    qui refuse toute écriture déséquilibrée ou mal formée ;
--  * chaque création, modification ou suppression est tracée dans journal_audit.
-- =====================================================================

-- ---------- Tables ----------

create table if not exists public.profils(
  id uuid primary key references auth.users(id) on delete cascade,
  nom text not null default '' check (char_length(nom) <= 120),
  tel text check (tel ~ '^\+[0-9]{1,4} [0-9]{6,12}$'),
  pays text check (pays ~ '^[A-Z]{2}$'),
  cree_le timestamptz not null default now()
);

create table if not exists public.entreprises(
  id uuid primary key default gen_random_uuid(),
  nom text not null check (char_length(nom) between 1 and 160),
  pays text check (pays ~ '^[A-Z]{2}$'),
  devise text not null check (devise ~ '^[A-Z]{3}$'),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  cree_par uuid references auth.users(id) on delete set null,
  cree_le timestamptz not null default now()
);

create table if not exists public.membres(
  entreprise_id uuid not null references public.entreprises(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('proprietaire','comptable','lecteur')),
  ajoute_le timestamptz not null default now(),
  primary key (entreprise_id, user_id)
);
create index if not exists membres_user on public.membres(user_id);

create table if not exists public.ecritures(
  entreprise_id uuid not null references public.entreprises(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  date date not null,
  piece text not null default '' check (char_length(piece) <= 60),
  libelle text not null check (char_length(libelle) between 1 and 300),
  lien text check (lien ~ '^[a-z_]{1,30}$'),
  maj_le timestamptz not null default now(),
  maj_par uuid references auth.users(id) on delete set null,
  primary key (entreprise_id, id)
);
create index if not exists ecritures_date on public.ecritures(entreprise_id, date);
-- Brouillard ou validée. Une écriture validée ne se modifie plus : on la corrige par contrepassation.
alter table public.ecritures add column if not exists statut text not null default 'brouillon' check (statut in ('brouillon','validee'));
alter table public.ecritures add column if not exists valide_le date;
alter table public.ecritures add column if not exists contrepasse text check (contrepasse ~ '^[A-Za-z0-9_-]{1,40}$');

-- Exercices comptables : un exercice clôturé verrouille sa période.
create table if not exists public.exercices(
  entreprise_id uuid not null references public.entreprises(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  debut date not null,
  fin date not null,
  cloture boolean not null default false,
  cloture_le timestamptz,
  check (fin >= debut),
  primary key (entreprise_id, id)
);

create table if not exists public.lignes(
  entreprise_id uuid not null,
  ecriture_id text not null,
  rang int not null check (rang between 1 and 500),
  compte text not null check (compte ~ '^[1-9][0-9]{1,7}$'),
  debit bigint not null default 0 check (debit >= 0),
  credit bigint not null default 0 check (credit >= 0),
  check ((debit > 0) <> (credit > 0)),
  primary key (entreprise_id, ecriture_id, rang),
  foreign key (entreprise_id, ecriture_id) references public.ecritures(entreprise_id, id) on delete cascade
);
create index if not exists lignes_compte on public.lignes(entreprise_id, compte);

create table if not exists public.factures(
  entreprise_id uuid not null references public.entreprises(id) on delete cascade,
  num text not null check (num ~ '^[A-Za-z0-9_-]{1,40}$'),
  date date not null,
  client text not null default '' check (char_length(client) <= 200),
  ht bigint not null check (ht >= 0),
  tva bigint not null check (tva >= 0),
  ttc bigint not null check (ttc >= 0),
  -- Détail complet (lignes, échéance, paiement, annulation) tel que l'app l'enregistre.
  donnees jsonb not null check (jsonb_typeof(donnees) = 'object'),
  maj_le timestamptz not null default now(),
  maj_par uuid references auth.users(id) on delete set null,
  primary key (entreprise_id, num)
);

create table if not exists public.comptes_perso(
  entreprise_id uuid not null references public.entreprises(id) on delete cascade,
  num text not null check (num ~ '^[1-9][0-9]{1,7}$'),
  nom text not null check (char_length(nom) between 1 and 160),
  primary key (entreprise_id, num)
);

-- Abonnements : en lecture seule pour l'utilisateur. Ils seront écrits par le
-- serveur de paiement (clé service_role), jamais par le navigateur.
create table if not exists public.abonnements(
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null,
  fin timestamptz not null,
  essai_utilise boolean not null default false,
  maj_le timestamptz not null default now()
);

create table if not exists public.journal_audit(
  id bigint generated always as identity primary key,
  entreprise_id uuid not null references public.entreprises(id) on delete cascade,
  quand timestamptz not null default now(),
  qui uuid,
  action text not null,
  objet text not null,
  avant jsonb,
  apres jsonb
);
create index if not exists audit_entreprise on public.journal_audit(entreprise_id, quand);

-- ---------- Fonctions utilitaires ----------

-- Rôle de l'utilisateur connecté dans une entreprise (null s'il n'en est pas membre).
create or replace function public.mon_role(p_entreprise uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.membres where entreprise_id = p_entreprise and user_id = auth.uid()
$$;

create or replace function public.peut_ecrire(p_entreprise uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mon_role(p_entreprise) in ('proprietaire','comptable'), false)
$$;

create or replace function public.periode_close(p_entreprise uuid, p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.exercices where entreprise_id = p_entreprise and cloture and p_date between debut and fin)
$$;

-- Montant en unités (ex. 1234.5) -> centimes entiers. Refuse plus de 2 décimales.
create or replace function public.vers_centimes(v jsonb, quoi text) returns bigint
language plpgsql immutable as $$
declare n numeric;
begin
  if v is null or v = 'null'::jsonb then return 0; end if;
  if jsonb_typeof(v) <> 'number' then raise exception '%: montant invalide', quoi using errcode = '22023'; end if;
  n := (v #>> '{}')::numeric;
  if n < 0 then raise exception '%: montant négatif', quoi using errcode = '22023'; end if;
  if n * 100 <> trunc(n * 100) then raise exception '%: plus de deux décimales', quoi using errcode = '22023'; end if;
  if n >= 10000000000000 then raise exception '%: montant trop grand', quoi using errcode = '22023'; end if;
  return (n * 100)::bigint;
end $$;

-- ---------- Création du profil à l'inscription ----------

create or replace function public.nouveau_profil() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profils(id, nom, tel, pays) values (
    new.id,
    left(coalesce(m->>'nom', ''), 120),
    case when m->>'tel' ~ '^\+[0-9]{1,4} [0-9]{6,12}$' then m->>'tel' end,
    case when m->>'pays' ~ '^[A-Z]{2}$' then m->>'pays' end
  ) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists profil_a_inscription on auth.users;
create trigger profil_a_inscription after insert on auth.users
  for each row execute function public.nouveau_profil();

-- ---------- Fonctions appelées par l'application ----------

create or replace function public.creer_entreprise(p_nom text, p_pays text, p_devise text, p_params jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if (select count(*) from public.membres where user_id = auth.uid() and role = 'proprietaire') >= 20 then
    raise exception 'Nombre maximal d''entreprises atteint' using errcode = '54000';
  end if;
  insert into public.entreprises(nom, pays, devise, params, cree_par)
    values (p_nom, nullif(p_pays, ''), p_devise, coalesce(p_params, '{}'::jsonb), auth.uid()) returning id into eid;
  insert into public.membres(entreprise_id, user_id, role) values (eid, auth.uid(), 'proprietaire');
  insert into public.journal_audit(entreprise_id, qui, action, objet, apres)
    values (eid, auth.uid(), 'creation', 'entreprise', jsonb_build_object('nom', p_nom, 'pays', p_pays, 'devise', p_devise));
  return eid;
end $$;

-- Crée ou remplace une écriture et ses lignes, en une seule opération.
-- p_ecriture : {"id","date","piece","libelle","lien","lignes":[{"compte","debit","credit"}]} (montants en unités).
create or replace function public.enregistrer_ecriture(p_entreprise uuid, p_ecriture jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  e jsonb := p_ecriture; l jsonb; i int := 0;
  td bigint := 0; tc bigint := 0; d bigint; c bigint;
  avant jsonb;
begin
  if not public.peut_ecrire(p_entreprise) then
    raise exception 'Accès refusé à cette entreprise' using errcode = '42501';
  end if;
  if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'lignes') <> 'array' then
    raise exception 'Écriture illisible' using errcode = '22023';
  end if;
  if jsonb_array_length(e->'lignes') < 2 then
    raise exception 'Écriture %: au moins deux lignes', e->>'id' using errcode = '22023';
  end if;
  if coalesce(e->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Écriture %: date invalide', e->>'id' using errcode = '22023';
  end if;
  for l in select * from jsonb_array_elements(e->'lignes') loop
    td := td + public.vers_centimes(l->'debit', 'Écriture ' || (e->>'id'));
    tc := tc + public.vers_centimes(l->'credit', 'Écriture ' || (e->>'id'));
  end loop;
  if td <> tc then
    raise exception 'Écriture %: débit (%) et crédit (%) ne sont pas égaux', e->>'id', td / 100.0, tc / 100.0 using errcode = '22023';
  end if;

  if coalesce(e->>'statut', 'brouillon') not in ('brouillon','validee') then
    raise exception 'Écriture %: statut invalide', e->>'id' using errcode = '22023';
  end if;
  select to_jsonb(x) into avant from public.ecritures x where entreprise_id = p_entreprise and id = e->>'id';
  if avant->>'statut' = 'validee' then
    raise exception 'Écriture % validée : elle ne peut plus être modifiée. Corrigez-la par une contrepassation.', e->>'id' using errcode = '55000';
  end if;
  if public.periode_close(p_entreprise, (e->>'date')::date)
     or (avant is not null and public.periode_close(p_entreprise, (avant->>'date')::date)) then
    raise exception 'Écriture %: la période est clôturée', e->>'id' using errcode = '55000';
  end if;
  insert into public.ecritures(entreprise_id, id, date, piece, libelle, lien, statut, valide_le, contrepasse, maj_le, maj_par)
    values (p_entreprise, e->>'id', (e->>'date')::date, coalesce(e->>'piece', ''), e->>'libelle', e->>'lien',
            coalesce(e->>'statut', 'brouillon'), case when e->>'statut' = 'validee' then current_date end, e->>'contrepasse', now(), auth.uid())
    on conflict (entreprise_id, id) do update
      set date = excluded.date, piece = excluded.piece, libelle = excluded.libelle, lien = excluded.lien,
          statut = excluded.statut, valide_le = excluded.valide_le, contrepasse = excluded.contrepasse,
          maj_le = now(), maj_par = auth.uid();
  delete from public.lignes where entreprise_id = p_entreprise and ecriture_id = e->>'id';
  for l in select * from jsonb_array_elements(e->'lignes') loop
    i := i + 1;
    d := public.vers_centimes(l->'debit', 'Écriture ' || (e->>'id'));
    c := public.vers_centimes(l->'credit', 'Écriture ' || (e->>'id'));
    insert into public.lignes(entreprise_id, ecriture_id, rang, compte, debit, credit)
      values (p_entreprise, e->>'id', i, l->>'compte', d, c);
  end loop;
  insert into public.journal_audit(entreprise_id, qui, action, objet, avant, apres)
    values (p_entreprise, auth.uid(), case when avant is null then 'creation' else 'modification' end,
            'ecriture ' || (e->>'id'), avant, e);
end $$;

create or replace function public.supprimer_ecriture(p_entreprise uuid, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare avant jsonb;
begin
  if not public.peut_ecrire(p_entreprise) then
    raise exception 'Accès refusé à cette entreprise' using errcode = '42501';
  end if;
  select to_jsonb(x) || jsonb_build_object('lignes', (select jsonb_agg(to_jsonb(y) order by rang) from public.lignes y
           where y.entreprise_id = p_entreprise and y.ecriture_id = p_id))
    into avant from public.ecritures x where entreprise_id = p_entreprise and id = p_id;
  if avant is null then return; end if;
  if avant->>'statut' = 'validee' then
    raise exception 'Écriture % validée : elle ne peut plus être supprimée. Annulez-la par une contrepassation.', p_id using errcode = '55000';
  end if;
  if public.periode_close(p_entreprise, (avant->>'date')::date) then
    raise exception 'Écriture %: la période est clôturée', p_id using errcode = '55000';
  end if;
  delete from public.ecritures where entreprise_id = p_entreprise and id = p_id;
  insert into public.journal_audit(entreprise_id, qui, action, objet, avant)
    values (p_entreprise, auth.uid(), 'suppression', 'ecriture ' || p_id, avant);
end $$;

-- p_facture : l'objet facture de l'application (montants en unités).
create or replace function public.enregistrer_facture(p_entreprise uuid, p_facture jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare f jsonb := p_facture; h bigint; t bigint; c bigint; avant jsonb;
begin
  if not public.peut_ecrire(p_entreprise) then
    raise exception 'Accès refusé à cette entreprise' using errcode = '42501';
  end if;
  if jsonb_typeof(f) <> 'object' then raise exception 'Facture illisible' using errcode = '22023'; end if;
  if coalesce(f->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Facture %: date invalide', f->>'num' using errcode = '22023';
  end if;
  h := public.vers_centimes(f->'ht', 'Facture ' || (f->>'num'));
  t := public.vers_centimes(f->'tva', 'Facture ' || (f->>'num'));
  c := public.vers_centimes(f->'ttc', 'Facture ' || (f->>'num'));
  if h + t <> c then
    raise exception 'Facture %: HT + TVA différent du TTC', f->>'num' using errcode = '22023';
  end if;
  select donnees into avant from public.factures where entreprise_id = p_entreprise and num = f->>'num';
  insert into public.factures(entreprise_id, num, date, client, ht, tva, ttc, donnees, maj_le, maj_par)
    values (p_entreprise, f->>'num', (f->>'date')::date, coalesce(f->>'client', ''), h, t, c, f, now(), auth.uid())
    on conflict (entreprise_id, num) do update
      set date = excluded.date, client = excluded.client, ht = excluded.ht, tva = excluded.tva, ttc = excluded.ttc,
          donnees = excluded.donnees, maj_le = now(), maj_par = auth.uid();
  insert into public.journal_audit(entreprise_id, qui, action, objet, avant, apres)
    values (p_entreprise, auth.uid(), case when avant is null then 'creation' else 'modification' end,
            'facture ' || (f->>'num'), avant, f);
end $$;

create or replace function public.supprimer_facture(p_entreprise uuid, p_num text)
returns void language plpgsql security definer set search_path = public as $$
declare avant jsonb;
begin
  if not public.peut_ecrire(p_entreprise) then
    raise exception 'Accès refusé à cette entreprise' using errcode = '42501';
  end if;
  delete from public.factures where entreprise_id = p_entreprise and num = p_num returning donnees into avant;
  if avant is not null then
    insert into public.journal_audit(entreprise_id, qui, action, objet, avant)
      values (p_entreprise, auth.uid(), 'suppression', 'facture ' || p_num, avant);
  end if;
end $$;

-- Crée ou modifie un exercice. Un exercice clôturé ne se modifie plus et ne se rouvre pas.
-- La clôture exige que toutes les écritures de la période soient validées.
create or replace function public.enregistrer_exercice(p_entreprise uuid, p_exercice jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare x jsonb := p_exercice; av public.exercices; d date; f date; c boolean;
begin
  if not public.peut_ecrire(p_entreprise) then
    raise exception 'Accès refusé à cette entreprise' using errcode = '42501';
  end if;
  if coalesce(x->>'debut', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(x->>'fin', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Exercice: dates invalides' using errcode = '22023';
  end if;
  d := (x->>'debut')::date; f := (x->>'fin')::date; c := coalesce((x->>'cloture')::boolean, false);
  select * into av from public.exercices where entreprise_id = p_entreprise and id = x->>'id';
  if found and av.cloture then
    raise exception 'Exercice du % au % clôturé : il ne peut plus être modifié', av.debut, av.fin using errcode = '55000';
  end if;
  if exists(select 1 from public.exercices where entreprise_id = p_entreprise and id <> x->>'id' and d <= fin and debut <= f) then
    raise exception 'Exercice: chevauche un exercice existant' using errcode = '22023';
  end if;
  if c and exists(select 1 from public.ecritures where entreprise_id = p_entreprise and date between d and f and statut <> 'validee') then
    raise exception 'Clôture impossible : des écritures de l''exercice sont encore au brouillard' using errcode = '55000';
  end if;
  insert into public.exercices(entreprise_id, id, debut, fin, cloture, cloture_le)
    values (p_entreprise, x->>'id', d, f, c, case when c then now() end)
    on conflict (entreprise_id, id) do update
      set debut = excluded.debut, fin = excluded.fin, cloture = excluded.cloture, cloture_le = excluded.cloture_le;
  insert into public.journal_audit(entreprise_id, qui, action, objet, avant, apres)
    values (p_entreprise, auth.uid(), case when c then 'cloture' when av.id is null then 'creation' else 'modification' end,
            'exercice ' || (x->>'id'), case when av.id is not null then to_jsonb(av) end, x);
end $$;

create or replace function public.supprimer_exercice(p_entreprise uuid, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare av public.exercices;
begin
  if not public.peut_ecrire(p_entreprise) then
    raise exception 'Accès refusé à cette entreprise' using errcode = '42501';
  end if;
  select * into av from public.exercices where entreprise_id = p_entreprise and id = p_id;
  if not found then return; end if;
  if av.cloture then raise exception 'Exercice clôturé : il ne peut pas être supprimé' using errcode = '55000'; end if;
  delete from public.exercices where entreprise_id = p_entreprise and id = p_id;
  insert into public.journal_audit(entreprise_id, qui, action, objet, avant)
    values (p_entreprise, auth.uid(), 'suppression', 'exercice ' || p_id, to_jsonb(av));
end $$;

-- Ajoute un collaborateur déjà inscrit (réservé au propriétaire).
create or replace function public.inviter_membre(p_entreprise uuid, p_email text, p_role text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if public.mon_role(p_entreprise) is distinct from 'proprietaire' then
    raise exception 'Seul le propriétaire peut ajouter un membre' using errcode = '42501';
  end if;
  if p_role not in ('comptable','lecteur') then raise exception 'Rôle invalide' using errcode = '22023'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then raise exception 'Aucun compte avec cet e-mail' using errcode = 'P0002'; end if;
  insert into public.membres(entreprise_id, user_id, role) values (p_entreprise, uid, p_role)
    on conflict (entreprise_id, user_id) do update set role = excluded.role;
  insert into public.journal_audit(entreprise_id, qui, action, objet, apres)
    values (p_entreprise, auth.uid(), 'ajout', 'membre', jsonb_build_object('email', p_email, 'role', p_role));
end $$;

-- ---------- Droits et règles d'accès (Row Level Security) ----------

alter table public.profils enable row level security;
alter table public.entreprises enable row level security;
alter table public.membres enable row level security;
alter table public.ecritures enable row level security;
alter table public.lignes enable row level security;
alter table public.factures enable row level security;
alter table public.comptes_perso enable row level security;
alter table public.abonnements enable row level security;
alter table public.journal_audit enable row level security;
alter table public.exercices enable row level security;

-- Aucun accès sans connexion.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
revoke all on public.profils, public.entreprises, public.membres, public.ecritures, public.lignes,
  public.factures, public.comptes_perso, public.abonnements, public.journal_audit, public.exercices from authenticated;

grant select, update(nom, tel, pays) on public.profils to authenticated;
grant select, update(nom, pays, devise, params) on public.entreprises to authenticated;
grant select on public.membres, public.ecritures, public.lignes, public.factures,
  public.abonnements, public.journal_audit, public.exercices to authenticated;
grant select, insert, update, delete on public.comptes_perso to authenticated;
grant execute on function public.mon_role(uuid), public.peut_ecrire(uuid),
  public.creer_entreprise(text, text, text, jsonb), public.enregistrer_ecriture(uuid, jsonb),
  public.supprimer_ecriture(uuid, text), public.enregistrer_facture(uuid, jsonb),
  public.supprimer_facture(uuid, text), public.inviter_membre(uuid, text, text),
  public.periode_close(uuid, date), public.enregistrer_exercice(uuid, jsonb), public.supprimer_exercice(uuid, text) to authenticated;

drop policy if exists profil_lire on public.profils;
create policy profil_lire on public.profils for select to authenticated using (id = auth.uid());
drop policy if exists profil_modifier on public.profils;
create policy profil_modifier on public.profils for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists entreprise_lire on public.entreprises;
create policy entreprise_lire on public.entreprises for select to authenticated using (public.mon_role(id) is not null);
drop policy if exists entreprise_modifier on public.entreprises;
create policy entreprise_modifier on public.entreprises for update to authenticated
  using (public.peut_ecrire(id)) with check (public.peut_ecrire(id));

drop policy if exists membres_lire on public.membres;
create policy membres_lire on public.membres for select to authenticated using (public.mon_role(entreprise_id) is not null);

drop policy if exists ecritures_lire on public.ecritures;
create policy ecritures_lire on public.ecritures for select to authenticated using (public.mon_role(entreprise_id) is not null);
drop policy if exists lignes_lire on public.lignes;
create policy lignes_lire on public.lignes for select to authenticated using (public.mon_role(entreprise_id) is not null);
drop policy if exists factures_lire on public.factures;
create policy factures_lire on public.factures for select to authenticated using (public.mon_role(entreprise_id) is not null);
drop policy if exists audit_lire on public.journal_audit;
create policy audit_lire on public.journal_audit for select to authenticated using (public.mon_role(entreprise_id) is not null);
drop policy if exists exercices_lire on public.exercices;
create policy exercices_lire on public.exercices for select to authenticated using (public.mon_role(entreprise_id) is not null);

drop policy if exists comptes_lire on public.comptes_perso;
create policy comptes_lire on public.comptes_perso for select to authenticated using (public.mon_role(entreprise_id) is not null);
drop policy if exists comptes_ajouter on public.comptes_perso;
create policy comptes_ajouter on public.comptes_perso for insert to authenticated with check (public.peut_ecrire(entreprise_id));
drop policy if exists comptes_modifier on public.comptes_perso;
create policy comptes_modifier on public.comptes_perso for update to authenticated
  using (public.peut_ecrire(entreprise_id)) with check (public.peut_ecrire(entreprise_id));
drop policy if exists comptes_supprimer on public.comptes_perso;
create policy comptes_supprimer on public.comptes_perso for delete to authenticated using (public.peut_ecrire(entreprise_id));

drop policy if exists abonnement_lire on public.abonnements;
create policy abonnement_lire on public.abonnements for select to authenticated using (user_id = auth.uid());
