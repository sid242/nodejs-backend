# India Geo Reference Data: Hierarchy & Polygons

Rebuilds administrative hierarchy and spatial data from public sources:
`country > state > district > sub-district > city / village`, plus India Post PIN areas.

---

## Architecture & PostGIS Strategy

> [!NOTE]
> **Plain PostgreSQL Mode (Default):**
> For standard application operations (address hierarchy cascading dropdowns, PIN code lookup, and point coordinates via latitude/longitude), **PostGIS is NOT required**. The system operates cleanly on standard vanilla PostgreSQL using `geo.geo_entities` and standard `latitude`/`longitude` columns.
>
> **PostGIS Mode (Optional):**
> Boundary polygons (`geo.geo_boundaries`) and spatial polygon containment lookups (`ST_Contains`, `geo_lookup`) require the PostGIS extension. If your deployment requires custom geofences, sales territory boundaries, or map polygon overlays in the future, you can enable PostGIS and set `INCLUDE_POLYGONS=true`.

---

## Requirements

### Default Mode (Plain PostgreSQL):

- PostgreSQL 14+ (no extensions required beyond `pg_trgm`)
- `psql`, Python 3, `curl`, `unzip`

### Optional Polygon Mode:

- PostgreSQL 14+ with **PostGIS** extension installed
- Python 3 with `pandas`, `geopandas`, `shapely`, `pyarrow`

---

## Running the Migration / Ingestion

### 1. Default Run (Hierarchy & Points Only — Plain PostgreSQL):

```bash
createdb mygeo
DB=mygeo ./run_all.sh
```

_This downloads the hierarchy, seeds `geo.geo_levels` and `geo.geo_entities`, creates fuzzy search indexes via `pg_trgm`, and skips all polygon/PostGIS dependencies._

### 2. Optional Full Run (Including PostGIS Spatial Polygons):

```bash
createdb mygeo
# Enable PostGIS on target DB first:
psql -d mygeo -c "CREATE EXTENSION IF NOT EXISTS postgis;"
# Run with polygons enabled:
DB=mygeo INCLUDE_POLYGONS=true ./run_all.sh
```

---

## Pipeline Steps

| Step / File                                          | What it does                                                            | PostGIS Required?                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| `build_geo.py`                                       | Builds hierarchy rows from the LGD dump (March 2022 snapshot)           | **No** (Plain Postgres)                       |
| `01_schema.sql`, `02_load.sql`                       | `geo_levels`, `geo_entities`, bulk load                                 | **No** (Plain Postgres)                       |
| `build_boundaries.py`                                | Repairs geometry, merges multi-part rows, stages polygons and PIN areas | **Yes** (Skipped if `INCLUDE_POLYGONS=false`) |
| `03_boundaries_schema.sql`, `04_load_boundaries.sql` | `geo_boundaries` (full + simplified geometry)                           | **Yes** (Skipped if `INCLUDE_POLYGONS=false`) |
| `05_derive_corrections.sql`                          | Finds sub-districts whose district link is contradicted by geometry     | **Yes** (Skipped if `INCLUDE_POLYGONS=false`) |
| `05_parent_corrections.sql`, `06_city_parents.sql`   | Applies the corrections (logged in `geo_parent_corrections`)            | **Yes** (Skipped if `INCLUDE_POLYGONS=false`) |
| `07_load_areas.sql`                                  | PIN areas as level `area`, parent by spatial lookup                     | **Yes** (Skipped if `INCLUDE_POLYGONS=false`) |
| `08_lookup_function.sql`                             | `geo_lookup(lat, lng)` spatial polygon lookup                           | **Yes** (Skipped if `INCLUDE_POLYGONS=false`) |
| `09_qa.sql`                                          | Integrity and containment checks                                        | **Yes** (Skipped if `INCLUDE_POLYGONS=false`) |
| `10_move_to_geo_schema.sql`                          | Moves loaded tables into dedicated `geo` schema                         | **No** (Safe for both modes)                  |
| `11_geo_indexes.sql`                                 | `pg_trgm` fuzzy-search and parent/name indexes                          | **No** (Plain Postgres)                       |

---

## Verified Results (Fresh-database Run)

- 26,451 polygons: 36 states, 763 districts, 6,340 sub-districts, 19,312 PIN areas; 0 invalid
- 763/763 districts >= 98% inside their state
- Sub-districts >= 95% inside their district: 5,833 -> 6,230 of 6,340 after 397 corrections
- 72 cities re-linked; 469 corrections logged

## Known Gaps

- LGD hierarchy is a March 2022 snapshot: ~22 newer districts missing, 95 sub-districts belong to post-2022 districts (see `qa_unresolved_subdistricts.csv`).
- 581 sub-districts have no polygon in the source. No city or village polygons.
- PIN-area parents are best fit; PIN areas straddle sub-district borders.

## Sizes and Storage

- `geo_entities`: ~150 MB (Plain PostgreSQL)
- `geo_boundaries`: ~484 MB (full geometry ~269 MB, display geometry ~24 MB; requires PostGIS)
