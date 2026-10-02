-- Označí převody mezi peněženkami v naimportované historii (issue #11).
--
-- Převod není výdaj domácnosti — peníze jen přejdou z jedné peněženky do
-- druhé. V deníku ale sedí jako obyčejný řádek a nafukuje součty výdajů.
-- Tenhle skript spáruje obě nohy převodu přes `zaznamy.prevod_skupina`.
--
-- Pouštět přes Supabase SQL editor nebo `psql "$CONNECTION_STRING" -f`.
-- Je idempotentní: co už skupinu má, se znovu nepřepisuje, takže se dá
-- pustit opakovaně i po doimportování dalších řádků.
--
-- ZÁMĚRNĚ KONZERVATIVNÍ. Co nejde spárovat jistě, zůstane neoznačené —
-- radši nechat převod schovaný mezi výdaji než omylem vyhodit skutečný
-- výdaj. Při vývoji párování podle „stejná částka do 7 dnů" bez omezení
-- na protistranu vznikly nesmysly: platba O2 za internet 500 Kč se
-- spárovala s výběrem 500 Kč z bankomatu.

BEGIN;

-- 1) Kotvy: příjem na peněžence, na kterou se příjem domácnosti nechodí.
--    Nikomu nechodí mzda na kreditku — příchozí částka tam je splátka
--    z běžného účtu. `kde` drží protistranu (banku), ne obchodníka.
--    Stravenka schválně není v seznamu: tam je příchozí částka stravenkový
--    benefit od zaměstnavatele (Ceos, Tieto), tedy skutečný příjem.
CREATE TEMP TABLE _kotvy ON COMMIT DROP AS
SELECT z.id, z.datum, z.castka
FROM zaznamy z JOIN penezenky p ON p.id = z.penezenka_id
WHERE z.typ_polozky = 'skutecnost' AND z.typ = 'prijem'
  AND z.prevod_skupina IS NULL
  AND ( (p.nazev IN ('Kreditka','Hotovost','Unicredit') AND z.kde = 'KB')
     OR (p.nazev = 'SkipPay' AND z.kde IN ('CSOB','KB')) );

-- 2) Protinoha: výdaj z Účtu na stejnou částku, do 7 dnů, a `kde` musí být
--    banka nebo cílová peněženka. Bez téhle podmínky vznikají falešné páry.
--    Párování je 1:1 — jeden výdaj nesmí zaplatit dva příjmy.
CREATE TEMP TABLE _pary ON COMMIT DROP AS
WITH kand AS (
  SELECT k.id AS prijem_id, v.id AS vydaj_id,
         ROW_NUMBER() OVER (PARTITION BY k.id ORDER BY abs(v.datum - k.datum), v.id) AS p_poradi,
         ROW_NUMBER() OVER (PARTITION BY v.id ORDER BY abs(v.datum - k.datum), k.id) AS v_poradi
  FROM _kotvy k
  JOIN zaznamy v ON v.typ_polozky = 'skutecnost' AND v.typ = 'vydaj'
                AND v.prevod_skupina IS NULL
                AND v.castka = k.castka AND abs(v.datum - k.datum) <= 7 AND v.id <> k.id
  JOIN penezenky vp ON vp.id = v.penezenka_id AND vp.nazev = 'Ucet'
  WHERE v.kde IN ('KB','CSOB','Unicredit','UniCredit','SkipPay','Vyber','Prevod')
)
SELECT prijem_id, vydaj_id FROM kand WHERE p_poradi = 1 AND v_poradi = 1;

-- 3) Spárované převody: obě nohy dostanou stejnou skupinu.
UPDATE zaznamy z SET prevod_skupina = 'p-' || p.prijem_id
FROM _pary p WHERE z.id IN (p.prijem_id, p.vydaj_id);

-- 4) Kotvy bez protinohy. Příjem to není v žádném případě, takže se taky
--    označí — ale sám, a je to vidět: skupina má jen jednu nohu. Odpovídající
--    výdaj se buď nikdy nezapsal, nebo má jinou částku či datum a zůstává
--    mezi výdaji. Tím se nic nekazí, jen se to neopraví.
UPDATE zaznamy z SET prevod_skupina = 'p1-' || z.id
WHERE z.id IN (SELECT id FROM _kotvy) AND z.prevod_skupina IS NULL;

COMMIT;

-- Kontrola: kolik nohou, kolik skupin, kolik z nich je neúplných.
SELECT count(*) AS nohou,
       count(DISTINCT prevod_skupina) AS skupin,
       count(*) FILTER (WHERE prevod_skupina LIKE 'p1-%') AS bez_protinohy,
       round(sum(castka) FILTER (WHERE typ = 'vydaj')) AS vydaju_vyjmuto,
       round(sum(castka) FILTER (WHERE typ = 'prijem')) AS prijmu_vyjmuto
FROM zaznamy WHERE prevod_skupina IS NOT NULL;
