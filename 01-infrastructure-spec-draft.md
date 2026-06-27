> # ⚠ SUPERSEDED — do not use
> This draft has been finalized and **replaced by [`01-infrastructure.md`](./01-infrastructure.md)**,
> which is verified against source with every marker resolved. This file is kept only for history and
> can be deleted. Read `01-infrastructure.md` instead.

---

# 01 — Shared Infrastructure Spec (DRAFT)

Cross-cutting machinery that per-feature specs (Phase 2) will reference instead of re-describing.
**Analysis only — no Django code, no fixes recorded as fixes.**

> **Provenance / how to read this.** This draft is synthesized from the Phase 0 manifest, which is
> itself an analysis rather than source. It is reliable where the manifest is specific and marked
> **`[VERIFY]`** where a claim needs confirmation against the actual file, and **`[NEEDS SOURCE]`**
> where the manifest doesn't carry enough detail (e.g. exact hashing, full helper signatures,
> representative query snippets). To finalize, provide the files listed in
> [§S — Source needed](#s--source-needed-to-finalize).

There are **two independent infrastructures** — App A (CodeIgniter) and App B (flat-file). They
share the database and some session state but bootstrap, authenticate, and lay out pages entirely
differently. Documented separately below.

---

## Part A — App A (CodeIgniter 2.x)

### A1. Bootstrap & request lifecycle
`index.php` (front controller) sets `ENVIRONMENT='production'` (errors suppressed) and loads
`system/core/CodeIgniter.php`. The root `.htaccess` rewrites everything except
`index.php|images|public|intern|wiki|robots.txt` through the front controller, and force-redirects
`gahk.dk → https://www.gahk.dk`. `autoload.php` opens a **database connection on every request**
(autoloads the `database` library) and loads the `url` helper; no models/configs autoloaded.
Routing (`routes.php`): default controller `page/show/1`; Danish slugs → `page/show/N`; the
internal area is the wildcard **`nyintern/(:any) → intern/$1`**.

### A2. Database connection
`application/config/database.php`: driver `mysqli`, host `localhost`, database `gahk_dk`, user
`gahk_dk`, **password hardcoded in plaintext**, `pconnect=TRUE` (persistent connections),
`db_debug=TRUE` (DB errors surfaced — information-disclosure risk in production), charset utf8.
*Reimplementation note:* maps to Django `DATABASES['default']` (Postgres) with secrets from
environment. `[VERIFY]` exact charset/collation to plan the utf8→utf8mb4 step.

### A3. Query layer
**No central query helper** — models issue SQL directly. Most App A models use **raw interpolated
SQL** (SQL-injection exposure); `kvotient_model` is the exception (uses `db->escape`).
`[NEEDS SOURCE]` representative examples of each pattern (one interpolated, one escaped) to anchor
the Phase 2 reviewers. *Reimplementation note:* all of this collapses into the ORM.

### A4. Sessions & authentication
`config.php`: **DB-backed sessions** in table `gahk_dk_sessions`, cookie `gahk_dk_session`, 2-hour
expiry, `sess_match_useragent` on. **Encryption key is weak/hardcoded** (`'gahksessionsecurity'`).
`base_url` is empty (auto-guessed). `csrf_protection=false` and `global_xss_filtering=false`
**[VERIFY]** — both off means no framework CSRF/XSS protection app-wide.

Login state is carried as CI **session userdata**. Per `MY_Controller`, the known keys are:
`username`, `alumne_id`, `akRole`, `indstilling`, `inspektion`, `kokkengruppe`, `oelkaelder`,
`administrator`. These double as the role/permission flags (see A5).

- **Public-site admin** (`admin` controller): **sha256** password auth. `[VERIFY]` salt? iterations?
  (sha256 alone is weak — informs the password-migration hasher in scope §5.)
- **Internal area** (`intern/admin` controller): login/logout/forgot/reset via `Internuser_model`.
  `resetpass()` builds a temporary password from `random_int(5,10000)` — **weak/guessable**.
- **Password storage** for internal users: `[NEEDS SOURCE]` confirm the hash used in
  `internuser_model` and `adminuser_model` so the rehash-on-login path is built correctly.

### A5. Authorization / roles
No central policy layer — authorization is **ad hoc per controller**, reading the session flags in
A4 (e.g. `username`+`editpage` for CMS edit; `oelkaelder` for the shop admin; `akRole` for duty
admin; `indstilling`/`inspektion`/`kokkengruppe` for alumni-list actions). Several checks are
**missing or broken** (record as findings, do not fix here): `oelkaelder/purchase` has its auth
**commented out**; `news/delete`, `admin/sendMail`, and several `statistik` JSON feeders have **no
auth**; `soegvaerelse` and `vaerelsestjek` admin use the buggy `!$username && !empty($role)` idiom
that likely lets unauthorized requests through; `alumneliste/json` is gated only by the
`insideGAHK()` IP check, not login. *Reimplementation note:* replace with Django auth +
per-view permission decorators/mixins; this scattered logic becomes one coherent model.

### A6. Global config & constants
`config.php` (above) plus custom configs: `email.php` (**hardcoded SMTP creds**,
`smtp_host=mailout.one.com`, plaintext password), `recaptcha.php` (**hardcoded v1 + v2 keys**).
`constants.php` and the other framework configs are CI defaults, unchanged. Language is `danish`;
`subclass_prefix='MY_'`.

### A7. Input handling
With `global_xss_filtering=false` and `csrf_protection=false`, there is **no global input
sanitization**; controllers/models read `$_GET`/`$_POST` and interpolate directly (A3).
`[NEEDS SOURCE]` confirm whether any controller does its own escaping beyond `kvotient_model`.

### A8. Shared layout
Two layout families, both opening a `.container` closed by `layout/bottom.php`:
- **Public:** `layout/head.php` (CSS/JS) → `layout/header.php` (+ `submenu.php`) → content →
  `layout/footer.php` (effectively a no-op; body commented out) / `bottom.php`.
- **Admin:** `adminHeader.php` (+ `adminSubmenu.php`, near-duplicate of `submenu.php`).
- **Internal (`nyintern`):** `views/intern/header.php` + `footer.php`, emitted by
  `MY_Controller::showInternPage()` using the session userdata in A4.
- Shared content partial: `standart_page_setup.php` (loops `$page` rows, contenteditable by
  `$editable`). *Reimplementation note:* collapses to one Django base template + `{% block %}`s;
  the public/admin/intern split becomes template inheritance.

### A9. Common helpers / base controller
- `MY_Controller` (base for all controllers): session bootstrap, intern layout wrapper, a per-IP/
  date **visit counter** (`counter()` → `gahk_counter`/`gahk_counterdato`), and
  `sendAnsoegningPaamindelseIfTime()` (weekly reminder mail — **send is commented out/disabled**).
  Note the `page` controller fires this on **every front-page hit** (cron-like side effect).
- `gahk_helper.php`: `insideGAHK()` (REMOTE_ADDR vs ~6 hardcoded campus IPs); `isInspektion()` is
  **broken/dead** (references `$this` from a plain function).
- `oelkaelder_helper.php`: money utils (price string ↔ øre).
- `GahkTree.php`: simple tree-node class (stamtree/menu).
- `recaptcha.php` / `recaptchassl.php`: **duplicate class name `Recaptcha`** — cannot coexist;
  `[VERIFY]` which is actually loaded. *Reimplementation note:* the counter and reminder become a
  middleware + a scheduled task; `insideGAHK()` becomes a small reusable check.

### A10. Cross-cutting security findings (App A)
| Issue | Location | Severity | Note |
|---|---|---|---|
| Plaintext DB password | `config/database.php` | High | Rotate at cutover |
| Plaintext SMTP creds | `config/email.php` | High | Rotate at cutover |
| Plaintext captcha keys | `config/recaptcha.php` | Medium | v1 dead; rotate v2 |
| Weak hardcoded session encryption key | `config/config.php` | High | `'gahksessionsecurity'` |
| CSRF protection disabled site-wide | `config/config.php` | High | `[VERIFY]` |
| Global XSS filtering disabled | `config/config.php` | Medium | `[VERIFY]` |
| `db_debug=TRUE` in production | `config/database.php` | Medium | Leaks DB errors |
| Raw interpolated SQL (most models) | `application/models/*` | High | SQLi; ORM removes |
| Weak sha256 admin auth | `admin` / `adminuser_model` | High | `[VERIFY]` salting |
| Guessable reset password | `intern/admin::resetpass` | Medium | `random_int(5,10000)` |
| Missing/disabled auth checks | see A5 | High | Several live endpoints |
| `phpinfo()` endpoint | `controllers/phpinfo.php` | High | Delete now (interim) |

---

## Part B — App B (flat-file `intern/`)

### B1. Bootstrap
No framework. Every page `include`s **`intern/delt.php`** — the linchpin. It defines the DB
credentials, **~8 plaintext app passwords**, the `atGAHK()` IP allowlist, room/month data, and the
entire helper library (`insertHeader`, `insertFooter`, `selector`, `mailFormatted2`, …). Pages are
served directly from disk (the `.htaccess` carve-out), so each is its own entry point. ADOdb is the
DB layer (bundled, old `mysql`/`mysqli` drivers; `intern/mailliste/*` even uses removed `mysql_*`).

### B2. Authentication & authorization
**No sessions.** A typed password is compared with `===` against a `delt.php` variable and
**re-posted as a hidden field** on each action. Some pages instead/also gate on `atGAHK()` (IP).
This is the entire auth model — there is no per-user identity. `[NEEDS SOURCE]` the exact set of
passwords/tiers in `delt.php` to map which capability each one unlocks.

### B3. Query layer & input handling
**Pervasive SQL injection** via raw `$_GET`/`$_POST`/`$month` interpolation across the tree
(`alumneliste/*`, `kvotient/*`, `pylon/*`, `handbook/*`, `andet/*`, `mailliste/*`, `mydata/*`).
`evalPostArray.php` interpolates even a **table name** from `$_POST`. `handbook/index` renders
stored HTML **unescaped** (stored XSS). `[NEEDS SOURCE]` representative query for the Phase 2
reviewers.

### B4. Layout
Emitted by `insertHeader()`/`insertFooter()` in `delt.php` (function-based, not templates).
`intern/menu/menu.php` is **fully commented out** (renders empty). Per-module `head.php` fragments
exist for `alumneliste` and `pylon`.

### B5. Notable infrastructure-level risks (App B)
- `delt.php` and its stray copies (`.../alumneliste/config.php`, `.../mydata/delt.php`) **leak all
  secrets**; treat as compromised.
- **Unrestricted file upload** (client-controlled basename) in `handbook/admin` and
  `mailliste/mailadmin` → **RCE risk**.
- **Open mass-mailers** (`alumneliste/mailAll*`, `mailliste/mailadmin`, plus App A's `admin/sendMail`).
- **`kvotient/seAnsoegninger` can TRUNCATE `intern_kvotient`** on POST.
- **MAC-address network access** (`mydata/approved.php`) gated by a **plaintext URL password**
  (`?password=mLXAC6V2wf`); **likely polled by router/RADIUS — load-bearing, confirm before any
  change** (scope §9).
- `telefonliste/index.php` opens a raw socket to www.gahk.dk and POSTs a **hardcoded password
  (`ymer`)** to scrape `alumneliste/liste.php` — fragile screen-scrape, unique (no `delt.php`).

> App B is mostly destined for retirement (scope §3); this section exists to (a) drive interim
> hardening and (b) inform porting the few endpoints the access logs prove are still used —
> chiefly the `mydata`/MAC feature.

---

## S — Source needed to finalize

To turn this draft into a verified `01-infrastructure.md`, provide these files (small, high-value):

**App A:** `index.php`, root `.htaccess`, `application/config/{database,config,autoload,routes,email,recaptcha}.php`,
`application/core/MY_Controller.php`, `application/models/{internuser_model,adminuser_model}.php`
(for the exact auth/hashing), `application/helpers/gahk_helper.php`, and one representative
interpolated-SQL model (e.g. `oelkaelder_model.php`).

**App B:** `intern/delt.php` (the single most important file), and one representative page
(e.g. `intern/alumneliste/liste.php` + `evalPostArray.php`).

Paste those and I'll close every `[VERIFY]`/`[NEEDS SOURCE]` and finalize the spec; then Phase 2
can start on the prioritised live-controller list.
