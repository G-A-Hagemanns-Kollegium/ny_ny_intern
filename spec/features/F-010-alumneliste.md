# Feature: Alumneliste — internal alumni/resident directory (App A "nyintern", monthly room/duty list)

- **Feature ID:** F-010
- **Source file(s):**
  - Controller: `application/controllers/intern/alumneliste.php` (CI `MY_Controller` subclass)
  - Model: `application/models/internuser_model.php` — **loaded in the constructor but never actually used by any of this controller's five methods** (dead dependency here; it backs the login/forgot-password flow elsewhere).
  - Views rendered by the controller: `application/views/intern/alumneliste/{liste,json,konfigurer}.php`
    ⚠ **These are NOT proper CodeIgniter views.** They are the OLD flat-file app's PHP scripts, copied wholesale under `views/`. They each **open their own ADOdb MySQL connection** (`include('adodb5/adodb.inc.php'); ADONewConnection(...)`) using **hardcoded DB credentials from `delt.php`**, run **raw, interpolated SQL** directly, perform **INSERT/UPDATE/DELETE writes**, send **email**, emit a **full standalone HTML document** (their own `<!DOCTYPE>`/`<html>`/`<head>` via `insertHeader()`), and even emit `header('Location: ...')` redirects to the OLD `gahk.dk/intern/...` site. The CI controller merely sets a few boolean `$data` flags and renders them.
  - Stray includes pulled in by those views (all under `application/views/intern/alumneliste/`):
    - `delt.php` — hardcoded admin passwords + **plaintext DB credentials**, plus shared helper functions (`insertHeader`, `selector`, `createDataTable`, `mailFormatted`, month-number math, etc.).
    - `config.php` — column/“extra” layout config per access level; `$roomFloor` map (built in `delt.php`).
    - `evalPostArray.php` — the entire POST-action engine for the editable list (add/remove/copy/delete person, edit list, network-status email). Included by `liste.php` when `access==2||3`.
    - `formsAndSubmitButtons.php` — the admin edit forms. Included by `liste.php` when `access==2`.
    - `adodb5/` — a full vendored ADOdb library copied into the views tree.
- **URL / route:** (base route `nyintern/(:any)` → `intern/$1`; explicit routes for the rest — `routes.php:71-77`)
  - `GET  /nyintern/alumneliste` — directory (index)
  - `GET  /nyintern/alumneliste/json` — JSON dump of current month's list
  - `POST /nyintern/alumneliste/closeNetwork` — inspektion/kokkengruppe "close network" editor (route `routes.php:73`)
  - `POST /nyintern/alumneliste/update` — indstilling/inspektion list editor (route `routes.php:74`)
  - `POST /nyintern/alumneliste/configure` — indstilling configuration page (route `routes.php:72`)
  - (Note: forms all submit via `form_open()` = **POST**, but every method also works under **GET**; CI does not bind methods to verbs. The list-month chooser submits POST to `/nyintern/alumneliste`.)
- **HTTP method(s):** GET + POST (CI routes accept both; the stray views branch on `$_POST`/`$_GET`).
- **Access control:** logged-in + role(s), enforced **inline per method** in the controller via `$this->session->userdata(...)` — **with one major exception: `json()` is gated only by `insideGAHK()` (a 6-IP campus allowlist), NOT by login.** See findings.

**Routes / actions:**
| Action | URL | Method | Access | Purpose |
|---|---|---|---|---|
| `index` | `/nyintern/alumneliste` | GET/POST | requires session `username` | render current/selected month directory (`liste.php`, access≤2) |
| `json` | `/nyintern/alumneliste/json` | GET/POST | **`insideGAHK()` IP only — no login** | emit most-recent list as hand-built JSON (`json.php`) |
| `closeNetwork` | `/nyintern/alumneliste/closeNetwork` | POST | `username` AND (`inspektion` OR `kokkengruppe`) | network open/close editor (`liste.php`, access=3) |
| `update` | `/nyintern/alumneliste/update` | POST | `username` AND (`indstilling` OR `inspektion`) | full list editor + add/remove/copy/delete (`liste.php`, access=2) |
| `configure` | `/nyintern/alumneliste/configure` | POST | `username` AND `indstilling` | workgroup/cleaning/email config (`konfigurer.php`) |

## Purpose
From a logged-in resident's perspective: the alumneliste is the internal monthly directory of GAHK residents — who lives in which room, their workgroup (*embedsgruppe*), cleaning duty (*rengøring*), *fylgje* (mentor), birthday, move-in date, study, phone and email — shown as a searchable/exportable DataTable for the most recent (or a chosen) month. Privileged officers get extra modes: *indstillingen* (`update`) can add/remove/copy/delete people and edit the whole list and configure workgroups/cleanings/welcome-emails (`configure`); *inspektionen*/*køkkengruppe* (`closeNetwork`) can toggle each resident's network-closed status (a disciplinary "your internet is cut" flag) and trigger notification emails. A campus-IP machine can also pull the current list as JSON without logging in.

## Inputs
| Name | Source | Type | Required? | Validated/sanitized? | Used for what |
|---|---|---|---|---|---|
| session `username` | CI session | string | yes (all except `json`) | none | login gate; if empty → set flashdata `redirectToUrlAfterLogin=current_url()` and `redirect("nyintern/admin")` |
| session `inspektion` | CI session | flag | yes for `closeNetwork`/`update` | none | role gate; sets access level |
| session `kokkengruppe` | CI session | flag | yes for `closeNetwork` | none | role gate (close-network) |
| session `indstilling` | CI session | flag | yes for `update`/`configure` | none | role gate; enables edit & config |
| caller IP `$_SERVER['REMOTE_ADDR']` | server | string | `json` only | exact match vs 6 hardcoded IPs (`insideGAHK()`, `gahk_helper.php:3-11`) | sole gate on `json` |
| `$_GET['m']` | GET | any (presence) | no | none | "mobile view": forces access=1 + hides menu (`liste.php:16-20`) |
| `$_GET['mostRecentList']` | GET | any (truthy) | no | none | force most-recent month instead of `$_POST['month']` (`liste.php:55`) |
| `$_GET['errorMessage']` | GET | string | no | **none — echoed raw** via `redText()` in `insertHeader()` (`delt.php:159-161`) | error banner (reflected XSS) |
| `$_POST['month']` | POST | int or `"allPersons"` | no | **none — interpolated into SQL** (`liste.php:59,125`) | which monthNumber list to show |
| `$_POST['action']` | POST | string | no | none | dispatches the write engine in `evalPostArray.php` / `konfigurer.php` |
| `$_POST['display']`, `$_POST['tableColumns']`, `$_POST['showExtra']` | POST | string/array | no | none | custom-column "showCustomList" mode (`config.php:4-7`, `liste.php:104`) |
| `$_POST['typedpassword']` | POST | string | no | compared (commented-out) ; otherwise **echoed back into hidden fields verbatim** | legacy password gate (dead) / reflected into forms (XSS) |
| `$_POST['alumne_ID'][]`, `room[]`, `workgroup[]`, `cleaning[]`, `fylgje[]`, `birthday[]`, `phone[]`, `email[]`, `study[]`, `moveInDay[]`, `networkClosed[]`, `networkClosedDetails[]`, … | POST | arrays | for `editList` | trimmed only (`liste.php:77-87`) | `editList`: per-row UPDATE of `intern_alumne` + `intern_alumne_liste` (**mass-assignment**) |
| `$_POST` (new-person fields: `firstName,lastName,room,room2,workgroup,cleaning,fylgje,fylgje2,birthday,moveInMonth,moveInYear,study,phone,email,addToThisList,alumne_ID`) | POST | mixed | for `addPerson` | none (raw `$_POST` copied into `$alumne`) | `addPerson`: INSERT into `intern_alumne` and/or `intern_alumne_liste` |
| `$_POST['alumneID']` | POST | int | for `removePerson` | **interpolated into SQL** (`evalPostArray.php:59`) | DELETE row from `intern_alumne_liste` |
| `$_POST['month2']`, `confirmCopy` | POST | int / checkbox | for `copyList` | interpolated | copy whole list to another month |
| `$_POST['confirmDelete']`, `$_POST['month']` (as `monthToDel`) | POST | checkbox / int | for `deleteList` | **interpolated** (`evalPostArray.php:88-89`) | DELETE all rows for a month |
| `$_POST['workgroupToDelete']`/`cleaningToDelete`/`studyToDelete` | POST | int | for delete* actions | **interpolated** | DELETE category row |
| `$_POST['newFirstName']`, `newLastName`, `alumne_ID`, `newNameOK` | POST | string | for `editNameOfPerson` | **interpolated** (`evalPostArray.php:156-157`) | rename a person |
| `$_POST['wID'][]`, `cID[]`, `workgroup[]`, `cleaning[]`, `w_amount[]`, `c_amount[]` | POST | arrays | for configure `action=change` | `$wid`/`$cid` **interpolated into UPDATE/DELETE** (`konfigurer.php:43,51,62,70`) | upsert/delete workgroup & cleaning rows |
| `$_POST['body']`, `sendEmails` | POST | text/flag | configure `change_email_settings...` | AutoExecute (escaped) | update welcome-email template (`intern_alumne_emailtonew` ID=1) |
| `$_POST['email_to_add']` | POST | string | configure `add_email` | AutoExecute (escaped) | INSERT subscriber |
| `$_POST['email_to_delete']` | POST | string | configure `remove_email` | **interpolated into DELETE** (`konfigurer.php:81`) | delete subscriber |
| `$_POST['body1']`,`enabled1`,`body2`,`enabled2` | POST | text/flag | configure `change_emailnetworkstatus` | AutoExecute (escaped) | update close/open notification email bodies |
| cookie `session_token` | cookie | string | (model only) | interpolated in model SQL | **not used by this controller** — `Internuser_model::loginSession/clearSession` only |

## Database interactions
- **Tables touched:** `intern_alumne` (R/W), `intern_alumne_liste` (R/W), `intern_alumne_workgroup` (R/W), `intern_alumne_cleaning` (R/W), `intern_alumne_study` (R/W via add-person & deleteStudy), `intern_alumne_emailtonew` (R/W), `intern_alumne_emailnetworkstatus` (R/W), `intern_alumne_emailsubscribers` (R/W), `intern_alumne_pylon_email_settings` (R, on removePerson). All **MyISAM** (no transactions). The CI framework's own session table is separate; `intern_alumne_sessions` is touched only by the unused model.
  - Relevant exact columns:
    - `intern_alumne`: `ID, firstName, lastName, fylgje, birthday, moveInDay, moveOutDay, study, phone, email, password, networkClosed, networkClosedDetails`
    - `intern_alumne_liste`: `ID, alumne_ID, room, workgroup, cleaning, monthNumber`
    - `intern_alumne_workgroup`: `ID, workgroup, w_amount`; `intern_alumne_cleaning`: `ID, cleaning, c_amount`; `intern_alumne_study`: `ID, study`
    - `intern_alumne_emailtonew`: `ID, emailBody, sendEmailToNewPersons`; `intern_alumne_emailnetworkstatus`: `ID, body, enabled`; `intern_alumne_emailsubscribers`: `ID, email`
    - `intern_alumne_pylon_email_settings`: `ID, …, moveout_sendEmail, moveout_emailSubject, moveout_emailBody, moveout_emailFrom`
- **Reads (all via the stray views' own ADOdb connection, not CI's `$this->db`):**
  - `liste.php` / `json.php`: most-recent `monthNumber` (`SELECT DISTINCT monthNumber FROM intern_alumne_liste ORDER BY monthNumber DESC`); list rows (`SELECT * FROM intern_alumne JOIN intern_alumne_liste ON intern_alumne_liste.alumne_ID = intern_alumne.ID WHERE intern_alumne_liste.monthNumber = '$month'`); or `SELECT * FROM intern_alumne` for `allPersons`.
  - workgroup/cleaning catalogs; prev/next-month diffs for "moved in/out"; list of distinct months for the "old lists" chooser.
  - `konfigurer.php`: workgroup, cleaning, emailtonew, emailnetworkstatus, emailsubscribers catalogs.
- **Writes:** (all done **inside the stray views/includes**, all raw or `AutoExecute` mass-assignment, MyISAM ⇒ no transaction)
  - **closeNetwork (access=3) → `editList` (`evalPostArray.php:109-148`):** for each posted row: if `networkClosed` changed vs DB, optionally send open/close email (see side effects); then `UPDATE intern_alumne_liste` (room/workgroup/cleaning) and `UPDATE intern_alumne` (whole row incl. `networkClosed`, `networkClosedDetails`) where `alumne_ID`/`ID` match. **Network status is a column on `intern_alumne` (`networkClosed` tinyint, `networkClosedDetails` text)** — toggled by the `networkClosed[]`/`networkClosedDetails[]` selectors. If `networkClosed` is false, `networkClosedDetails` is forced to `""` (`evalPostArray.php:144`).
  - **update (access=2):** dispatches `evalPostArray.php` actions:
    - `addPerson`: optionally INSERT new study/workgroup/cleaning category rows; then either INSERT into `intern_alumne_liste` (existing alumne) or INSERT into `intern_alumne` (new, with sha256 random password + computed `moveInDay`) and optionally INSERT into `intern_alumne_liste`.
    - `removePerson`: `DELETE FROM intern_alumne_liste WHERE monthNumber='$month' AND alumne_ID='$alumneToDel'`.
    - `copyList`: re-INSERT every current-month row into `intern_alumne_liste` with `monthNumber=$month2` (if `confirmCopy`).
    - `deleteList`: `DELETE FROM intern_alumne_liste WHERE monthNumber='$monthToDel'` then `header('Location: https://gahk.dk/intern/alumneliste/index.php?admin=true')` (redirect to OLD site).
    - `deleteWorkgroup`/`deleteCleaning`/`deleteStudy`: `DELETE FROM intern_alumne_{workgroup|cleaning|study} WHERE ID='…'`.
    - `editNameOfPerson`: `UPDATE intern_alumne` set firstName/lastName where ID.
    - `editList`: same as closeNetwork above (shared code path; access≥2 reaches it).
  - **configure (`konfigurer.php:35-87`):**
    - `change`: per-row UPSERT/DELETE on `intern_alumne_workgroup` and `intern_alumne_cleaning` (`AutoExecute UPDATE` if id>0; `INSERT` if id==0 and name not "(ny)"/duplicate; else `DELETE … WHERE ID='$wid'`).
    - `change_email_settings_when_new_alumne_created`: `UPDATE intern_alumne_emailtonew … ID=1`.
    - `add_email`: `INSERT` into `intern_alumne_emailsubscribers`; `remove_email`: `DELETE … WHERE email='…'`.
    - `change_emailnetworkstatus`: two `UPDATE intern_alumne_emailnetworkstatus` (ID=1 closed, ID=2 open).
- **Transactions / ordering:** None. All tables are **MyISAM = no transactions, no FKs**. `copyList`/`editList` loop row-by-row with no atomicity; a failure mid-loop leaves a partially-written list. `addPerson` uses `Insert_ID()` between two INSERTs.

## Business logic
- **Access level is derived in the view, not just the controller** (`liste.php:4-20`). The controller sets booleans (`closenetwork`, `changeList`) and passes role flags via `showInternPage`. `liste.php` then computes: `access=3` if (`inspektion`||`kokkengruppe`) && `closenetwork`; `access=2` if (`indstilling`||`inspektion`) && `changeList`; else `access=1` (read-only). Special downgrades: if `$_POST['month']==="allPersons"` access drops to 1; if `$_GET['m']` set (mobile) access drops to 1 and menu hidden.
- **Which list:** if `$_GET['mostRecentList']` or no `$_POST['month']`, pick the max `monthNumber`; else use the posted month. `"allPersons"` selects everyone in `intern_alumne` (no join, no room/workgroup/cleaning columns).
- **Column layout** per access level comes from `config.php`; users can request a custom column set via `display=showCustomList`.
- **Rendering:** `createDataTable()` (in `delt.php`) emits an HTML table consumed client-side by jQuery DataTables (CSV/Excel export buttons, EU-date sorting). For access 2/3 the rows become editable `<input>`/`<select>` fields wrapped in a `form_open()` posting back to `update` or `closeNetwork`.
- **Error checks (access=2, `liste.php:130-184`):** warns if workgroup/cleaning member counts don't match configured `w_amount`/`c_amount`, if a workgroup/cleaning value isn't in the catalog, if an alumne appears twice, or if two people share a room. Purely advisory (echoed warnings; does not block writes).
- **Network open/close workflow:** in `editList`, when a row's `networkClosed` value differs from the stored value and the alumne has an email, an email is sent — "Dit netværk er lukket" if newly closed (and `emailnetworkstatus` ID=1 enabled) or "Dit netværk er åbent igen" if newly opened (ID=2 enabled). Body tags (`{firstName}`, `{networkClosedDetails}`, etc.) are substituted via `replaceTagsWithValues()`.
- **configure** branches entirely on `$_POST['action']`; with no action it just renders the current config forms.
- **`json()`** ignores all access levels: always reads the most-recent month and prints a hand-concatenated JSON object (`{"alumni":[ … ]}`) — fields are NOT escaped (string concatenation), so a quote/newline in any name breaks the JSON.

## Outputs & side effects
- **Rendered data:**
  - `index`/`update`/`closeNetwork`: `showInternPage('intern/alumneliste/liste', …)` wraps the stray script between CI `intern/header.php` and `intern/footer.php`. ⚠ But `liste.php` also calls `insertHeader()` which emits its **own** full `<!DOCTYPE html><html><head>…` — so the response contains **nested/duplicated HTML document chrome** (CI header + flat-file header). It also injects absolute `https://gahk.dk/intern/...` stylesheet/JS links pointing at the OLD site.
  - `configure`: `konfigurer.php` likewise emits its own `insertHeader()` document plus config forms.
  - `json`: emits raw JSON text (no `Content-Type: application/json` header is set — it goes through `$this->load->view(...)` so default HTML content type). Returned to **any caller from a campus IP, unauthenticated.**
- **Redirects:** controller `redirect("nyintern/admin")` when not logged in (with `redirectToUrlAfterLogin` flashdata); `redirect("nyintern/alumneliste")` on insufficient role. The stray views additionally emit PHP `header('Location: https://gahk.dk/intern/alumneliste...')` for access-denied and after `deleteList` — pointing back at the OLD flat-file site, mid-output (likely "headers already sent").
- **Emails (PHP `mail()` from the stray includes):** welcome email to new alumne (`addPerson`), move-out email (`removePerson`, via `intern_alumne_pylon_email_settings`), network closed/opened notifications (`editList`). `From: interngahk@gahk.dk` (or configured From).
- **Files / external calls:** loads jQuery, jQuery-UI, DataTables, validity, button/export JS — many hardcoded from `https://gahk.dk/intern/...` and some from `base_url('public/...')`. Floorplan image from `base_url('/public/image/intern/plantegning.png')`.
- **Session/headers:** controller calls `session_start()` in its constructor (in addition to CI's session lib). Sets flashdata on the login redirect.
- **Visit-counter write:** ⚠ **NOT triggered here.** Unlike many App A controllers, `Alumneliste::__construct()` calls `parent::__construct()` but **does not call `$this->counter()`** (compare admin/page/optagelse which call it explicitly — see `01-infrastructure.md` A9). So no `gahk_counter`/`gahk_counterdato` write occurs for this feature. (Document divergence from the assumed "counter on every hit".)

## Dependencies
- **Cross-cutting infra used:** `MY_Controller` base + `showInternPage()` chrome and role-userdata wiring (`01-infrastructure.md` A4/A5/A9 — note A9's "counter on every hit" does **not** apply here); CI session/login userdata (`username` + role flags `indstilling/inspektion/kokkengruppe`) from `01-infrastructure.md` A4/A5; `gahk_helper::insideGAHK()` 6-IP campus allowlist (`01-infrastructure.md` A4) — the sole `json` gate; CI `form` helper (`form_open`).
- **Other includes / libraries / external services:**
  - ⚠ Vendored **ADOdb** copied into `application/views/intern/alumneliste/adodb5/` — the views open their **own** mysqli/mysql connection independent of CI's DB layer.
  - ⚠ `delt.php` — a **stray config with hardcoded plaintext secrets** (DB user/password and several admin passwords) is `include`/`require_once`'d by every view. (Mirrors `atGAHK()` / the App B `delt.php` noted in `01-infrastructure.md` B1/the manifest dashboard finding.)
  - `Internuser_model` is loaded but unused by this controller.
  - PHP `mail()` for all notifications.

## Security findings
| Issue | Location (file:line) | Severity | One line |
|---|---|---|---|
| Auth bypass: `json()` exposes the full current resident directory (names, rooms, phones, emails, studies) to anyone on a campus IP, no login | `alumneliste.php:30-37` | High | IP allowlist is not authentication; campus Wi-Fi = open data dump |
| SQL injection via `$_POST['month']` interpolated into SQL | `liste.php:59,125,269-270`; `json.php` (month from DB) | High | `WHERE monthNumber = '$month'` with unsanitised POST |
| SQL injection via `removePerson`/`deleteList`/`editNameOfPerson`/category deletes | `evalPostArray.php:59,88-89,97,102,106,156-157` | High | raw `$_POST[...]` interpolated into DELETE/UPDATE |
| SQL injection via `configure` `$wid`/`$cid`/`email_to_delete` | `konfigurer.php:43,51,62,70,81` | High | row ids and email interpolated into UPDATE/DELETE |
| Mass assignment: whole `$_POST` copied into `intern_alumne`/`intern_alumne_liste` via `AutoExecute` | `evalPostArray.php:9-11,37,114-146`; `liste.php` editList | High | any matching column (incl. `password`, `networkClosed`) settable from the form |
| Hardcoded plaintext DB credentials | `delt.php:15-17` (`gahk_dk`/`keldogfrederik`) | High | secrets in source, included into every render |
| Hardcoded admin passwords (some plaintext) | `delt.php:3-10` | High | `Numedtinder`, `blomsterbørn`, `ymer`, … in source |
| Reflected XSS via `$_GET['errorMessage']` | `delt.php:159-161` | Medium | echoed raw through `redText()` |
| Reflected XSS via `$_POST['typedpassword']` into hidden form fields | `liste.php` (createDataTable), `konfigurer.php:115,189,204,215`, `formsAndSubmitButtons.php:15` | Medium | posted value echoed unescaped into HTML |
| Stored XSS: alumne fields (`firstName`, `email`, etc.) echoed into table/JSON without escaping | `liste.php:194-264`, `json.php:62-72` | Medium | any field with HTML/quotes renders unescaped |
| No CSRF protection on state-changing POSTs (add/remove/delete/copy/edit/configure/network) | all `form_open()` in views; CI CSRF off (`01-infrastructure.md`) | High | forgeable destructive actions |
| Email header / body injection: unsanitised name/email into `mail()` | `delt.php:348-370`, `evalPostArray.php:52,67,130,135` | Medium | recipient/body from user-controlled data |
| Weak randomness for new-alumne password / off-by-one index | `delt.php:251-258` (`random_int(0,strlen)` includes out-of-range index) | Low | password generation can yield empty char / undefined index |
| `header('Location: …gahk.dk…')` emitted after output already started | `evalPostArray.php:90`, `liste.php:107-112` | Low | "headers already sent"; redirect to OLD site |

## Quirks, edge cases & suspected bugs
- ⚠ **CI-controller-renders-stray-script entanglement (the core finding):** the three view files are the OLD flat-file app's scripts living under `views/`. They open their own ADOdb connection, run raw SQL, write to the DB, send email, and print a complete HTML document — they are **not** data-fed CI views. The CI controller only sets boolean flags. So all real behavior (and all the SQLi/secret-leak risk) lives in the "views."
- ⚠ **Double HTML chrome:** `showInternPage` wraps with CI `header.php`/`footer.php`, but the stray view emits its own `insertHeader()` `<!DOCTYPE><html><head>…`. The rendered page nests two documents. The flat-file `insertHeader()` even has its menu include commented out (`delt.php:147`).
- ⚠ **Visit counter NOT called** here (unlike most App A controllers) — `__construct` omits `$this->counter()`. Diverges from the assumed A9 "counter on every hit."
- The **model `Internuser_model` is loaded but never used** by any of the five methods.
- Controller calls `session_start()` *and* loads CI's `session` library — redundant/possibly conflicting session handling.
- `json.php` builds JSON by string concatenation (`json.php:54-77`) with no escaping → any quote/newline/backslash in a field produces invalid JSON. It also uses `ADONewConnection('mysql')` (deprecated driver) whereas `liste.php`/`konfigurer.php` use `'mysqli'`.
- `closeNetwork`/`update`/`configure` are reached via `form_open` POST, but nothing prevents a plain GET (CI ignores verbs) — combined with no CSRF this widens the attack surface.
- `access` computation reads `$_POST['month']` unconditionally (`liste.php:14`), generating a PHP notice when absent; "allPersons" forcibly downgrades admin modes to read-only mid-edit.
- `deleteList` uses `$_POST['month']` as `monthToDel` but the surrounding list logic uses a possibly different `$month` — easy to delete the wrong/most-recent list.
- Several JS/CSS assets are hardcoded to `https://gahk.dk/intern/...` (the OLD site), coupling the new app to the old host.

## Reimplementation notes (Django)
- View type: a small set of role-gated class-based views — `DirectoryListView` (read), `ListEditView` (indstilling/inspektion), `NetworkStatusEditView` (inspektion/kokkengruppe), `ConfigureView` (indstilling), and a `DirectoryJSON` API view. **Do NOT port the stray-view pattern** — move ALL DB access into Django ORM/models and views; render proper templates fed by view context (FIX).
- Models: `InternAlumne`, `InternAlumneListe` (FK alumne, monthNumber), `InternAlumneWorkgroup`, `InternAlumneCleaning`, `InternAlumneStudy`, and the three email-settings/subscriber models. Preserve the monthNumber = `12*year+month` convention and the per-month list semantics.
- Forms: Django `ModelForm`/formsets — **FIX mass-assignment** (whitelist editable fields; never accept `password`/`ID` from the form). Use parameterized ORM queries (FIX all SQLi).
- Templates: one DataTable-style list template + edit formset templates + config template; drop the duplicated `insertHeader()` chrome (use the base layout).
- Auth: **FIX `json`** — require login + role (or at minimum keep an IP allowlist *in addition to* auth), and set proper `Content-Type: application/json` via `JsonResponse`. PRESERVE the role matrix (index=login, update=indstilling|inspektion, closeNetwork=inspektion|kokkengruppe, configure=indstilling). Move secrets to settings/env (FIX `delt.php`). Add CSRF (Django default).
- URL pattern: `path('nyintern/alumneliste/', …)`, `.../json/`, `.../closeNetwork/`, `.../update/`, `.../configure/`. Decide whether to keep the legacy welcome/move-out/network emails as Django email tasks (PRESERVE behavior, harden inputs).

## Open questions
- Is exposing the directory as **unauthenticated JSON to any campus IP** intentional (some on-LAN display/integration) or an oversight? It leaks personal data (phones, emails, birthdays). Who consumes `/json`?
- Should the **visit counter** apply to this feature? Every other App A controller calls `$this->counter()`; alumneliste does not. Intentional or a missed call?
- The `typedpassword` / `delt.php` admin-password gate is commented out (`liste.php:12-13`); is the role-based CI gate now the only intended control, and can the legacy password machinery be dropped entirely?
- `deleteList` and several actions redirect to the OLD `gahk.dk/intern/...` site — is the old flat-file app still live and authoritative, or is this dead/copy-paste residue? Determines whether App A is the source of truth for alumne data.
- Which month should `index` default to for a brand-new month with no list yet — silently the previous month? Define the empty-state.
- `closeNetwork` and `update` both reach the shared `editList` write path (access 2 and 3). Is it intended that an `update`-privileged officer (indstilling/inspektion) can also change network status, or should network toggling be inspektion/kokkengruppe-only?
