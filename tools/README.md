# Nástroje

Import deníku ze sheetu do tabulky `zaznamy` (issue #4). Dvě cesty, stejná
převodní logika:

| | kdo zapisuje | kdy ji použít |
|---|---|---|
| `nahraj-denik.py` | REST API, jeden běh | **výchozní** — máš service_role klíč |
| `import-denik.py` | vysype SQL, zapisuje Claude přes MCP `execute_sql` | když klíč není k dispozici |

## nahraj-denik.py — jeden běh přes REST

```
# 1) nasucho: zkontroluje mapování a spočítá řádky, nic neposlá
python3 tools/nahraj-denik.py --vstup denik.csv --mapovani tools/mapovani.json --nasucho

# 2) naostro
export SUPABASE_SERVICE_KEY='...'      # service_role / secret klíč z dashboardu
python3 tools/nahraj-denik.py --vstup denik.csv --mapovani tools/mapovani.json
```

**Musí to být `service_role` klíč.** RLS politiky na `zaznamy` jsou
`TO authenticated`, takže anon klíč (ten zapečený v `index.html`) nezapíše nic.
Klíč se bere jen z proměnné prostředí, ne z argumentu, aby neskončil v historii
shellu — a po importu ho v dashboardu **rotuj**.

Skript si nejdřív stáhne `zdroj_radek`, která v tabulce už jsou, a pošle jen
chybějící. Dá se jím tedy bez obav dojet přerušený import.

## import-denik.py — SQL pro cestu přes MCP

```
python3 tools/import-denik.py --vstup denik.csv --mapovani tools/mapovani.json \
                              --vystup out/ --po 500
```

Vysype `out/cast-NN.sql`; každý soubor je samostatný idempotentní `insert … on
conflict (zdroj_radek) … do update`. Dávky po ~500 řádcích, protože obsah musí
projít výstupem modelu. Dají se také pustit ručně:

```
cat out/cast-*.sql | psql "$CONNECTION_STRING"     # connection string z dashboardu
```

## najdi-prevody.sql — označení převodů mezi peněženkami

Splátka kreditky ani výběr z bankomatu nejsou výdaj domácnosti, ale v deníku
sedí jako obyčejný řádek a nafukují součty výdajů (issue #11). Skript spáruje
obě nohy převodu přes `zaznamy.prevod_skupina`:

```
psql "$CONNECTION_STRING" -f tools/najdi-prevody.sql
```

Je idempotentní a **záměrně konzervativní** — co nejde spárovat jistě, zůstane
neoznačené. Kotvou je příjem na peněžence, na kterou příjem domácnosti nechodí
(na kreditku nikomu nechodí mzda); protinoha se hledá jako výdaj z Účtu na
stejnou částku do 7 dnů, a `kde` musí být banka nebo cílová peněženka. Bez té
poslední podmínky vznikaly nesmysly: platba O2 za internet 500 Kč se spárovala
s výběrem 500 Kč z bankomatu.

Na naimportované historii označil 421 nohou ve 228 skupinách, z toho 35 skupin
má jen jednu nohu (protinoha se nenašla — buď se nikdy nezapsala, nebo má jinou
částku či datum).

## Vstup

Buď **CSV** stažené z listu `Odpovědi formuláře 1` (File → Download →
Comma-separated values) — očekává se hlavička na prvním řádku a sloupce v
původním pořadí A..N, číslo řádku se dopočítá z pozice.

Nebo **JSON**, pole objektů se surovými hodnotami:

```json
[{"radek": 2, "zapsano": "31.8.2015 18:24:33", "datum": "31.8.2015",
  "castka": "-200", "kat": "Odevy", "kde": "Albert", "koment": "Marianka teplaky",
  "polozka": "Skutecnost", "placeni": "Kreditka", "potvrzeni": "OK", "kod": "NA"}]
```

`radek` je číslo řádku ve sheetu a slouží jako klíč (`zaznamy.zdroj_radek`),
takže **import lze pustit opakovaně** a řádky se přepíšou, nikoli zduplikují.
Krytí má v databázi částečný unikátní index — pozor, v `schema.sql` zatím
chybí, i když v databázi je:

```sql
create unique index zaznamy_zdroj_radek_uniq on zaznamy(zdroj_radek)
  where zdroj_radek is not null;
```

**`mapovani.json`** drží id z databáze (osnova podle kódu, peněženky podle názvu).
Když se osnova změní, je potřeba ho přegenerovat:

```sql
select kod, id from osnova where kod is not null;
select nazev, id from penezenky;
```

## Co skript řeší

- `d.m.yyyy` → `date`; časová značka má v datech 6 podob včetně překlepů
  (`21.23` místo `21:23`), při neúspěchu se uloží NULL
- znaménko částky určuje `typ`; u nulové částky rozhoduje typ hlavní kategorie
- `Skutecnost` / `Plán` / `plán` → `typ_polozky`
- `Hotove` / `hotove` / `Hotovost` → jedna peněženka; `NA` / `N/A` / `Na` → žádná
- kategorie: přednost má kód osnovy (vyplňuje se až od 1/2026), jinak se
  plochá kategorie mapuje na hlavní kategorii
- prázdná kategorie projde jako NULL, vyplněná a neznámá se nahlásí a přeskočí
- `NA` a `N/A` v textových polích jsou zástupky za prázdno, ne text

## Dvě věci, které je dobré vědět

**`zapsano_dne` se ukládá jako UTC.** Hodina ze sheetu je pražský lokální čas,
ale do `timestamptz` jde tak, jak je napsaná, tedy s posunem `+00`. Založil to
první běh importu a drží se to kvůli konzistenci. Týká se to jen `zapsano_dne`
(pomocný údaj „kdy to někdo zapsal"), ne `datum`. Kdyby se to mělo předělat,
musí se přepsat celá tabulka najednou, ne po částech.

**Proč vůbec existuje cesta přes `execute_sql`.** MCP nástroj umí zavolat jen
model, ne skript, takže tudy musí data projít výstupem modelu — ~500 řádků na
volání. Je to pomalé a drahé a má smysl jen tehdy, když není po ruce klíč pro
REST: skript v kontejneru se bez `service_role` klíče (nebo hesla k DB) nemá
čím přihlásit, i když je `*.supabase.co` ze sítě dosažitelné.

## `zalohy-prerazeni-zpet.sql`

Zpětný krok k přeřazení záloh za elektřinu a vodu (8. 10. 2026). Platby za obě
ležely od roku 2016 na společné kategorii **Zalohy** vedle internetu, SIPO,
telefonů a plynu; karta Energie je potřebuje zvlášť, aby šlo srovnat zaplacené
s nákladem. Rozpoznaly se podle poznámky a dodavatele a přesunuly do
podkategorií **Elektrina** (120 záznamů) a **Vodne** (38 záznamů).

Součty se tím nikde neposunuly — obě jsou děti kategorie Zalohy, takže rozpad
po hlavních kategoriích v Přehledu i v Roku zůstal stejný.

Skript vyjmenovává přesně těch 158 id, takže vrátí jen to, co se tehdy
přesunulo, a nesáhne na záznamy, které v podkategoriích byly už předtím.

## `uniqa-slouceni-zpet.sql`

Zpětný krok ke sloučení dvou řad Uniqa Generace X (9. 10. 2026). V sheetu
byly dvě, obě patřící témuž fondu — vyšší byla stav před výběrem v 3/2026,
nižší to, co po něm zůstalo —, ale importovaly se jako dva fondy. Sloučení
je sečetlo po měsících do jednoho.

Součty se tím nikde neposunuly, součet fondů se dál rovná sloupci Investice.
Skript nese původních 23 hodnot nižší řady, protože ty se sloučením z databáze
ztratily a jinak by je nebylo z čeho vzít.

## `podkategorie-2024-2025-zpet.sql`

Zpětný krok k zařazení záznamů do podkategorií (9. 10. 2026, roky 2024–2025).
Záznamy ležely na nadřazených kategoriích; co to bylo, pojmenovává poznámka
a u části i obchod ve sloupci „kde". Ve dvou dávkách se jich 2 353 přeřadilo
(1 854 podle poznámky, 499 podle obchodu). Skript nese tatáž pravidla použitá
obráceně.

Zařadily se jen záznamy, jejichž poznámka odpovídá právě jedné podkategorii.
Kde seděly dvě („Nakup a obed", „havarijni a povinne"), záznam zůstal na
rodiči — jednu částku na dvě rozdělit nejde. Součty se nikde neposunuly.
