# -*- coding: utf-8 -*-
# Rozpočet 2027. Základem je SKUTEČNOST za 10/2025–9/2026 (bez převodů, bez
# kreditky a bez „příjmů", které jsou ve skutečnosti převody a výběry).
# K ní se přičítají jmenovité úpravy, aby šlo dohledat, odkud se číslo vzalo.
S = {}
for r in """Doprava|Benzin|prijem|1000
Doprava|Benzin|vydaj|66297
Doprava|Doprava|prijem|2000
Doprava|Doprava|vydaj|630
Doprava|Jizdenky|vydaj|8082
Doprava|Servis|vydaj|9951
Drogerie|Drogerie|vydaj|27052
Drogerie|Léky|vydaj|11596
Hypoteka|Dum|vydaj|165492
Jiny Prijem|Jiny Prijem|prijem|44520
Jiny Prijem|Jiny Prijem|vydaj|3000
Jiny Prijem|Volejbal|prijem|33150
Mzda|Marika|prijem|246104
Mzda|Mzda|prijem|4338
Mzda|Peťa|prijem|1098314
Odevy|Odevy|prijem|200
Odevy|Odevy|vydaj|25283
Ostatni|Domacnost|prijem|570
Ostatni|Domacnost|vydaj|62451
Ostatni|Dovolene|vydaj|100830
Ostatni|Fitness|vydaj|65212
Ostatni|Narozeniny|vydaj|15761
Ostatni|Ostatni|prijem|13355
Ostatni|Ostatni|vydaj|259429
Ostatni|Predplatne|vydaj|11613
Ostatni|Vanoce|vydaj|48671
Ostatni|Zdravi|prijem|175
Ostatni|Zdravi|vydaj|23748
Pojisteni|Cestovni|vydaj|670
Pojisteni|Domacnost|vydaj|6456
Pojisteni|Duchodove|vydaj|5500
Pojisteni|Havarijni|vydaj|12602
Pojisteni|Pojisteni|vydaj|560
Pojisteni|Povinne rucni|vydaj|4102
Pojisteni|Urazovka|vydaj|32477
Pujcka|Auto|vydaj|69492
Pujcka|Bazen|vydaj|49296
Sporeni|Amundi|vydaj|36000
Sporeni|Conseq|vydaj|12000
Sporeni|Sporeni|vydaj|1500
Sporeni|Trigea|vydaj|9000
Sporeni|XTB|vydaj|11434
Strava|Nakupy|prijem|400
Strava|Nakupy|vydaj|233466
Strava|Obedy|prijem|195
Strava|Obedy|vydaj|28776
Strava|Posezeni|vydaj|3214
Strava|Restaurace|vydaj|53109
Strava|Strava|vydaj|5236
Zalohy|Drevo|vydaj|5600
Zalohy|Elektrina|vydaj|60719
Zalohy|Internet|vydaj|5986
Zalohy|Poplatky|vydaj|4374
Zalohy|SIPO|vydaj|2538
Zalohy|Telefony|vydaj|8367
Zalohy|Vodne|vydaj|16582""".strip().split('\n'):
    a,b,t,v = r.split('|'); S[(a,b,t)] = int(v)

P0 = sum(v for k,v in S.items() if k[2]=='prijem')
V0 = sum(v for k,v in S.items() if k[2]=='vydaj')

# Jmenovité úpravy proti skutečnosti. Každá má důvod; co není v seznamu,
# jde do rozpočtu tak, jak to loni bylo.
UPRAVY = [
 # (kategorie, typ, nová roční částka, důvod)
 (('Mzda','Peťa','prijem'),      92884*12, 'poslední 3 měsíce (93 tis.), ne průměr roku'),
 (('Mzda','Marika','prijem'),    21912*12, 'poslední 3 měsíce (22 tis.)'),
 (('Mzda','Mzda','prijem'),             0, 'jednorázový doplatek, neopakuje se'),
 (('Zalohy','Elektrina','vydaj'),3980*12,  'nová záloha 3 980 Kč od 16. 11. 2026'),
 (('Zalohy','Vodne','vydaj'),       16300, '113 m³ × 144,07 Kč podle faktury SMVaK'),
]
# Co nechávám na zvážení (do rozpočtu jde plná loňská částka):
RIZIKA = [
 (('Ostatni','Domacnost','vydaj'), 49340, 'jednorázová položka 49 340 Kč v 9/2026'),
 (('Ostatni','Dovolene','vydaj'),  14310, 'loni o 14 tis. víc než tříletý průměr'),
 (('Ostatni','Ostatni','vydaj'),       0, 'sběrná kategorie 259 tis./rok bez rozpadu'),
]

B = dict(S)
for k, nova, _ in UPRAVY: B[k] = nova
P1 = sum(v for k,v in B.items() if k[2]=='prijem')
V1 = sum(v for k,v in B.items() if k[2]=='vydaj')

def f(n): return f'{round(n):,}'.replace(',', ' ')
sep = '='*72

print(sep); print('ROZPOČET 2027 — od skutečnosti k plánu'.center(72)); print(sep)
print(f'\nSKUTEČNOST 10/2025 – 9/2026 (základ)')
print(f'  příjmy {f(P0):>12}   výdaje {f(V0):>12}   saldo {f(P0-V0):>12}')
print(f'\nÚPRAVY')
for k, nova, duvod in UPRAVY:
    d = nova - S.get(k,0)
    print(f'  {k[0]+" › "+k[1]:28}{("+" if d>=0 else "")+f(d):>10}   {duvod}')
print(f'\nROZPOČET 2027')
print(f'  příjmy {f(P1):>12}   výdaje {f(V1):>12}   saldo {f(P1-V1):>12}')
print(f'  měsíčně{f(P1/12):>12}        {f(V1/12):>12}         {f((P1-V1)/12):>12}')
print('\n'+sep)
print('CO ROZPOČET NEŘEŠÍ — tam jde loňská částka beze změny')
print(sep)
for k, c, duvod in RIZIKA:
    print(f'  {k[0]+" › "+k[1]:28}{f(B[k]):>10} Kč/rok   {duvod}')
print(f'\n  Kdyby se jednorázová Domácnost (49 340) neopakovala,')
print(f'  saldo by bylo {f(P1-V1+49340)} Kč místo {f(P1-V1)} Kč.')

# ---------------------------------------------------------------------------
# Celá tabulka po kategoriích (markdown), ať se dá rozpočet vytisknout.
print('\n'+sep); print('ROZPOČET 2027 PO KATEGORIÍCH'.center(72)); print(sep)
for typ, hlav in (('prijem','PŘÍJMY'),('vydaj','VÝDAJE')):
    radky = sorted([(k,v) for k,v in B.items() if k[2]==typ and (v or S.get(k,0))],
                   key=lambda x: -x[1])
    print(f'\n### {hlav}\n')
    print('| Kategorie | Podkategorie | 2027 / rok | 2027 / měsíc | skutečnost 10/25–9/26 |')
    print('|---|---|---:|---:|---:|')
    for k, v in radky:
        s = S.get(k, 0)
        zm = '' if v == s else f' ({"+" if v>s else ""}{f(v-s)})'
        print(f'| {k[0]} | {k[1]} | {f(v)} | {f(v/12)} | {f(s)}{zm} |')
    cv = sum(v for _, v in radky); cs = sum(S.get(k,0) for k,_ in radky)
    print(f'| **celkem** |  | **{f(cv)}** | **{f(cv/12)}** | **{f(cs)}** |')
