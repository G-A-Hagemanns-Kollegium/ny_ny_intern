# Feature: Admin — public-site administration (login, dashboard, admin-user management, stats, group mailout)

- **Feature ID:** F-002
- **Source file(s):** `application/controllers/admin.php`, `application/models/adminuser_model.php`,
  `application/models/ansoegninger_model.php`, `application/models/counter_model.php`,
  views `application/views/admin/{dashboard,login,useradm}.php`,
  layout `application/views/layout/{adminHeader,adminSubmenu,bottom,head,footer}.php`
- **URL / route:** (route `admin → admin`; default action `index`; CI `index.php`-style URLs are used by the views, e.g. `index.php/admin/deleteuseradm/...`)
  - `GET  /admin/` — dashboard (index); renders login form if not authenticated
  - `GET/POST /admin/login` — login form + credential check
  - `GET  /admin/logout` — destroy session, redirect to `/admin`
  - `GET  /admin/useradm` — admin-user management page (Super Admin only)
  - `POST /admin/adduseradm` — grant one alumne a role set
  - `GET  /admin/addAllUserAdm` — wipe & rebuild all admin-users from the current intern roster
  - `GET  /admin/deleteuseradm/{id}` — revoke an admin-user row
  - `GET  /admin/alumneSearch?term=...` — JSON autocomplete of alumne names
  - `POST /admin/sendMail` — send the "new office groups" mail to the entire kollegium
  - `GET  /admin/getAngsoegningStatistic/{type}` — application-count statistics (also called internally)
- **HTTP method(s):** GET + POST (CI does not distinguish; all actions accept either — see findings)
- **Access control:** **logged-in (CI session `username`) for most actions, enforced inline per method; NOT centrally guarded.** `useradm` additionally requires `administrator == 1`. **`sendMail()` and `getAngsoegningStatistic()` have NO auth check at all** (see Security findings). Auth uses the standard CI session userdata model from `01-infrastructure.md` A4/A5 (keys `username`, `administrator`, `editpage`, `indstilling`, `inspektion`, `akRole`, `kokkengruppe`, `oelkaelder`, `alumne_id`, `fullname`).

**Routes / actions:**
| Action | URL | Method | Access | Purpose |
|---|---|---|---|---|
| `index` | `/admin/` | GET | logged-in (else shows login) | dashboard + counter/application stats |
| `login` | `/admin/login` | GET/POST | public | render login form; verify email+sha256 password |
| `logout` | `/admin/logout` | GET | any | destroy session → redirect `/admin` |
| `useradm` | `/admin/useradm` | GET | `username` **and `administrator==1`** | list/manage admin-users; mail UI |
| `adduseradm` | `/admin/adduseradm` | POST | `username` (any logged-in) ⚠ | grant a role set to one alumne → INSERT |
| `addAllUserAdm` | `/admin/addAllUserAdm` | GET | `username` (any logged-in) ⚠ | DELETE all then re-INSERT roles from roster |
| `deleteuseradm` | `/admin/deleteuseradm/{id}` | GET | `username` (any logged-in) ⚠ | DELETE one admin-user row |
| `alumneSearch` | `/admin/alumneSearch?term=...` | GET | `username` (any logged-in) | JSON name autocomplete |
| `sendMail` | `/admin/sendMail` | POST (any) | **none — unauthenticated** ⚠ | mail all 13 office groups |
| `getAngsoegningStatistic` | `/admin/getAngsoegningStatistic/{type}` | GET | **none — unauthenticated** ⚠ | 18-month application stats (echoed JSON-ish string) |

## Purpose
The administration entry point for the public gahk.dk site. A board member logs in with the same email/password they use on gahk-intern; the dashboard greets them and shows a 31-day visit-count graph and 18-month application-statistics for tours (*rundvisning*) and sublets (*fremleje*). A "Super Admin" can additionally open *Administrer brugere* to grant/revoke per-feature roles (edit-page, indstilling, inspektion, AK, kitchen, ølkælder, super-admin) to alumni, bulk-sync those roles from the current intern roster, and trigger a one-off informational mailout to all office groups.

## Inputs
| Name | Source | Type | Required? | Validated/sanitized? | Used for |
|---|---|---|---|---|---|
| `email` | POST | string | yes (`required` rule) | form_validation `required` only; **interpolated raw into SQL** | login lookup against `gahk_admin_user`/`intern_alumne.email` |
| `password` | POST | string | yes (`required` rule) | `hash('sha256', ...)` then **interpolated raw into SQL** | login password match (unsalted sha256) |
| `term` | GET | string | no (read with no isset check) | **none — interpolated raw into LIKE** | `alumneSearch` name search |
| `fullname` | POST | string | yes (`required` rule, `adduseradm`) | none beyond required; **interpolated raw into LIKE** via `searchOnAlumne` | resolve alumne, then `unset` before insert |
| `administrator` | POST | "1"/absent (checkbox) | no | **none — mass-assigned** into `gahk_admin_user` | grant super-admin role |
| `editpage` | POST | "1"/absent (checkbox) | no | **none — mass-assigned** | grant edit-page role |
| `indstilling` | POST | "1"/absent (checkbox) | no | **none — mass-assigned** | grant indstilling role |
| `inspektion` | POST | "1"/absent (checkbox) | no | **none — mass-assigned** | grant inspektion role |
| `kokkengruppe` | POST | "1"/absent (checkbox) | no | **none — mass-assigned** | grant kitchen role |
| `ak` | POST | "1"/absent (checkbox) | no | **none — mass-assigned** | grant AK role |
| `oelkaelder` | POST | "1"/absent (checkbox) | no | **none — mass-assigned** | grant ølkælder role |
| *(any other POST key on `adduseradm`)* | POST | — | no | **none** | ⚠ **mass-assignment** — whole `$_POST` (minus `fullname`, plus `alumne_id`) is `db->insert()`ed; any key matching a `gahk_admin_user` column is written |
| `{id}` | route seg 3 (`deleteuseradm`) | int | truthy-checked (`if($id)`) | **none**; passed to `db->delete(..., array('id'=>$id))` (escaped by AR) | which admin-user row to delete |
| `{type}` | route seg 3 (`getAngsoegningStatistic`) | string | no (defaults to PHP arg error if absent) | **none — interpolated raw into SQL** in `getAnsoegningerByMonth` | `typeOfAnsoegning` filter (`"rundvisning"`/`"fremleje"`) |
| `$_SERVER['REMOTE_ADDR']` | server | string | n/a | none | counter key (constructor) |
| session: `username`, `administrator`, `editpage`, `fullname`, `indstilling`, `inspektion`, `akRole`, `oelkaelder`, `alumne_id` | session | mixed | for guarded actions | CI session userdata (`01-infrastructure.md` A4) | auth gate + view chrome; `alumne_id` is the "self" exclusion in `addAllUserAdm`/`deleteuseradm` UI |
| `flashdata('success')`, `flashdata('fejl')` | session | string | no | n/a | one-shot status banners on `useradm` |

## Database interactions
- **Tables touched:** `gahk_admin_user` (R/W), `intern_alumne` (R, join), `intern_alumne_liste` (R), `gahk_ansoegninger` (R, count), `gahk_counter` (R/W), `gahk_counterdato` (R/W). (`intern_alumne_sessions` is referenced only by `Adminuser_model::loginSession()`, which this controller never calls.)
- **Reads:**
  - **Login:** `SELECT * FROM gahk_admin_user INNER JOIN intern_alumne ON gahk_admin_user.alumne_id = intern_alumne.ID WHERE email = '$email' AND password = '$passwordhash'` (`adminuser_model.php:13`). Selected row supplies session values `email`, `administrator`, `editpage`, `indstilling`, `alumne_id`, `firstName`+`lastName`, `ak`, `oelkaelder`.
  - **Alumne search** (`alumneSearch`, `adduseradm`): `SELECT id, concat(firstName,' ',lastName) AS label FROM intern_alumne WHERE CONCAT(firstName,' ',lastName) like '%$searchWord%'` (`adminuser_model.php:18`).
  - **List admin-users** (`useradm`): `SELECT gahk_admin_user.id, firstName, lastName, gahk_admin_user.* FROM gahk_admin_user INNER JOIN intern_alumne ON gahk_admin_user.alumne_id = intern_alumne.ID ORDER BY firstName` (`adminuser_model.php:33`).
  - **Current roster** (`addAllUserAdm`): newest `monthNumber` from `intern_alumne_liste`, then `SELECT alumne_ID, workgroup FROM intern_alumne_liste WHERE monthNumber = $month` (`adminuser_model.php:50-56`).
  - **Counter** (constructor, every hit): `gahk_counter` by `ip`, `gahk_counterdato` by `dato`.
  - **Dashboard stats:** `getCounterStatistic()` reads `gahk_counterdato` once per day for 31 days; `getAngsoegningStatistic()` runs `SELECT * FROM gahk_ansoegninger WHERE timestamp > ... AND timestamp < ... AND typeOfAnsoegning = '$type'` and returns `num_rows()`, 18 times (`ansoegninger_model.php:55-60`).
- **Writes:**
  - **INSERT `gahk_counter`** (new IP) / **UPDATE `gahk_counter`** (existing IP, >30 min since last) — constructor counter on **every** action (`MY_Controller::counter()`, `01-infrastructure.md` A9).
  - **INSERT `gahk_counterdato`** (new date) / **UPDATE `gahk_counterdato`** (existing date) — when `needCountByDate` set.
  - **INSERT `gahk_admin_user`** — `adduseradm`, when exactly one alumne matches: `db->insert('gahk_admin_user', $_POST)` with `$_POST['fullname']` unset and `$_POST['alumne_id']` set to the matched alumne id (`admin.php:285-288`, `adminuser_model.php:37-39`). ⚠ Whole-array mass-assignment.
  - **DELETE `gahk_admin_user`** — `deleteuseradm($id)`: `db->delete('gahk_admin_user', array('id'=>$id))` (`adminuser_model.php:41-43`).
  - **`addAllUserAdm` (multi-step rebuild):**
    1. List all admin-users; for each whose `alumne_id != session.alumne_id`, **DELETE** it (`admin.php:306-310`).
    2. For each roster row (newest `monthNumber`) whose `alumne_ID != session.alumne_id`, **INSERT `gahk_admin_user`** with a hardcoded role tuple by `workgroup` via `addUserAdmAll(...)` — raw `INSERT INTO gahk_admin_user(alumne_id, editpage, indstilling, administrator, ak, inspektion, kokkengruppe, oelkaelder) VALUES (...)` (`adminuser_model.php:58-60`). Workgroup→roles map: Køkkengruppen→`kokkengruppe=1`; Inspektionen→`inspektion=1`; Indstillingen→`indstilling=1`; Ølkælderen→`oelkaelder=1`; AK-gruppen→`ak=1`; Netværksgruppen→all seven roles=1. **Other workgroups insert nothing** (no `else`).
- **Transactions / ordering:** none. All tables are **MyISAM** (no transactions). `addAllUserAdm` is a destructive delete-then-reinsert with **no atomicity**: a failure mid-loop leaves the admin-user table partially wiped. The current user's own row is preserved by the `alumne_id` guards (delete) but is **also** skipped on re-insert, so it is never re-derived from the roster.

## Business logic
- **`index`**: read 6 session keys. If no `username` → call `login()` (renders the login view inline). Else render `adminHeader` + `dashboard` + `bottom`, passing `getCounterStatistic()` (31-day visit graph) and two `getAngsoegningStatistic(...)` strings (rundvisning, fremleje).
- **`login`**: `form_validation` requires `email`+`password`. On invalid → show form. On valid → `Adminuser_model->login(email, sha256(password))`:
  ```
  if result rows > 0:
     set session: username=email, administrator, editpage, indstilling,
                   alumne_id, fullname=first+" "+last, akRole=ak, oelkaelder
     redirect(current uri)            # back to whatever action invoked login()
  else:
     showError = true; re-render form
  ```
  Note: session keys `inspektion` and `kokkengruppe` are **never set at login** (read elsewhere but absent) — see Quirks.
- **`useradm`**: requires `username`; then `if administrator != 1 → echo "Ingen adgang"` (no markup, just a string); else load flashdata banners + `listAllAdminUser()` and render the management view.
- **`adduseradm`** (POST): requires `username` (any role) and `fullname`. Searches alumni by `fullname`; **0 matches** → flash "not found"; **>1** → flash "be more specific"; **exactly 1** → unset `fullname`, set `alumne_id`, insert `$_POST` as a new `gahk_admin_user`, flash success. Always `redirect("admin/useradm")`.
- **`addAllUserAdm`**: requires `username` (any role). Performs the delete-then-reinsert rebuild described above, flashes success, redirects to `admin/useradm`.
- **`deleteuseradm($id)`**: requires `username` (any role). If `$id` truthy, set flash success **then** delete (flash is set even though delete could fail silently). Redirect `admin/useradm`.
- **`alumneSearch`**: requires `username`. Echoes `json_encode(searchOnAlumne($_GET['term']))`. (Used by jQuery UI autocomplete in `useradm.php`.)
- **`sendMail`**: **no auth**. Iterates a hardcoded map of 13 office-group→email pairs and calls `mail()` (PHP built-in, via `mailFormatted()`) for each, substituting `{gruppe}`. Echoes the concatenated boolean return values.
- **`getAngsoegningStatistic($type)`**: **no auth** (also a public action because it is `public`). Builds an 18-month count string for the given `typeOfAnsoegning`.

## Outputs & side effects
- **Renders:** dashboard (`admin/dashboard.php` — static welcome text; the passed stats are **not displayed** there, the stat-box views are commented out), login form (`admin/login.php`), user-admin page (`admin/useradm.php`). All wrapped by `layout/adminHeader.php` + `layout/bottom.php`. `adminHeader` shows the edit-page nav only if `editpage=="1"`, and an "Administrer brugere" link only if `administrator==1`.
- **Redirects:** `login` success → `current_url`/uri string; `logout` → `/admin`; `adduseradm`/`addAllUserAdm`/`deleteuseradm` → `admin/useradm`.
- **Echoed (non-view) output:** `useradm` access denied → bare `"Ingen adgang"`; `alumneSearch` → JSON; `sendMail` → space-separated `1`/`0` send results; `getAngsoegningStatistic` → a `[['Y-m-d', n],...]` string.
- **Emails:** `sendMail` sends 13 plaintext UTF-8 mails via PHP `mail()` with `From: interngahk@gahk.dk` to the office-group addresses (ak@, indstillingen@, inspektionen@, kulturgruppen@, kokken@, legat@, it@, pr@, pylon@, regnskab@, repperne@, vicevaert@, bierkeller@ — all `@gahk.dk`).
- **Session values set:** on login (8 keys, listed above). `logout` calls `sess_destroy()` + `session_unset()`.
- **Headers:** `session_start()` in constructor; CI no-cache headers from `MY_Controller` (`01-infrastructure.md` A9).
- **DB side effects:** visit counter write on every hit (`gahk_counter`/`gahk_counterdato`).

## Dependencies
- **Cross-cutting infra used:** `MY_Controller` base — visit counter (`counter()`, writes `gahk_counter`/`gahk_counterdato`) and the disabled application-reminder mail (`sendAnsoegningPaamindelseIfTime()`), CI DB sessions, `gahk_helper` — all per `01-infrastructure.md` A4/A9.
- **Models:** `Adminuser_model`, `Ansoegninger_model`, `Counter_model`.
- **Libraries/helpers:** `form_validation`, `session`, `form` helper, `cookie` helper (loaded by `Adminuser_model`, used only by the unused `loginSession()`).
- **External services:** PHP `mail()` (local MTA), **not** the CI Email/one.com SMTP path used elsewhere (`01-infrastructure.md` A6).

## Security findings
| Issue | Location | Severity | Note |
|---|---|---|---|
| SQL injection in login | `adminuser_model.php:13` (`email`/`passwordhash` interpolated) | **High** | `$_POST['email']` raw in WHERE → auth bypass / data exfil; hash limits password leg only |
| SQL injection in alumne search | `adminuser_model.php:18` (`$searchWord` raw in LIKE) | **High** | `$_GET['term']` / `$_POST['fullname']` raw, logged-in but low-priv users reach it |
| SQL injection in stats | `ansoegninger_model.php:50,58` (`$typeOfAnsoegning` raw) | **High** | route seg of `getAngsoegningStatistic` is unauthenticated |
| Mass-assignment on role grant | `admin.php:288` + `adminuser_model.php:37` (`db->insert('gahk_admin_user', $_POST)`) | **High** | any logged-in user can POST arbitrary role columns (incl. `administrator=1`, even `id`) |
| Privilege escalation via `adduseradm`/`addAllUserAdm`/`deleteuseradm` | `admin.php:266,299,334` (gate is only `if($username)`) | **High** | role-management actions require *any* login, not `administrator==1` like `useradm` |
| Unauthenticated mass mailout | `admin.php:96-131` (`sendMail`, no auth) | **High** | anyone can POST `/admin/sendMail` and spam all 13 office groups (no rate-limit/CSRF) |
| Unauthenticated statistics endpoint | `admin.php:218` (`getAngsoegningStatistic` public, no auth) | **Medium** | leaks application volume; also an unauth SQLi vector |
| Unsalted SHA-256 passwords | `admin.php:67`, `intern_alumne.password` | **High** | fast, unsalted hash; trivially rainbow-tableable |
| No CSRF protection | all POST + state-changing GETs (`deleteuseradm`, `addAllUserAdm`) | **Medium** | `csrf_protection=false` site-wide (`01-infrastructure.md` A4); destructive ops on GET |
| Stored XSS in `useradm` banners | `useradm.php:45,50` (`$success`/`$fejl` echoed unescaped) | **Low** | flash content is server-set here, but pattern is unsafe |
| Email header injection (low exposure) | `mailFormatted()` `admin.php:133-139` | **Low** | recipients/body are hardcoded, so not currently reachable, but `mail()` is used with manual headers |
| Verbose SQL error surface | CI `db_debug` default | **Medium** | injection errors likely echoed (inherited, `01-infrastructure.md`) |

## Quirks, edge cases & suspected bugs
- **Inconsistent authorization:** only `useradm` (the *view*) enforces `administrator==1`. The actual mutators (`adduseradm`, `addAllUserAdm`, `deleteuseradm`) check **only** `if($username)`. So any logged-in alumne (e.g. an ølkælder member) can grant themselves super-admin via a crafted POST — the UI hides it, the controller does not. ⚠ Almost certainly unintended.
- **`sendMail` and `getAngsoegningStatistic` are unauthenticated** because they are `public` methods with no session check (unlike every other sensitive method). The mailout is fired by an AJAX `POST` from `useradm.php` (behind the admin UI), but the endpoint itself is open. ⚠
- **Login never sets `inspektion` or `kokkengruppe` session keys**, yet `useradm()` reads `inspektion` (and passes it to the view) and the roster sync writes those columns. So a logged-in user's `inspektion`/`kokkengruppe` session values are always null/empty regardless of their DB row. ⚠ Likely a bug.
- **Dashboard discards its stats:** `index` computes `getCounterStatistic()` + two application stats and passes them to the view, but `dashboard.php` renders only static welcome text; the stat-box `load->view` lines are commented out (`admin.php:42-43`). The 31-day counter loop + 36 application-count queries run on **every** dashboard load for nothing.
- **`addAllUserAdm` skips the current user on re-insert**, not just on delete — so the operator's own roles are preserved as-is (their old row survives) but are never reconciled with the roster. Roster workgroups outside the six mapped names insert nothing (no default branch).
- **`deleteuseradm` sets the success flash before deleting**, so the UI reports success even if the delete affects 0 rows.
- **`getAngsoegningStatistic` arg is required** (no default); calling `/admin/getAngsoegningStatistic` with no segment is a PHP missing-argument error/warning.
- **CI does not enforce HTTP method**, so e.g. `sendMail` can be triggered by GET too; the "POST" labels reflect only how the views call them.
- **Mojibake risk:** `gahk_admin_user`/`gahk_counter*`/`gahk_ansoegninger` are `latin1_swedish_ci` while `intern_alumne`/`intern_alumne_liste` are `utf8mb3_danish_ci`; cross-charset joins (login, list) need careful latin1↔utf8 handling in ETL (`01-infrastructure.md` A2).
- `Adminuser_model::loginSession()` (cookie/`intern_alumne_sessions`-based) is loaded-helper-ready but **never used** by this controller — dead path here.

## Reimplementation notes (Django)
- **Views:** a login view (Django auth), a dashboard `TemplateView`, an admin-only `ListView`+create/delete for admin-users, the JSON autocomplete as a small endpoint, and the stats as a method/endpoint. Use Django `ModelForm` with explicit fields to kill the mass-assignment, and the ORM to kill every raw-SQL injection.
- **Models:** `gahk_admin_user` (one-to-one-ish to `intern_alumne` via `alumne_id`), reuse the `Ansoegning` model from F-001 for stats, counter models from the infra spec.
- **PRESERVE (record + confirm first):** the `/admin/*` URL shape; the role-checkbox semantics and the workgroup→roles map in `addAllUserAdm`; the office-group email map; the "same credentials as intern" login.
- **FIX (after diff-test confirms current behavior):** require `administrator==1` (or per-role) on **all** mutators; authenticate `sendMail`/`getAngsoegningStatistic`; migrate sha256→Django PBKDF2/argon2; add CSRF; make destructive ops POST-only; restore (or delete) the dashboard stat boxes; set `inspektion`/`kokkengruppe` consistently.

## Open questions
- Is the unauthenticated `sendMail`/`getAngsoegningStatistic` intentional (cron/external trigger) or oversight? Confirm before locking down.
- Are the missing `inspektion`/`kokkengruppe` session keys at login relied on anywhere downstream (any controller treating "no key" as "no access" by design)?
- Should `addAllUserAdm` re-derive the current operator's roles from the roster too, or is preserving their existing row deliberate?
- For roster workgroups not in the six mapped names, is "grant no roles" the intended behavior?
- Should the dashboard statistics (visit graph, application counts) be restored, or are the commented-out boxes intentionally retired?
- Retention/GDPR: `gahk_counter` stores raw visitor IPs indefinitely — is there a retention policy?
