# Otevřené body

Stav k 12. 10. 2026. Co je tady, na to **nikdo nesahal** — je to buď čeká na
rozhodnutí Petra, nebo jsem to nabídl a nedostal odpověď.

## Čeká na rozhodnutí

- **Rozpočet 2027 do aplikace.** `tools/rozpocet-2027.md` je spočítaný, ale do
  tabulky `plan` se nic nezapsalo. Vložením 57 záznamů na rok 2027 by záložka
  Rok ukazovala plán vs. skutečnost. Nepotvrzeno.
  Od 14. 10. 2026 to jde udělat v appce: záložka Rok → **✦ Plán na další rok**.
  Průvodce staví plán stejnou metodou (skutečnost za posledních 12 měsíců +
  jmenovité úpravy s důvodem) a zapíše ho jako záznamy typu plán, jeden na
  kategorii a měsíc. Úpravy z `rozpocet-2027.md` se v něm dají naklikat
  (mzdy tlačítkem `3m`, zálohu EON jako `3980/m`).
- **Zbývající Strava › Strava (300 záznamů).** Nabídnuto rozdělení podle
  obchodu (supermarkety → Nákupy, restaurace → Restaurace). Bez odpovědi.
- **Záznamy před rokem 2024** (16 103 ks, zařazeno ~1 %). Petr to odložil.
  Před jakýmkoli zápisem nejdřív udělat průzkum a nechat si ho schválit.
- **19 záznamů „Kreditka"** (496 040 Kč, 2016–2025) je vedeno jako výdaj, i když
  jsou to převody. Z rozpočtu jsou vyloučené, ale v Přehledu a Roku pořád
  nadhodnocují výdaje. Překlopení na převod změní součty v obou záložkách —
  proto zatím nic.

## Nedělat

- **Rok 2026 je vyplněný, nesahat na něj.** Ověřeno: 100 % zařazeno, neporušeno.
- **Rotaci Supabase klíče nenavrhovat.** Petr ji odmítl. (Věta o rotaci ve
  `tools/README.md` je z dřívějška, nechat být.)

## Drobnosti k opravě, až bude chuť

- 5 nulových záznamů Penny na SkipPay.
- DPO 24. 9. 2026 (32 Kč) je pod Oděvy místo Jízdenky.
- Google Sheet, buňka C61: pořád tam je překlep 1 048 951; v Supabase je
  správně 1 066 951.
- `fondy` id 3 — prázdný osiřelý řádek po sloučení Uniqa Generace X. `DELETE`
  přes Supabase MCP vyprší (timeout), i přejmenování. Aplikaci nevadí.
- Nepoužívané sloupce v DB: `sporeni.garant`, `osnova.typ`. Aplikace je nečte.

## Zapsat, až to přijde

- **Přeplatek EON 8 968,26 Kč** (splatnost 22. 10. 2026) → jako **příjem** do
  Zálohy › Elektřina.
- Nová záloha EON **3 980 Kč/měsíc od 16. 11. 2026** (v rozpočtu už je).

## Co platí o Supabase MCP

`DELETE` a DDL `DROP` spolehlivě vyprší (60 s). `SELECT`, `INSERT`, `UPDATE`
a `CREATE TABLE` fungují. Neúspěšný `DELETE` navíc nechá zámek, který blokuje
pozdější `UPDATE` na stejném řádku — hromadné mazání dělat přes CTE v jednom
příkazu, nebo vůbec.
