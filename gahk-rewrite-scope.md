# GAHK.dk — Project Scope

Status: living document. Captures the decisions made to date so the whole team works from one
reference. Supersedes ad-hoc notes; update it as open questions close.

## 1. Background & objective

The current gahk.dk is a ~15-year-old codebase with structural SQL-injection vulnerabilities,
plaintext secrets throughout, and several unauthenticated or broken endpoints. The goal is a
**security-driven rewrite of the primary application onto a modern, maintainable stack**, hosted
off one.com, under version control with a proper CI/CD pipeline.

This is not a lift-and-shift. The defects live in the source, so the target is a clean
reimplementation of *intended behaviour minus defects* — not a translation.

## 2. What exists today (system inventory)

The document root contains several stacked systems, not one site:

| System | Location | What it is | Disposition |
|---|---|---|---|
| **App A — CodeIgniter 2.x** | `application/`, front controller `index.php` | Live public site + current internal members area (`nyintern/*`) | **Primary rewrite target** |
| **App B — flat-file `intern/`** | `intern/` (procedural PHP, served directly) | Previous-generation internal system; mostly superseded but **still served and therefore live/exploitable** | **Selectively port, then retire** |
| **MediaWiki** | `wiki/` (~5030 files) | Standalone wiki engine (PHP + MySQL) | **Keep — upgrade, do not rewrite** |
| Vendor / framework | `system/` (CI core), ADOdb ×3, KCFinder, front-end libs | Third-party code | **Drop / replace** |

## 3. Scope decisions

**In scope — rebuild in Django (Phase 2 worklist):** the ~15 live App A controllers in the
manifest (`page`, `admin`, `news`, `optagelse`, `pylon`, the `nyintern/*` set: `admin`,
`dashboard`, `ak`, `alumneliste`, `oelkaelder`, `soegvaerelse`, `vaerelsestjek`,
`stamtree`, `statistik`) and their models. **`nyintern/mydata` is excluded — it is the MAC-address
feature, confirmed no longer used (2026-06); it drops off the rebuild list.** CI's MVC structure means controllers → views,
models → ORM, views → templates is a clean mapping, and the raw interpolated SQL becomes
parameterised ORM calls — which is where the SQL-injection class is eliminated structurally.

**Port from App B then retire — currently nothing identified:** the prime (and only) port candidate
was the **MAC-address network-access feature** (`intern/mydata/*`, especially `approved.php`), but it
is **confirmed no longer used** (2026-06). With it gone, **no App B endpoint is currently slated for
porting** — the whole tree retires, pending only an access-log check (§8.6) that nothing else is in
active use.

**Keep, not rewritten — MediaWiki:** migrate the install to the new host as a **separate
PHP + MariaDB application** behind the same nginx (`wiki.gahk.dk` or `/wiki`), and **upgrade it to
the current LTS (1.43, supported to Dec 2027)**, then maintain it on the LTS track. Note MediaWiki
only supports upgrading from up to two LTS releases back, so if the current install is old the
upgrade is multi-step. Explicitly outside the Django rewrite.

**Out of scope / delete:** CodeIgniter core, the three bundled ADOdb copies, KCFinder, all 26
`.php_` backups, `phpinfo.php`, the reCAPTCHA v1 view, the CKEditor sample scripts, and the stray
App B copies dropped into the CI views tree (`application/views/intern/alumneliste/*`,
`.../mydata/*` except where `nyintern/mydata` renders the real page). The superseded App B tree is
retired once its live endpoints are ported.

## 4. Target architecture & stack

- **Backend:** Django, targeting the current LTS (**5.2**, supported to Apr 2028) on Python 3.12+.
- **Databases:** **PostgreSQL** for the Django app (Django's first-class DB, stricter integrity,
  best managed-DB options in the EU/Hetzner ecosystem). **MariaDB** for MediaWiki only (its
  recommended engine) — two engines, each serving the app that wants it.
- **Frontend:** server-rendered **Django templates + HTMX** (partial updates, inline editing,
  live search via HTML fragments — no separate API), **Alpine.js** for small client-only
  interactions, **Tailwind or plain CSS** for styling. **No SPA** — it would force an API the
  monolith doesn't need and roughly double the attack surface. Replace the legacy captcha with
  **Cloudflare Turnstile or reCAPTCHA v2** (the old v1 is dead).
- **App serving:** gunicorn/uvicorn behind nginx; **WhiteNoise** for static files; Redis only if
  caching/background tasks are needed (Celery or RQ/Django-Q).
- **Hosting:** **Hetzner** (EU/GDPR-aligned, low latency to DK, very low cost) running both the
  Django app and MediaWiki on one box behind nginx. Hetzner is unmanaged IaaS — a self-hostable
  PaaS layer (**Coolify / Kamal**) is recommended to get git-push deploys and TLS automation
  without owning every detail. **Scaleway** is the fallback if a first-party managed database is
  preferred over self-hosting Postgres.
- **Source control & CI/CD:** a **fresh GitHub repository** (see §5 — do not import the legacy
  repo with its secrets/history). **GitHub Actions** pipeline: ruff (lint+format), mypy
  (optional), pytest, **bandit + pip-audit + Dependabot** for security, then deploy. A **staging
  environment** and a safe migration step in the deploy are required.

## 5. Security baseline

Security is the reason for the project; these are non-negotiable.

- **Treat all current secrets as compromised and rotate at cutover.** They appear in plaintext in:
  `application/config/database.php` (DB password), `.../email.php` (SMTP password),
  `.../recaptcha.php` (captcha keys), `intern/delt.php` (DB creds + ~8 app passwords + the
  `atGAHK()` allowlist), the stray `.../alumneliste/config.php` and `.../mydata/delt.php` copies,
  and MediaWiki's `LocalSettings.php`. **All three apps (App A, App B, MediaWiki) use the same
  `gahk_dk` DB account** (confirmed §9), so rotating the DB password breaks all three at once — it
  must be coordinated across `database.php`, `intern/delt.php`, and `LocalSettings.php` in one change
  window. Plan the DB/SMTP rotation as a deliberate step, not a surprise.
- **SQL injection** is eliminated structurally by moving to the ORM; raw queries in the new code
  get a manual review as a backstop.
- **Password migration:** old hashes (MD5/sha256, per the manifest) are migrated with a custom
  Django hasher that **transparently upgrades each user's hash on next successful login**, avoiding
  a forced global reset.
- **Per-feature security pass** in Phase 2: every input→DB path, auth check, and upload boundary
  is reviewed and recorded; the consolidated findings list (Phase 3) is the project's threat model.

## 6. Data migration

`mysqldump` → transform into the clean Postgres schema via an ETL step (pgloader for the bulk move,
plus scripted transforms). Expect and handle **latin1 → utf8mb4** encoding issues (note App A's
connection charset is `utf8`/`utf8mb3`, so check per-table charsets in the dump — see
`01-infrastructure.md` A2). **Confirmed (2026-06): MediaWiki shares the `gahk_dk` database**, using
DB user `gahk_dk` and the table prefix `wiki` (`wiki/LocalSettings.php:56-62`). So **carve out the
`wiki*`-prefixed tables** and keep them on MariaDB rather than dragging them into the Postgres ETL.
**Preserve existing URLs** (App A routes and `/wiki`) and serve **301 redirects** for any that
change, to protect SEO.

## 7. Domain & DNS (.dk)

The domain, the nameservers, and the DNS records are three independent layers; Punktum dk treats
nameserver changes and registrar changes as separate operations with separate auth codes.

- **Cutover (lowest risk):** lower the A-record TTL a day ahead, then **repoint the A record** to
  the new host. Leave **MX records on one.com** so email is untouched. Roll back by repointing.
- **Registrar transfer is optional and separate** — do it later (or not) via a Punktum "change
  registrar" auth code; it doesn't gate the hosting move.
- Punktum self-service uses **MitID** and requires registrant (or proxy) access — **confirm who the
  registrant of record is now**, as that can be the slowest item if it was set up years ago.

## 8. Interim hardening (start now, in parallel with the rewrite)

Because App B and the KCFinder tree are **served directly and live**, their vulnerabilities are
exploitable today regardless of usage. These run ahead of / alongside the rewrite:

1. **Lock down KCFinder** — `public/js/kcfinder/.htaccess` with `Require all denied`. (Confirmed
   live: `browse.php` returns a 500, i.e. PHP executes rather than being blocked.) Only risk is the
   admin CKEditor "insert image from server" dialog; acceptable, and replaced by Django uploads.
2. **Gate or disable the open mass-mailers** (`admin/sendMail`, `intern/alumneliste/mailAll*`,
   `intern/mailliste/mailadmin`) — domain-reputation/abuse risk.
3. **Gate the unrestricted file-upload endpoints** (`intern/handbook/admin`,
   `intern/mailliste/mailadmin`) — RCE risk via blocklist bypass.
4. **Delete** `application/controllers/phpinfo.php` and the CKEditor sample `posteddata.php`.
5. **IP-restrict** the remaining dangerous App B endpoints.
6. **Pull and archive the one.com access logs *before decommissioning anything*** — they resolve
   most "is this live?" questions and reveal any prior abuse/probing.

## 9. Resolved & open questions

**Resolved:**
- reCAPTCHA v1 view is **dead** (live forms use v2 keys). Delete it.
- `intern/` is **still served** → live and exploitable → interim hardening + selective port.
- KCFinder is **live but crashing** on cold requests → lock it now; it does not survive the rewrite.
- **MAC-address network-access feature (`intern/mydata/*`, `approved.php`) is no longer used**
  (project owner, 2026-06). Nothing to port; delete with the App B tree. Removes `nyintern/mydata`
  from the Phase 2 rebuild list. Still **interim-harden** it (it's served + exploitable) until deleted.
- **MediaWiki shares the `gahk_dk` database** (user `gahk_dk`, table prefix `wiki`;
  `wiki/LocalSettings.php:56-62`). ETL carves out `wiki*` tables (→ §6); the shared DB user means a
  password rotation hits all three apps at once (→ §5).

**Open — resolve early:**
- Is the **wiki login integrated** with the members area or standalone? *(DB layout suggests
  standalone — separate `wiki`-prefixed user tables — but confirm there's no SSO extension wiring it
  to `intern_alumne` in `LocalSettings.php`.)*
- Do the access logs show the **KCFinder upload path** being used legitimately by the admin editor?

## 10. Phased plan

- **Phase 0 — Triage. ✅ Done.** Codebase manifest classifying ~230 bespoke files + vendor bundles.
- **Phase 1 — Shared infrastructure spec. ✅ Done.** `01-infrastructure.md` documents the
  cross-cutting machinery (DB connection, sessions/auth, config, layout, helpers) for App A and App B,
  verified against source — every `[VERIFY]`/`[NEEDS SOURCE]`/`[UNRESOLVED]` marker resolved. Also
  confirmed the shared `gahk_dk` DB spans all three apps (incl. MediaWiki).
- **Phase 2 — Per-feature specs. ◀ Next.** One structured spec per **live App A controller**, prioritised
  by risk and how load-bearing each is. Excludes dead code — including `nyintern/mydata` (the MAC
  feature, now confirmed unused), which is dropped rather than specced.
- **Phase 3 — Aggregation.** Feature index, table→feature map, consolidated security findings
  (= threat model), consolidated open questions, coverage check.
- **Then:** clean schema design + ETL, build feature-by-feature from the specs with tests that
  diff against the running old site, run the data migration, cut over via the DNS A-record flip.
- **In parallel from now:** interim hardening (§8) and the MediaWiki upgrade workstream (§3).
