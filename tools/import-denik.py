#!/usr/bin/env python3
"""
Převede deník z Google Sheetu („Utrata", list Odpovědi formuláře 1) na SQL
pro tabulku `zaznamy`.

    python3 tools/import-denik.py --vstup denik.json --mapovani mapovani.json \
                                  --vystup out/ --po 1000

Vstup je JSON: pole objektů se surovými hodnotami ze sheetu
  {radek, zapsano, datum, castka, kat, kde, koment, polozka, placeni, potvrzeni, kod}

Výstup jsou SQL soubory po N řádcích. Každý je idempotentní: klíčem je
`zdroj_radek` (číslo řádku ve sheetu), takže opakovaný běh řádky přepíše,
nikoli zduplikuje.
"""
import json, re, argparse, os, sys, unicodedata
from collections import Counter

RE_DATUM = re.compile(r'^(\d{1,2})\.(\d{1,2})\.(\d{4})$')
# časová značka má v datech 6 podob včetně překlepů (21.23 místo 21:23)
RE_ZNACKA = re.compile(r'^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$')

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

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--vstup', required=True)
    ap.add_argument('--mapovani', required=True)
    ap.add_argument('--vystup', required=True)
    ap.add_argument('--po', type=int, default=1000)
    a = ap.parse_args()

    recs = json.load(open(a.vstup, encoding='utf-8'))
    mp = json.load(open(a.mapovani, encoding='utf-8'))
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
            typ = 'p'
        elif c < 0:
            typ = 'v'
        else:
            typ = 'p' if kat_kod and kod2typ.get(kat_kod.split('.')[0]) == 'prijem' else 'v'
            stat['nulová částka'] += 1

        tp = 'p' if klic(r.get('polozka')) == 'plan' else 's'
        stat['plán' if tp == 'p' else 'skutečnost'] += 1

        pen = pen2id.get(klic(r.get('placeni')))
        if pen is None:
            stat['bez peněženky'] += 1

        potv = 't' if klic(r.get('potvrzeni')) in ('ok', 'oik') else 'f'
        zap = znacka(r.get('zapsano'))
        if zap is None:
            stat['bez časové značky'] += 1

        castka = round(abs(c), 2)
        castka = '%d' % castka if castka == int(castka) else '%.2f' % castka
        radky.append('|'.join([
            str(int(r['radek'])), d, castka, typ, tp, str(kat_id or ''),
            pole_text(r.get('kde')), pole_text(r.get('koment')),
            str(pen or ''), zap or '', potv]))

    os.makedirs(a.vystup, exist_ok=True)
    # Řádky jdou jako jeden dolarem uvozený text oddělený rourami a konci řádků;
    # je to zhruba o třetinu úspornější než VALUES se zvlášť uvozeným polem.
    # prazdne(x) překládá prázdný řetězec na NULL.
    hlavicka = (
        "with vstup as (\n"
        "  select string_to_array(radek,'|') a\n"
        "  from unnest(string_to_array($D$\n")
    pata = (
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

    pocet = 0
    for i in range(0, len(radky), a.po):
        pocet += 1
        with open(os.path.join(a.vystup, 'cast-%02d.sql' % pocet), 'w', encoding='utf-8') as f:
            f.write(hlavicka + '\n'.join(radky[i:i + a.po]) + pata)

    print('k importu: %d řádků v %d souborech' % (len(radky), pocet))
    for k, v in sorted(stat.items()):
        print('  %-20s %6d' % (k, v))
    print('přeskočeno: %d' % len(preskocene))
    for radek, duvod in preskocene[:20]:
        print('  řádek %s: %s' % (radek, duvod))

if __name__ == '__main__':
    main()
