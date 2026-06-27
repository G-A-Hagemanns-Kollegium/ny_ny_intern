# 00 — Codebase Manifest (legacy_site/)

Classification pass ahead of the Django rewrite. **No behaviour is described in depth here — this is a map, not a spec.**

## What this codebase actually is

It is **not one site** — it is several layers stacked in one document root:

| Layer | Location | What it is | In scope for rewrite? |
|---|---|---|---|
| **App A — "nyintern" (current)** | CodeIgniter 2.x app in `application/`, front controller `index.php` | The live public site (gahk.dk) + the *new* internal members area, reached via the `nyintern/*` routes | **Yes — primary** |
| **App B — old flat-file "intern"** | `intern/` (procedural PHP, served directly) | The *previous-generation* internal system. `intern/index.php` just redirects to `/nyintern`, and `intern/menu/menu.php` is fully commented out — the whole tree is **superseded**. The MAC-address network-access feature, previously suspected live, is **confirmed no longer used** (project owner, 2026-06) | **Retire — nothing left to port** |
| CodeIgniter framework | `system/` | Vendored CI 2.x core (127 PHP files) | No (replace with Django) |
| MediaWiki | `wiki/` | A complete, separate MediaWiki install (~5030 PHP files) | No (standalone app) |
| ADOdb (×3 copies) | `intern/adodb5/`, `application/views/intern/alumneliste/adodb5/`, `application/views/intern/mydata/adodb5/` | DB-abstraction library, **bundled three times** (170 / 178 / 170 files) | No (vendor) |
| Front-end asset libs | `public/` (bootstrap, freshGAHK, semantic, ckeditor, jqplot, kcfinder), `intern/tools/tinymce`, `intern/dataTables`, `intern/jqueryui`, `intern/jQuery.validity` | JS/CSS bundles; a few carry PHP | No (vendor; a few PHP files flagged below) |
| CI docs | `user_guide/` | CodeIgniter HTML manual (0 PHP) | No |

### How URLs map (root `.htaccess`)

```
RewriteCond $1 !^(index\.php|images|public|intern|wiki|robots\.txt)
RewriteRule ^(.*)$ /index.php/$1 [L]
```

Everything **except** `index.php`, `images`, `public`, `intern`, `wiki`, `robots.txt` is rewritten through the CodeIgniter front controller. Consequences:

- **`intern/`, `wiki/`, `public/` are served directly from disk** — their PHP files are real URL endpoints.
- **`application/` is *not* directly reachable** — it is routed through CI, which blocks direct file access. So CI controllers are the only entry points; CI models/views/helpers are `—` for "Reached by URL?" even when they contain page-like code.
- The site also force-redirects `gahk.dk` → `https://www.gahk.dk`.

### Scope of the tables below

Every **bespoke** PHP file is listed individually (≈230 files across App A and App B, plus the bespoke PHP under `public/`). **Vendor/framework bundles are summarized** in [§13](#13-vendor--framework-bundles-not-enumerated-file-by-file) with file counts rather than enumerating thousands of third-party files — enumerating MediaWiki, CodeIgniter core, and 3× ADOdb line-by-line would bury the signal. If you need any vendor file expanded, say so.

> **Column key.** `Type` ∈ {entry-point, include, config, db, helper, asset-handler, cron/cli, dead}. `Reached by URL?` = public path if an entry point, else `—`. `Includes` lists `include`/`require` targets and, for CI controllers, the effective dependencies loaded via `$this->load->{model,view,library,helper}()`. `Touches DB?` = yes/no.

---

## 1. Root / bootstrap

| Path | Type | Reached by URL? | Includes | Touches DB? | Notes |
|---|---|---|---|---|---|
| index.php | config | `/` (front controller) | requires `system/core/CodeIgniter.php` | no | CI 2.x front controller. `ENVIRONMENT='production'` (errors suppressed). `system_path='system'`, `application_folder='application'`. Bootstrap only. |

(`/.htaccess` — not PHP — is the routing/redirect/gzip config; see overview.)

---

## 2. CodeIgniter — config & core

| Path | Type | Reached by URL? | Includes | Touches DB? | Notes |
|---|---|---|---|---|---|
| application/config/database.php | **db** | — | DB-connection config | yes (connection) | **DB-connection config.** `dbdriver=mysqli`, `hostname=localhost`, `database=gahk_dk`, `username=gahk_dk`, **password hardcoded in plaintext**, `pconnect=TRUE`, `db_debug=TRUE`, utf8. |
| application/config/config.php | config | — | main app config | no | `base_url` EMPTY (auto-guessed); `encryption_key` weak/hardcoded (`'gahksessionsecurity'`); DB-backed sessions (`gahk_dk_sessions`, cookie `gahk_dk_session`, 2h, match_useragent); `csrf_protection=false`, `global_xss_filtering=false`; lang `danish`; `subclass_prefix='MY_'`. |
| application/config/autoload.php | config | — | — | no | Autoloads library `database` (every request opens a DB connection) + helper `url`. No models/configs autoloaded. |
| application/config/routes.php | config | — | — | no | `default_controller='page/show/1'`; Danish slugs → `page/show/N`; `admin→admin`, `optagelse→optagelse`, `pylon→pylon/show`; **`nyintern/(:any)` wildcard → `intern/$1`** (the internal area); `404_override` empty. |
| application/config/email.php | config | — | — | no | **CUSTOM (not a framework default).** Hardcoded SMTP creds: `smtp_user=autosvar@gahk.dk`, `smtp_host=mailout.one.com`, **password in plaintext**. |
| application/config/recaptcha.php | config | — | — | no | **CUSTOM.** Hardcoded reCAPTCHA keys: legacy v1 public/private **and** v2 site/secret keys, all plaintext. |
| application/config/constants.php | config | — | — | no | CI framework default — unchanged. |
| application/config/doctypes.php | config | — | — | no | CI framework default — unchanged. |
| application/config/foreign_chars.php | config | — | — | no | CI framework default — unchanged. |
| application/config/hooks.php | config | — | — | no | CI framework default — empty; hooks disabled. |
| application/config/migration.php | config | — | — | no | CI framework default — unchanged. |
| application/config/mimes.php | config | — | — | no | CI framework default — unchanged. |
| application/config/profiler.php | config | — | — | no | CI framework default — unchanged. |
| application/config/smileys.php | config | — | — | no | CI framework default — unchanged. |
| application/config/user_agents.php | config | — | — | no | CI framework default — unchanged. |
| application/core/MY_Controller.php | include | — | loads lib `session`, helper `gahk_helper`; models `Counter_model`, `Ansoegninger_model`; views `intern/header`, `intern/footer` | yes | **Custom base controller** all controllers extend. `showInternPage()` wraps content in intern header/footer using session userdata (username, alumne_id, akRole, indstilling, inspektion, kokkengruppe, oelkaelder, administrator). `counter()` = per-IP/date visit counter. `sendAnsoegningPaamindelseIfTime()` weekly reminder mail (send is commented out/disabled). |

---

## 3. CodeIgniter — controllers (entry points, App A)

All are URL-reachable. Root controllers at `/<name>/`; `intern/` sub-controllers at `/nyintern/<name>/`.

| Path | Type | Reached by URL? | Includes (loads) | Touches DB? | Notes |
|---|---|---|---|---|---|
| application/controllers/page.php | entry-point | `/` (default `page/show/1`) + slugs velkommen/faciliteter/kollegielivet/vision/legater/kontakt; `index, show/$id, edit/$id, save/$id, savebg/$id, altfrontpage` | models Page_model, News_model; views layout/*, home_page, standart_page, admin/editPageBox, news/begivenheder, news/news_ajax; lib session; helper form | yes | Core CMS page renderer. Ctor fires `sendAnsoegningPaamindelseIfTime()` (cron-like side-effect on every hit). edit/save gated on `username`+`editpage` session. |
| application/controllers/admin.php | entry-point | `/admin/`; `index, login, logout, useradm, adduseradm, addAllUserAdm, deleteuseradm, alumneSearch, sendMail, getAngsoegningStatistic` | models Adminuser_model, Ansoegninger_model, Counter_model; views layout/adminHeader, admin/{dashboard,login,useradm}, layout/bottom; libs session, form_validation; helper form | yes | Public-site admin dashboard; sha256 password auth. ⚠ `sendMail()` mass-emails workgroups with **no auth check**; `getAngsoegningStatistic()` also public. |
| application/controllers/news.php | entry-point | `/news/`; `listBox, show/$id, listAndCreate, edit/$id, create, save, delete/$id` | models News_model, Page_model; views news/*, standart_page, layout/*; lib session; helpers form, text | yes | News CRUD. edit/create/save gated on `username`+`editpage`. ⚠ `delete/$id` has **no auth check**. Legacy news system (largely replaced by a Facebook embed). |
| application/controllers/optagelse.php | entry-point | `/optagelse/`; `index, ansoeg, send_rundvisning, fremlej, send_fremleje, listansoegninger, showAnsoegning/$id, setasreceived/$id, validateCaptcha` | models Page_model, Pylon_calendar_model, Ansoegninger_model; views optagelse/*, layout/*; libs recaptcha, form_validation, email, session; helper form | yes | Public admission/tour/sublet forms w/ reCAPTCHA+email; admin list/show gated on `indstilling`. ⚠ `send_fremleje` mail path bypassed by `if(TRUE)`; `sendMail` always returns TRUE (bug). |
| application/controllers/pylon.php | entry-point | `/pylon/` (route `pylon→pylon/show`); `index, show, editCalendar, save_calendar, delete/$id` | models Page_model, Pylon_calendar_model; views layout/*, standart_page, pylon/*; libs session, form_validation; helper form | yes | Public "pylon" event-calendar page; edit/save/delete gated on `username`+`editpage`. |
| application/controllers/portfolio.php | entry-point | `/portfolio/getPortfolio` | view portfolio; lib session; helper form | no | Single method emits JSON with `Access-Control-Allow-Origin: *`. No auth, no DB. Small embeddable endpoint. |
| application/controllers/phpinfo.php | entry-point | `/phpinfo/` | — | no | ⚠ **Debug-only `<?php phpinfo(); ?>`** — not even a CI controller class (no class, no BASEPATH guard). Leaks server config. Abandoned; remove. |
| application/controllers/intern/admin.php | entry-point | `/nyintern/admin/`; `index, login, logout, editinfo, changepassword, forgotpass, receivedmail, resetpass` | models Internuser_model, Adminuser_model; views intern/{header,footer,login,editinfo,changepass,forgotpass/*}; libs session, form_validation; helper form | yes | Internal-area auth (login, logout, password reset/forgot). ⚠ `resetpass()` builds temp password from `random_int(5,10000)` (weak/guessable). |
| application/controllers/intern/dashboard.php | entry-point | `/nyintern/` and `/nyintern/dashboard/`; `index` | model Internuser_model; view intern/dashboard; lib session; helpers form, gahk_helper | yes | Internal landing page; requires login else redirect to `nyintern/admin`. Thin. |
| application/controllers/intern/mydata.php | entry-point | `/nyintern/mydata/`; `index` | model Internuser_model; view intern/mydata/mydata; lib session; helper form | yes | MAC-address registration page. ⚠ **MAC feature confirmed no longer used (2026-06) → this controller is now DEAD; dropped from the Phase 2 rebuild list.** Renders view `intern/mydata/mydata.php`, a stray flat-file script with its own DB connection (see §9). |
| application/controllers/intern/ak.php | entry-point | `/nyintern/ak/`; `index, showPersonalLog/$id, admin, delete_log_element/$id, updatestatus, reduceAllKrydser` | models Aklog_model, Akstatus_model, Adminuser_model; views intern/ak, intern/adminAk; libs session, form_validation; helper form | yes | "AK-krydser" duty-tracking. Own log open to user; others/admin actions gated on `akRole`. |
| application/controllers/intern/alumneliste.php | entry-point | `/nyintern/alumneliste/`; `index, json, closeNetwork, update, configure` | model Internuser_model; views intern/alumneliste/{liste,json,konfigurer}; lib session; helper form | yes | Alumni list. index requires login; closeNetwork/update/configure gated on inspektion/kokkengruppe/indstilling roles. ⚠ `json()` gated only on `insideGAHK()` IP check, not login. |
| application/controllers/intern/oelkaelder.php | entry-point | `/nyintern/oelkaelder/<method>`; `products, purchase, activeShoppers, transactions, overview, allsales, deactivate/activate(+Product), setWarningMail, deposit/saleReport, addShopper, deleteDeposit/Transaction, admin, upload, assortment, shopperList` | models Internshop_model, Oelkaelder_model, Adminuser_model; views intern/oelkaelder*; libs session, upload; helpers form, oelkaelder | yes | Beer-cellar POS/shop. Admin actions gated on `oelkaelder` role. ⚠ **`purchase()` has its auth entirely commented out** — open POST write endpoint (`ACAO:*`); `transactions()` `var_dump`s raw data (debug). |
| application/controllers/intern/soegvaerelse.php | entry-point | `/nyintern/soegvaerelse/<method>`; `index, soeg/$mn, indsend/$mn, getKAsJson/$mn, getKvotientData/$id, admin, getApplicationByRoom/$r, wonRoomAlgorithm/$r, closeOffer/$id, createoffer` | models Kvotient_model, Kvotientoffer_model, Kvotient_priority_model, Kvotient_orlov_model, Adminuser_model; views intern/soegvaerelse/*; libs session, form_validation; helper form | yes | Room-application "kvotient" lottery. ⚠ admin/createoffer/closeOffer auth uses buggy `!$username && !empty($indstilling)` (likely lets unauthorized through); `wonRoomAlgorithm` uses undefined var. |
| application/controllers/intern/vaerelsestjek.php | entry-point | `/nyintern/vaerelsestjek/<method>`; `index, besvar/$roomId, indsend/$roomId, akoverview` | models RoomCondition_model, RoomCriteria_model; views intern/vaerelsestjek/*; libs session, upload, form_validation; helper form | yes | Room-inspection w/ multi-image upload. ⚠ `akoverview` auth `!$username && !empty($ak)` is buggy; `mkdir 0777` + user-named upload dirs (path/permission concern). |
| application/controllers/intern/stamtree.php | entry-point | `/nyintern/stamtree/`; `index` | model Stamtree_model; view intern/stamtree; lib GahkTree; helpers form, url | yes | Builds alumni family-tree JSON. Requires login. Echoes `"FEJL!!"` on missing parent (debug-ish). |
| application/controllers/intern/statistik.php | entry-point | `/nyintern/statistik/<method>`; `index, getAllStudyData, getStudyData, addStudyDataToData, getAnsoegningerBy*JSON/Table, getAngsoegningStatisticJSON, getCounterStatistic, getAnsoegningerByHeardAboutUs*` | models Internuser_model, Ansoegninger_model, Counter_model; view intern/statistik; lib session; helper form | yes | Stats/charts. index requires login, but ⚠ **JSON/data feeder methods have no auth** — publicly expose aggregate data; `getStudyData` self-commented "old and should be removed". |

---

## 4. CodeIgniter — models (DB layer, App A)

Not URL-reachable. Type = `db`. Most use **raw interpolated SQL** (SQL-injection risk) except `kvotient_model` which uses `db->escape`.

| Path | Type | Reached by URL? | Includes | Touches DB? | Notes (tables) |
|---|---|---|---|---|---|
| application/models/adminuser_model.php | db | — | loads cookie helper | yes | `gahk_admin_user` (login/list/add/delete); reads `intern_alumne`, `intern_alumne_sessions`, `intern_alumne_liste`. ⚠ unescaped interpolation. |
| application/models/internuser_model.php | db | — | loads cookie helper | yes | `intern_alumne` (login/get/update/changePassword), `intern_alumne_sessions`, `intern_forgotpassword`. Hardcodes db name `gahk_dk`. |
| application/models/page_model.php | db | — | — | yes | `gahk_page` (CMS content: get/update). |
| application/models/news_model.php | db | — | — | yes | `gahk_news` (add/update/get/getNewest/delete/count). |
| application/models/ansoegninger_model.php | db | — | — | yes | `gahk_ansoegninger`, `gahk_ansoegninger_paamindelse`; joins `intern_alumne`. Admission intake + stats. |
| application/models/counter_model.php | db | — | — | yes | `gahk_counter` (per-IP), `gahk_counterdato` (per-date). `get_count_by_week` duplicates `get_count_by_date`. |
| application/models/pylon_calendar_model.php | db | — | — | yes | `gahk_pylon_calendar` (events list/add/delete). |
| application/models/internshop_model.php | db | — | — | yes | `getShopperList`: reads `intern_alumne`, `intern_alumne_liste` (current residents). |
| application/models/oelkaelder_model.php | db | — | loads directory helper | yes | Largest model. `intern_oelkaelder_product/_saldo/_deposit/_transaction/_transaction_item/_purchase/_log/_warnings`, `intern_shopper`; reads `intern_alumne`; also `mail()` + reads filesystem. ⚠ raw SQL. |
| application/models/aklog_model.php | db | — | — | yes | `intern_alumne_aklog` (duty log get/add/getById/delete). |
| application/models/akstatus_model.php | db | — | — | yes | `intern_alumne_akstatus`; reads `intern_alumne`, `intern_alumne_aklog`, `intern_alumne_liste`. ⚠ hard-coded monthNumber `'24178'`; buggy `insert(..., -1*$inserData)`. |
| application/models/kvotient_model.php | db | — | — | yes | `intern_kvotient_nyintern`; joins `intern_kvotient_priority/orlov/offer_nyintern`, `intern_alumne`. Uses `db->escape` (safer). |
| application/models/kvotient_priority_model.php | db | — | — | yes | `intern_kvotient_priority_nyintern` (addPriority). `deletePriorityByAnsoegningId` marked "Not used anymore". |
| application/models/kvotient_orlov_model.php | db | — | — | yes | `intern_kvotient_orlov_nyintern` (single addOrlov insert). |
| application/models/kvotientoffer_model.php | db | — | — | yes | `intern_kvotient_offer_nyintern` (room offers get/getByMonth/add/delete/getById). |
| application/models/roomcondition_model.php | db | — | — | yes | `intern_room_condition` (move-in condition reports, is_newest flagging). |
| application/models/roomcriteria_model.php | db | — | — | yes | `intern_room_criteria` (single getCriteria lookup). |
| application/models/stamtree_model.php | db | — | — | yes | `getAllAlumner` reads `intern_alumne`; **rest is a near-duplicate of `ansoegninger_model`** (`gahk_ansoegninger*`) and looks copy-pasted/dead here. |

---

## 5. CodeIgniter — helpers & libraries (App A)

| Path | Type | Reached by URL? | Includes | Touches DB? | Notes |
|---|---|---|---|---|---|
| application/helpers/gahk_helper.php | helper | — | — | no | `insideGAHK()` (REMOTE_ADDR vs ~6 hardcoded campus IPs) and `isInspektion()`. ⚠ `isInspektion()` references `$this` from a plain function — broken/dead. |
| application/helpers/oelkaelder_helper.php | helper | — | — | no | Money utils `priceStrToOrens()` / `orensToPriceStr()` (price string ↔ øre). |
| application/libraries/GahkTree.php | helper | — | — | no | Simple tree-node class (`$name`, `$children[]`, `addChild()`) for the stamtree/menu structures. |
| application/libraries/recaptcha.php | helper | — | loads config `recaptcha` | no | appleboy CI-reCAPTCHA class `Recaptcha` (verifyResponse/getScriptTag/getWidget). ⚠ bug: `$this->_ci` vs `$this->_CI` casing. |
| application/libraries/recaptchassl.php | helper | — | loads config `recaptcha` | no | ⚠ **Duplicate class name `Recaptcha`** — cannot coexist with recaptcha.php. Reads flat `recaptcha_site_key`/`recaptcha_secret_key` config. |

---

## 6. CodeIgniter — error views (App A)

| Path | Type | Reached by URL? | Includes | Touches DB? | Notes |
|---|---|---|---|---|---|
| application/errors/error_404.php | include | — | rendered by framework on 404 | no | CI default — unchanged. |
| application/errors/error_db.php | include | — | rendered on DB error | no | CI default — unchanged. |
| application/errors/error_general.php | include | — | rendered on general error | no | CI default — unchanged. |
| application/errors/error_php.php | include | — | rendered on PHP error | no | CI default — unchanged. |

---

## 7. CodeIgniter — language files (App A)

17 files; almost all are CI 2.x translation arrays (no DB, no URL).

| Path | Type | Reached by URL? | Includes | Touches DB? | Notes |
|---|---|---|---|---|---|
| application/language/danish/*_lang.php (13: calendar, date, db, email, form_validation, ftp, imglib, number, profiler, scaffolding, unit_test, upload, validation) | config | — | — | no | Danish translations of CI framework strings. Standard localization data. |
| application/language/danish/fremleje_lang.php | config | — | — | no | **CUSTOM** — sublet-form (fremleje) labels. |
| application/language/danish/recaptcha_lang.php | config | — | — | no | **CUSTOM** — reCAPTCHA labels. |
| application/language/english/fremleje_lang.php | config | — | — | no | **CUSTOM** — English fremleje labels (the public form supports DA/EN). |
| application/language/english/recaptcha_lang.php | config | — | — | no | **CUSTOM** — English reCAPTCHA labels. |

---

## 8. CodeIgniter — views: public site, admin, layout (App A)

Views are rendered by controllers; none are URL-reachable (`—`). None touch the DB (clean separation) except where flagged.

| Path | Type | Reached by URL? | Includes | Touches DB? | Notes |
|---|---|---|---|---|---|
| application/views/layout/head.php | include | — | — | no | **Shared layout** `<head>`: jQuery/jQuery-UI/Bootstrap, fonts, screen.css; injects `$bgpic` bg. |
| application/views/layout/header.php | include | — | head.php, submenu.php | no | **Shared layout** public header (logo, nav by `$menucat`). Opens `.container` closed in bottom.php. |
| application/views/layout/submenu.php | include | — | — | no | **Shared layout** public contextual submenu. Duplicate logic of adminSubmenu.php. |
| application/views/layout/adminHeader.php | include | — | head.php, adminSubmenu.php | no | **Shared layout** admin header + edit-mode nav. Opens `.container` closed in bottom.php. |
| application/views/layout/adminSubmenu.php | include | — | — | no | **Shared layout** admin submenu; near-identical to submenu.php. |
| application/views/layout/footer.php | include | — | — | no | **Shared layout** — footer entirely commented out; only honors `$hidefooter`. Effectively a no-op. |
| application/views/layout/bottom.php | include | — | — | no | **Shared layout** — closes `</div></body></html>` (counterpart to header/adminHeader). |
| application/views/standart_page.php | include | — | standart_page_setup, layout/footer | no | Generic CMS text-page wrapper. |
| application/views/standart_page_setup.php | include | — | — | no | Shared partial: loops `$page` rows, contenteditable vs read-only by `$editable`. |
| application/views/small_standart_page.php | include | — | layout/footer | no | Near-duplicate of standart_page.php. |
| application/views/home_page.php | include | — | standart_page_setup, layout/footer | no | Front-page body; contains a "midlertidigt" manual-div hack + unbalanced markup. |
| application/views/portfolio.php | **dead** | — | — | no | ⚠ Not a view — just `{"test":"hej"}` JSON junk. |
| application/views/admin/dashboard.php | include | — | — | no | Static admin welcome box. |
| application/views/admin/login.php | include | — | layout/footer | no | Admin login form (`$showError`). |
| application/views/admin/useradm.php | include | — | layout/footer | no | User-admin: alumne autocomplete, role checkboxes, list `$useradm`, AJAX send-mail. |
| application/views/admin/editPageBox.php | include | — | standart_page_setup.php, layout/footer | no | CMS editor: CKEditor + KCFinder; iframes `pylon/editCalendar` and `news/listAndCreate`. |
| application/views/admin/statisticBox.php | include | — | — | no | Visitors-per-day jqplot chart. Stray `<head>` mid-page; near-dup of ansoeg_statistic_box. |
| application/views/admin/ansoeg_statistic_box.php | include | — | — | no | Applications/month jqplot chart. Stray `<head>` mid-page. |
| application/views/admin/test.php | **dead** | — | — | no | ⚠ Effectively empty (1 line) scratch file. |
| application/views/news/news_box.php | include | — | — | no | Front-page news widget: iframes `news/listBox` (`$oldStyleNews`) **or** Facebook plugin. Old branch dead. |
| application/views/news/news_ajax.php | include | — | layout/head.php | no | Iframe public news listing w/ pagination. Renders own DOCTYPE. Legacy. |
| application/views/news/show_box.php | include | — | layout/footer | no | Single-news article page. Legacy. |
| application/views/news/create_box.php | include | — | — | no | New-news editor (CKEditor) → `news/save`. Legacy. |
| application/views/news/edit_news_box.php | include | — | layout/head.php | no | Iframe paginated news list w/ edit/delete. Renders own DOCTYPE. Legacy. |
| application/views/news/begivenheder.php | include | — | — | no | Events page — ⚠ **event data hard-coded in a PHP array in the view**. |
| application/views/optagelse/overview.php | include | — | layout/footer | no | Admission landing; loops `$page` CMS rows + apply button. |
| application/views/optagelse/rundvisning_box.php | include | — | — | no | Tour-request form → `optagelse/send_rundvisning` + reCAPTCHA. Large dead commented blocks. |
| application/views/optagelse/fremlej_box.php | include | — | — | no | Sublet form (i18n) → `optagelse/send_fremleje` + reCAPTCHA. |
| application/views/optagelse/list_ansoegninger_box.php | include | — | layout/footer | no | Admin applications list (DataTables). |
| application/views/optagelse/show_ansoegninger_box.php | include | — | — | no | Single application detail + "set as received". |
| application/views/pylon/calendar_box.php | include | — | — | no | Pylon calendar widget (loops `$calendar`). |
| application/views/pylon/edit_calendar_template.php | include | — | layout/head.php | no | Iframe pylon-calendar editor → `pylon/save_calendar`. Own DOCTYPE. |
| application/views/recaptcha/recaptcha.php | **dead** | — | — | no | ⚠ Renders **reCAPTCHA v1** against `google.com/recaptcha/api/challenge` (dead service). Superseded by v2. |

---

## 9. CodeIgniter — views: internal "nyintern" area (App A)

`intern/header.php` + `intern/footer.php` are the shared internal layout (used by `MY_Controller::showInternPage()`). **⚠ The `alumneliste/` and `mydata/` subfolders are largely stray copies of the old flat-file App B dropped into the views tree** — they open their own DB connections, run raw SQL, call `mail()`/`session_start()`, and emit full HTML. They are not reachable directly (under `application/`), but they leak secrets and are a porting hazard.

| Path | Type | Reached by URL? | Includes | Touches DB? | Notes |
|---|---|---|---|---|---|
| application/views/intern/header.php | include | — | — | no | **Shared internal layout** header (navbar/sidebar via `menuItem()`). |
| application/views/intern/footer.php | include | — | — | no | **Shared internal layout** footer (bug-min.js / noko-lugter.js). |
| application/views/intern/login.php | include | — | — | no | Internal login form. |
| application/views/intern/dashboard.php | include | — | — | no | ⚠ Dashboard; **prints WiFi password + Google-calendar creds in plaintext** (gated by `insideGAHK()`). |
| application/views/intern/editinfo.php | include | — | — | no | Edit email/phone form. |
| application/views/intern/changepass.php | include | — | — | no | Change-password form. |
| application/views/intern/forgotpass/forgotpass.php | include | — | — | no | Forgot-password email form. |
| application/views/intern/forgotpass/vispass.php | include | — | — | no | ⚠ Shows a temporary password in plaintext to the user. |
| application/views/intern/ak.php | include | — | — | no | Personal AK-duty log + add/delete forms. |
| application/views/intern/adminAk.php | include | — | — | no | AK-duty admin: reset-period + status table. |
| application/views/intern/stamtree.php | include | — | — | no | D3.js family/lineage tree (`$treeOut` → JS). |
| application/views/intern/statistik.php | include | — | — | no | Stats dashboard; AJAX `$.get` to statistik endpoints → Morris charts. |
| application/views/intern/statusreply.php | include | — | — | no | Tiny JSON AJAX reply (`{"status":...}`). |
| application/views/intern/activeshoppers.php | include | — | — | no | JSON list of shoppers (name, saldo). JSON endpoint output. |
| application/views/intern/shopperlist.php | include | — | — | no | JSON shopper list; ⚠ hardcodes two "fremlejer" people in the view. |
| application/views/intern/oelkaelderadmin.php | include | — | — | no | Beer-cellar admin (debt/deposit table, report generators). |
| application/views/intern/oelkaelderassortment.php | include | — | — | no | Product/price/image editor (defines `cmp()` in view). |
| application/views/intern/oelkaelderoverview.php | include | — | — | no | Per-shopper balance/transaction overview (month selector). |
| application/views/intern/oelkaelderproducts.php | include | — | — | no | Products as JSON (price_steps, imageurl). |
| application/views/intern/oelkaelderreport.php | include | — | — | no | Plain-HTML deposit report table (no layout wrapper; print/export). |
| application/views/intern/oelkaeldersales.php | include | — | — | no | Plain-HTML sales report table (no layout wrapper). |
| application/views/intern/oelkaeldersalesquantity.php | include | — | — | no | Plain-HTML sales-quantity table (no layout wrapper). |
| application/views/intern/oelkealderallsales.php | include | — | — | no | Global sales overview. ⚠ filename misspelled "oelkealder". |
| application/views/intern/soegvaerelse/overview.php | include | — | — | no | Room-search overview; canvas floor-maps via vaerelse.js; iframes kvotient detail. |
| application/views/intern/soegvaerelse/soeg.php | include | — | — | no | Room-application wizard (priorities, orlov); AJAX to getKAsJson. |
| application/views/intern/soegvaerelse/admin.php | include | — | — | no | Room-offer admin. ⚠ hardcoded easter-egg behaviour keyed on `alumne_id===254`. |
| application/views/intern/soegvaerelse/kvotientDetailFrame.php | include | — | — | no | Standalone iframe page (own full HTML) showing kvotient calc. |
| application/views/intern/vaerelsestjek/overview.php | include | — | — | no | Room-check floor-plan overview; JS per-room buttons → besvar. |
| application/views/intern/vaerelsestjek/besvar.php | include | — | form_open() | no | Room-check answer form (scores, comments, image upload). |
| application/views/intern/vaerelsestjek/akoverview.php | include | — | — | no | Room-check AK overview DataTable + CSV/Excel export. |
| application/views/intern/alumneliste/index.php | include (stray script) | — | ../delt.php, config.php, ../adodb5/adodb.inc.php | **yes** | ⚠ **Stray copy of App B** — opens own ADOdb connection, queries, `header()` redirects. |
| application/views/intern/alumneliste/liste.php | include (stray script) | — | adodb5/adodb.inc.php, config.php, evalPostArray.php, formsAndSubmitButtons.php; requires delt.php | **yes** | ⚠ Stray hybrid — own DB connection, many raw `$month`-interpolated queries (SQLi). |
| application/views/intern/alumneliste/json.php | include (stray script) | — | requires delt.php, adodb5/adodb.inc.php | **yes** | ⚠ Stray — own connection, hand-built JSON from raw SQL. |
| application/views/intern/alumneliste/konfigurer.php | include (stray script) | — | delt.php, adodb5/adodb.inc.php | **yes** | ⚠ Stray — INSERT/UPDATE/DELETE from `$_POST` (SQLi), own header. |
| application/views/intern/alumneliste/evalPostArray.php | include (stray script) | — | (included by liste) | **yes** | ⚠ Stray — `$db->Execute/AutoExecute` with unescaped `$_POST` incl. **table name** (SQLi) + `mail()`. |
| application/views/intern/alumneliste/formsAndSubmitButtons.php | include (stray script) | — | form_open() | **yes** | ⚠ Stray — runs inline `$db->GetAll` SELECTs. |
| application/views/intern/alumneliste/config.php | include (stray secrets) | — | — | no | ⚠ **Stray copy — hardcodes ALL admin passwords + MySQL credentials in plaintext.** |
| application/views/intern/alumneliste/head.php | include (stray script) | — | — | no | ⚠ Stray `<head>` for the flat-file app; references assets absent from CI tree. |
| application/views/intern/alumneliste/delt.php | include (stray secrets) | — | — | no | ⚠ Stray copy of App B's `delt.php` shared lib (creds/passwords/helpers). |
| application/views/intern/alumneliste/mailAll.php | include (stray script) | — | ../delt.php, ../adodb5/adodb.inc.php | **yes** | ⚠ Stray mass-mail form; own connection; password-gated. |
| application/views/intern/alumneliste/mailAllDone.php | include (stray script) | — | ../delt.php, ../adodb5/adodb.inc.php | **yes** | ⚠ Stray mail-send handler; own connection; `mail()`. |
| application/views/intern/mydata/mydata.php | include (stray script) | — | delt.php, adodb5/adodb.inc.php | **yes** | ⚠ **Rendered as the view for `nyintern/mydata`** yet opens own ADOdb connection, INSERT/DELETE devices from `$_POST` (SQLi). Hybrid mess. |
| application/views/intern/mydata/index.php | include (stray script) | — | ../delt.php, ../adodb5/adodb.inc.php | **yes** | ⚠ Stray — `session_start()`, own connection, INSERT/DELETE `macaddress_temp`, `mail()`, `$_COOKIE`; SQLi via `$_POST['email']`. |
| application/views/intern/mydata/approved.php | include (stray script) | — | ../delt.php, ../adodb5/adodb.inc.php | **yes** | ⚠ Stray — MAC allowlist gated by hardcoded `$_GET` password `'mLXAC6V2wf'`. |
| application/views/intern/mydata/delt.php | include (stray secrets) | — | — | no | ⚠ Stray copy of `delt.php` — creds + all passwords in plaintext. |
| application/views/intern/mydata/findMacAddressMAC.php | include (stray script) | — | ../delt.php | no | ⚠ Stray static guide page (macOS); uses insertHeader/Footer from delt.php. |
| application/views/intern/mydata/findMacAddressPC.php | include (stray script) | — | ../delt.php | no | ⚠ Stray static guide page (Windows). |

---

## 10. Flat-file "intern" app (App B — served directly under `/intern/`)

Procedural PHP, **no framework**. Every page `include`s `../delt.php` (the shared bootstrap that hardcodes DB creds + ~8 plaintext admin passwords + the helper library + the `atGAHK()` IP allowlist). Auth model throughout = compare a typed password (`===`) against a `delt.php` variable, **no sessions**, password re-posted as a hidden field each action. **Pervasive SQL injection** via raw `$_GET`/`$_POST`/`$month` interpolation. ⚠ `intern/index.php` redirects to `/nyintern` → the whole tree is **superseded** by App A.

| Path | Type | Reached by URL? | Includes | Touches DB? | Notes |
|---|---|---|---|---|---|
| intern/index.php | entry-point | /intern/ | — | no | Bare redirect to `gahk.dk/nyintern`. **Confirms the tree is superseded.** |
| intern/classic.php | entry-point | /intern/classic.php | delt.php, adodb5/adodb.inc.php | yes | Old front page (electricity chart from `intern_forbrug`). No auth; `atGAHK()` gates a plaintext WiFi password. |
| intern/delt.php | config + db + helper | — | — | no (defines creds/helpers) | ⚠ **Linchpin.** Hardcoded MySQL creds + multiple plaintext passwords, `atGAHK()` IP allowlist, room/month data, and the entire helper lib (`insertHeader`, `selector`, `mailFormatted2`, …). Included by every page. |
| intern/menu/menu.php | include | — | (via insertHeader) | no | Nav menu — entire `<ul>` HTML-commented out → renders empty. Effectively dead but still included. |
| intern/alumneliste/index.php | entry-point | /intern/alumneliste/ | ../delt.php, config.php, ../adodb5/adodb.inc.php | yes | Alumni-list landing/chooser. No password to view; `atGAHK()` bypass. Deprecated ADOdb `mysql` driver. |
| intern/alumneliste/liste.php | entry-point | /intern/alumneliste/liste.php | ../delt.php, ../adodb5, config.php, head.php, evalPostArray.php, formsAndSubmitButtons.php | yes | Core list view/edit. Plaintext-password tiers or `atGAHK()` IP. ⚠ many `$month`-interpolated queries (SQLi). |
| intern/alumneliste/config.php | config | — | (by liste.php) | no | `$tableColumns`/`$showExtra` + `sort_keyword()`. Reads `$_POST` columns (reflected). |
| intern/alumneliste/evalPostArray.php | include | — | (by liste.php) | yes | POST-action handler (add/remove/edit/copy/delete). ⚠ interpolates `$month`, `$origVar` (table name!) into SQL. No own auth. |
| intern/alumneliste/formsAndSubmitButtons.php | include | — | (by liste.php) | yes | Admin form fragment; `$month`-interpolated SELECTs. No own auth. |
| intern/alumneliste/head.php | include | — | (by liste.php) | no | `<head>` fragment (DataTables/jQuery/validity). |
| intern/alumneliste/konfigurer.php | entry-point | /intern/alumneliste/konfigurer.php | ../delt.php, ../adodb5 | yes | Workgroup/email-settings admin. Plaintext-password auth. ⚠ SQLi via several `$_POST` fields. |
| intern/alumneliste/mailAll.php | entry-point | /intern/alumneliste/mailAll.php | ../delt.php, ../adodb5 | yes | Mass-mail compose. Plaintext-password auth. ⚠ `$month` SQLi. |
| intern/alumneliste/mailAllDone.php | entry-point | /intern/alumneliste/mailAllDone.php | ../delt.php, ../adodb5 | yes | Sends the bulk mail. ⚠ open mass-mailer if password leaks; spoofable From; `$month` SQLi. |
| intern/kvotient/index.php | entry-point | /intern/kvotient/ | ../delt.php | no | Static link hub for room-application module. Likely abandoned (→ nyintern/soegvaerelse). |
| intern/kvotient/udregn.php | entry-point | /intern/kvotient/udregn.php | ../delt.php | no | Public quotient calculator + form → `sendtKvotient.php` (GET). |
| intern/kvotient/sendtKvotient.php | entry-point | /intern/kvotient/sendtKvotient.php | ../delt.php, settings.php, ../adodb5 | yes | Receives public application (GET), INSERT `intern_kvotient`, emails indstillingen. No auth. AutoExecute (bound) but unsanitized mail. |
| intern/kvotient/settings.php | config | — | (by sendtKvotient) | no | One line: `$numberOfPriorities = 9`. |
| intern/kvotient/seAnsoegninger.php | entry-point | /intern/kvotient/seAnsoegninger.php | ../delt.php, ../adodb5 | yes | Lists/admins applications. Plaintext-password auth. ⚠ can **TRUNCATE `intern_kvotient`** on POST; SQLi via `$_POST`. |
| intern/kvotient/seAnsoeningerLogin.php | entry-point | /intern/kvotient/seAnsoeningerLogin.php | ../delt.php | no | Login form → seAnsoegninger.php. ⚠ misspelled filename. |
| intern/kvotient/adminAnsoegninger.php | entry-point | /intern/kvotient/adminAnsoegninger.php | ../delt.php | no | Tiny login form → seAnsoegninger.php. |
| intern/kvotient/plantegning.php | entry-point | /intern/kvotient/plantegning.php | ../delt.php | no | Displays floor-plan PNG. No auth/DB. |
| intern/mydata/index.php | entry-point | /intern/mydata/ | ../delt.php, ../adodb5 | yes | Login + "temp MAC access" (+commented credential-send). No auth to reach. ⚠ SQLi via `$_POST['email']`/`$mac`; self-service network-access abuse risk. |
| intern/mydata/mydata.php | entry-point | /intern/mydata/mydata.php | ../delt.php, ../adodb5 | yes | Member dashboard: change pw/contact, add/remove MAC devices; admin sees all. sha256 pw auth. ⚠ SQLi via several vars. **MAC feature confirmed no longer used (2026-06) → dead; delete.** |
| intern/mydata/approved.php | entry-point (machine) | /intern/mydata/approved.php | ../delt.php, ../adodb5 | yes | Outputs all approved MACs if `?password=mLXAC6V2wf` (plaintext secret in URL). **MAC feature confirmed no longer used (2026-06) → dead; delete (no consumer to coordinate with).** |
| intern/mydata/findMacAddressMAC.php | entry-point | /intern/mydata/findMacAddressMAC.php | ../delt.php | no | Static how-to (macOS). |
| intern/mydata/findMacAddressPC.php | entry-point | /intern/mydata/findMacAddressPC.php | ../delt.php | no | Static how-to (Windows). |
| intern/pylon/index.php | entry-point | /intern/pylon/ | ../delt.php | no | Pylon landing (two password forms). |
| intern/pylon/pylon.php | entry-point | /intern/pylon/pylon.php | ../delt.php, ../adodb5, head.php | yes | Pylon mailing-list admin. Plaintext-password auth. ⚠ SQLi via `$_POST['removeByEmail']`. |
| intern/pylon/pylonMail.php | entry-point | /intern/pylon/pylonMail.php | ../delt.php, ../adodb5 | yes | Sends group email to pyloners. Plaintext-password auth. Mail-injection-ish risk. |
| intern/pylon/pylonSignup.php | entry-point | /intern/pylon/pylonSignup.php | ../delt.php, ../adodb5 | yes | Public self-signup. ⚠ SQLi via raw `$_GET['email']`. |
| intern/pylon/admin.php | entry-point | /intern/pylon/admin.php | ../delt.php, ../adodb5 | yes | Public unsubscribe via `randCode` match. ⚠ SQLi via raw `$_GET['email']`; no password needed. |
| intern/pylon/head.php | include | — | — | no | `<head>` fragment for pylon.php. |
| intern/handbook/index.php | entry-point | /intern/handbook/ | ../delt.php, ../adodb5 | yes | Handbook reader. `atGAHK()` IP OR shared password. ⚠ SQLi via `$_GET['id']`; renders stored HTML unescaped (stored XSS). |
| intern/handbook/admin.php | entry-point | /intern/handbook/admin.php | ../delt.php, config.php, ../adodb5 | yes | Handbook CMS admin (TinyMCE). Plaintext-password auth. ⚠ **Unrestricted file upload (client basename) → RCE risk**; SQLi via `$_POST['ID']`. |
| intern/handbook/config.php | config | — | (by handbook pages) | no | Trivial: `$pageWidth='900px'`. |
| intern/andet/index.php | entry-point | /intern/andet/ | ../delt.php | no | "Andet" section index + password form → forbrugAdmin.php. |
| intern/andet/forbrugAdmin.php | entry-point | /intern/andet/forbrugAdmin.php | ../delt.php, ../adodb5 | yes | Electricity-consumption admin (JSChart). Plaintext-password auth. ⚠ SQLi via `$_POST['entryToRemove']`. |
| intern/andet/junkfood.php | entry-point | /intern/andet/junkfood.php | ../delt.php | no | Static takeaway photos. |
| intern/andet/kalender.php | entry-point | /intern/andet/kalender.php | ../delt.php | no | Static Google-Calendar iframe. |
| intern/andet/kontaktgrupper.php | entry-point | /intern/andet/kontaktgrupper.php | ../delt.php | no | Static group mailto list. Not linked from index — possibly orphaned but reachable. |
| intern/mailliste/index.php | entry-point | /intern/mailliste/ | ⚠ ../validEmail.php (MISSING), ../delt.php | yes (legacy `mysql_*`) | Public subscribe/unsubscribe. ⚠ deprecated `mysql_*`; SQLi via raw `$_GET['email']`; **broken include** (validEmail.php absent). Mojibake output. |
| intern/mailliste/mailadmin.php | entry-point | /intern/mailliste/mailadmin.php | ../delt.php, ⚠ ../validEmail.php (MISSING) | yes (legacy `mysql_*`) | Mailing-list admin; sends mail+attachment to all; "send password" emails plaintext pw to a Gmail. ⚠ deprecated `mysql_*`; **unrestricted upload** (client basename); broken include; major concern. |
| intern/gahkhjerne/index.php | entry-point | /intern/gahkhjerne/ | ../delt.php | no | Static fileserver/landing page + download links. |
| intern/gahkhjerne/mapperOgBrugernavne.php | entry-point | /intern/gahkhjerne/mapperOgBrugernavne.php | ../delt.php | no | ⚠ Static table exposing fileserver share usernames in cleartext. |
| intern/gahki/index.php | entry-point | /intern/gahki/ | ../delt.php | no | Redirect-only: if `atGAHK()` → router `192.168.0.1`, else back with error. |
| intern/PR/index.php | entry-point | /intern/PR/ | ../delt.php, ⚠ config.php (MISSING) | no | Google-Docs T-shirt order-form iframe. **Broken include** (PR/config.php absent). |
| intern/PR/shop.php | entry-point | /intern/PR/shop.php | ../delt.php | no | Spreadshirt shop banner/popup. Likely superseded by PR/index.php. |
| intern/m/index.php | entry-point | /intern/m/ | ../delt.php | no | Redirect stub → alumneliste mobile. insertHeader/Footer after `header()` is dead code. |
| intern/rengoering/index.php | entry-point | /intern/rengoering/ | ../delt.php | no | Static cleaning-schedule PDF index. |
| intern/telefonliste/index.php | entry-point | /intern/telefonliste/ | ../menu/menu.php (not delt.php) | no (scrapes another page) | ⚠ vCard exporter: opens a raw socket to www.gahk.dk, POSTs **hardcoded password `ymer`** to alumneliste/liste.php, regex-scrapes the HTML, emits `.vcf`. Fragile screen-scrape; unique (no delt.php). |
| intern/printer/index.php | entry-point | /intern/printer/ | ../delt.php | no | Printer-guide index (links to per-OS guides + PDFs). Static. |
| intern/printer/canonWin.php | entry-point | /intern/printer/canonWin.php | ../delt.php | no | Static how-to (Canon MF5770). |
| intern/printer/duplex.php | entry-point | /intern/printer/duplex.php | ../delt.php | no | Static how-to (duplex printing). |
| intern/printer/HPM4555.php | entry-point | /intern/printer/HPM4555.php | ../delt.php | no | Static how-to (HP M4555 Windows). |
| intern/printer/HPM4555mac.php | entry-point | /intern/printer/HPM4555mac.php | ../delt.php | no | Static placeholder ("guide coming soon" — body commented out). Near-stub. |
| intern/printer/win7.php | entry-point | /intern/printer/win7.php | ../delt.php | no | Static how-to (old HP 4345, Win7/Vista). Superseded printer. |
| intern/printer/winxp.php | entry-point | /intern/printer/winxp.php | ../delt.php | no | Static how-to (old HP 4345, WinXP). Superseded printer. |

---

## 11. `public/` — bespoke PHP + library entry points

`public/` is served directly. The three `misc/` files are bespoke micro-APIs; the rest is the **KCFinder** file-manager (old vendor lib, v2.51) plus CKEditor/jqplot demo scraps.

| Path | Type | Reached by URL? | Includes | Touches DB? | Notes |
|---|---|---|---|---|---|
| public/misc/json.php | entry-point | /public/misc/json.php | — | no | Bespoke: echoes hardcoded JSON product list, CORS `*`. Static. |
| public/misc/json2.php | entry-point | /public/misc/json2.php | — | no | Bespoke: longer hardcoded product list. Static. |
| public/misc/oel_alumneliste.php | entry-point | /public/misc/oel_alumneliste.php | — | no | Bespoke: hardcoded "alumner"+beer-balance JSON. Despite the name, **no DB** — sample data. |
| public/js/kcfinder/upload.php | entry-point | /public/js/kcfinder/upload.php | core/autoload.php | no | ⚠ **Primary file-upload attack surface.** No intrinsic auth — gated only by `config.php disabled` flag/session; defense is an extension **blocklist** (risky). |
| public/js/kcfinder/browse.php | entry-point | /public/js/kcfinder/browse.php | core/autoload.php | no | ⚠ File-manager browser (list/delete/copy/move/zip). No intrinsic auth. |
| public/js/kcfinder/css.php | entry-point | /public/js/kcfinder/css.php | core/autoload.php | no | Dynamic CSS generator (instantiates browser). Asset endpoint. |
| public/js/kcfinder/js_localize.php | entry-point | /public/js/kcfinder/js_localize.php | core/autoload.php, lang/<lng>.php | no | Emits JS labels for `$_GET['lng']`; whitelisted against lang dir (traversal mitigated). |
| public/js/kcfinder/config.php | config | — | references `$_SESSION['KCFINDER']` | no | KCFinder base config. **`disabled => true`** by default; `deniedExts` blocks php/exe/etc. |
| public/js/kcfinder/core/autoload.php | helper | — | conditionally integration/drupal.php (`?cms=drupal`), core/*, lib/* | no | Bootstrap + `__autoload`. |
| public/js/kcfinder/core/browser.php | asset-handler | — | extends uploader | no | Browser class: dir listing/thumbnails/file ops. |
| public/js/kcfinder/core/uploader.php | asset-handler | — | uses input class | no | ⚠ Uploader class: the real upload logic behind upload.php. |
| public/js/kcfinder/core/types/type_img.php | helper | — | uses gd | no | Upload validator (image via GD). |
| public/js/kcfinder/core/types/type_mime.php | helper | — | uses finfo | no | Upload validator (MIME via finfo). |
| public/js/kcfinder/integration/drupal.php | dead | — | conditionally Drupal bootstrap | no | Drupal integration — only loaded with `?cms=drupal`; no Drupal here → inert/dead. |
| public/js/kcfinder/js/browser/joiner.php | entry-point | /public/js/kcfinder/js/browser/joiner.php | lib/helper_httpCache.php, lib/helper_dir.php | no | JS concatenator/bundler. Benign static-asset server. |
| public/js/kcfinder/lib/class_gd.php | helper | — | — | no | GD image wrapper. |
| public/js/kcfinder/lib/class_input.php | helper | — | — | no | Input normalizer ($_GET/$_POST/$_COOKIE). |
| public/js/kcfinder/lib/class_zipFolder.php | helper | — | uses ZipArchive | no | Dir→ZIP archiver. |
| public/js/kcfinder/lib/helper_dir.php | helper | — | — | no | Directory helper. |
| public/js/kcfinder/lib/helper_file.php | helper | — | — | no | File helper (ext/path/size). |
| public/js/kcfinder/lib/helper_httpCache.php | helper | — | — | no | HTTP-cache (mtime/304). |
| public/js/kcfinder/lib/helper_path.php | helper | — | — | no | Path helper. |
| public/js/kcfinder/lib/helper_text.php | helper | — | — | no | Text/CSS/JS compression helper. |
| public/js/kcfinder/tpl/tpl_browser.php | asset-handler | — | tpl_css.php, tpl_javascript.php | no | Browser-UI HTML template (rendered in class context). |
| public/js/kcfinder/tpl/tpl_css.php | asset-handler | — | references css.php | no | `<link>` template fragment. |
| public/js/kcfinder/tpl/tpl_javascript.php | asset-handler | — | references joiner.php, js_localize.php | no | `<script>` template fragment. |
| public/js/kcfinder/lang/*.php (24 files) | config | — | — | no | Localization arrays (vendor). Not entry points. |
| public/js/ckeditor/samples/assets/posteddata.php | dead | /public/js/ckeditor/samples/assets/posteddata.php | — | no | ⚠ CKEditor demo — dumps `$_POST` back; uses deprecated `get_magic_quotes_gpc`. **Should not be deployed.** |
| public/js/ckeditor/samples/sample_posteddata.php | dead | /public/js/ckeditor/samples/sample_posteddata.php | posteddata.php | no | ⚠ CKEditor demo wrapper. **Should not be deployed.** |
| public/js/jqplot/examples/kcp_pyramid_by_age.php | dead | /public/js/jqplot/examples/kcp_pyramid_by_age.php | — | no | jqplot example (static chart; data via client AJAX). Vendor sample. |

---

## 12. Disabled / backup files (`.php_`) — all dead

26 files renamed with a trailing underscore so PHP won't execute them — i.e. **disabled backups/old versions**. Not live code; listed for completeness. Several are *older variants of files that still exist live* (e.g. `MY_Controller.php_`, `routes.php_`, `database.php_`, the `news/*_box.php_`, `layout/*.php_`), so they are useful only as historical diffs.

```
application/config/autoload.php_      application/config/config.php_
application/config/database.php_      application/config/recaptcha.php_
application/config/routes.php_        application/core/MY_Controller.php_
application/helpers/counter_helper.php_   application/helpers/recaptchalib_helper.php_
application/hooks/Yield.php_          application/language/danish/form_validation_lang.php_
application/language/danish/fremleje_lang.php_   application/language/danish/recaptcha_lang.php_
application/language/english/fremleje_lang.php_  application/language/english/recaptcha_lang.php_
application/views/admin/editPageBox.php_         application/views/layout/adminHeader.php_
application/views/layout/footer.php_  application/views/layout/head.php_
application/views/news/create_box.php_    application/views/news/edit_news_box.php_
application/views/news/news_ajax.php_     application/views/news/news_box.php_
application/views/news/show_box.php_      application/views/pylon/calendar_box.php_
application/views/recaptcha/recaptcha.php_   application/views/standart_page.php_
```

Note `application/helpers/counter_helper.php_` and `application/hooks/Yield.php_` have **no live `.php` counterpart** — the counter logic now lives in `MY_Controller::counter()` and hooks are disabled, so these are fully abandoned.

---

## 13. Vendor / framework bundles (NOT enumerated file-by-file)

Third-party code; out of scope for the rewrite except as behaviour to reproduce. Counts are PHP files.

| Bundle | Location | PHP files | What it is / disposition |
|---|---|---|---|
| CodeIgniter 2.x core | `system/` | 127 | The framework. Replace wholesale with Django. |
| MediaWiki | `wiki/` | ~5030 | A complete, **separate** MediaWiki install (own `index.php`, `api.php`, `load.php`, `LocalSettings.php`, …). Standalone app — migrate/host independently of the Django rewrite. |
| ADOdb (copy 1) | `intern/adodb5/` | 170 | DB-abstraction lib used by App B. |
| ADOdb (copy 2) | `application/views/intern/alumneliste/adodb5/` | 178 | ⚠ **Duplicate** ADOdb, used by the stray scripts in §9. |
| ADOdb (copy 3) | `application/views/intern/mydata/adodb5/` | 170 | ⚠ **Duplicate** ADOdb, used by the stray scripts in §9. |
| TinyMCE | `intern/tools/tinymce/` | (JS/HTML; ~0 bespoke PHP) | WYSIWYG editor for handbook admin. Vendor. |
| Front-end libs | `public/bootstrap/`, `public/freshGAHK/`, `public/css/`, `intern/dataTables/`, `intern/jqueryui/`, `intern/jQuery.validity/`, `intern/jscharts.js`, `intern/jquery.min.js` | 0 | Pure CSS/JS/asset bundles. |
| CI user guide | `user_guide/` | 0 | CodeIgniter HTML manual. Delete. |
| Abandoned test dir | `intern/test/` | 0 | Only `index.html` + a stray `test.jar`. Abandoned. |

---

## A. Config / DB-connection / bootstrap files → document in Phase 1

The minimum set needed to understand how either app boots, connects to the DB, authenticates, and is configured:

**App A (CodeIgniter):**
1. `index.php` — front controller / bootstrap.
2. `.htaccess` (root) — URL rewriting, the `intern|wiki|public` carve-outs, host redirect.
3. `application/config/database.php` — **DB connection** (mysqli, db `gahk_dk`, plaintext password).
4. `application/config/config.php` — base_url, encryption key, **session settings** (DB-backed `gahk_dk_sessions`), CSRF/XSS flags.
5. `application/config/autoload.php` — what loads on every request (database + url helper).
6. `application/config/routes.php` — URL → controller map, incl. the `nyintern/*` wildcard.
7. `application/config/email.php` — **SMTP credentials** (plaintext).
8. `application/config/recaptcha.php` — **reCAPTCHA keys** (plaintext).
9. `application/core/MY_Controller.php` — base controller: session bootstrap, intern layout wrapper, visit counter, reminder mail.

**App B (flat-file intern):**
10. `intern/delt.php` — **the App B bootstrap**: DB credentials + ~8 plaintext app passwords + `atGAHK()` IP allowlist + the shared helper library. Single most important file to document.
11. `intern/kvotient/settings.php`, `intern/handbook/config.php`, `intern/alumneliste/config.php` — small per-module config fragments.

> **Phase-1 security callout:** plaintext secrets live in `database.php`, `email.php`, `recaptcha.php`, `intern/delt.php`, and the stray `…/alumneliste/config.php` + `…/mydata/delt.php` copies. Treat all of these (and the DB) as compromised; rotate on cutover.

## B. Shared layout files (header / footer / nav / common templates)

**App A — public/admin site:**
- `application/views/layout/head.php` — `<head>` (CSS/JS).
- `application/views/layout/header.php` — public header + main nav (includes head + submenu).
- `application/views/layout/submenu.php` — public contextual submenu.
- `application/views/layout/adminHeader.php` — admin header + edit nav (includes head + adminSubmenu).
- `application/views/layout/adminSubmenu.php` — admin submenu (near-dup of submenu).
- `application/views/layout/footer.php` — footer (currently a near-no-op; body commented out).
- `application/views/layout/bottom.php` — closing tags (pairs with header/adminHeader).
- `application/views/standart_page_setup.php` — shared CMS content partial.

**App A — internal "nyintern" area:**
- `application/views/intern/header.php` — internal header/nav (used by `MY_Controller::showInternPage()`).
- `application/views/intern/footer.php` — internal footer.

**App B — flat-file intern:**
- `intern/delt.php` → `insertHeader()` / `insertFooter()` (the layout is emitted by these functions, not a template file).
- `intern/menu/menu.php` — nav fragment (currently commented out / empty).
- `intern/alumneliste/head.php`, `intern/pylon/head.php` — per-module `<head>` fragments.

## C. Suspected dead code (with evidence)

**High confidence — dead/abandoned:**
- `application/controllers/phpinfo.php` — bare `phpinfo()`, not a controller class; debug leftover.
- `application/views/portfolio.php` — contains only `{"test":"hej"}`; not a usable view.
- `application/views/admin/test.php` — ~1 line, empty scratch file.
- `application/views/recaptcha/recaptcha.php` (+ its `.php_`) — targets reCAPTCHA **v1** (`api/challenge`), a service Google shut down; superseded by v2 in the live forms.
- **All 26 `.php_` files** (§12) — disabled by extension; `counter_helper.php_` and `hooks/Yield.php_` have no live counterpart at all.
- `application/views/intern/alumneliste/*` and `application/views/intern/mydata/{index,approved,findMacAddress*,delt}.php` — stray copies of App B inside the CI views tree; unreachable directly and not loaded by any controller (only `mydata/mydata.php` is actually rendered). They mainly leak secrets. *(Evidence: under `application/`, blocked from direct access; no `$this->load->view()` references them except `intern/mydata/mydata`.)*
- `public/js/ckeditor/samples/.../posteddata.php` + `sample_posteddata.php` — vendor demo scripts (shipped sample dir).
- `public/js/kcfinder/integration/drupal.php` — only runs under `?cms=drupal`; not a Drupal site → inert.
- `intern/test/` — only an orphan `test.jar` + empty `index.html`.

**Likely superseded by App A ("nyintern") — verify before deleting:**
- **Effectively the entire `intern/` flat-file tree.** *Evidence:* `intern/index.php` redirects to `/nyintern`; `intern/menu/menu.php`'s menu is fully commented out; App A has same-named, more modern replacements (`nyintern/alumneliste`, `nyintern/soegvaerelse` ⇄ `intern/kvotient`, `nyintern/oelkaelder`, `nyintern/mydata`).
- ~~Probable still-live exceptions inside `intern/`~~ — **RESOLVED (2026-06): the MAC-address feature is no longer used.** `intern/mydata/*` (incl. `approved.php`, `mydata.php`, `index.php`) is therefore **dead — delete with the rest of the tree, nothing to port.** This also makes the entangled App A controller `nyintern/mydata` and its rendered view (`application/views/intern/mydata/mydata.php`) dead.
- `application/models/stamtree_model.php` — only `getAllAlumner()` is unique; its `gahk_ansoegninger*` methods duplicate `ansoegninger_model` and appear unused (dead within this model).
- `intern/PR/shop.php` (Spreadshirt) — appears replaced by `PR/index.php` (Google form).
- `intern/printer/win7.php`, `winxp.php`, `HPM4555mac.php` — reference "old printer"/"guide coming soon"; likely outdated.
- `intern/andet/kontaktgrupper.php` — not linked from its section index (orphaned, though still URL-reachable).

**Broken (references a file that does not exist):**
- `intern/mailliste/index.php` & `intern/mailliste/mailadmin.php` → `include ../validEmail.php` (file absent). Also still on the removed `mysql_*` API.
- `intern/PR/index.php` → `include config.php` (no `intern/PR/config.php` exists).

---

### Open questions to resolve before Phase 1
1. **Is any of `intern/` still served in production**, or is it fully behind the `/nyintern` redirect? *(The MAC-access feed — previously the key open item here — is **resolved: no longer used**, so it no longer blocks retiring the tree.)*
2. **Which reCAPTCHA is live** — the v2 keys in `recaptcha.php` config suggest v2; confirm the v1 view is truly unused.
3. **Is the `wiki/` MediaWiki in scope** for the rewrite at all, or does it stay as a separate system?
4. **KCFinder**: is `config.php`'s `disabled => true` actually in force in production, or is it enabled via session somewhere (it's wired into the admin CKEditor)? That determines whether the upload endpoint is a live risk.
