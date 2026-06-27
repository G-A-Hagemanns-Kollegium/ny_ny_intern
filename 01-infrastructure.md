# 01 — Shared Infrastructure Spec

Cross-cutting machinery that per-feature specs (Phase 2) reference instead of re-describing.
**Analysis only — no Django code, no fixes recorded as fixes.** Reimplementation notes describe
*where* a concern lands in the target stack, not how to build it.

> **Provenance.** This is the finalized version of `01-infrastructure-spec-draft.md`. Every
> `[VERIFY]` / `[NEEDS SOURCE]` marker in the draft has been resolved against the actual source.
> Claims below carry `file:line` references and are verified unless explicitly marked
> **`[UNRESOLVED]`**. Files read to finalize:
> `index.php`, root `.htaccess`, `application/config/{database,config,autoload,routes,email,recaptcha}.php`,
> `application/core/MY_Controller.php`, `application/models/{internuser_model,adminuser_model,kvotient_model,oelkaelder_model}.php`,
> `application/controllers/{optagelse,intern/admin}.php`, `application/helpers/gahk_helper.php`,
> `intern/delt.php`, `intern/alumneliste/{liste.php,evalPostArray.php}`, `wiki/LocalSettings.php`.
> The draft (`01-infrastructure-spec-draft.md`) is now superseded and can be deleted.

There are **two independent infrastructures** — App A (CodeIgniter) and App B (flat-file). They
**share one database and credentials** but bootstrap, authenticate, and lay out pages entirely
differently. Documented separately below.

---

## Part A — App A (CodeIgniter 2.x)

### A1. Bootstrap & request lifecycle
`index.php` sets `define('ENVIRONMENT','production')` (`index.php:21`) → `error_reporting(0)`
(errors suppressed), then `require_once BASEPATH.'core/CodeIgniter.php'` (`index.php:203`).
`system_path='system'`, `application_folder='application'`.

Root `.htaccess` rewrites everything **except** `index.php|images|public|intern|wiki|robots.txt`
through the front controller (`.htaccess:2-3`) and force-redirects `gahk.dk → https://www.gahk.dk`
(`.htaccess:8-10`). Consequence (unchanged from manifest): `intern/`, `wiki/`, `public/` are served
directly from disk; `application/` is reachable only through CI routing.

`autoload.php` autoloads the **`database` library** (`autoload.php:59`) → a **DB connection opens on
every request** — and the **`url` helper** (`autoload.php:71`). No models, configs, or language
files autoloaded.

Routing (`routes.php`): `default_controller='page/show/1'` (`routes.php:45`); Danish public slugs →
`page/show/N` (`routes.php:46-67`); `admin→admin`, `optagelse→optagelse`, `pylon→pylon/show`. The
internal area is the wildcard **`nyintern/(:any) → intern/$1`** (`routes.php:75-77`), with explicit
`nyintern/mydata` and `nyintern/alumneliste/*` routes ahead of it (`routes.php:71-74`).
`404_override` is empty (`routes.php:68`).

### A2. Database connection — *verified*
`application/config/database.php` (active group `default`):

| Setting | Value | Note |
|---|---|---|
| `dbdriver` | `mysqli` | `database.php:59` |
| `hostname` | `localhost` | `database.php:55` |
| `database` | `gahk_dk` | `database.php:58` |
| `username` | `gahk_dk` | `database.php:56` |
| `password` | `keldogfrederik` | **Plaintext** `database.php:57` — rotate at cutover |
| `pconnect` | `TRUE` | Persistent connections `database.php:61` |
| `db_debug` | `TRUE` | **DB errors surfaced to output** — info-disclosure in prod `database.php:62` |
| `char_set` | `utf8` | `database.php:65` |
| `dbcollat` | `utf8_unicode_ci` | `database.php:66` |
| `stricton` | `FALSE` | No strict mode `database.php:69` |

**Encoding note (resolves draft A2 `[VERIFY]`):** the connection charset is MySQL **`utf8`
(= `utf8mb3`)**, not `utf8mb4` — so any stored 4-byte characters (emoji, some symbols) are
already lossy at the connection layer. The scope's latin1→utf8mb4 migration step must inspect the
**table/column** charsets in the dump (which may differ from this connection charset) — confirm per
table during ETL. *Reimplementation note:* maps to Django `DATABASES['default']` (PostgreSQL,
UTF-8) with all credentials from environment.

### A3. Query layer — *verified*
**No central query helper** — models call `$this->db` directly. Two patterns coexist:

- **Raw interpolated SQL (the norm, SQL-injection exposure).** Example, `oelkaelder_model.php`:
  ```php
  $this->db->query("SELECT * FROM intern_oelkaelder_product WHERE `productId`=$productId"); // :38
  $this->db->query("INSERT INTO `intern_oelkaelder_product` (...) VALUES ('$name','$price',...)"); // :24
  ```
  User-supplied values are concatenated with no escaping/binding. This is representative of
  `adminuser_model`, `internuser_model`, `news_model`, `ansoegninger_model`, etc.
- **Escaped SQL (the exception).** `kvotient_model.php` consistently wraps inputs in
  `$this->db->escape(...)`:
  ```php
  ... WHERE vaerelse_id = ".$this->db->escape($roomNr)." ORDER BY ..." // :21
  ... WHERE applica.ID = ".$this->db->escape($ansoegningsId)            // :39
  ```
  Note even this "safe" model has a latent bug: `:21-22` omits the space before `ORDER BY`
  (`...escape($roomNr)."ORDER BY"`), so the rendered SQL reads `…26ORDER BY`. Escaping ≠ correctness.

*Reimplementation note:* all of this collapses into the Django ORM; the SQL-injection class is
removed **structurally** by parameterised queries. Any unavoidable raw SQL in the new code gets a
manual review as a backstop (scope §5).

### A4. Sessions & authentication — *verified*
**Session config** (`config.php`):

| Setting | Value | Line |
|---|---|---|
| `sess_use_database` | `true` | `:259` |
| `sess_table_name` | `gahk_dk_sessions` | `:260` |
| `sess_cookie_name` | `gahk_dk_session` | `:255` |
| `sess_expiration` | `7200` (2 h) | `:256` |
| `sess_expire_on_close` | `false` | `:257` |
| `sess_encrypt_cookie` | `false` | `:258` — session cookie **not** encrypted |
| `sess_match_ip` | `false` | `:261` |
| `sess_match_useragent` | `true` | `:262` |
| `sess_time_to_update` | `300` | `:263` |
| `encryption_key` | `'gahksessionsecurity'` | `:235` — **weak, hardcoded** |
| `base_url` | `''` (auto-guessed) | `:25` |
| `cookie_secure` | `false` | `:279` — session cookie sent over plain HTTP |
| `csrf_protection` | **`false`** | `:304` — resolves draft `[VERIFY]`: confirmed OFF site-wide |
| `global_xss_filtering` | **`false`** | `:290` — resolves draft `[VERIFY]`: confirmed OFF |
| `log_threshold` | `0` | `:191` — **error logging disabled** |
| `allow_get_array` | `true` | `:165` — `$_GET` permitted alongside segment URLs |

Login state is CI **session userdata**. Per `MY_Controller::showInternPage()`
(`MY_Controller.php:14-32`) the keys are: `username`, `fullname`, `alumne_id`, `akRole`,
`indstilling`, `inspektion`, `kokkengruppe`, `oelkaelder`, `administrator`. (`editpage` is also used
as a flag by the public-admin views — see A5.) These double as the role flags.

**Password storage (resolves draft `[NEEDS SOURCE]` + `[VERIFY]` salting):**
- **Storage is unsalted `sha256`**, in `intern_alumne.password`, **shared by both internal users and
  admins**. `internuser_model::changePassword()` writes `hash("sha256",$newpass)` with no salt
  (`internuser_model.php:109,113`); login compares `password = '$passwordhash'` against a hash
  passed in by the controller (`internuser_model.php:14`).
- **Admin auth uses the same `intern_alumne.password` hash**, joined to the role table:
  `adminuser_model::login()` does
  `SELECT * FROM gahk_admin_user INNER JOIN intern_alumne ON gahk_admin_user.alumne_id = intern_alumne.ID WHERE email='$email' AND password='$passwordhash'`
  (`adminuser_model.php:13`). So there is **no separate admin password** — admin = an `intern_alumne`
  row that also has a `gahk_admin_user` row.
- **Login resolution order** (`intern/admin.php::login()`, `:113-156`): try cookie-token login
  (`Adminuser_model->loginSession()` then `Internuser_model->loginSession()`), else form login —
  `Adminuser_model->login($email, hash('sha256',$password))` first, falling back to
  `Internuser_model->login(...)`. `startSession()` (`:170-191`) sets the base userdata for everyone
  and the role flags **only when `$result[0]->ak` is set** (i.e. when a `gahk_admin_user` row was
  joined, `:176-184`) — this is how "is this user an admin?" is decided.
- Both login queries are **raw-interpolated** (SQLi) and key off the hash, so the hashing happens in
  the controller before the query.
- **Forgot/reset-password flow** (`intern/admin.php`, *now resolved against source*):
  `receivedmail()` issues a reset link keyed on `$key = sha1(time())` (`:240`) — a **predictable,
  second-granularity token with no secret and no observed expiry** — stored via
  `addForgotPasswordLink()` and emailed. `resetpass()` then sets the new password to
  `random_int(5,10000)."#glemaldrig"` (`:301`) — a **~10,000-value space with a fixed known suffix**,
  stored as unsalted sha256 (`:303`) and **displayed in plaintext** to whoever opens the link
  (`vispass.php`, `:310`). `receivedmail()` also returns a different message for unknown emails
  (`:264`) → **account enumeration**. The lookup query interpolates the link id (SQLi, per A3).

*Reimplementation note:* migrate with a custom Django hasher that recognises the legacy unsalted
sha256 and **transparently upgrades each user's hash on next successful login** (scope §5). Because
admin and member identities share `intern_alumne`, model them as one user table with a role/grant
relation (the `gahk_admin_user` flags), not two user types.

**Internal-area session token (separate from CI sessions):** `internuser_model` also maintains its
own cookie-based token in `intern_alumne_sessions`: `createSession()` stores
`hash('sha256', $alumneId." ".microtime()." ".rand(0,1000))` in a `session_token` cookie
(`internuser_model.php:50-64`); `loginSession()`/`clearSession()` read/clear it
(`internuser_model.php:28-48`). So the internal area has **two overlapping session mechanisms** (CI
DB sessions + this token) — both must be accounted for when porting `nyintern` auth.

### A5. Authorization / roles — *verified pattern*
No central policy layer — authorization is **ad hoc per controller**, reading the session flags
(A4) and the `gahk_admin_user` columns. The role columns are enumerated by
`adminuser_model::addUserAdmAll()` (`adminuser_model.php:58-60`):
`editpage, indstilling, administrator, ak, inspektion, kokkengruppe, oelkaelder`.

Known checks (from the manifest; record as findings, **do not fix here**):
- `username`+`editpage` → CMS edit (page/news/pylon).
- `oelkaelder` → shop admin; `akRole` → duty admin; `indstilling`/`inspektion`/`kokkengruppe` →
  alumni-list actions.
- **Broken/missing:** `oelkaelder/purchase` auth **commented out**; `news/delete`, `admin/sendMail`,
  and several `statistik` JSON feeders have **no auth**; `soegvaerelse`/`vaerelsestjek` admin use the
  buggy `!$username && !empty($role)` idiom (passes when logged-out *and* role-empty — i.e. lets
  unauthenticated through); `alumneliste/json` gated only by `insideGAHK()` IP, not login.

*Reimplementation note:* replace with Django auth + per-view permission decorators/mixins; the seven
boolean columns become groups/permissions. The scattered, partly-inverted checks become one
coherent, testable policy.

### A6. Global config & custom configs — *verified*
- `email.php` defines a **custom** `$config['smtp']` array (`email.php:3-7`): `smtp_user=autosvar@gahk.dk`,
  `smtp_host=mailout.one.com`, `smtp_pass=autosvar2020` — **plaintext**. Note this is *not* CI's
  standard email-config key set, so the CI `Email` library is configured in code, not from this file.
- `recaptcha.php` (`recaptcha.php:4-14`) holds **both** key generations in plaintext:
  - **v1** `public`/`private` (`6Lf3…`) pointing at `api.recaptcha.net` / `api-verify.recaptcha.net`
    — the **dead** v1 service.
  - **v2** `recaptcha_site_key`/`recaptcha_secret_key` (`6LfX…`), `recaptcha_lang='en'`,
    `theme='custom'`.
- `constants.php` and the remaining `config/*` files are CI 2.x defaults, unchanged.
  `language='danish'` (`config.php:80`), `subclass_prefix='MY_'` (`config.php:117`),
  `enable_hooks=false` (`config.php:102`).

### A7. Input handling — *verified, inconsistent*
With `global_xss_filtering=false` and `csrf_protection=false` (A4) there is **no framework-wide
input sanitization or CSRF token**. Handling is **per-controller and inconsistent**:
- `optagelse::send_rundvisning()` **does** sanitize before persisting:
  `$_POST = $this->security->xss_clean($_POST)` (`optagelse.php:78`), and uses `form_validation`
  rules + a `callback_validateCaptcha` (`optagelse.php:62-73`). So the public forms are partly
  defended.
- Most models (A3) read `$_GET`/`$_POST` and interpolate directly with no escaping. `kvotient_model`
  escapes; nothing else observed does.

*Reimplementation note:* Django gives CSRF tokens, template auto-escaping, and ORM binding by
default — this entire inconsistency disappears, but the per-feature specs should still record which
inputs were historically unvalidated so behaviour (e.g. accepted formats) is preserved intentionally.

### A8. Shared layout — *verified*
Two layout families, both opening a `.container` `<div>` that is only closed by `layout/bottom.php`:
- **Public:** `layout/head.php` (CSS/JS, injects `$bgpic`) → `layout/header.php` (+ `submenu.php`,
  nav by `$menucat`) → content → `layout/footer.php` (**effectively a no-op — body commented out**) →
  `layout/bottom.php` (closing tags).
- **Admin:** `layout/adminHeader.php` (+ `adminSubmenu.php`, near-duplicate of `submenu.php`).
- **Internal (`nyintern`):** `views/intern/header.php` + `footer.php`, emitted by
  `MY_Controller::showInternPage()` (`MY_Controller.php:35-37`) using the session userdata in A4.
- Shared content partial: `standart_page_setup.php` (loops `$page` rows; renders contenteditable vs
  read-only by `$editable`).

*Reimplementation note:* collapses to one Django base template + `{% block %}`s; the
public/admin/intern split becomes template inheritance. The implicit "header opens a div, bottom
closes it" coupling becomes a single layout block and stops being a footgun.

### A9. Common helpers / base controller — *verified*
- **`MY_Controller`** (base for all controllers, `MY_Controller.php`): in `__construct()` loads the
  `session` library + `gahk_helper` (`:8-9`). Provides:
  - `showInternPage()` — the intern layout wrapper (A8).
  - `counter()` — per-IP/date **visit counter** writing `gahk_counter` / `gahk_counterdato`
    (`:45-110`).
  - `sendAnsoegningPaamindelseIfTime()` — weekly reminder mail; **the actual send is commented out**
    (`:117-120`), so it is currently inert.
  - **Side-effect note:** `counter()` is invoked from controller constructors, so it fires on
    ordinary page loads — confirmed in **both** `page` (manifest) and `optagelse` (`optagelse.php:23`).
    Treat the counter as request middleware, not page logic, when porting.
- **`gahk_helper.php`:** `insideGAHK()` checks `REMOTE_ADDR` against **6 hardcoded campus IPs**
  (`gahk_helper.php:4`: `130.225.243.26`, `192.38.116.242-246`). `isInspektion()` is **dead/broken**
  — it calls `$this->session->...` from a plain function with no `$this` (`gahk_helper.php:13-15`).
- **`oelkaelder_helper.php`:** money utils (price string ↔ øre).
- **`GahkTree.php`:** simple tree-node class (stamtree/menu).
- **reCAPTCHA library (resolves draft A9 `[VERIFY]`):** `recaptcha.php` is **the one actually
  loaded** — `optagelse` calls `$this->load->library('recaptcha')` (`optagelse.php:24`) and uses
  `$this->recaptcha->getWidget()` (`optagelse.php:42`). `recaptchassl.php` declares the **same class
  name `Recaptcha`** and is **not loaded** anywhere observed (dead duplicate; would fatally collide
  if both were loaded).

*Reimplementation note:* the counter and reminder become a middleware + a scheduled task;
`insideGAHK()`/`atGAHK()` (the same 6-IP list duplicated in App B — see B1) becomes one small
reusable "on-campus" check; the captcha is replaced wholesale (scope §4).

### A10. Cross-cutting security findings (App A) — *verified, with refs*
| Issue | Location | Severity | Note |
|---|---|---|---|
| Plaintext DB password | `config/database.php:57` | High | `keldogfrederik`; rotate at cutover |
| Plaintext SMTP creds | `config/email.php:4-6` | High | `autosvar2020`; rotate |
| Plaintext captcha keys (v1+v2) | `config/recaptcha.php:5-11` | Medium | v1 dead; rotate v2 |
| Weak hardcoded session encryption key | `config/config.php:235` | High | `'gahksessionsecurity'` |
| CSRF protection disabled site-wide | `config/config.php:304` | High | Confirmed `false` |
| Global XSS filtering disabled | `config/config.php:290` | Medium | Confirmed `false`; per-form xss_clean is inconsistent |
| Session cookie not secure / not encrypted | `config/config.php:279,258` | Medium | `cookie_secure=false`, `sess_encrypt_cookie=false` |
| `db_debug=TRUE` in production | `config/database.php:62` | Medium | Leaks DB errors to output |
| Error logging disabled | `config/config.php:191` | Low | `log_threshold=0` — no audit trail |
| Raw interpolated SQL (most models) | `application/models/*` (e.g. `oelkaelder_model.php:24,38`) | High | SQLi; ORM removes structurally |
| Unsalted sha256 password storage | `internuser_model.php:109,113`; `adminuser_model.php:13` | High | Shared `intern_alumne.password`; rehash-on-login at migration |
| Weak reset flow: guessable temp pw + predictable `sha1(time())` link + plaintext display + no expiry + user enumeration | `intern/admin.php:240,264,301-310` | High | ~10k-value temp pw with fixed suffix; token has no secret |
| Missing/disabled/inverted auth checks | see A5 | High | Several live endpoints |
| `phpinfo()` endpoint | `controllers/phpinfo.php` | High | Delete now (interim hardening, scope §8) |
| Duplicate `Recaptcha` class | `libraries/recaptcha.php` + `recaptchassl.php` | Low | `recaptchassl.php` is dead; remove |

---

## Part B — App B (flat-file `intern/`)

### B1. Bootstrap — *verified*
No framework. Every page `include`s **`intern/delt.php`** (the linchpin). Pages are served directly
from disk (the `.htaccess` carve-out, A1), so each `.php` is its own entry point. The DB layer is
**ADOdb** (bundled), connected with the **removed `mysql` driver**: e.g. `liste.php:18-23`
`include('../adodb5/adodb.inc.php'); $db = ADONewConnection('mysql'); $db->Connect('localhost',
$username,$password,$database); $db->Execute("SET NAMES utf8");`. (`intern/mailliste/*` uses the even
older raw `mysql_*` API.)

**`delt.php` contents (resolves draft `[NEEDS SOURCE]`):**
- **Shared DB credentials — identical to App A:** `$username='gahk_dk'`, `$password='keldogfrederik'`,
  `$database='gahk_dk'` (`delt.php:15-17`). **Both apps talk to the same MySQL DB with the same
  account** — important for the ETL and for rotation (one password change breaks both).
- **`atGAHK()`** — the same 6-IP campus allowlist as App A's `insideGAHK()` (`delt.php:22-30`).
- **Static domain data:** room map (`$roomFloor/$roomSide/$roomDescription/$room_number`,
  `delt.php:34-105`), `$monthName` (`:107`), `translate()` field-name map (`:283-290`).
- **Helper library (function-based layout + utils):** `insertHeader()`/`insertFooter()` (`:128-164`),
  `selector()`, `createDataTable()` (`:292-334`), `mailFormatted()`/`mailFormatted2()` (`:338-360`),
  `replaceTagsWithValues*()` (`:363-385`), `genRandomString()`, monthnumber math (`mn2mstr` etc.),
  `reduceArrayArray`, `sortArray`, `shortenName`, …

### B2. Authentication & authorization — *verified*
**No sessions, no per-user identity.** A typed password is compared with `===` against a `delt.php`
variable and **re-posted as a hidden field** on each action. The **8 passwords and the tier model**:

| Variable (`delt.php`) | Value | Unlocks |
|---|---|---|
| `$userpassword` | `ymer` (`:10`) | Normal user view (also granted by `atGAHK()` IP with no password) |
| `$adminpassword_indstillingen` | `Numedtinder` (`:3`) | Alumni-list admin (indstillingen) |
| `$adminpassword_inspection` | `blomsterbørn` (`:5`) | Inspektion & køkkengruppe admin |
| `$adminpassword_network` | `9e51…50eb` *(sha256)* (`:4`) | Network group (brotherc) |
| `$adminpassword_mailall` | `abemad` (`:6`) | Mass-mail site |
| `$adminpassword_forbrug` | `el` (`:7`) | Electricity-consumption admin |
| `$adminpassword_handbook` | `disko` (`:8`) | Handbook admin |
| `$adminpassword_pylon` | `annebo` (`:9`) | Pylon list admin |

The access ladder is computed inline per page; canonical example `alumneliste/liste.php:4-8`:
```php
$access=0;
if($_POST["typedpassword"]===$userpassword || (!$_POST["typedpassword"] && atGAHK())) $access=1; // user / on-campus
if($_POST["typedpassword"]===$adminpassword_indstillingen) $access=2;  // admin indstillingen
if($_POST["typedpassword"]===$adminpassword_inspection)    $access=3;  // admin inspektionen
```
The cleartext password is then **echoed back into a hidden form field** so it survives the next POST
— `createDataTable()` emits `<input type="hidden" name="typedpassword" value="$_POST[typedpassword]">`
(`delt.php:296`). So the shared password travels in page source, browser history, and any proxy logs.
`$userpassword` (`ymer`) is the same literal hardcoded in `telefonliste/index.php`'s scraper (manifest).

### B3. Query layer & input handling — *verified*
**Pervasive SQL injection** via raw `$_GET`/`$_POST`/`$month` interpolation across the tree. The
worst case interpolates **table *and* column identifiers** from `$_POST`-derived names —
`evalPostArray.php:21`:
```php
$categories = $db->GetAll("SELECT $origVar FROM intern_alumne_$origVar WHERE $origVar='$newWorkgroup'");
```
Other representative sinks in the same file: `DELETE FROM intern_alumne_liste WHERE monthNumber='$month'
AND alumne_ID='$alumneToDel'` (`:53`), `DELETE FROM intern_alumne_workgroup WHERE ID='".$_POST["workgroupToDelete"]."'`
(`:91`). `AutoExecute('intern_alumne', $alumne, 'INSERT'/'UPDATE', ...)` passes a whole
`$_POST`-derived array straight to the row (`:35,136-137`) — mass-assignment + injection surface.
Also note a literal source bug at `:36` — `if($alumne[\ADDTOTHISLIST])` — an undefined/garbage
expression guarding the "add to list" branch.

Additional input-borne issues at the infrastructure level:
- `insertHeader()` echoes `$_GET['errorMessage']` unescaped via `redText()` (`delt.php:156-159`,
  `109-114`) → **reflected XSS on every App B page** (and `liste.php:83` builds redirect URLs that
  feed this param).
- `mailFormatted2()` sets the `From:` header from a caller-supplied value (`delt.php:353`) → header
  injection / spoofing if that value is ever user-influenced.
- `handbook/index` renders stored HTML **unescaped** (stored XSS — manifest).

### B4. Layout — *verified*
Emitted by `insertHeader()`/`insertFooter()` in `delt.php` (function-based, not template files).
`insertHeader()` writes an XHTML-Strict doctype, links `intern/menu/menu_style.css`, optionally
`include`s `../menu/menu.php`, prints the title, and dumps `$_GET['errorMessage']` (B3)
(`delt.php:128-160`). `insertFooter()` emits only `</html>` — **malformed** (no `</body>`)
(`delt.php:162-164`). `intern/menu/menu.php` is **fully commented out** (renders empty). Per-module
`head.php` fragments exist for `alumneliste` and `pylon`.

### B5. Notable infrastructure-level risks (App B) — *verified*
- `delt.php` (and its stray copies `.../alumneliste/config.php`, `.../mydata/delt.php`) **leak all
  secrets** — DB creds + the 8 passwords above. Treat as compromised.
- **One DB account shared by both apps** (`delt.php:15-17` == `database.php:55-58`): rotating
  `gahk_dk`'s password must update App A config *and* `delt.php` in the same change window.
- **Unrestricted file upload** (client-controlled basename) in `handbook/admin` and
  `mailliste/mailadmin` → **RCE risk** (manifest).
- **Open mass-mailers** (`alumneliste/mailAll*`, `mailliste/mailadmin`, plus App A `admin/sendMail`),
  all behind only a shared cleartext password — domain-reputation/abuse risk.
- **`kvotient/seAnsoegninger` can `TRUNCATE intern_kvotient` on POST** (manifest).
- **MAC-address network access** (`mydata/*`, incl. `approved.php` gated by the plaintext URL
  password `?password=mLXAC6V2wf`) — **confirmed no longer used** (project owner, 2026-06). Retire
  and delete with the rest of App B; **do not port**. There is no consumer (router/RADIUS) to
  coordinate with. This also retires App A's `nyintern/mydata` controller and its rendered view.
- `telefonliste/index.php` opens a raw socket to www.gahk.dk and POSTs the hardcoded `$userpassword`
  (`ymer`) to scrape `alumneliste/liste.php` — fragile screen-scrape; uniquely does **not** include
  `delt.php`.
- ADOdb runs on the **removed `mysql` driver** (`liste.php:19`); `mailliste/*` on raw `mysql_*` —
  neither exists in modern PHP, so this tree is also a **time bomb on any PHP upgrade**, independent
  of the rewrite.

> App B is destined for retirement (scope §3). With the **MAC feature now confirmed unused
> (2026-06)** — previously the one likely port candidate — **no App B endpoint is currently
> identified for porting**; the tree retires once interim hardening (scope §8) is in place and the
> access logs confirm nothing else is in active use. This section now exists chiefly to drive that
> interim hardening.

---

## C. Shared facts that shape the whole rewrite
1. **One database, one account, THREE apps.** `gahk_dk` (user `gahk_dk` / `keldogfrederik`) is
   shared by App A, App B, **and MediaWiki** — `LocalSettings.php` has `$wgDBname='gahk_dk'`,
   `$wgDBuser='gahk_dk'`, `$wgDBprefix='wiki'` (`wiki/LocalSettings.php:56-62`). So the wiki's tables
   live in the same database, namespaced by the `wiki` prefix. Implications: (a) the Postgres ETL
   must **carve out the `wiki*`-prefixed tables** and leave them on MariaDB (scope §6); (b) rotating
   the `gahk_dk` password breaks **all three** apps at once — coordinate App A config, `delt.php`,
   and `LocalSettings.php` in one change window.
2. **Connection charset is `utf8mb3`** — plan the utf8mb4 widening and check per-table charsets in
   the dump, don't trust the connection setting.
3. **Two session systems in `nyintern`** — CI DB sessions (`gahk_dk_sessions`) *and* the
   `intern_alumne_sessions` cookie token. Both feed "is this user logged in?".
4. **Identity is unified, roles are a side table** — admins are `intern_alumne` rows with a
   `gahk_admin_user` grant; passwords are unsalted sha256 in `intern_alumne`. One user model + a
   permission relation, with rehash-on-login.
5. **The `atGAHK()`/`insideGAHK()` 6-IP campus check is duplicated** across both apps and is used as
   an *authorization* shortcut in several places — it becomes one reusable check, but note it is IP
   trust, not authentication.

## D. Remaining unknowns (carry into Phase 2 / scope §9)
- ~~`intern/admin::resetpass` exact temp-password logic~~ — **RESOLVED** against `intern/admin.php`
  (see A4 / A10): guessable temp pw + predictable `sha1(time())` link + plaintext display + user enumeration.
- ~~Whether MediaWiki shares `gahk_dk` or has its own DB~~ — **RESOLVED**: it **shares `gahk_dk`**
  (user `gahk_dk`, table prefix `wiki`; `wiki/LocalSettings.php:56-62`). Carve the `wiki*` tables out
  of the Postgres ETL. *(Wiki↔members login integration is still open — scope §9; the separate
  `wiki`-prefixed user tables imply standalone auth, but confirm no SSO extension in LocalSettings.)*
- ~~Confirmed consumer of `mydata/approved.php`~~ — **RESOLVED (2026-06): MAC feature no longer
  used. Delete, do not port; no consumer to coordinate with.**
- Whether the access logs show the KCFinder upload path used legitimately by the admin editor —
  scope §8/§9.
