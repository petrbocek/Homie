#!/usr/bin/env python3
"""
Převede deník z Google Sheetu („Utrata", list Odpovědi formuláře 1) na řádky
pro tabulku `zaznamy`.

Jako knihovna dává `preved()` — tu používá `nahraj-denik.py`, který zapisuje
přes REST API. Jako skript vysype SQL soubory; to je cesta pro Supabase MCP
`execute_sql`, když není k dispozici service_role klíč:

    python3 tools/import-denik.py --vstup denik.json --mapovani mapovani.json \
                                  --vystup out/ --po 1000

Vstup je CSV stažené ze sheetu, nebo JSON: pole objektů se surovými hodnotami
  {radek, zapsano, datum, castka, kat, kde, koment, polozka, placeni, potvrzeni, kod}

Výstup je idempotentní: klíčem je `zdroj_radek` (číslo řádku ve sheetu),
takže opakovaný běh řádky přepíše, nikoli zduplikuje.
"""
import json, re, csv, argparse, os, unicodedata
from collections import Counter

# Sloupce listu „Odpovědi formuláře 1" v pořadí A..N. G/H/I (Mesic/Rok/Tyden)
# a K (CashFlow) se neimportují — jsou odvozené.
CSV_POLE = [
    'zapsano',    # A Časová značka
    'datum',      # B Datum
    'castka',     # C Castka
    'kat',        # D Kategorie (plochá)
    'kde',        # E Kde
    'koment',     # F Koment
    None,         # G Mesic
    None,         # H Rok
    None,         # I Tyden
    'polozka',    # J Typ polozky
    None,         # K CashFlow
    'placeni',    # L Typ placeni
    'potvrzeni',  # M Potvrzeni
    'kod',        # N Osnova (kód)
]

RE_DATUM = re.compile(r'^(\d{1,2})\.(\d{1,2})\.(\d{4})$')
# časová značka má v datech 6 podob včetně překlepů (21.23 místo 21:23)
RE_ZNACKA = re.compile(r'^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$')

# Hodina ze sheetu je pražský lokální čas, ale ukládá se jako UTC — tak to
# založil první běh importu a týká se jen `zapsano_dne` (pomocný údaj, ne
# `datum`). Kdyby se to mělo předělat, musí se přepsat celá tabulka najednou.
ZONA = '+00'


def klic(s):
    """Porovnávací klíč: bez diakritiky, malá písmena, bez mezer navíc."""
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode()
    return ' '.join(s.lower().split())


def cislo(s):
    s = str(s or '').replace('\xa0', '').replace(' ', '').replace('Kč', '').replace(',', '.').strip()
    try:
        return float(s)
    except ValueError:
        return None


def datum(s):
    m = RE_DATUM.match(str(s or '').strip())
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return None
    return '%04d-%02d-%02d' % (y, mo, d)


def znacka(s):
    m = RE_ZNACKA.match(str(s or '').strip())
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return None
    h, mi, se = int(m.group(4) or 0), int(m.group(5) or 0), int(m.group(6) or 0)
    if h > 23 or mi > 59 or se > 59:
        h = mi = se = 0
    return '%04d-%02d-%02d %02d:%02d:%02d' % (y, mo, d, h, mi, se)


def pole_text(s):
    """Hodnota do roury. Prázdné pole se v SQL přeloží na NULL."""
    s = ' '.join(str(s or '').split())
    # „NA" je ve zdroji zástupka za prázdnou hodnotu, ne skutečný text
    if s.upper() in ('NA', 'N/A'):
        return ''
    if '|' in s or '\n' in s:
        raise ValueError('hodnota obsahuje oddělovač: %r' % s)
    return s


def nacti(cesta):
    """Vstup: buď JSON (pole objektů), nebo CSV stažené ze sheetu.

    U CSV se `radek` dopočítá z pozice: hlavička je řádek 1 sheetu, takže
    i-tý datový řádek je sheetu řádek i+2. Na tom stojí idempotence —
    `zdroj_radek` musí odpovídat číslu řádku ve sheetu.
    """
    if not cesta.lower().endswith('.csv'):
        return json.load(open(cesta, encoding='utf-8'))

    recs = []
    with open(cesta, encoding='utf-8-sig', newline='') as f:
        for i, row in enumerate(csv.reader(f)):
            if i == 0:          # hlavička
                continue
            if not any(str(x).strip() for x in row):
                continue        # prázdný řádek ve zdroji
            r = {'radek': i + 1}
            for j, jmeno in enumerate(CSV_POLE):
                if jmeno:
                    r[jmeno] = row[j] if j < len(row) else ''
            recs.append(r)
    return recs


def preved(cesta_vstup, cesta_mapovani):
    """Surové řádky ze sheetu → (řádky pro `zaznamy`, přeskočené, statistika).

    Řádky jsou slovníky s názvy sloupců tabulky; `castka` je vždy kladná,
    směr nese `typ`. Prázdná hodnota je None, tedy NULL.
    """
    recs = nacti(cesta_vstup)
    mp = json.load(open(cesta_mapovani, encoding='utf-8'))
    kod2id = {str(k): int(v) for k, v in mp['osnova_kod'].items()}       # '9.1' -> 43
    plocha2kod = {klic(k): str(v) for k, v in mp['plocha_kategorie'].items()}  # 'strava' -> '9'
    pen2id = {klic(k): int(v) for k, v in mp['penezenky'].items()}       # 'kreditka' -> 3
    kod2typ = {str(k): v for k, v in mp['kod_typ'].items()}              # '9' -> 'vydaj'

    radky, preskocene = [], []
    stat = Counter()

    for r in recs:
        d = datum(r.get('datum'))
        c = cislo(r.get('castka'))
        if d is None or c is None:
            preskocene.append((r.get('radek'), 'bez data nebo částky'))
            continue

        # kategorie: přednost má kód osnovy, jinak plochá kategorie → hlavní kategorie
        kod = str(r.get('kod') or '').strip()
        if kod in kod2id:
            kat_id, kat_kod = kod2id[kod], kod
            stat['kategorie z kódu'] += 1
        else:
            syrova = str(r.get('kat') or '').strip()
            kk = plocha2kod.get(klic(syrova))
            if kk is None and syrova != '':
                # vyplněná, ale neznámá kategorie je chyba mapování – nahlásit
                preskocene.append((r.get('radek'), 'neznámá kategorie %r' % syrova))
                continue
            if kk is None:
                # prázdná kategorie: záznam je jinak platný, nezahazujeme ho
                kat_id, kat_kod = None, None
                stat['bez kategorie'] += 1
            else:
                kat_id, kat_kod = kod2id[kk], kk
                stat['kategorie z ploché'] += 1

        # směr: znaménko částky; u nuly rozhoduje typ hlavní kategorie
        if c > 0:
            typ = 'prijem'
        elif c < 0:
            typ = 'vydaj'
        else:
            typ = ('prijem' if kat_kod and kod2typ.get(kat_kod.split('.')[0]) == 'prijem'
                   else 'vydaj')
            stat['nulová částka'] += 1

        tp = 'plan' if klic(r.get('polozka')) == 'plan' else 'skutecnost'
        stat['plán' if tp == 'plan' else 'skutečnost'] += 1

        pen = pen2id.get(klic(r.get('placeni')))
        if pen is None:
            stat['bez peněženky'] += 1

        potv = klic(r.get('potvrzeni')) in ('ok', 'oik')
        zap = znacka(r.get('zapsano'))
        if zap is None:
            stat['bez časové značky'] += 1

        radky.append({
            'zdroj_radek': int(r['radek']),
            'datum': d,
            'castka': round(abs(c), 2),
            'typ': typ,
            'typ_polozky': tp,
            'kategorie_id': kat_id,
            'kde': pole_text(r.get('kde')) or None,
            'poznamka': pole_text(r.get('koment')) or None,
            'penezenka_id': pen,
            'zapsano_dne': (zap + ZONA) if zap else None,
            'potvrzeno': potv,
        })

    return radky, preskocene, stat


def sql_radek(d):
    """Řádek do dolarem uvozeného bloku, pole oddělená rourou."""
    c = d['castka']
    castka = '%d' % c if c == int(c) else '%.2f' % c
    return '|'.join([
        str(d['zdroj_radek']), d['datum'], castka,
        'v' if d['typ'] == 'vydaj' else 'p',
        'p' if d['typ_polozky'] == 'plan' else 's',
        str(d['kategorie_id'] or ''), d['kde'] or '', d['poznamka'] or '',
        str(d['penezenka_id'] or ''),
        (d['zapsano_dne'] or '').replace(ZONA, ''),
        't' if d['potvrzeno'] else 'f'])


# Řádky jdou jako jeden dolarem uvozený text oddělený rourami a konci řádků;
# je to zhruba o třetinu úspornejší než VALUES se zvlášť uvozeným polem.
# nullif(x,'') překládá prázdný řetězec na NULL.
HLAVICKA = (
    "with vstup as (\n"
    "  select string_to_array(radek,'|') a\n"
    "  from unnest(string_to_array($D$\n")
PATA = (
    "\n$D$, chr(10))) as radek where radek <> ''\n"
    ")\n"
    "insert into zaznamy (zdroj_radek,datum,castka,typ,typ_polozky,kategorie_id,"
    "kde,poznamka,penezenka_id,zapsano_dne,potvrzeno)\n"
    "select a[1]::int, a[2]::date, a[3]::numeric,\n"
    "  case a[4] when 'v' then 'vydaj' else 'prijem' end,\n"
    "  case a[5] when 'p' then 'plan'  else 'skutecnost' end,\n"
    "  nullif(a[6],'')::bigint, nullif(a[7],''), nullif(a[8],''),\n"
    "  nullif(a[9],'')::bigint, nullif(a[10],'')::timestamptz, a[11]='t'\n"
    "from vstup\n"
    "on conflict (zdroj_radek) where zdroj_radek is not null do update set\n"
    "  datum=excluded.datum,castka=excluded.castka,typ=excluded.typ,\n"
    "  typ_polozky=excluded.typ_polozky,kategorie_id=excluded.kategorie_id,\n"
    "  kde=excluded.kde,poznamka=excluded.poznamka,penezenka_id=excluded.penezenka_id,\n"
    "  zapsano_dne=excluded.zapsano_dne,potvrzeno=excluded.potvrzeno;\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--vstup', required=True)
    ap.add_argument('--mapovani', required=True)
    ap.add_argument('--vystup', required=True)
    ap.add_argument('--po', type=int, default=1000)
    a = ap.parse_args()

    radky, preskocene, stat = preved(a.vstup, a.mapovani)
    sql = [sql_radek(d) for d in radky]

    os.makedirs(a.vystup, exist_ok=True)
    pocet = 0
    for i in range(0, len(sql), a.po):
        pocet += 1
        with open(os.path.join(a.vystup, 'cast-%02d.sql' % pocet), 'w', encoding='utf-8') as f:
            f.write(HLAVICKA + '\n'.join(sql[i:i + a.po]) + PATA)

    print('k importu: %d řádků v %d souborech' % (len(sql), pocet))
    for k, v in sorted(stat.items()):
        print('  %-20s %6d' % (k, v))
    print('přeskočeno: %d' % len(preskocene))
    for radek, duvod in preskocene[:20]:
        print('  řádek %s: %s' % (radek, duvod))


if __name__ == '__main__':
    main()
