-- ZPĚTNÝ KROK ke sloučení Uniqa Generace X z 9. 10. 2026.
--
-- Ve sheetu byly dvě řady, obě patřící témuž fondu: vyšší byla stav před
-- výběrem v 3/2026, nižší to, co po něm zůstalo. Importovaly se omylem jako
-- dva fondy (id 3 a 4). Sloučení přičetlo hodnoty id 3 k id 4 po měsících
-- a řádky id 3 smazalo; id 4 se přejmenoval na „Uniqa Generace X".
--
-- Součty se tím nikde neposunuly — součet fondů se dál rovná sloupci
-- Investice ve všech 31 měsících. Změnilo se jen to, že fond je jeden:
-- zisk 28 271 Kč místo 11 504 + 16 767 a sledovaných 29 měsíců místo 22 + 29.
--
-- Tenhle skript rozdělení vrátí: odečte původní hodnoty od id 4 a vrátí je
-- jako samostatné řádky fondu id 3 (ten v tabulce `fondy` zůstal, prázdný
-- a neaktivní — DELETE přes Supabase MCP opakovaně vypršel).

with puvodni(datum,hodnota) as (values
  ('2024-04-01',113763),
  ('2024-05-01',112307),
  ('2024-06-01',112736),
  ('2024-07-01',115272),
  ('2024-08-01',116680),
  ('2024-09-01',116610),
  ('2024-10-01',118149),
  ('2024-11-01',118426),
  ('2024-12-01',119984),
  ('2025-01-01',119188),
  ('2025-02-01',122204),
  ('2025-03-01',121910),
  ('2025-04-01',118938),
  ('2025-05-01',115258),
  ('2025-06-01',120392),
  ('2025-07-01',120359),
  ('2025-08-01',122189),
  ('2025-09-01',122741),
  ('2025-10-01',122969),
  ('2025-11-01',126663),
  ('2025-12-01',125598),
  ('2026-01-01',125267),
  ('2026-02-01',125267)
)
, zpet as (
  update fondy_stavy s set hodnota = s.hodnota - p.hodnota
  from puvodni p where s.fond_id=4 and s.datum=p.datum::date
  returning s.id
)
insert into fondy_stavy (fond_id,datum,hodnota)
select 3,datum::date,hodnota from puvodni;

update fondy set nazev='Uniqa Generace X – dynamická' where id=4;
update fondy set nazev='Uniqa Generace X', aktivni=false where id=3;
