-- ZPĚTNÝ KROK k zařazení záznamů do podkategorií (9. 10. 2026, roky 2024–2025).
--
-- Záznamy ležely na nadřazených kategoriích; co to bylo, pojmenovává poznámka
-- a u části i obchod ve sloupci „kde". Ve dvou dávkách se jich 2 353 přeřadilo
-- do podkategorií. Pravidla níž jsou tatáž, jen použitá obráceně — vrátí
-- přesně tu množinu zpátky.
--
--   dávka 1 (1 854) podle poznámky: Nakup, Obed, Jizdenky, Urazovka, Internet…
--   dávka 2   (499) podle obchodu:  Amundi/Conseq/Trigea/XTB u Spoření,
--                                   lékárna vs. drogerie, Colliery vs. Spotify
--                                   u členství, plat od zaměstnavatele
--
-- Pravidlo bylo: poznámka musí odpovídat právě jedné podkategorii daného
-- rodiče. Kde seděly dvě („Nakup a obed", „havarijni a povinne"), zůstal
-- záznam na rodiči, protože rozdělit jednu částku na dvě nejde.
-- Rodiče s jedinou podkategorií (Hypoteka→Dum, Odevy→Odevy, Najem→Najem)
-- se přesunuly celé: splést se tam nedá.
--
-- Součty se nikde neposunuly — podkategorie se sčítají do rodiče, takže
-- rozpad po hlavních kategoriích v Přehledu i v Roku zůstal stejný.
--
-- POZOR: skript se řídí pravidlem, ne seznamem id. Když po přeřazení sám
-- přesuneš do podkategorie další záznam z let 2024–2025 a jeho poznámka
-- některému pravidlu vyhoví, vrátí ho tenhle skript na rodiče taky.

with pravidla(rodic,vzor,cil) as (values
  (13,'.*',55),(6,'.*',20),(59,'.*',60),
  (8,'jizdenk|jízdenk',28),(8,'benzin|tankov',27),
  (5,'lek|lék',19),
  (7,'urazov|úrazov',21),(7,'havarij',24),(7,'povinn',23),(7,'cestovn',25),(7,'duchodov|důchodov',26),
  (11,'nakup',43),(11,'obed|oběd',46),
  (12,'vanoc|vánoc',51),(12,'narozen|narozk',52),(12,'dovolen',53),(12,'predplatn|predpaltn|předplatn',49),
  (10,'internet',38),(10,'sipo',39),(10,'telefon',37),(10,'poplatk|vedeni uctu',40),
  (10,'drevo|dřevo',41),(10,'odpad',42),
  (14,'^auto',57),(14,'bazen|bazén',56),
  (4,'volejbal',16),(4,'^dan|^daň',17),
  (1,'marika',3),(1,'^pet|^peť',2)
), zpet as (
  select z.id, c.parent_id rodic
  from zaznamy z
  join osnova c on c.id=z.kategorie_id and c.parent_id is not null
  join pravidla r on r.rodic=c.parent_id and r.cil=c.id
                 and coalesce(z.poznamka,'') ~* r.vzor
  where z.datum between '2024-01-01' and '2025-12-31'
  group by z.id, c.parent_id
)
update zaznamy z set kategorie_id=p.rodic from zpet p where p.id=z.id;

-- dávka 2: rozřazeno podle obchodu ve sloupci „kde" (a u členství podle obojího)
with p2(rodic,pole,vzor,cil) as (values
  (9,'kde','xtb',31),(9,'kde','amundi',32),(9,'kde','trigea',33),(9,'kde','conseq',34),
  (5,'kde','benu|lekarn|lékárn',19),
  (5,'kde','^dm|drogerie|rossmann|teta|albert|lidl|kaufland|dealz|action|globus|penny|tesco|billa',18),
  (12,'oboji','clenstv.*(colliery|fitpark)|(colliery|fitpark).*clenstv',48),
  (12,'oboji','clenstv.*(spotify|google|youtube)|(spotify|google|youtube).*clenstv',49),
  (1,'poznamka','^plat',2)
), zpet2 as (
  select z.id, c.parent_id rodic
  from zaznamy z
  join osnova c on c.id=z.kategorie_id and c.parent_id is not null
  join p2 r on r.rodic=c.parent_id and r.cil=c.id
    and (case r.pole when 'kde' then coalesce(z.kde,'')
                     when 'poznamka' then coalesce(z.poznamka,'')
                     else coalesce(z.poznamka,'')||' | '||coalesce(z.kde,'') end) ~* r.vzor
  where z.datum between '2024-01-01' and '2025-12-31'
  group by z.id, c.parent_id
)
update zaznamy z set kategorie_id=p.rodic from zpet2 p where p.id=z.id;
