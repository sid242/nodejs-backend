#!/bin/bash
# Rebuild geo reference data from public sources.
# Modes:
#   1. Default (INCLUDE_POLYGONS=false): Plain PostgreSQL only (no PostGIS required).
#      Loads hierarchy (state, district, sub-district, city, village, pin code) into geo.geo_entities.
#   2. Full (INCLUDE_POLYGONS=true): Requires PostGIS on the target DB + Python (geopandas, pyarrow).
#      Loads boundary polygons, spatial lookups, and parent corrections into geo.geo_boundaries.
#
# Usage:
#   DB=mydb [INCLUDE_POLYGONS=true] [APP_USER=app_role] ./run_all.sh
set -euo pipefail
DB=${DB:-geo}; export WORK=${WORK:-work}; mkdir -p "$WORK"
INCLUDE_POLYGONS=${INCLUDE_POLYGONS:-false}

q() { psql -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }

# 1. Download LGD administrative hierarchy (Plain PostgreSQL compatible)
[ -d "$WORK/india-local-government-directory-main" ] || {
  curl -sL -o "$WORK/lgd.zip" https://codeload.github.com/planemad/india-local-government-directory/zip/refs/heads/main
  unzip -q -o "$WORK/lgd.zip" -d "$WORK"
}
[ -f "$WORK/4-village.csv" ] || unzip -q -o "$WORK/india-local-government-directory-main/administrative/4-village.csv.zip" -d "$WORK" -x '__MACOSX/*'

# 2. Build and load hierarchy tables (geo_levels, geo_entities)
python3 build_geo.py
q -f 01_schema.sql -f 02_load.sql

# 3. Optional PostGIS Boundary Polygons (Skipped by default for plain PostgreSQL)
if [ "$INCLUDE_POLYGONS" = "true" ]; then
  echo "==> PostGIS enabled: Building and loading spatial boundary polygons..."
  REL=https://github.com/yashveeeeeeer/india-geodata/releases/download
  for p in admin/states/LGD_States admin/districts/LGD_Districts admin/subdistricts/LGD_Subdistricts postal/boundaries/Datagov_Pincode_Boundaries; do
    f="$WORK/$(basename $p).parquet"
    [ -s "$f" ] || curl -sL --max-time 900 -o "$f" "$REL/$p.parquet"
  done

  python3 build_boundaries.py
  q -f 03_boundaries_schema.sql -f 04_load_boundaries.sql
  q -f 05_derive_corrections.sql
  q -f 05_parent_corrections.sql
  q -f 06_city_parents.sql
  q -f 07_load_areas.sql
  q -f 08_lookup_function.sql
  q -f 09_qa.sql
else
  echo "==> Skipping boundary polygons (Plain PostgreSQL mode). To enable PostGIS polygons in the future, set INCLUDE_POLYGONS=true."
fi

# 4. Move into dedicated "geo" schema and add search indexes (Safe for both plain Postgres and PostGIS)
q -f 10_move_to_geo_schema.sql ${APP_USER:+-v app_user=$APP_USER}
q -f 11_geo_indexes.sql
