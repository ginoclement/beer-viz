-- Star schema + rollup views for the recipe corpus.
--
-- The loader (scripts/build-corpus.mjs) first materializes `recipe_raw` — one
-- row per recipe, each a nested STRUCT read straight from the normalized
-- src/generated/recipes.json (which scales to the full multi-GB Brewer's Friend
-- crawl; DuckDB streams JSON out-of-core). Everything below flattens that into
-- a star schema and precomputes the aggregates every visualization needs.
--
-- Run order matters: base fact/dimension tables first, then the views that read
-- them. All statements are idempotent (CREATE OR REPLACE) so the pipeline can
-- re-run over a fresh crawl without a manual reset.

------------------------------------------------------------------ fact tables

-- One row per recipe, vitals pulled out of the nested struct into columns.
CREATE OR REPLACE TABLE recipes AS
SELECT
  rec['id']::BIGINT            AS id,
  rec['name']::VARCHAR         AS name,
  rec['family']::VARCHAR       AS family,
  rec['origin']::VARCHAR       AS origin,
  TRY_CAST(rec['year'] AS INTEGER) AS year,
  rec['vitals']['og']::DOUBLE  AS og,
  rec['vitals']['fg']::DOUBLE  AS fg,
  rec['vitals']['abv']::DOUBLE AS abv,
  rec['vitals']['ibu']::DOUBLE AS ibu,
  rec['vitals']['srm']::DOUBLE AS srm,
  rec['batchL']::DOUBLE        AS batch_l,
  rec['yeast']::VARCHAR        AS yeast
FROM recipe_raw;

-- Exploded grain bill: one row per (recipe, fermentable).
CREATE OR REPLACE TABLE recipe_malts AS
SELECT
  rec['id']::BIGINT       AS recipe_id,
  m['name']::VARCHAR      AS malt_name,
  m['class']::VARCHAR     AS malt_class,
  m['kg']::DOUBLE         AS kg,
  m['pct']::DOUBLE        AS pct
FROM recipe_raw, unnest(rec['malts']) AS t(m);

-- Exploded hop schedule: one row per (recipe, hop addition).
CREATE OR REPLACE TABLE recipe_hops AS
SELECT
  rec['id']::BIGINT       AS recipe_id,
  h['name']::VARCHAR      AS hop_name,
  -- key is the variety matched to the hop-chemistry dataset; fall back to the
  -- normalized display name so twists/extracts still aggregate consistently.
  COALESCE(NULLIF(h['key']::VARCHAR, ''), lower(trim(h['name']::VARCHAR))) AS hop_key,
  h['g']::DOUBLE          AS grams,
  h['stage']::VARCHAR     AS stage
FROM recipe_raw, unnest(rec['hops']) AS t(h);

-------------------------------------------------------------- dimension tables

CREATE OR REPLACE TABLE malts AS
SELECT
  lower(trim(malt_name)) AS malt_key,
  any_value(malt_name)   AS name,
  any_value(malt_class)  AS class,
  count(DISTINCT recipe_id)::INTEGER AS n_recipes
FROM recipe_malts
GROUP BY 1;

CREATE OR REPLACE TABLE hops AS
SELECT
  hop_key,
  any_value(hop_name)    AS name,
  count(DISTINCT recipe_id)::INTEGER AS n_recipes
FROM recipe_hops
GROUP BY 1;

-------------------------------------------------------------------- roll-up views

-- Malt usage by fermentable, ranked — feeds the grist / ingredient leaderboards.
CREATE OR REPLACE VIEW v_malt_usage AS
SELECT
  lower(trim(malt_name)) AS malt_key,
  any_value(malt_name)   AS name,
  any_value(malt_class)  AS class,
  count(DISTINCT recipe_id)::INTEGER AS n_recipes,
  round(avg(pct), 1)     AS avg_pct
FROM recipe_malts
GROUP BY 1
ORDER BY n_recipes DESC;

-- Average grist composition per beer family, broken down by malt class — the
-- "base makes sense, but what base malts make it up" drill-down, precomputed.
CREATE OR REPLACE VIEW v_grist_by_family AS
SELECT
  r.family,
  rm.malt_class,
  count(DISTINCT rm.recipe_id)::INTEGER AS n_recipes,
  round(avg(rm.pct), 1)        AS avg_pct
FROM recipe_malts rm
JOIN recipes r ON r.id = rm.recipe_id
GROUP BY 1, 2
ORDER BY r.family, avg_pct DESC;

-- Hop usage by variety and dominant stage.
CREATE OR REPLACE VIEW v_hop_usage AS
SELECT
  hop_key,
  any_value(hop_name)          AS name,
  count(DISTINCT recipe_id)    AS n_recipes,
  round(avg(grams), 1)         AS avg_grams,
  mode(stage)                  AS top_stage
FROM recipe_hops
GROUP BY 1
ORDER BY n_recipes DESC;

-- Hop co-occurrence: how often two varieties share a recipe. The self-join is
-- what a graph store would traverse; here it is a single indexed aggregation.
CREATE OR REPLACE VIEW v_hop_pairs AS
SELECT
  a.hop_key AS hop_a,
  b.hop_key AS hop_b,
  count(DISTINCT a.recipe_id)::INTEGER AS co_recipes
FROM (SELECT DISTINCT recipe_id, hop_key FROM recipe_hops) a
JOIN (SELECT DISTINCT recipe_id, hop_key FROM recipe_hops) b
  ON a.recipe_id = b.recipe_id AND a.hop_key < b.hop_key
GROUP BY 1, 2
HAVING count(DISTINCT a.recipe_id) >= 2
ORDER BY co_recipes DESC;

-- Style-family outcome envelope: average vitals and spread per family.
CREATE OR REPLACE VIEW v_family_outcomes AS
SELECT
  family,
  count(*)::INTEGER        AS n_recipes,
  round(avg(abv), 2)       AS avg_abv,
  round(avg(ibu), 1)       AS avg_ibu,
  round(avg(srm), 1)       AS avg_srm,
  round(avg(og), 4)        AS avg_og,
  round(avg(fg), 4)        AS avg_fg
FROM recipes
WHERE abv IS NOT NULL
GROUP BY 1
ORDER BY n_recipes DESC;

-- Corpus provenance — recipe counts per source.
CREATE OR REPLACE VIEW v_origins AS
SELECT origin, count(*)::INTEGER AS n_recipes
FROM recipes
GROUP BY 1
ORDER BY n_recipes DESC;
