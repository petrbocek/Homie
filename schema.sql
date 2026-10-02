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
-- přihlášený uživatel vidí a edituje všechno.
-- ============================================================
--
-- MODEL DAT (podle Google Sheetu „Utrata", list Odpovědi formuláře 1)
--
-- Skutečnost i plán leží ve stejné tabulce `zaznamy`, rozlišené
-- sloupcem `typ_polozky`. Plánovaná položka je plnohodnotná budoucí
-- transakce – má datum, částku, protistranu i podkategorii. Díky
-- tomu jde dělat projekce cashflow na konkrétní dny a plánovat
-- na úrovni podkategorií.
--
-- ============================================================

-- ============================================================
-- 1. Osnova (dvouúrovňové kategorie)
-- ============================================================
CREATE TABLE IF NOT EXISTS osnova (
  id           BIGSERIAL PRIMARY KEY,
  nazev        TEXT NOT NULL,
  parent_id    BIGINT REFERENCES osnova(id) ON DELETE CASCADE,
  typ          TEXT CHECK (typ IN ('prijem', 'vydaj')),  -- NULL pro podkategorie
  kod          TEXT,                                     -- kód ze sheetu: 1.1, 10.8
  poradi       INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- kód je unikátní, ale jen tam, kde je vyplněný
CREATE UNIQUE INDEX IF NOT EXISTS osnova_kod_uniq ON osnova(kod) WHERE kod IS NOT NULL;

-- ============================================================
-- 2. Peněženky
--    Odpovídají sloupci „Typ placeni" ve zdrojovém sheetu.
--    „Penezenka" z listu Pivot = „Hotovost" z deníku (totéž).
--    „Budouci" z listu Pivot NENÍ peněženka – je to dopočítaný
--    zůstatek po zahrnutí plánovaných položek.
-- ============================================================
CREATE TABLE IF NOT EXISTS penezenky (
  id                  BIGSERIAL PRIMARY KEY,
  nazev               TEXT NOT NULL,
  pocatecni_zustatek  NUMERIC(12,2) DEFAULT 0,
  barva               TEXT DEFAULT '#c8f060',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. Záznamy – skutečnost i plán
-- ============================================================
CREATE TABLE IF NOT EXISTS zaznamy (
  id              BIGSERIAL PRIMARY KEY,
  datum           DATE NOT NULL,              -- kdy se to stalo
  castka          NUMERIC(12,2) NOT NULL,     -- vždy kladná, směr určuje `typ`
  typ             TEXT CHECK (typ IN ('prijem', 'vydaj')) NOT NULL,
  typ_polozky     TEXT NOT NULL DEFAULT 'skutecnost',
  kategorie_id    BIGINT REFERENCES osnova(id),
  kde             TEXT,
  poznamka        TEXT,
  penezenka_id    BIGINT REFERENCES penezenky(id),
  zapsano_dne     TIMESTAMPTZ,                -- „Časová značka" ze sheetu;
                                              -- liší se od `datum` i o měsíce
                                              -- (zpětné zápisy), proto ne created_at
  potvrzeno       BOOLEAN NOT NULL DEFAULT FALSE,
  prevod_skupina  TEXT,                       -- páruje obě nohy převodu mezi
                                              -- peněženkami, aby šly vyloučit
                                              -- ze součtů za kategorii
  pravidelna      BOOLEAN NOT NULL DEFAULT FALSE,  -- mandatorní pravidelná
                                              -- platba (hypotéka, zálohy,
                                              -- pojistky, investice) – výdaj,
                                              -- kterého se nejde zbavit
  zdroj_radek     INTEGER,                    -- číslo řádku ve zdrojovém
                                              -- sheetu; klíč importu historie,
                                              -- viz unikátní index níž
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- `zdroj_radek` drží číslo řádku ve zdrojovém sheetu „Utrata". Je to klíč
-- importu historie (`on conflict (zdroj_radek) do update`), takže import jde
-- pustit opakovaně, aniž by se řádky zduplikovaly. Záznamy zadané v appce ho
-- nemají, proto je unikátní index částečný.
ALTER TABLE zaznamy ADD COLUMN IF NOT EXISTS zdroj_radek INTEGER;

-- Pravidelné (mandatorní) platby se neodvozují z pravidla, ale označují přímo
-- na pohybu. Nastavují se hromadně podle dvojice „kde + hlavní kategorie“;
-- appka je u nového záznamu navrhne, když stejnou dvojici v historii najde.
ALTER TABLE zaznamy ADD COLUMN IF NOT EXISTS pravidelna BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE zaznamy DROP CONSTRAINT IF EXISTS zaznamy_typ_polozky_chk;
ALTER TABLE zaznamy ADD  CONSTRAINT zaznamy_typ_polozky_chk
  CHECK (typ_polozky IN ('skutecnost', 'plan'));

-- ============================================================
-- Indexy
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_zaznamy_datum       ON zaznamy(datum);
CREATE INDEX IF NOT EXISTS idx_zaznamy_kategorie   ON zaznamy(kategorie_id);
CREATE INDEX IF NOT EXISTS idx_zaznamy_penezenka   ON zaznamy(penezenka_id);
CREATE INDEX IF NOT EXISTS idx_zaznamy_typ_polozky ON zaznamy(typ_polozky);
CREATE INDEX IF NOT EXISTS idx_zaznamy_prevod      ON zaznamy(prevod_skupina)
  WHERE prevod_skupina IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_osnova_parent       ON osnova(parent_id);

-- Na tomhle indexu stojí idempotence importu deníku. Je částečný záměrně:
-- unikátnost se vynucuje jen u importovaných řádků. Důsledek, na který je
-- potřeba myslet — `ON CONFLICT` musí predikát zopakovat
-- (`on conflict (zdroj_radek) where zdroj_radek is not null`), jinak ho
-- Postgres neodvodí; a PostgREST z částečného indexu konflikt odvodit neumí
-- vůbec, takže `Prefer: resolution=merge-duplicates` tady nefunguje.
CREATE UNIQUE INDEX IF NOT EXISTS zaznamy_zdroj_radek_uniq ON zaznamy(zdroj_radek)
  WHERE zdroj_radek IS NOT NULL;

-- ============================================================
-- ENERGIE (#9) – odečty měřidel a ceník. Zdroj je list „Energie" ze
-- sheetu; `zdroj_radek` drží číslo řádku, aby šel import pustit znovu.
-- ============================================================
CREATE TABLE IF NOT EXISTS energie_odecty (
  id                BIGSERIAL PRIMARY KEY,
  datum             DATE NOT NULL,
  voda              NUMERIC(12,2),      -- stav vodoměru v m³
  t1                NUMERIC(12,2),      -- stav elektroměru VT (kWh)
  t2                NUMERIC(12,2),      -- stav elektroměru NT (kWh)
  -- Příznak „tímhle odečtem začíná nové měřidlo". Spotřebu za daný řádek
  -- nelze spočítat — stav starého měřidla v okamžiku výměny nikdo nezapsal
  -- — a naivní odčítání by vyrobilo nesmysl (skok ze 767 na 10 m³).
  vymena_vodomer    BOOLEAN NOT NULL DEFAULT FALSE,
  vymena_elektromer BOOLEAN NOT NULL DEFAULT FALSE,
  poznamka          TEXT,
  zdroj_radek       INTEGER,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS energie_cenik (
  id               BIGSERIAL PRIMARY KEY,
  platnost_od      DATE NOT NULL,
  platnost_do      DATE,               -- NULL = platí dosud
  vt               NUMERIC(10,4) NOT NULL,   -- Kč/kWh ve vysokém tarifu
  nt               NUMERIC(10,4) NOT NULL,   -- Kč/kWh v nízkém tarifu
  mesicni_fix      NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Cena vody a zálohy nejsou v sheetu rozlišené podle období; jsou
  -- převzaté z jediné buňky a ve všech obdobích stejné.
  voda             NUMERIC(10,2),
  zaloha_elektrina NUMERIC(10,2),
  zaloha_voda      NUMERIC(10,2),
  poznamka         TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_energie_odecty_datum ON energie_odecty(datum);
CREATE INDEX IF NOT EXISTS idx_energie_cenik_od     ON energie_cenik(platnost_od);

-- Stejná logika jako u zaznamy_zdroj_radek_uniq: idempotence importu.
CREATE UNIQUE INDEX IF NOT EXISTS energie_odecty_zdroj_uniq ON energie_odecty(zdroj_radek)
  WHERE zdroj_radek IS NOT NULL;

-- ============================================================
-- RLS – přístup má jen přihlášený uživatel (role `authenticated`).
-- Role `anon` (klíč zapečený v index.html) nemá k datům nic.
-- ============================================================
ALTER TABLE osnova    ENABLE ROW LEVEL SECURITY;
ALTER TABLE penezenky ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaznamy   ENABLE ROW LEVEL SECURITY;
ALTER TABLE energie_odecty ENABLE ROW LEVEL SECURITY;
ALTER TABLE energie_cenik  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all" ON osnova;
DROP POLICY IF EXISTS "anon_all" ON penezenky;
DROP POLICY IF EXISTS "anon_all" ON zaznamy;

DROP POLICY IF EXISTS "auth_all" ON osnova;
DROP POLICY IF EXISTS "auth_all" ON penezenky;
DROP POLICY IF EXISTS "auth_all" ON zaznamy;
DROP POLICY IF EXISTS "auth_all" ON energie_odecty;
DROP POLICY IF EXISTS "auth_all" ON energie_cenik;

CREATE POLICY "auth_all" ON osnova    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON penezenky FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON zaznamy   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON energie_odecty FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON energie_cenik  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- Výchozí peněženky (podle hodnot „Typ placeni" v deníku).
-- Počáteční zůstatky nastaví import historie.
-- ============================================================
INSERT INTO penezenky (nazev, pocatecni_zustatek, barva)
SELECT * FROM (VALUES
  ('Ucet',      0, '#c8f060'),
  ('Hotovost',  0, '#60c8f0'),
  ('Kreditka',  0, '#f0a860'),
  ('Stravenka', 0, '#a860f0'),
  ('SkipPay',   0, '#60f0a8'),
  ('Unicredit', 0, '#f0d060')
) AS v(nazev, pocatecni_zustatek, barva)
WHERE NOT EXISTS (SELECT 1 FROM penezenky);

-- ============================================================
-- POZNÁMKA K MIGRACI ZE STARÉHO SCHÉMATU
--
-- Tabulka `plan` (měsíční částka na kategorii) byla nahrazena
-- sloupcem `zaznamy.typ_polozky` a v databázi je přejmenovaná na
-- `_archiv_plan`. Až si ověříš, že nic nechybí, smaž ji ručně
-- v SQL editoru:
--     DROP TABLE _archiv_plan;
-- ============================================================
