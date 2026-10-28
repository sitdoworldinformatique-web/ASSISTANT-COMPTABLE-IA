#!/bin/sh
# Teste supabase/schema.sql sur une base PostgreSQL vide.
# Usage : tests/sql/lancer.sh [URL de connexion]  (par défaut : base locale « compteassist_test »)
set -e
export PGOPTIONS="-c client_min_messages=warning"
cd "$(dirname "$0")/../.."
URL="${1:-${DATABASE_URL:-postgresql:///compteassist_test}}"
psql "$URL" -q -v ON_ERROR_STOP=1 -c "drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;"
psql "$URL" -q -v ON_ERROR_STOP=1 -f tests/sql/simulation-supabase.sql
psql "$URL" -q -v ON_ERROR_STOP=1 -f supabase/schema.sql
# Le script doit pouvoir être relancé sans erreur.
psql "$URL" -q -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql "$URL" -q -v ON_ERROR_STOP=1 -f tests/sql/isolation.sql
