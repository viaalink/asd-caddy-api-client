#!/bin/sh
# A user that logs in with a cleartext password (AuthenticationCleartextPassword),
# so the layer4 test can check that pgwire.py blanks it in the stored flow.
# Test-only credentials for a throwaway container.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
CREATE USER clear WITH PASSWORD 'Cleartext-Secret-4711';
GRANT ALL ON SCHEMA public TO clear;
SQL
# pg_hba is first-match: put the `password` rule above the image's catch-all.
sed -i '1i host all clear all password' "$PGDATA/pg_hba.conf"
