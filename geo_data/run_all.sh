#!/bin/bash
# Rebuild everything from public sources. Needs: psql + PostGIS on the target DB, python3 (pandas, geopandas, pyarrow), curl, unzip, gzip.
# Usage: DB=mydb [APP_USER=app_role] ./run_all.sh      (PGHOST/PGUSER etc. honoured by psql)
set -euo pipefail
DB=${DB:-geo}; export WORK=${WORK:-work}; mkdir -p "$WORK"
REL=https://github.com/yashveeeeeeer/india-geodata/releases/download
[ -d "$WORK/india-local-government-directory-main" ] || { curl -sL -o "$WORK/lgd.zip" https://codeload.github.com/planemad/india-local-government-directory/zip/refs/heads/main; unzip -q -o "$WORK/lgd.zip" -d "$WORK"; }
[ -f "$WORK/4-village.csv" ] || unzip -q -o "$WORK/india-local-government-directory-main/administrative/4-village.csv.zip" -d "$WORK" -x '__MACOSX/*'
for p in admin/states/LGD_States admin/districts/LGD_Districts admin/subdistricts/LGD_Subdistricts postal/boundaries/Datagov_Pincode_Boundaries; do
  f="$WORK/$(basename $p).parquet"; [ -s "$f" ] || curl -sL --max-time 900 -o "$f" "$REL/$p.parquet"; done
python3 build_geo.py
python3 build_boundaries.py
q() { psql -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }
q -f 01_schema.sql -f 02_load.sql
q -f 03_boundaries_schema.sql -f 04_load_boundaries.sql
q -f 05_derive_corrections.sql
q -f 05_parent_corrections.sql
q -f 06_city_parents.sql
q -f 07_load_areas.sql
q -f 08_lookup_function.sql
q -f 09_qa.sql
# Move into the dedicated "geo" schema and add search indexes. Optional: APP_USER=<your app db user> for read-only grants.
q -f 10_move_to_geo_schema.sql ${APP_USER:+-v app_user=$APP_USER}
q -f 11_geo_indexes.sql
