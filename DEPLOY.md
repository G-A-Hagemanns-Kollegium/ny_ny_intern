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
SMTP_HOST=send.one.com  SMTP_USER=…  SMTP_PASSWORD=…  SMTP_PORT=587
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
DEFAULT_FROM_EMAIL=autosvar@gahk.dk               # ⚠ must be an alias of SMTP_USER — see below
OELKAELDER_FROM_EMAIL=bierkeller@gahk.dk          # ⚠ second sender, same requirement
TURNSTILE_SITE_KEY=…  TURNSTILE_SECRET_KEY=…      # Cloudflare Turnstile [you]
WIFI_PASSWORD=…  GOOGLE_CALENDAR_USER=…  GOOGLE_CALENDAR_PASSWORD=…
INDSTILLING_EMAIL=indstillingen@gahk.dk           # recipient only, not a sender
POSTGRES_PASSWORD=<pw>                            # for the compose postgres service
OELKAELDER_KIOSK_IPS=<the till's server-observed source IP>   # confirm from access logs, NOT ipconfig
VAPID_PUBLIC_KEY=…  VAPID_PRIVATE_KEY=…           # Web Push for Den Hurtige — see below
VAPID_ADMIN_EMAIL=autosvar@gahk.dk                # real address: push services report failures here
```
Store real values in Coolify's secret manager / a vault — not in git.

**Web Push (Den Hurtige).** The two VAPID values are the *raw base64url* key pair, not PEM files —
`VAPID_PUBLIC_KEY` is handed to the browser as `applicationServerKey`, which must be the 65-byte
uncompressed EC point. `app/.env.example` carries the generate/convert one-liner. Leave them unset
and the feature degrades cleanly: the feed still works, the subscribe button just reports that push
is not configured. **Rotating the pair invalidates every existing subscription**, so every resident
would have to press the button again — settle on one pair before residents start subscribing.
Push also requires HTTPS, which Traefik already terminates; on iOS the site must be added to the
home screen before notifications are available at all.

**Email — verify the senders, don't assume.** one.com authenticates as `SMTP_USER` and rejects any
From address that account is not itself or an alias of:
`550 5.7.1 [M9] User [it@gahk.dk] not authorized to send on behalf of <autosvar@gahk.dk>`. Both
`DEFAULT_FROM_EMAIL` and `OELKAELDER_FROM_EMAIL` must therefore be added as aliases on the
`SMTP_USER` mailbox in the one.com control panel (or pointed at `SMTP_USER` itself). Test each from
inside the running container — this is the only way to confirm, since MX stays on one.com (§7) and
the app relays through their smarthost, so existing SPF/DKIM for gahk.dk covers it with no new DNS:
```
python manage.py sendtestemail you@example.com                       # exercises DEFAULT_FROM_EMAIL
DEFAULT_FROM_EMAIL=$OELKAELDER_FROM_EMAIL python manage.py sendtestemail you@example.com
```
Exit 0 = delivered. A failure here is otherwise near-invisible in the UI: the mails are best-effort
so the app keeps working, and only the server log records the rejection. The one exception is
password reset — Django's built-in view does not suppress errors, so a bad `DEFAULT_FROM_EMAIL`
turns "glemt kodeord" into a 500 for the resident.

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

### 4b. Scheduled tasks (Coolify → the `web` resource → **Scheduled Tasks**)

Coolify runs each of these *inside the already-running `web` container* on a cron expression, and
keeps the output in its own log view. That is why there is no cron sidecar, no host crontab (which
would fight Coolify's control of the compose lifecycle) and no Celery beat (a broker plus a worker
for four jobs a month). Container name: `web`. Every command below is **idempotent** — a double run
or an overlapping run is harmless.

| Command | Cron | Why |
| --- | --- | --- |
| `python manage.py purge_applications` | `20 3 * * *` | **The one that is genuinely missing.** F-001 says applications are kept one year; nothing has ever enforced it, so applicant PII accumulates indefinitely — the exact GDPR gap 99-index.md flags in the legacy system. |
| `python manage.py ak_monthly_assessment` | `10 4 1 * *` | Books the month's AK deduction on the 1st instead of whenever someone happens to open an internal page. |
| `python manage.py purge_quick_posts` | `*/30 * * * *` | Drains expired Den Hurtige posts (and their images) even in a quiet week when nobody loads the feed. |
| `python manage.py purge_notices` | `40 3 * * *` | Enforces opslagstavlen's ~2-year retention and sweeps compose-toolbar images that were uploaded to a post nobody ever saved. **Pinned opslag are exempt** — a pin is Inspektionen deciding the kollegium keeps that one. Offset from `purge_applications` (03:20) so two deletes never overlap on the same small box. |
| `python manage.py purge_events` | `0 4 * * *` | Enforces Begivenheder's retention: an event goes a week after it ends, a cancelled one thirty days after it was cancelled (two clocks, see `events/models.py`). Offset to 04:00 so it does not overlap `purge_applications` (03:20) or `purge_notices` (03:40) on the same small box. |
| `python manage.py remind_rsvp_deadlines` | `0 17 * * *` | Nudges the people who have not answered when a svarfrist falls inside the next 24 hours. **Once per event** — the claim is a compare-and-swap on `reminder_sent_at`, taken *before* the send, so a crash between the two loses one reminder rather than pushing the whole house twice. Runs at 17:00 rather than overnight because it is a notification people are meant to act on. |

**Run `purge_applications --dry-run` by hand first.** It deletes permanently and there is no undo;
confirm the count is what you expect before putting it on a schedule.
The same goes for `purge_notices` — though its retention branch will delete nothing for years, so
the number worth eyeballing on the first real run is the *unused image* count.

`purge_events` and `remind_rsvp_deadlines` both have lazy backstops in the events list view, for
the reason given below; `purge_notices` does not.

**`purge_notices` is the deliberate exception to the lazy-guard rule below, and should stay that
way.** Den Hurtige purges on every feed load because its promise is "gone in 30 minutes": a message
that should have vanished is visibly wrong to a reader within the hour, so cron failing silently has
an immediate cost. Opslagstavlen's tolerance is *months* — if the job is dead for a week nothing is
wrong for anybody — and putting a potentially large DELETE on every board request to insure against
that would be a bad trade. Don't "fix" the inconsistency.

**These do not replace the lazy guards, and the lazy guards should stay.** `ensure_active_month_applied()`
costs two indexed single-row queries on three pages (measured), and it is the only thing that makes a
missed cron self-healing. Cron's failure mode is silence — a bad expression, a container restarted at
the wrong minute, a task disabled during debugging — and a skipped `ak_monthly_assessment` means every
resident's balance is quietly wrong until someone notices. The lazy check turns that into "runs a few
hours late". Belt and braces, and both paths are idempotent so they cannot double-charge.

**Timezone.** Coolify evaluates cron on the host clock (UTC on a stock Hetzner box) while Django's
`TIME_ZONE` is `Europe/Copenhagen`. Irrelevant for the daily and half-hourly jobs; it matters for the
monthly one, where `10 4 1 * *` UTC is 05:10/06:10 local on the 1st — safely inside the day either
way. Do not move it near midnight, or DST will eventually put it on the wrong side of a month
boundary.

**Deliberately not scheduled:** ølkælder interest (`apply_interest`). It is already idempotent per
calendar month and exposed as a button for the ølkælder officers, so automating it is a policy
decision for them, not a technical one.

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
- [ ] `sendtestemail` green for **both** sender addresses (§2); one real "glemt kodeord" round-trip.
- [ ] Scheduled tasks created in Coolify (§4b); `purge_applications --dry-run` reviewed before the
      daily job is enabled, and each task run once by hand so its log is known-good.
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
