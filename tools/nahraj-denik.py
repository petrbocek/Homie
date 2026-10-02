#!/usr/bin/env python3
"""
Nahraje deník do tabulky `zaznamy` přes Supabase REST API — jedním během.

    # 1) nasucho: jen spočítá a zkontroluje mapování, nic neposlá
    python3 tools/nahraj-denik.py --vstup denik.csv --mapovani tools/mapovani.json --nasucho

    # 2) naostro
    export SUPABASE_SERVICE_KEY='...'      # service_role / secret klíč
    python3 tools/nahraj-denik.py --vstup denik.csv --mapovani tools/mapovani.json

`--vstup` je CSV stažené z listu „Odpovědi formuláře 1" (File → Download →
Comma-separated values), nebo JSON ve tvaru, který popisuje README.

Proč service_role a ne anon klíč: RLS politiky na `zaznamy` jsou `TO
authenticated`, takže anon klíč (ten zapečený v index.html) nezapíše nic.
Klíč se bere **jen z proměnné prostředí**, aby neskončil v historii shellu.
Po importu ho v dashboardu rotuj.

Idempotence: skript si nejdřív stáhne `zdroj_radek`, která v tabulce už jsou,
a posílá jen chybějící — opakovaný běh tedy nic nezduplikuje a dá se jím
dojet přerušený import. Na `zaznamy` je navíc částečný unikátní index
(`zdroj_radek WHERE zdroj_radek IS NOT NULL`), takže i kdyby tahle kontrola
selhala, databáze duplicitu odmítne.

Pozn.: `Prefer: resolution=merge-duplicates` se tu nepoužívá — PostgREST
neumí odvodit konflikt z *částečného* unikátního indexu.
"""
import argparse, importlib.util, json, os, sys, urllib.error, urllib.request

ZDE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('SUPABASE_URL', 'https://fcycbzbzhuslmkfbgryb.supabase.co')


def _prevod():
    """Převodní logika je jedna a tatáž jako u SQL cesty — import-denik.py."""
    spec = importlib.util.spec_from_file_location('prevod', os.path.join(ZDE, 'import-denik.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def volani(cesta, klic, metoda='GET', telo=None, hlavicky=None):
    data = json.dumps(telo).encode() if telo is not None else None
    r = urllib.request.Request(URL + cesta, data=data, method=metoda)
    r.add_header('apikey', klic)
    r.add_header('Authorization', 'Bearer ' + klic)
    r.add_header('Content-Type', 'application/json')
    for k, v in (hlavicky or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=180) as o:
            surovy = o.read().decode()
            return json.loads(surovy) if surovy else None
    except urllib.error.HTTPError as e:
        # detail z Postgresu pomůže při diagnostice; klíč v odpovědi není
        sys.exit('HTTP %d na %s %s\n%s' % (e.code, metoda, cesta, e.read().decode()[:800]))
    except urllib.error.URLError as e:
        sys.exit('spojení na %s selhalo: %s' % (URL, e.reason))


def existujici(klic):
    """Všechna zdroj_radek, která v tabulce už jsou (po stránkách)."""
    mam, od, krok = set(), 0, 1000
    while True:
        cast = volani('/rest/v1/zaznamy?select=zdroj_radek&zdroj_radek=not.is.null'
                      '&order=zdroj_radek.asc&limit=%d&offset=%d' % (krok, od), klic)
        if not cast:
            return mam
        mam.update(r['zdroj_radek'] for r in cast)
        if len(cast) < krok:
            return mam
        od += krok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--vstup', required=True, help='CSV ze sheetu nebo JSON')
    ap.add_argument('--mapovani', required=True)
    ap.add_argument('--po', type=int, default=2000, help='řádků na jeden POST')
    ap.add_argument('--nasucho', action='store_true', help='nic neposílej, jen vypiš')
    a = ap.parse_args()

    radky, preskocene, stat = _prevod().preved(a.vstup, a.mapovani)
    print('ze vstupu připraveno: %d řádků' % len(radky))
    for k, v in sorted(stat.items()):
        print('  %-20s %6d' % (k, v))
    print('přeskočeno: %d' % len(preskocene))
    for radek, duvod in preskocene[:20]:
        print('  řádek %s: %s' % (radek, duvod))
    if radky:
        print('rozsah zdroj_radek: %d–%d' % (radky[0]['zdroj_radek'], radky[-1]['zdroj_radek']))
        # Součet je kontrola, že se CSV rozparsovalo stejně jako dřív ověřená
        # data — hlavně že desetinná čárka nespadla na oddělovač tisíců.
        print('součet částek: %.2f' % sum(r['castka'] for r in radky))
        print('  z toho příjmy: %.2f' % sum(r['castka'] for r in radky if r['typ'] == 'prijem'))
        print('  z toho výdaje: %.2f' % sum(r['castka'] for r in radky if r['typ'] == 'vydaj'))

    if a.nasucho:
        print('\nnasucho — nic se neposílá')
        return

    klic = os.environ.get('SUPABASE_SERVICE_KEY')
    if not klic:
        sys.exit('chybí SUPABASE_SERVICE_KEY (service_role klíč) v prostředí')

    mam = existujici(klic)
    print('\nv tabulce už je: %d řádků s klíčem' % len(mam))
    chybi = [r for r in radky if r['zdroj_radek'] not in mam]
    print('k nahrání: %d řádků' % len(chybi))
    if not chybi:
        print('nic k nahrání, hotovo')
        return

    nahrano = 0
    for i in range(0, len(chybi), a.po):
        davka = chybi[i:i + a.po]
        volani('/rest/v1/zaznamy', klic, 'POST', davka, {'Prefer': 'return=minimal'})
        nahrano += len(davka)
        print('  nahráno %d / %d' % (nahrano, len(chybi)), flush=True)

    print('hotovo: nahráno %d řádků' % nahrano)
    print('v tabulce by teď mělo být %d řádků s klíčem' % (len(mam) + nahrano))


if __name__ == '__main__':
    main()
