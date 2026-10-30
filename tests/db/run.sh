#!/bin/sh
# Applies the Supabase migration to a throwaway local Postgres 16 and runs the RLS/security tests.
# Needs the postgresql-16 server binaries; runs the server as the `postgres` system user.
# Usage: sh tests/db/run.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
BIN=/usr/lib/postgresql/16/bin
DIR=$(mktemp -d)
PORT=55432
chown postgres "$DIR"
as_pg() { runuser -u postgres -- "$@"; }
cleanup() { as_pg "$BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
as_pg "$BIN/initdb" -D "$DIR/data" -A trust -U postgres >/dev/null
as_pg "$BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
PSQL="psql -X -q -v ON_ERROR_STOP=1 -h $DIR -p $PORT -U postgres -d postgres"
cp "$HERE/supabase-shim.sql" "$ROOT"/supabase/migrations/*.sql "$HERE/rls.test.sql" "$DIR/"
chmod a+r "$DIR"/*.sql
$PSQL -f "$DIR/supabase-shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do $PSQL -f "$DIR/$(basename "$f")"; done
$PSQL -f "$DIR/rls.test.sql"
