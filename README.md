# Social Follower Tracker

Automatizované denné sledovanie počtu sledovateľov naprieč 8 sociálnymi sieťami
(Instagram, Facebook, TikTok, YouTube, X/Twitter, LinkedIn, Reddit, Threads)
do Google Sheets, s denným prehľadom, kontrolou výpadkov a mesačnou sumarizáciou.

Systém beží na **Google Apps Script** (zdarma) + **Apify actor**
(free tier stačí, ~$1–2/mesiac pri osobnom použití). Žiadny server, žiadna údržba.

---

## Ako to funguje

```
Google Sheet (Dashboard, Accounts, Raw, Failures, Health, Monthly)
        │
        │  1× denne o 22:00 (trigger)
        ▼
Apps Script ──► Apify API (actor k1ra/social-media-followers-scraper)
        │            $0,005 / profil, žiadne cookies ani login
        ▼
Zápis do Raw (idempotentný upsert podľa dátumu)
        │
        ├──► Dashboard – denný prehľad (hodnoty, nie vzorce)
        ├──► Health    – kontrola zdravia účtov
        ├──► Failures  – log neúspešných profilov
        └──► Monthly   – mesačná sumarizácia (1. v mesiaci 22:30)
```

- **Idempotentnosť**: opakovaný beh za ten istý deň prepíše riadky, nikdy nenaduplikuje.
- **Výpadok**: neúspešný profil sa zapíše do `Failures`; doplnite ho spätne cez backfill (tlačidlo).
- **Weekly účty**: platformy označené `weekly` sa scrape-ujú automaticky, keď od posledného záznamu prešlo ≥ 6 dní (napr. subreddity – úspora kreditov).

---

## Požiadavky

| Položka | Detail |
|---|---|
| Google účet | ľubovoľný, Sheets + Apps Script sú súčasťou |
| Apify účet | free tier (https://apify.com) – $5 kreditov/mesiac bez karty |
| Apify API token | Console → Settings → API tokens |
| LinkedIn personal | verejný follower count je zaokrúhlený (napr. 2 587 → 3 000) – obmedzenie LinkedInu, nie skriptu |
| LinkedIn company | často za login-gateom, spôsob riešenia nižšie v kapitole Troubleshooting |

---

## Štruktúra spreadsheetu

| List | Obsah | Kto píše |
|---|---|---|
| `Dashboard` | stav posledného behu, backfill pole, **denný prehľad** (brand, platforma, účet, last_date, followers, prev_day, Δ abs, Δ %) | skript (hodnoty) |
| `Accounts` | konfigurácia sledovaných účtov | používateľ |
| `Raw` | časová séria: `date, platform, username, brand, account_label, followers, posts, profile_url` | skript |
| `Failures` | `date, platform, username, brand, account_label, note` – čo treba dopočítať | skript |
| `Health` | posledný záznam a stav každého účtu (`ok` / `STALE` / `NEVER SCRAPED`) | skript |
| `Monthly` | `month, platform, username, brand, account_label, first, last, growth, avg_daily, growth_pct` | skript |

### Konfigurácia – list `Accounts`

| Stĺpec | Hodnoty | Poznámka |
|---|---|---|
| `enabled` | `TRUE` / `FALSE` | zapína/vypína účet |
| `platform` | `instagram` `facebook` `tiktok` `youtube` `twitter` `linkedin` `reddit` `threads` | presne takto |
| `username` | formát podľa platformy, nižšie | bez `@` okrem YouTube |
| `brand` | `You` / `Competitor 1`–`4` | lubovoľný počet účtov na brand |
| `account_label` | `main` / `secondary` | 2. IG/FB účet brandu = ďalší riadok |
| `frequency` | `daily` / `weekly` | weekly = beh, keď je účet "zrelý" |
| `note` | voľný text | |

**Formáty `username`:**

| Platform | Príklad |
|---|---|
| Instagram, Facebook, TikTok, Threads, X | `evolum.sk` |
| YouTube | `@yourbrand` |
| Reddit | `yoursubreddit` (bez `r/`) |
| LinkedIn personal | `in/meno-priezvisko` |
| LinkedIn company | `company/slug` (bez koncového lomítka) |

---

## Nasadenie (cca 20 minút)

1. **Vytvorte Google Sheet** a pomenujte ho, napr. `Social Follower Tracker`.
2. **Nastavte locale**: `File → Settings → Locale: United States`, `Time zone: (GMT+01:00) Central European` → Save.
   *(Locale ovplyvňuje syntax importovaných vzorcov; časová zóna určuje čas triggerov. Bratislava sa v zozname nenachádza – Central European je správna voľba, letný/zimný čas rieši Google automaticky.)*
3. **Vytvorte listy**: `Dashboard`, `Accounts`, `Raw`, `Failures`, `Health`, `Monthly` (presné názvy, malými písmenami okrem prvej).
4. **Skript**: `Extensions → Apps Script`, zmažte predvolený obsah a vložte celý obsah súboru `social_tracker_v3.gs`.
5. **Token**: vložte Apify token do konštanty `APIFY_TOKEN` na vrchu skriptu.
6. **Inicializácia**: spustite funkciu `setup()` (dropdown nad editorom → Run → autorizujte prístup).
   Vytvorí hlavičky listov, ukážkové riadky a triggre (denne 22:00, mesačná sumarizácia 1. o 22:30).
7. **Účty**: v `Accounts` nahraďte ukážkové riadky vlastnými, nastavte `enabled = TRUE`.
8. **Tlačidlá** (voliteľné, odporúčané): `Insert → Drawing` → uložte → pravým na kresbu → `Assign script`:
   - `btnScrapeToday` – scrape dnešného dňa na požiadanie
   - `btnBackfillDate` – doplní dátum z `Dashboard!B4` (formát `yyyy-MM-dd`)
   - `btnRebuildSummary` – prepočíta `Monthly`
   - `refreshDashboard` – obnoví denný prehľad bez spúšťania scrape
9. **Prvý beh**: kliknite na tlačidlo Scrape today (alebo spustite `btnScrapeToday`). Do 60 sekúnd sa v `Raw` objavia riadky, Dashboard sa naplní hodnotami.

---

## Automatizácia

| Trigger | Čas | Funkcia |
|---|---|---|
| denne | 22:00 | `scheduledDailyRun` – scrape daily účtov + weekly účtov, ak sú zrelé |
| mesačne | 1. deň 22:30 | `rebuildSummary` – prepočet `Monthly` |

Trigger beží v časovej zóne spreadsheetu. Zoznam triggerov: Apps Script →Triggers (hodiny) → `Triggers`.

---

## Limity a náklady (overené 2026-09)

- Cena actoru: **$0,005 za profil**; neúspešné profily sa neúčtujú.
- Free tier Apify: **$5 kreditov/mesiac**, 25 súbežných runov.
- `run-sync-get-dataset-items`: max 300 s na run (HTTP 408 pri prekročení); úspešná odpoveď je **HTTP 201** (nie 200).
- Rate limit: 250 000 req/min na účet – jedno denné volanie je zanedbateľné.
- Odhad: 16 profilov denne × 30 dní ≈ **$2,40/mesiac**; s weekly subredditmi menej.

---

## Riešenie problémov

| Príznak | Príčina | Riešenie |
|---|---|---|
| `API error 201` v `Dashboard!B2` | stará verzia skriptu považovala za úspech len HTTP 200 | aktualizujte skript (aktuálna verzia akceptuje 200 aj 201) a spustite Scrape today znova |
| `#ERROR!` v Dashboarde | vzorce vs. locale | Dashboard sa od aktuálnej verzie píše ako hodnoty – spustite `refreshDashboard`; v starších verziách nastavte Locale: United States |
| účet v `Failures`: `not returned by actor` | súkromný/zmazaný profil, dočasný blok platformy | opakujte neskôr; trvalé chyby zmažte z `Accounts` |
| LinkedIn company: `requires login` | LinkedIn gates company pages za login pre dátacentrové IP | nechajte vypnuté, alebo použite dedikovaný LinkedIn actor s residential proxy |
| `STALE (Xd)` v `Health` | účet nemá čerstvý záznam | overte `Failures`; po oprave použite backfill (Dashboard!B4 + tlačidlo) |
| tlačidlo nič nerobí | v `Assign script` je viac ako názov funkcie | v políčku má byť **iba** `btnScrapeToday` atď., bez medzier a popisu |
| `Dashboard: 0 enabled accounts` | stĺpec `enabled` nie je `TRUE` | skript akceptuje boolean aj text `TRUE`; overte, či riadok obsahuje platformu aj username |

---

## Poznámky

- **Looker Studio**: pripojte listy `Raw` a `Monthly` ako zdroje; `brand` rozdeľuje Vaše účty a konkurenciu, `account_label` rozlišuje main/secondary účty.
- **Bezpečnosť**: skript obsahuje Apify token – zdieľajte spreadsheet len s dôveryhodnými osobami, prípadne ho presuňte do `Script Properties`.
- **Zálohy**: `File → Make a copy` raz mesačne; história `Raw` je jediný neobnoviteľný stav.
- **Licencia**: MIT.
