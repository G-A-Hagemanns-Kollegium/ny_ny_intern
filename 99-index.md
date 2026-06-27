# 99 — Feature Index & Aggregation (Phase 3)

Aggregates the Phase 2 feature specs (`spec/features/F-*.md`) with the shared infrastructure
(`01-infrastructure.md`, treated here as **F-000**) and the Phase 0 manifest (`00-manifest.md`).
Schema authority: `schema.sql` (116 tables). **Analysis only.**

> **Scope reminder.** "Features" = the **live App A (CodeIgniter) controllers**. App B (flat-file
> `intern/`), MediaWiki (`wiki*` tables), and dead endpoints are deliberately **not** specced — see
> [Coverage](#5-coverage-check). The MAC feature (`nyintern/mydata`, `intern/mydata/*`) is retired
> (confirmed unused, 2026-06) and excluded.

---

## 1. Feature index

| ID | Feature | URL(s) | Source controller | Access |
|---|---|---|---|---|
| F-000 | Shared infrastructure (bootstrap, DB, sessions/auth, layout, counter, reminder) | n/a | `index.php`, `core/MY_Controller.php`, `config/*` | n/a |
| F-001 | Optagelse — admission/tour & sublet applications | `/optagelse/*` (incl. `/ansoeg`, `/fremlej`, `/listansoegninger`, `/showAnsoegning/{id}`) | `optagelse.php` | public forms; `indstilling` for review |
| F-002 | Public-site admin (auth, user-admin, mass-mail, stats) | `/admin/*` | `admin.php` | `administrator` (partly **unenforced**) |
| F-003 | Ølkælder — beer-cellar POS/shop | `/nyintern/oelkaelder/*` | `intern/oelkaelder.php` | `oelkaelder` role (**`purchase` open**) |
| F-004 | Søg værelse — room-application "kvotient" lottery | `/nyintern/soegvaerelse/*` | `intern/soegvaerelse.php` | login; admin via **broken** idiom |
| F-005 | Værelsestjek — room condition inspection + uploads | `/nyintern/vaerelsestjek/*` | `intern/vaerelsestjek.php` | login (**guards broken**) |
| F-006 | Page — public CMS renderer + inline editor | `/`, Danish slugs, `/page/*` | `page.php` | public view; `editpage` to edit |
| F-007 | News — news/events CRUD (legacy, Facebook-superseded) | `/news/*` | `news.php` | `editpage` (**`delete` unauth**) |
| F-008 | Pylon — public event/notice calendar + editor | `/pylon/*` | `pylon.php` | public view; `editpage` to edit |
| F-009 | AK — duty/"krydser" tracking | `/nyintern/ak/*` | `intern/ak.php` | login; `akRole` for others' logs |
| F-010 | Alumneliste — resident directory (⚠ wraps flat-file scripts) | `/nyintern/alumneliste/*` | `intern/alumneliste.php` | login; roles; **`json` IP-only** |
| F-011 | Stamtree — alumni lineage tree | `/nyintern/stamtree/` | `intern/stamtree.php` | login |
| F-012 | Statistik — internal stats dashboard + JSON feeders | `/nyintern/statistik/*` | `intern/statistik.php` | login; **feeders unauth** |
| F-013 | Dashboard — internal landing page | `/nyintern/`, `/nyintern/dashboard/` | `intern/dashboard.php` | login |
| F-014 | Intern admin — members-area auth (login/forgot/reset) | `/nyintern/admin/*` | `intern/admin.php` | public auth flows; login for profile |
| F-015 | Portfolio — static JSON stub | `/portfolio/getPortfolio` | `portfolio.php` | public (stub) |

---

## 2. Table → feature map

Letters = R(ead), W(rite), D(elete). Only App-relevant tables shown (MediaWiki `wiki*` and unused
legacy tables are in [Coverage](#5-coverage-check)). **F-000** owns the cross-cutting writes
(sessions, visit counter, reminder).

| Table | Read by | Written by | Flag |
|---|---|---|---|
| `intern_alumne` | F-001, F-002, F-003, F-004, F-009, F-011, F-012 | F-010, F-014 | core identity; written only by directory + auth |
| `intern_alumne_liste` | F-002, F-003, F-009, F-012 | F-010 | month roster |
| `gahk_page` | F-001, F-006, F-007, F-008 | F-006 | CMS content |
| `gahk_news` | F-006, F-007 | F-007 | — |
| `gahk_pylon_calendar` | F-008 | F-008 | — |
| `gahk_ansoegninger` | F-002, F-012, F-000 (reminder) | F-001 | applications |
| `gahk_ansoegninger_paamindelse` | F-000 | F-000 (**disabled**) | ⚠ write path commented out → effectively unused |
| `gahk_admin_user` | F-002, F-014 | F-002 | role grants |
| `intern_alumne_sessions` | F-002, F-014 | F-014 | remember-me token |
| `intern_forgotpassword` | F-014 | F-014 | reset links (never deleted — see findings) |
| `intern_alumne_aklog` | F-009 | F-009 | — |
| `intern_alumne_akstatus` | F-009 | F-009 | — |
| `intern_alumne_workgroup` | F-010 | F-010 | — |
| `intern_alumne_cleaning` | F-010 | F-010 | — |
| `intern_alumne_study` | F-010 | F-010 | — |
| `intern_alumne_emailtonew` | F-010 | F-010 | email template/config |
| `intern_alumne_emailnetworkstatus` | F-010 | F-010 | email template/config |
| `intern_alumne_emailsubscribers` | F-010 | F-010 | — |
| `intern_alumne_pylon_email_settings` | F-010 | — | ⚠ **read-only** → reference/config data |
| `intern_kvotient_nyintern` | F-004 | F-004 | — |
| `intern_kvotient_priority_nyintern` | F-004 | F-004 (+D) | — |
| `intern_kvotient_orlov_nyintern` | F-004 | F-004 (+D) | — |
| `intern_kvotient_offer_nyintern` | F-004 | F-004 (+D) | — |
| `intern_room_condition` | F-005 | F-005 | — |
| `intern_room_criteria` | F-005 | — | ⚠ **read-only** → reference/seed data |
| `intern_oelkaelder_product` | F-003 | F-003 | — |
| `intern_oelkaelder_saldo` | F-003 | F-003 | balance |
| `intern_oelkaelder_deposit` | F-003 | F-003 | — |
| `intern_oelkaelder_transaction` | F-003 | F-003 | — |
| `intern_oelkaelder_transaction_item` | F-003 | F-003 | — |
| `intern_oelkaelder_purchase` | F-003 | F-003 | — |
| `intern_oelkaelder_warnings` | F-003 | F-003 | — |
| `intern_oelkaelder_log` | — | F-003 | ⚠ **write-only** → audit log, not read by app |
| `intern_shopper` | F-003 | F-003 | — |
| `gahk_counter` | F-002 | F-001, F-002, F-006, F-007, F-008 | per-IP visit count (F-000 counter) |
| `gahk_counterdato` | F-002, F-012 | F-001, F-002, F-006, F-007, F-008 | per-date visit count (F-000 counter) |
| `gahk_dk_sessions` | F-000 (all logged-in) | F-000 (CI session lib) | session store |

**Flags summary**
- **Read but never written** (candidate reference/seed data): `intern_room_criteria`,
  `intern_alumne_pylon_email_settings`. Keep as fixtures/lookups.
- **Written but never read** (candidate dead data): `intern_oelkaelder_log` (append-only audit, no
  reader in App A), `gahk_ansoegninger_paamindelse` (writer is disabled). `gahk_counter`/`gahk_counterdato`
  are written by 5 controllers and *are* read (F-002 dashboard — but its boxes are commented out — and
  F-012 `getCounterStatistic`); low-value but not dead.

> **Correction applied vs Phase 2 drafts:** the visit-counter write belongs **only** to the 5
> controllers that call `$this->counter()` (F-001, F-002, F-006, F-007, F-008). The Phase 2 specs
> F-003/F-004/F-005/F-009/F-012 originally listed a counter write "via middleware" — that is wrong
> (those controllers do not call `counter()`); the specs have been patched to match this table.

---

## 3. Consolidated security findings

Deduplicated by class, most severe first; each links to the feature(s) where it occurs. Infrastructure
(F-000) findings from `01-infrastructure.md` A10 are folded in.

### CRITICAL
- **Open unauthenticated write endpoint with client-controlled pricing** — `oelkaelder.purchase()` has
  its auth commented out, emits `Access-Control-Allow-Origin: *`, and trusts basket prices from the
  client JSON (server never compares to DB). Anyone on the internet can record sales and debit any
  shopper. → **F-003** (`oelkaelder.php:40-62`, `oelkaelder_model.php:135-156`).

### HIGH
- **SQL injection — raw string interpolation** (the dominant class). User input concatenated into SQL in
  → **F-001, F-002, F-003, F-005, F-007, F-009, F-010, F-012, F-014** (and latent in shared models used
  by F-004). Only `kvotient_model` (F-004) escapes. Root cause documented in F-000 (`01-infra` A3).
- **Broken / missing authorization**
  - Inverted idiom `!$username && !empty($role)` (only blocks logged-out users) → **F-004** (all admin
    actions), **F-005** (`akoverview`); inconsistent `indstilling` check → **F-001** (`setasreceived`).
  - No auth at all on dangerous actions → **F-007** (`delete/{id}`), **F-002** (`sendMail`,
    `getAngsoegningStatistic`), **F-003** (`purchase`, `upload`), **F-012** (all JSON feeders),
    **F-005** (`indsend`).
  - IP-allowlist used *as* auth, exposing personal data → **F-010** (`json`), **F-013** (secrets).
- **Privilege escalation via mass-assignment role grant** — any logged-in user can POST
  `administrator=1` to `gahk_admin_user`. → **F-002** (`admin.php:288`).
- **Mass-assignment (`insert($_POST)` / `update($_POST)`)** → **F-001, F-002, F-004, F-006, F-007,
  F-008, F-009, F-010** (and dynamic-key writes in **F-003**).
- **Stored XSS — unsanitized content rendered raw** → **F-006** (CMS page body + `bgpic` CSS),
  **F-007** (news body), **F-008** (event fields), **F-010/F-011/F-012/F-004** (member names into
  HTML/JS/JSON, incl. `</script>` breakout in F-011).
- **Unsalted SHA-256 password storage** (shared `intern_alumne.password`) → **F-002, F-014** (F-000 A4).
- **Hardcoded plaintext secrets in source** → **F-013** (WiFi pw, Google-calendar creds), **F-010**
  (`delt.php` DB creds + admin passwords), **F-000** (DB pw, SMTP pw, captcha keys — `01-infra` A10),
  **F-001** (SMTP, inherited).
- **Insecure file upload** → **F-005** (`mkdir 0777`, path traversal via `roomId`, unlimited size),
  **F-003** (`upload` no auth), **F-006** (KCFinder enabled for the editor).
- **Weak password-reset flow** — predictable `sha1(time())` link, ~10k-value temp password with fixed
  suffix shown in plaintext, link not one-time, password rewritten on every GET → **F-014**.
- **Cascade delete data loss** — `closeOffer` deletes applications for a room across **all months** on a
  CSRF-able GET → **F-004**.

### MEDIUM
- **No CSRF protection (site-wide)** — `csrf_protection=false`; affects **every** feature's POST forms.
  → all of F-001–F-014 (F-000 A4).
- **State-changing actions on GET** → **F-001** (`setasreceived`), **F-003** (deactivate/delete*),
  **F-004** (`closeOffer`), **F-007** (`delete`), **F-008** (`delete`), **F-009** (`delete_log_element`),
  **F-014** (`resetpass`).
- **Email header/body injection** (user data into `mail()`) → **F-001, F-003, F-010** (low in F-002).
- **`db_debug=TRUE` in production** — SQL errors (incl. injection) echoed → **F-000** (A10), surfaced in F-002.
- **Insecure session/cookie handling** — `cookie_secure=false`, `sess_encrypt_cookie=false`, weak
  hardcoded `encryption_key`, remember-me token not httponly/secure → **F-000** (A4), **F-014**, **F-004**.
- **User enumeration** — distinct response for unknown email → **F-014** (`receivedmail`).
- **Debug disclosure (`var_dump`)** → **F-003** (`transactions`, upload errors), **F-005** (`indsend`).
- **PII retention** — `gahk_counter` stores raw visitor IPs indefinitely; `gahk_ansoegninger` holds
  unsolicited personal data with no retention/rate-limit → **F-001, F-002, F-012** (GDPR).

### LOW
- **Wide-open CORS (`ACAO: *`)** → **F-015**, **F-001** (`portfolio`/JSON endpoints), and (escalated by
  the open write) **F-003**.
- **Spoofable IP allowlist** (`insideGAHK()`/`atGAHK()` trust `REMOTE_ADDR`) → **F-003, F-010, F-013**, F-000.
- **Two parallel session systems** (native `session_start()` + CI session lib) → **F-014** and most
  intern controllers.
- **Non-fatal authz failure** (`echo "No rights"` without `exit`) → **F-006, F-008**.

> **Structural note:** the entire SQLi class and most mass-assignment/CSRF findings are eliminated by the
> move to Django (ORM parameterisation, explicit forms, CSRF middleware, template auto-escaping). The
> authorization findings need a deliberate redesign (one permission model), not a translation.

---

## 4. Consolidated open questions (by theme)

**A. Is it still used? (delete vs port)**
- News in-house system vs Facebook (F-007); `portfolio` stub (F-015); `altfrontpage` / old-news iframe
  path (F-006, F-007); `allsalesoverview` duplicate (F-003); `intern_oelkaelder_individual_price` /
  `intern_oelkaelder_log` consumers (F-003). Is the **old flat-file `intern/` site still authoritative**
  for alumne data (F-010 redirects to it)? → mostly answerable from **access logs (scope §8.6)**.

**B. Authorization intent**
- Are `admin/sendMail` + `getAngsoegningStatistic` intentionally unauthenticated (F-002)? Is
  `oelkaelder/purchase` deliberately open (LAN kiosk) or accidental (F-003)? Who may manage room offers
  / view an application's detail (F-004)? What role marks an AK member (F-005, F-009)? Is the
  `json` directory dump to any campus IP intended (F-010)? Is campus-IP gating the intended model for the
  dashboard secrets (F-013)? Should members + admins share one login, and are reset links one-time (F-014)?

**C. Business-logic intent — fix vs preserve**
- The `if(TRUE)` that suppresses the fremleje committee email (F-001); the K formula `a·100/(a+b+12)` and
  the cross-month cascade delete (F-004); the hardcoded `monthNumber='24178'`, the `-1*$inserData` insert,
  and whether "start new period" should clear the AK log (F-009); the Sep/Okt month-label swap (F-001,
  F-008); `gender`→`female` value set (F-001).

**D. Data model / schema / ETL**
- Slug ↔ page-id source of truth (F-006); `gahk_pylon_calendar.id` AUTO_INCREMENT in the live DB (F-008);
  `intern_room_condition` date format + image-path validity + audit retention (F-005); free-text
  `intern_alumne.study` canonicalisation (F-012); `pageId` 6/7/8/9 mapping (F-001); latin1/utf8mb3 mix
  across tables (F-000 A2 / scope §6).

**E. Secrets & infra**
- Where the WiFi + shared Google-calendar creds should live (F-013); rotation of the shared `gahk_dk`
  account used by **all three apps** (F-000, scope §5/§9); should the `intern_alumne_sessions` remember-me
  token survive or be replaced by Django sessions (F-014)?

**F. Privacy / GDPR**
- Retention for `gahk_ansoegninger` (unsolicited personal data) and `gahk_counter` visitor IPs (F-001,
  F-002, F-012).

---

## 5. Coverage check

### Entry points (from `00-manifest.md`) → spec status
**All live App A controllers are specced (F-001–F-015).** Intentionally **not** specced:

| Entry point | Why no spec |
|---|---|
| `controllers/phpinfo.php` | Dead debug endpoint — delete (scope §8). |
| `controllers/intern/mydata.php` + `intern/mydata/*` | MAC feature **retired** (confirmed unused 2026-06). |
| All of App B (`intern/*`: kvotient, pylon, handbook, mailliste, forbrug, printer, …) | Flat-file app being **retired**; selectively port only if access logs prove use (none identified). |
| `public/js/kcfinder/*`, ckeditor/jqplot demo PHP | Vendor/asset code — drop (scope §3); upload surface tracked as interim-hardening (scope §8). |
| MediaWiki (`wiki/`) | Separate app, kept & upgraded (scope §3). |

→ **No live App A entry point lacks a spec.**

### Schema tables (116) not referenced by any feature
**MediaWiki (out of scope — kept on MariaDB):** all 64 `wiki*` tables.

**Legacy / App-B / dead — candidates to drop or migrate-then-retire (not in the Django build):**
- App B MAC feature (retired): `intern_alumne_macaddress`, `intern_alumne_macaddress_temp`
- App B handbook: `intern_handbook`, `intern_handbook_access`
- App B electricity: `intern_forbrug`
- App B pylon mailing list: `intern_alumne_pylon` (distinct from `gahk_pylon_calendar`)
- **Old** kvotient (superseded by `*_nyintern`): `intern_kvotient`, `intern_kvotient_counter`,
  `kvotient_ansoegninger`, `kvotient_counter`
- Backups / old: `intern_kvotient_priority_nyintern_backup`, `intern_alumne_sessions_old`, `gahk_archive`
- One-off: `jubilaeum2008` (2008 anniversary)
- Possibly-unused oelkaelder extra: `intern_oelkaelder_individual_price` (not touched by F-003 — confirm)
- Misc/unclear: `banned_ips` (likely App B IP blocking)

→ **Action:** confirm each is App-B-only / dead via access logs before the ETL; none are referenced by a
live App A feature. (The MAC tables are confirmed dead.)

### Notes / corrections folded in
- Visit-counter write attribution corrected (see §2 note); F-003/F-004/F-005/F-009/F-012 specs patched.
- `01-infrastructure.md` is counted as **F-000** so session/counter/reminder table writes are attributed
  rather than appearing as orphan writes.

---

## 6. Suggested Phase-2-follow-up order (by risk)
1. **F-003 `oelkaelder`** (open write + money) and **F-002 `admin`** (priv-esc) — highest blast radius.
2. **F-004 `soegvaerelse`**, **F-005 `vaerelsestjek`** (broken auth + uploads + data-loss delete).
3. **F-014 `intern/admin`** (auth/reset) — foundational for every other intern feature.
4. **F-006 `page`**, **F-001 `optagelse`** (public surface, SEO URLs, stored XSS).
5. **F-007/F-008/F-009/F-011/F-012/F-013** (content/members area).
6. **F-010 `alumneliste`** — needs a genuine rebuild (currently un-ported flat-file).
7. **F-015 `portfolio`** — confirm-then-delete.
