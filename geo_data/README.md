# India geo reference data: hierarchy + polygons (PostgreSQL / PostGIS)

Rebuilds everything from public sources:
`country > state > district > sub-district > city / village`, plus India Post PIN areas, with polygons for
state, district, sub-district and PIN area.

## Requirements
PostgreSQL 14+ with PostGIS, `psql`, python3 (pandas, geopandas, pyarrow), curl, unzip.
Network access to github.com / codeload.github.com / release-assets.githubusercontent.com.

## Run
    createdb mygeo
    DB=mygeo ./run_all.sh          # PG* env vars are honoured; takes roughly 10-15 minutes

## Steps
| File | What it does |
|---|---|
| build_geo.py | Builds hierarchy rows from the LGD dump (March 2022 snapshot) |
| 01_schema.sql, 02_load.sql | geo_levels, geo_entities, bulk load |
| build_boundaries.py | Repairs geometry, merges multi-part rows, stages polygons and PIN areas |
| 03_boundaries_schema.sql, 04_load_boundaries.sql | geo_boundaries (full + simplified geometry) |
| 05_derive_corrections.sql | Finds sub-districts whose district link is contradicted by geometry AND the newer boundary file |
| 05_parent_corrections.sql, 06_city_parents.sql | Applies the corrections (logged in geo_parent_corrections) and re-links cities |
| 07_load_areas.sql | PIN areas as level `area`, parent by spatial lookup |
| 08_lookup_function.sql | `geo_lookup(lat, lng)` returns state / district / sub-district / PIN area |
| 09_qa.sql | Integrity and containment checks |
| 10_move_to_geo_schema.sql | Moves everything into schema `geo` (re-runnable); optional read-only grants via `-v app_user=...` |
| 11_geo_indexes.sql | pg_trgm fuzzy-search and parent/name indexes |

## Verified results (fresh-database run)
- 26,451 polygons: 36 states, 763 districts, 6,340 sub-districts, 19,312 PIN areas; 0 invalid
- 763/763 districts >= 98% inside their state
- Sub-districts >= 95% inside their district: 5,833 -> 6,230 of 6,340 after 397 corrections
- 72 cities re-linked; 469 corrections logged

## Known gaps
- LGD hierarchy is a March 2022 snapshot: ~22 newer districts missing, 95 sub-districts belong to
  post-2022 districts (see qa_unresolved_subdistricts.csv). Refresh LGD to close this.
- 581 sub-districts have no polygon in the source. No city or village polygons.
- PIN-area parents are best fit; PIN areas straddle sub-district borders.
- Boundaries are community re-publications (about 100 m simplification). Check licences before commercial use and
  review the depiction of India's external boundaries before showing them on a public map.

## Sizes and hosting
geo_entities ~150 MB, geo_boundaries ~484 MB (full geometry ~269 MB, display geometry ~24 MB). Compressed dump ~272 MB.
Needs PostGIS. Use geom_simple for map rendering and geom for analysis.
