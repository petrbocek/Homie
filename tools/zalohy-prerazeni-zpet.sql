-- ZPĚTNÝ KROK k přeřazení záloh z 8. 10. 2026.
--
-- Platby za elektřinu a vodu ležely od roku 2016 na společné kategorii
-- Zalohy (10) vedle internetu, SIPO, telefonů a plynu. Karta Energie je
-- potřebuje zvlášť, aby šlo srovnat zaplacené s nákladem, tak se přeřadily
-- do podkategorií Elektrina (35) a Vodne (36) podle poznámky a dodavatele:
--
--   elektřina: poznamka ~* 'elektr' nebo kde ~* '^e\.?on'   120 záznamů, 300 083 Kč
--   voda:      poznamka ~* 'vodn|stocn' nebo kde ~* 'smvak'   38 záznamů,  74 972 Kč
--
-- Součty se tím nikde neposunuly: 35 i 36 jsou děti kategorie 10, takže rozpad
-- po hlavních kategoriích v Přehledu i v Roku zůstal stejný. Přibyla jen data
-- na kartě Energie — uzavřené období 1. 10. 2025 – 30. 9. 2026 je díky tomu
-- úplné: přeplatek 10 511 Kč místo dřívějšího „+16 920 bez tří měsíců".
--
-- Záznamy, které pod Elektrinou a Vodnem byly už předtím (od ledna 2026),
-- se tu nevyjmenovávají, takže se jich tenhle skript nedotkne.

update zaznamy set kategorie_id=10 where id in (
-- elektřina (120)
  1034,1035,1199,1201,1296,1297,1432,1433,1586,1736,1911,4113,4115,4269,4271,
  4467,4469,4642,4644,4833,4835,5002,5004,5198,5201,5383,5385,5536,5539,5745,
  5916,6129,6346,6561,6837,7077,7267,7527,7737,7904,8085,8293,8472,8663,8839,
  8981,9156,9332,9480,9671,9860,10031,10225,10405,10572,10758,10917,11094,
  11257,11439,11503,11604,11732,11927,12076,12236,12377,12484,12612,12739,
  13031,13213,13381,14028,14594,14739,14845,14983,15105,15238,15393,15562,
  15758,15943,16054,16208,16376,16639,16762,16890,17030,17285,17444,17742,
  18011,18049,18205,18375,18535,18708,18874,19041,19172,19353,19510,19549,
  19651,19802,20003,20150,20309,20485,20648,20824,21024,21199,21366,21555,
  21746,22134
,
-- voda (38)
  590,997,1397,1857,4310,5049,5489,6156,6851,7417,8033,8683,9099,9610,10384,
  10698,11214,11530,12195,12459,12802,13416,13922,14364,14807,15146,15573,
  16539,16984,17366,17824,18336,18792,19743,20171,20709,21228,21848
);
