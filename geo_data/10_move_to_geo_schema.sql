-- Moves the loaded geo tables and lookup function from "public" into a dedicated "geo" schema.
-- Safe to re-run. Usage: psql -d yourdb -f 10_move_to_geo_schema.sql [-v app_user=your_app_db_user]
CREATE SCHEMA IF NOT EXISTS geo;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['geo_levels','geo_entities','geo_boundaries','geo_parent_corrections'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN EXECUTE format('ALTER TABLE public.%I SET SCHEMA geo', t); END IF;
  END LOOP;
  IF to_regprocedure('public.geo_lookup(double precision,double precision)') IS NOT NULL THEN
    ALTER FUNCTION public.geo_lookup(double precision,double precision) SET SCHEMA geo;
  END IF;
END $$;
ALTER FUNCTION geo.geo_lookup(double precision, double precision) SET search_path = geo, public;

-- Optional: read-only access for your application database user
\if :{?app_user}
GRANT USAGE ON SCHEMA geo TO :"app_user";
GRANT SELECT ON ALL TABLES IN SCHEMA geo TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA geo GRANT SELECT ON TABLES TO :"app_user";
\endif
