# Empire — Fáza 1 (hrad, suroviny, budovy, fronty)

## Čo to je
Základ tvojej GGE-style hry. Hráč sa zaregistruje, dostane hrad s náhodnými
súradnicami na mape 2000×2000, počiatočnými surovinami a 5 postavenými
budovami (hlavná budova, píla, kameňolom, farma, sklad) + 4 voľnými parcelami.

Suroviny sa produkujú kontinuálne — vrátane času, keď hráč nie je online
(dopočíta sa to pri ďalšom prihlásení podľa uplynutého času). Vylepšovanie
budov beží cez frontu s reálnym časovačom.

## 1. Nastavenie Supabase

1. Vytvor nový projekt na [supabase.com](https://supabase.com) (alebo použi existujúci, ale **odporúčam nový**, keďže ide o samostatnú hru).
2. V **SQL Editor** spusti celý obsah súboru `sql/schema.sql`.
3. V **Authentication → Providers** nechaj zapnuté "Email" (pre jednoduchosť zatiaľ bez potvrdzovacieho e-mailu — dá sa vypnúť v Authentication → Settings → "Confirm email").
4. V **Settings → API** skopíruj `Project URL` a `anon public` kľúč.
5. Vlož ich do `js/supabase-client.js`:
   ```js
   const SUPABASE_URL = 'https://tvoj-projekt.supabase.co';
   const SUPABASE_ANON_KEY = 'tvoj-anon-key';
   ```

## 2. Lokálne testovanie
Stačí otvoriť `index.html` cez lokálny server (napr. `npx serve .` alebo VS Code Live Server) — priamo cez `file://` Supabase auth niekedy robí problémy s cookies.

## 3. Nasadenie na Vercel (rovnako ako Landlord)
1. Založ nový GitHub repozitár, nahraj doň tento priečinok.
2. Na [vercel.com](https://vercel.com) → "New Project" → vyber repo → Deploy (je to statický web, žiadny build krok netreba).

## Ako funguje "hra beží aj offline"
- Každá surovina má v DB `last_updated_at` a vypočítanú `production_rate`.
- Pri prihlásení sa spočíta `(teraz − last_updated_at) × rýchlosť` a pripočíta k množstvu (obmedzené kapacitou skladu).
- To isté pri fronte výstavby: `finish_at` sa porovná s aktuálnym časom; ak už čas vypršal, budova sa hneď povýši.

**Dôležité obmedzenie fázy 1:** kontrola dokončenia frontu beží zatiaľ len
keď je hráč v hre otvorenej v prehliadači (klient si to kontroluje sám pri
načítaní a každých 10s). To stačí pre ekonomiku a jedného hráča, ale keď
pridáme **súboje medzi hráčmi** (fáza 3), útok musí byť vyhodnotený aj keď
obranca aj útočník majú hru zavretú. Na to použijeme **Supabase Edge
Function + pg_cron** (beží na serveri nezávisle od klientov, raz za minútu
skontroluje všetky "dozreté" udalosti). Pripravíme to vo fáze, kde
pridávame pohyb armád a boj.

## Ďalšie fázy (podľa dohody)
- **Fáza 2:** kasárne, jednotky, tréningová fronta, spotreba jedla.
- **Fáza 3:** skutočná mapa (súradnice, cudzie hrady), pohyb armád, boj, battle report, Edge Function pre server-side vyhodnocovanie.
- **Fáza 4:** aliancie, výskum, velitelia, obranné/útočné nástroje, eventy.

## Balans hry
Všetky ceny, časy a produkčné rýchlosti sú v `js/config.js` — jeden súbor,
kde sa dá celý balans ladiť bez zásahu do zvyšku kódu (exponenciálny rast
ceny/času s úrovňou, rovnaký princíp ako v GGE/Travian).
