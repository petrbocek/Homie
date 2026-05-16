-- ============================================================
-- Domácí Finance – nové schéma
-- Spusť v Supabase SQL Editoru
-- ============================================================

-- Volitelně: smaž staré tabulky
-- DROP TABLE IF EXISTS zaznamy CASCADE;
-- DROP TABLE IF EXISTS energie CASCADE;
-- DROP TABLE IF EXISTS plan CASCADE;

-- ============================================================
-- 1. Osnova (dvouúrovňové kategorie)
-- ============================================================
CREATE TABLE osnova (
  id           BIGSERIAL PRIMARY KEY,
  nazev        TEXT NOT NULL,
  parent_id    BIGINT REFERENCES osnova(id) ON DELETE CASCADE,
  typ          TEXT CHECK (typ IN ('prijem', 'vydaj')),  -- NULL pro podkategorie
  poradi       INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. Peněženky
-- ============================================================
CREATE TABLE penezenky (
  id                  BIGSERIAL PRIMARY KEY,
  nazev               TEXT NOT NULL,
  pocatecni_zustatek  NUMERIC(12,2) DEFAULT 0,
  barva               TEXT DEFAULT '#c8f060',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. Záznamy (příjmy a výdaje)
-- ============================================================
CREATE TABLE zaznamy (
  id            BIGSERIAL PRIMARY KEY,
  datum         DATE NOT NULL,
  castka        NUMERIC(12,2) NOT NULL,
  typ           TEXT CHECK (typ IN ('prijem', 'vydaj')) NOT NULL,
  kategorie_id  BIGINT REFERENCES osnova(id),
  kde           TEXT,
  poznamka      TEXT,
  penezenka_id  BIGINT REFERENCES penezenky(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. Plán (měsíční rozpočet na kategorii)
-- ============================================================
CREATE TABLE plan (
  id            BIGSERIAL PRIMARY KEY,
  mesic         TEXT NOT NULL,       -- formát YYYY-MM
  kategorie_id  BIGINT REFERENCES osnova(id) ON DELETE CASCADE,
  castka        NUMERIC(12,2) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mesic, kategorie_id)
);

-- ============================================================
-- Indexy
-- ============================================================
CREATE INDEX idx_zaznamy_datum      ON zaznamy(datum);
CREATE INDEX idx_zaznamy_kategorie  ON zaznamy(kategorie_id);
CREATE INDEX idx_zaznamy_penezenka  ON zaznamy(penezenka_id);
CREATE INDEX idx_plan_mesic         ON plan(mesic);

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================
ALTER TABLE osnova    ENABLE ROW LEVEL SECURITY;
ALTER TABLE penezenky ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaznamy   ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON osnova    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON penezenky FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON zaznamy   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON plan      FOR ALL TO anon USING (true) WITH CHECK (true);
