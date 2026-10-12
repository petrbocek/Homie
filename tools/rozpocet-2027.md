# Rozpočet 2027

Sestaveno 12. 10. 2026 z historických dat. **Do aplikace nic zapsáno není** —
tohle je podklad k rozhodnutí, ne plán v tabulce `plan`.

Reprodukce: `python3 tools/rozpocet-2027.py`. Čísla jsou v tom skriptu zadrátovaná
(jak byla v Supabase k 12. 10. 2026), aby šel rozpočet přepočítat i bez přístupu
k databázi a aby byla vidět každá jmenovitá úprava.

## Metoda

Základ je **skutečnost za 10/2025 – 9/2026**, ne průměr několika let ani odhad.
K ní se přičítají jmenovité úpravy, u každé je důvod. Co v seznamu úprav není,
jde do rozpočtu v loňské výši.

Ze základu jsou vyloučené:

- převody mezi vlastními účty (`prevod_skupina`),
- záznamy „Kreditka" (jsou to převody, ale vedou se jako výdaj),
- pseudo-příjmy podle `poznamka ~* 'prevod|moje pujcka|vyber'` — 153 000 Kč
  přesunů z Unicreditu, 50 000 Kč čerpání vlastní půjčky a výběry z bankomatu.

Bez toho vyloučení vyjdou příjmy o ~203 tis. vyšší, než doopravdy jsou.

## Můstek od skutečnosti k rozpočtu

| | Kč/rok |
|---|---:|
| skutečnost 10/2025 – 9/2026, příjmy | 1 444 321 |
| skutečnost 10/2025 – 9/2026, výdaje | 1 584 154 |
| **saldo skutečnosti** | **−139 833** |

| úprava | dopad | důvod |
|---|---:|---|
| Mzda › Peťa → 92 884/m | +16 294 | poslední 3 měsíce, ne průměr roku |
| Mzda › Marika → 21 912/m | +16 840 | poslední 3 měsíce |
| Mzda › Mzda → 0 | −4 338 | jednorázový doplatek |
| Zálohy › Elektřina → 3 980/m | −12 959 | nový předpis od 16. 11. 2026 |
| Zálohy › Vodné → 16 300 | −282 | 113 m³ × 144,07 Kč podle faktury SMVaK |

| rozpočet 2027 | Kč/rok | Kč/měsíc |
|---|---:|---:|
| příjmy | 1 473 117 | 122 760 |
| výdaje | 1 570 913 | 130 909 |
| **saldo** | **−97 796** | **−8 150** |

## Čisté jmění za stejné období

| | Kč |
|---|---:|
| čisté jmění 10/2025 | −1 555 317 |
| čisté jmění 10/2026 | −1 279 985 |
| **změna** | **+275 332** |

Z toho aktiva +146 586, dluhy −128 746.

Záporné saldo tedy neznamená prožírání. Do fondů jde ~69 934 Kč/rok a na
jistinách se umoří ~128 746 Kč/rok; to je 198 680 Kč, které z cash flow odtečou,
ale v majetku zůstanou. Schodek je převážně přesun do majetku.

## Co rozpočet neřeší

Tyhle položky jdou do rozpočtu v plné loňské výši, protože jejich snížení je
rozhodnutí, ne modelování:

| kategorie | Kč/rok | riziko |
|---|---:|---|
| Ostatní › Domácnost | 62 451 | obsahuje jednorázových 49 340 Kč v 9/2026 |
| Ostatní › Dovolené | 100 830 | o 14 tis. nad tříletým průměrem |
| Ostatní › Ostatní | 259 429 | sběrná kategorie bez rozpadu, 21 619 Kč/m |

Kdyby se jednorázová Domácnost neopakovala, **saldo je −48 456 Kč** místo
−97 796.

Kvalitu rozpočtu nejvíc limituje `Ostatní › Ostatní`: 259 429 Kč/rok je šestá
nejvyšší položka domácnosti a nikdo neví, co v ní je. Rozpad téhle jedné
kategorie by zpřesnil rozpočet víc než všechny úpravy výše dohromady.

## Pozor na první verzi

První pokus vyšel na saldo −3 347 Kč, tedy téměř vyrovnaný rozpočet. **Bylo to
špatně.** Vypadly z něj kategorie pod 3 000 Kč (Pojištění › Domácnost 6 456,
Strava › Strava 5 236, Strava › Posezení 3 214, Jiný Příjem výdaj 3 000) a byly
v něm schované dvě nepotvrzené „úspory". Odhalilo se to porovnáním s realitou:
skutečné saldo je −139 833, ne nula. Proto je rozpočet postavený jako můstek —
každé číslo musí být dohledatelné ze skutečnosti.

## Celý rozpočet po kategoriích

### Příjmy

| Kategorie | Podkategorie | 2027 / rok | 2027 / měsíc | skutečnost 10/25–9/26 |
|---|---|---:|---:|---:|
| Mzda | Peťa | 1 114 608 | 92 884 | 1 098 314 (+16 294) |
| Mzda | Marika | 262 944 | 21 912 | 246 104 (+16 840) |
| Jiny Prijem | Jiny Prijem | 44 520 | 3 710 | 44 520 |
| Jiny Prijem | Volejbal | 33 150 | 2 762 | 33 150 |
| Ostatni | Ostatni | 13 355 | 1 113 | 13 355 |
| Doprava | Doprava | 2 000 | 167 | 2 000 |
| Doprava | Benzin | 1 000 | 83 | 1 000 |
| Ostatni | Domacnost | 570 | 48 | 570 |
| Strava | Nakupy | 400 | 33 | 400 |
| Odevy | Odevy | 200 | 17 | 200 |
| Strava | Obedy | 195 | 16 | 195 |
| Ostatni | Zdravi | 175 | 15 | 175 |
| Mzda | Mzda | 0 | 0 | 4 338 (-4 338) |
| **celkem** |  | **1 473 117** | **122 760** | **1 444 321** |

### Výdaje

| Kategorie | Podkategorie | 2027 / rok | 2027 / měsíc | skutečnost 10/25–9/26 |
|---|---|---:|---:|---:|
| Ostatni | Ostatni | 259 429 | 21 619 | 259 429 |
| Strava | Nakupy | 233 466 | 19 456 | 233 466 |
| Hypoteka | Dum | 165 492 | 13 791 | 165 492 |
| Ostatni | Dovolene | 100 830 | 8 402 | 100 830 |
| Pujcka | Auto | 69 492 | 5 791 | 69 492 |
| Doprava | Benzin | 66 297 | 5 525 | 66 297 |
| Ostatni | Fitness | 65 212 | 5 434 | 65 212 |
| Ostatni | Domacnost | 62 451 | 5 204 | 62 451 |
| Strava | Restaurace | 53 109 | 4 426 | 53 109 |
| Pujcka | Bazen | 49 296 | 4 108 | 49 296 |
| Ostatni | Vanoce | 48 671 | 4 056 | 48 671 |
| Zalohy | Elektrina | 47 760 | 3 980 | 60 719 (-12 959) |
| Sporeni | Amundi | 36 000 | 3 000 | 36 000 |
| Pojisteni | Urazovka | 32 477 | 2 706 | 32 477 |
| Strava | Obedy | 28 776 | 2 398 | 28 776 |
| Drogerie | Drogerie | 27 052 | 2 254 | 27 052 |
| Odevy | Odevy | 25 283 | 2 107 | 25 283 |
| Ostatni | Zdravi | 23 748 | 1 979 | 23 748 |
| Zalohy | Vodne | 16 300 | 1 358 | 16 582 (-282) |
| Ostatni | Narozeniny | 15 761 | 1 313 | 15 761 |
| Pojisteni | Havarijni | 12 602 | 1 050 | 12 602 |
| Sporeni | Conseq | 12 000 | 1 000 | 12 000 |
| Ostatni | Predplatne | 11 613 | 968 | 11 613 |
| Drogerie | Léky | 11 596 | 966 | 11 596 |
| Sporeni | XTB | 11 434 | 953 | 11 434 |
| Doprava | Servis | 9 951 | 829 | 9 951 |
| Sporeni | Trigea | 9 000 | 750 | 9 000 |
| Zalohy | Telefony | 8 367 | 697 | 8 367 |
| Doprava | Jizdenky | 8 082 | 674 | 8 082 |
| Pojisteni | Domacnost | 6 456 | 538 | 6 456 |
| Zalohy | Internet | 5 986 | 499 | 5 986 |
| Zalohy | Drevo | 5 600 | 467 | 5 600 |
| Pojisteni | Duchodove | 5 500 | 458 | 5 500 |
| Strava | Strava | 5 236 | 436 | 5 236 |
| Zalohy | Poplatky | 4 374 | 364 | 4 374 |
| Pojisteni | Povinne rucni | 4 102 | 342 | 4 102 |
| Strava | Posezeni | 3 214 | 268 | 3 214 |
| Jiny Prijem | Jiny Prijem | 3 000 | 250 | 3 000 |
| Zalohy | SIPO | 2 538 | 212 | 2 538 |
| Sporeni | Sporeni | 1 500 | 125 | 1 500 |
| Pojisteni | Cestovni | 670 | 56 | 670 |
| Doprava | Doprava | 630 | 52 | 630 |
| Pojisteni | Pojisteni | 560 | 47 | 560 |
| **celkem** |  | **1 570 913** | **130 909** | **1 584 154** |
