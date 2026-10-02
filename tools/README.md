# Nástroje

## import-denik.py

Převádí deník z Google Sheetu „Utrata" (list `Odpovědi formuláře 1`) na SQL
pro tabulku `zaznamy`. Souvisí s issue #4.

```
python3 tools/import-denik.py --vstup denik.json --mapovani tools/mapovani.json \
                              --vystup out/ --po 1000
```

**Vstup** `denik.json` je pole objektů se surovými hodnotami ze sheetu:

```json
[{"radek": 2, "zapsano": "31.8.2015 18:24:33", "datum": "31.8.2015",
  "castka": "-200", "kat": "Odevy", "kde": "Albert", "koment": "Marianka teplaky",
  "polozka": "Skutecnost", "placeni": "Kreditka", "potvrzeni": "OK", "kod": "NA"}]
```

`radek` je číslo řádku ve sheetu. Slouží jako klíč: vygenerované SQL dělá
`on conflict (zdroj_radek) do update`, takže **import lze pustit opakovaně**
a řádky se přepíšou, nikoli zduplikují.

**`mapovani.json`** drží id z databáze (osnova podle kódu, peněženky podle názvu).
Když se osnova změní, je potřeba ho přegenerovat:

```sql
select kod, id from osnova where kod is not null;
select nazev, id from penezenky;
```

### Co skript řeší

- `d.m.yyyy` → `date`; časová značka má v datech 6 podob včetně překlepů
  (`21.23` místo `21:23`), při neúspěchu se uloží NULL
- znaménko částky určuje `typ`; u nulové částky rozhoduje typ hlavní kategorie
- `Skutecnost` / `Plán` / `plán` → `typ_polozky`
- `Hotove` / `hotove` / `Hotovost` → jedna peněženka; `NA` → žádná
- kategorie: přednost má kód osnovy (vyplňuje se až od 1/2026), jinak se
  plochá kategorie mapuje na hlavní kategorii
- prázdná kategorie projde jako NULL, vyplněná a neznámá se nahlásí a přeskočí
- `NA` a `N/A` v textových polích jsou zástupky za prázdno, ne text

### Jak se data berou ze sheetu

Supabase ani Google API nejsou z kontejneru dosažitelné (egress politika),
takže data tečou přes MCP konektor. Velké odpovědi harness ukládá na disk,
takže čtení je levné; zápis do databáze ale musí projít přes `execute_sql`,
což je pomalé. Pokud by síťová politika prostředí povolila `*.supabase.co`,
šel by celý import pustit jedním skriptem proti REST API.
