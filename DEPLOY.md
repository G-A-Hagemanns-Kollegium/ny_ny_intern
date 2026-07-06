# Deployment runbook

Target stack (scope §4): **Django 5.2 + gunicorn** behind **nginx/Traefik**, **PostgreSQL**, **WhiteNoise**
for static, on **Hetzner** with **Coolify** (git-push deploys + Let's Encrypt TLS) or **Kamal**. MediaWiki
stays a separate **PHP + MariaDB** app on the same box. No SPA/API — one monolith.

> Items marked **[you]** need your accounts/credentials (GitHub, Hetzner, Punktum dk) — I can't do them from here.

## 1. Local
Prereqs: [`uv`](https://docs.astral.sh/uv/) (Python deps) + [`go-task`](https://taskfile.dev) + Node.
```
task install      # uv sync → ./.venv from pyproject.toml + uv.lock
task db:up        # Postgres + MariaDB (dev)
task dev          # build assets + migrate + runserver → http://127.0.0.1:8800
task test         # pytest
task lint         # ruff check + format --check
task build        # prod asset build + collectstatic
docker build -t gahk .   # full production image
```

## 2. Secrets / environment (prod → `app/.env.prod`, never committed)
All are read from the environment (F-013); rotate everything at cutover (scope §5 — legacy secrets are compromised).
```
DJANGO_SECRET_KEY=<64+ random chars>
DJANGO_DEBUG=0
DJANGO_ALLOWED_HOSTS=www.gahk.dk,gahk.dk
DATABASE_URL=postgres://gahk:<pw>@postgres:5432/gahk
VISIT_COUNTER_HMAC_KEY=<random>
SMTP_HOST=…  SMTP_USER=…  SMTP_PASSWORD=…  DEFAULT_FROM_EMAIL=autosvar@gahk.dk
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
TURNSTILE_SITE_KEY=…  TURNSTILE_SECRET_KEY=…      # Cloudflare Turnstile [you]
WIFI_PASSWORD=…  GOOGLE_CALENDAR_USER=…  GOOGLE_CALENDAR_PASSWORD=…
INDSTILLING_EMAIL=indstillingen@gahk.dk
POSTGRES_PASSWORD=<pw>                            # for the compose postgres service
OELKAELDER_KIOSK_IPS=<the till's server-observed source IP>   # confirm from access logs, NOT ipconfig
```
Store real values in Coolify's secret manager / a vault — not in git.

## 3. CI (GitHub Actions — `.github/workflows/ci.yml`) **[you: create the repo]**
Fresh repo (do **not** import the legacy history — it contains plaintext secrets, scope §5). Jobs:
`lint` (ruff + bandit), `test` (pytest against a Postgres service), `security` (pip-audit), `build`
(`docker build`). Add **Dependabot**. mypy is optional (code is currently untyped) — add later with django-stubs.

## 4. Hosting (Hetzner) **[you]**
1. Provision a Hetzner CX/CPX VM (EU/GDPR-aligned, DK-close).
2. Install **Coolify** (recommended): git-push deploys, TLS, env management. Point it at the repo; it builds
   the `Dockerfile` and runs it. (Alternative: **Kamal** — `kamal setup`/`deploy` using the same Dockerfile.)
3. Run **Postgres** (managed, or the `postgres` service in `docker-compose.prod.yml`) and **MariaDB** (for
   MediaWiki). Mount a **`media` volume** for uploads.
4. `web` runs `migrate` on start then gunicorn; Coolify/Traefik terminates TLS and proxies to :8000.
5. `Scaleway` is the fallback if you prefer a first-party managed Postgres.

## 5. Data migration to prod
```
mysqldump the live gahk_dk  →  load into the MariaDB staging container
task etl          # seed_rooms + all etl_* + reset_sequences   (needs LEGACY_DB_* env pointing at staging)
task etl:verify   # count diff legacy ↔ clean (expect residents/residencies/kvotient/deposits lower; rest equal)
python manage.py relocate_media   # copy referenced legacy images into MEDIA_ROOT
```
Encoding: connection charset is utf8mb3 — check per-table charsets, watch latin1→utf8 mojibake (02-schema-etl §1.4/A2).
**Carve out the `wiki*`-prefixed tables** — they belong to MediaWiki (MariaDB), not the Postgres ETL.

## 6. MediaWiki workstream (keep, don't rewrite — scope §3) **[you]**
- It currently **shares the `gahk_dk` DB** (user `gahk_dk`, table prefix `wiki`; `LocalSettings.php`).
  Split the `wiki*` tables into their **own MariaDB database** on the new box.
- **Upgrade to the current LTS (1.43, supported to Dec 2027)**. MediaWiki upgrades span at most two LTS
  releases at a time, so if the current install is old this is **multi-step**; then stay on the LTS track.
- Serve behind the same proxy at `wiki.gahk.dk` or `/wiki`. Confirm open Q: is wiki login standalone or
  SSO'd to the members area? (Separate `wiki`-prefixed user tables imply standalone; verify LocalSettings.)

## 7. DNS cutover (.dk via Punktum dk) **[you]**
1. A **day ahead**, lower the A-record TTL (e.g. 300s).
2. Repoint the **A record** to the Hetzner IP. **Leave MX on one.com** (email untouched).
3. Serve **301 redirects** for any changed URLs to protect SEO. The rewrite **preserves** the public URLs
   (`/`, `/faciliteter`, `/faciliteter/vaerelse`, `/kollegielivet/historie`, `/optagelse`, `/pylon`→ n/a, `/wiki`).
4. **Rollback** = repoint the A record back. Registrar transfer is optional/separate (MitID + auth code).
5. Confirm **who the registrant of record is** early — often the slowest item.

## 8. Cutover checklist
- [ ] Fresh GitHub repo, CI green, Dependabot on.
- [ ] Hetzner + Coolify up; `.env.prod` secrets set (all rotated).
- [ ] Postgres + MariaDB provisioned; `media` volume mounted.
- [ ] `task etl` + `etl_verify` + `relocate_media` run against a fresh dump; counts sane.
- [ ] `createsuperuser`; assign initial roles via `/admin/roles`.
- [ ] Interim hardening done on the *old* box until DNS flips (scope §8: lock KCFinder, gate mass-mailers,
      delete `phpinfo.php`, pull & archive access logs).
- [ ] MediaWiki migrated + upgraded to 1.43, reachable behind the proxy.
- [ ] Staging smoke-tested; behavioural diff vs the live PHP site on key pages.
- [ ] Lower A TTL → repoint A → verify → keep MX on one.com.
- [ ] 301s live for any changed URLs.

## 9. Notes
- Python: **dev is 3.14, prod image pins 3.13** (Django 5.2's supported range; psycopg wheels).
- Static: WhiteNoise `CompressedManifestStaticFilesStorage` in prod (hashed/cached); `collectstatic` runs at image build.
- Fonts (Julius Sans One / Ubuntu) currently load from Google Fonts — self-host for a fully CSP-clean/offline prod.
- The `gahk_dk` DB account is shared by App A, App B, and MediaWiki — rotating its password touches all three.
