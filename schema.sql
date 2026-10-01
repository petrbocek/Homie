-- ============================================================
-- Domácí Finance – schéma databáze
-- Spusť v Supabase SQL Editoru
-- ============================================================
--
-- ⚠️  POVINNÝ KROK V DASHBOARDU – bez něj je appka otevřená komukoli
--
--  1) Authentication → Sign In / Providers → Email
--       vypni „Allow new users to sign up"
--       (jinak se kdokoli zaregistruje a uvidí celou vaši evidenci)
--
--  2) Authentication → Users → Add user
--       zadej e-mail + heslo a zaškrtni „Auto Confirm User"
--       (takhle se vytvoří účty pro domácnost; registrace z appky není možná)
--
-- Model přístupu: data jsou společná pro celou domácnost – každý
-- přihlášený uživatel vidí a edituje všechno. Oddělení dat po
-- uživatelích by vyžadovalo sloupec owner_id a jiné politiky.
-- ============================================================

-- Volitelně: smaž staré tabulky
-- DROP TABLE IF EXISTS plan CASCADE;
-- DROP TABLE IF EXISTS zaznamy CASCADE;
-- DROP TABLE IF EXISTS penezenky CASCADE;
-- DROP TABLE IF EXISTS osnova CASCADE;

-- ============================================================
-- 1. Osnova (dvouúrovňové kategorie)
-- ============================================================
CREATE TABLE IF NOT EXISTS osnova (
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
CREATE TABLE IF NOT EXISTS penezenky (
  id                  BIGSERIAL PRIMARY KEY,
  nazev               TEXT NOT NULL,
  pocatecni_zustatek  NUMERIC(12,2) DEFAULT 0,
  barva               TEXT DEFAULT '#c8f060',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. Záznamy (příjmy a výdaje)
-- ============================================================
CREATE TABLE IF NOT EXISTS zaznamy (
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
--    UNIQUE(mesic, kategorie_id) je nutný pro upsert z appky
-- ============================================================
CREATE TABLE IF NOT EXISTS plan (
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
CREATE INDEX IF NOT EXISTS idx_zaznamy_datum      ON zaznamy(datum);
CREATE INDEX IF NOT EXISTS idx_zaznamy_kategorie  ON zaznamy(kategorie_id);
CREATE INDEX IF NOT EXISTS idx_zaznamy_penezenka  ON zaznamy(penezenka_id);
CREATE INDEX IF NOT EXISTS idx_osnova_parent      ON osnova(parent_id);
CREATE INDEX IF NOT EXISTS idx_plan_mesic         ON plan(mesic);

-- ============================================================
-- RLS – přístup má jen přihlášený uživatel (role `authenticated`).
-- Role `anon` (klíč zapečený v index.html) nemá k datům nic.
-- ============================================================
ALTER TABLE osnova    ENABLE ROW LEVEL SECURITY;
ALTER TABLE penezenky ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaznamy   ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan      ENABLE ROW LEVEL SECURITY;

-- Shoď případné staré, veřejně otevřené politiky
DROP POLICY IF EXISTS "anon_all" ON osnova;
DROP POLICY IF EXISTS "anon_all" ON penezenky;
DROP POLICY IF EXISTS "anon_all" ON zaznamy;
DROP POLICY IF EXISTS "anon_all" ON plan;

DROP POLICY IF EXISTS "auth_all" ON osnova;
DROP POLICY IF EXISTS "auth_all" ON penezenky;
DROP POLICY IF EXISTS "auth_all" ON zaznamy;
DROP POLICY IF EXISTS "auth_all" ON plan;

CREATE POLICY "auth_all" ON osnova    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON penezenky FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON zaznamy   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON plan      FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- VOLITELNÉ ZPEVNĚNÍ – allowlist e-mailů
-- Pojistka pro případ, že by registrace zůstala omylem zapnutá:
-- pak ani nově zaregistrovaný účet na data nedosáhne.
-- Doplň si e-maily a spusť místo politik výše.
-- ============================================================
-- DROP POLICY IF EXISTS "auth_all" ON osnova;
-- CREATE POLICY "auth_all" ON osnova FOR ALL TO authenticated
--   USING      (auth.jwt() ->> 'email' IN ('ja@example.com','partner@example.com'))
--   WITH CHECK (auth.jwt() ->> 'email' IN ('ja@example.com','partner@example.com'));
-- (a stejně pro penezenky, zaznamy, plan)
