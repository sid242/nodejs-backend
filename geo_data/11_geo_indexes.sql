-- Search indexes for the address form (fuzzy name search and fast child lookups). Safe to re-run.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
CREATE INDEX IF NOT EXISTS geo_entities_name_trgm ON geo.geo_entities USING gin (lower(name) public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS geo_entities_parent_name_idx ON geo.geo_entities (parent_id, lower(name) text_pattern_ops);
ANALYZE geo.geo_entities;
