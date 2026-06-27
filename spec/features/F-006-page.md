# Feature: Page — public CMS page renderer + inline page editor

- **Feature ID:** F-006
- **Source file(s):** `application/controllers/page.php`, `application/models/page_model.php`,
  views `application/views/{home_page,standart_page,standart_page_setup,small_standart_page}.php`,
  `application/views/admin/editPageBox.php`,
  `application/views/layout/{header,adminHeader,bottom,head,footer}.php`,
  `application/views/news/{begivenheder,news_ajax}.php`
  (constructor also pulls `application/core/MY_Controller.php` counter + reminder; reads `application/models/news_model.php` via `altfrontpage`)
- **URL / route:** `default_controller = page/show/1`. This controller renders the entire public-facing
  Danish site. **All named-slug routes below MUST be preserved verbatim for SEO** (they 301/route to a
  numeric `page/show/N`):
  - `/` (root) → `page/show/1`
  - `velkommen` → `page/show/1` (front page)
  - `faciliteter` → `page/show/2`
  - `kollegielivet` → `page/show/3`
  - `vision` → `page/show/22`
  - `legater` → `page/show/4`
  - `kontakt` → `page/show/21`
  - `faciliteter/vaerelse` → `page/show/10`
  - `faciliteter/faellesomraede` → `page/show/11`
  - `faciliteter/kokken` → `page/show/12`
  - `legater/modtagne` → `page/show/18`
  - `kollegielivet/historie` → `page/show/14`
  - `kollegielivet/aaretsgang` → `page/show/15`
  - `kollegielivet/alumnerne` → `page/show/20`
  - `kollegielivet/selvstyre` → `page/show/16`
  - `kollegielivet/bestyrelse` → `page/show/17`
  - direct controller paths: `/page/show/{id}`, `/page/altfrontpage`, `/page/edit/{id}[/success|/successbg|/deletesuccess]`, `/page/save/{id}` (POST), `/page/savebg/{id}` (POST)
  - ⚠ Note `optagelse` (menuCat 6) is **not** served by this controller — it routes to the `optagelse` controller (F-001). The page rows 6/7/8/9 are CMS bodies that controller reads.
- **HTTP method(s):** GET (`index`, `show`, `altfrontpage`, `edit`); POST (`save`, `savebg`). ⚠ `save`/`savebg`
  are not method-guarded in code — see findings.
- **Access control:**
  - `index`, `show`, `altfrontpage` — **public**, no auth.
  - `edit`, `save`, `savebg` — gated **inline** (no central guard) on session `username` truthy **and**
    session `editpage` truthy. Uses standard CI session userdata (see `01-infrastructure.md` A4/A5).
    Pattern in all three: `if(!$username){ redirect("admin"); } else if(!$editpage){ echo "No rights to visit this page"; } else { … }`.

**Routes / actions:**
| Action | URL | Method | Access | Purpose |
|---|---|---|---|---|
| `index` | `/` , `/page` | GET | public | front page (delegates to `show(1)`) |
| `show($id)` | `/page/show/{id}` + all named slugs above | GET | public | render one CMS page by id |
| `altfrontpage` | `/page/altfrontpage` | GET | public | alternate front page (standart layout + legacy news) |
| `edit($id)` | `/page/edit/{id}[/success\|/successbg\|/deletesuccess]` | GET | `username` + `editpage` | inline CKEditor editor for a page |
| `save($id)` | `/page/save/{id}` | POST | `username` + `editpage` | UPDATE `header`/`text` of page |
| `savebg($id)` | `/page/savebg/{id}` | POST | `username` + `editpage` | UPDATE `bgpic` (background image) |
| (named slugs) | e.g. `velkommen`, `faciliteter`, `kollegielivet/historie`, … | GET | public | SEO aliases → `page/show/N` |

## Purpose
This is the public website. A visitor browses the front page (`gahk.dk`) and the Danish content pages
(facilities, vision, college life, legates, contact, etc.), each of which is a row of editable HTML stored
in the CMS. A logged-in editor with the `editpage` right can click into any page and edit its heading and
body inline with CKEditor, and swap the page background image via a KCFinder image picker — changes save
straight back to the same CMS row.

## Inputs
| Name | Source | Type | Required? | Validated/sanitized? | Used for |
|---|---|---|---|---|---|
| `$pageId` / `$id` | route segment 3 (`page/show/{id}`, `edit/{id}`, `save/{id}`, `savebg/{id}`); `index`→hardcoded `1`; `altfrontpage`→hardcoded `1` | int-ish (string) | yes (defaults to `1` via slug routing/`index`) | **none** — passed straight to `Page_model` (CI active-record `where('id',$id)` binds it; `update_by_id` uses `where('id',$id)`) | look up / update the `gahk_page` row |
| `uri->segment(4)` | URL | string | no | n/a | flash flag in `edit`: `"success"` / `"successbg"` / `"deletesuccess"` toggles the confirmation banner |
| `header` | POST (on `save`) | string (HTML) | no | **none** — raw CKEditor HTML | written verbatim to `gahk_page.header` |
| `text` | POST (on `save`) | text (HTML) | no | **none** — raw CKEditor HTML | written verbatim to `gahk_page.text` |
| `bgpic` | POST (on `savebg`) | string (URL/path) | no | **none** — set client-side to the chosen image `src` | written verbatim to `gahk_page.bgpic` |
| *(any other POST key)* | POST (`save`/`savebg`) | — | no | **none** | ⚠ inserted/updated verbatim if it matches a `gahk_page` column — **mass-assignment** (see DB writes & findings) |
| session `username` | CI session | string | for `edit`/`save`/`savebg` | n/a | auth gate |
| session `editpage` | CI session | flag | for `edit`/`save`/`savebg` | n/a | authorization gate (edit right) |
| session `administrator`, `fullname`, `indstilling` | CI session | mixed | no | n/a | read in `edit` for admin-header chrome (`administrator` shows user-admin link) |
| `$_SERVER['REMOTE_ADDR']` | server | string | implicit | n/a | counter middleware (per-IP visit row) — see side effects |

## Database interactions
- **Tables touched:** `gahk_page` (R in show/altfrontpage/edit, W in save/savebg), `gahk_news` (R in `altfrontpage` only), `gahk_counter` (R/W via counter middleware), `gahk_counterdato` (R/W via counter middleware), `gahk_ansoegninger` (R via the reminder middleware — currently a no-op write path).
- **Reads:**
  - `gahk_page` via `Page_model->get_page($id)` → `db->where('id',$id); db->get('gahk_page')->result()`
    (`page_model.php:9-13`). Returns an array of row objects; the controller always uses `[0]`
    (`page.php:22-24,45-47,77-78`). Columns read off the row: `id`, `header`, `text`, `bgpic`, `menuCat`.
    There is **no `LIMIT 1`** — it relies on `id` being the primary key.
  - `gahk_news` via `News_model->isAnyNewsLastTwoMonth()` — only in `altfrontpage`. Runs
    `SELECT * FROM gahk_news WHERE timestamp > '<epoch 2 months ago>'` (`news_model.php:28-35`); returns
    1/0. If 1, sets `oldStyleNews=true` so the legacy iframe news box renders. ⚠ raw string-interpolated
    query (the value is server-generated `strtotime`, so not attacker-controlled here).
  - `home_page` view also displays a **hard-coded PHP `$events` array** in `news/begivenheder.php`
    (Fællessang 2025-11-26, Åbent Hus 2026-02-28) — these events are **in source code, not the DB**
    (`begivenheder.php:26-51`).
  - `gahk_counter`/`gahk_counterdato`: read in the counter middleware (by IP, by date) before writing.
  - `gahk_ansoegninger`: read by the reminder middleware (`getPaamindelseForWeek`,
    `getAnsoegningerNotReceived`) — but the actual mail+insert are commented out (disabled), so no write.
- **Writes:**
  - **UPDATE `gahk_page` SET <all POST keys> WHERE `id` = {id}** — on `save` via
    `Page_model->update_by_id($id, $_POST)` (`page.php:136`, `page_model.php:15-18`). In normal flow the
    form posts only `header` + `text` (`editPageBox.php:108-111`), so it updates `header` and `text`.
    ⚠ It passes the **entire `$_POST`** — any extra posted key matching a column (`menuCat`, `bgpic`, even
    `id`) would be written too. The `id` in WHERE is bound via `db->where`.
  - **UPDATE `gahk_page` SET <all POST keys> WHERE `id` = {id}** — on `savebg` via the same
    `update_by_id($id, $_POST)` (`page.php:154`). Normal flow posts only `bgpic` (`editPageBox.php:143-145`),
    so it updates `bgpic`. Same mass-assignment exposure.
  - **INSERT/UPDATE `gahk_counter`** — counter middleware: if no row for this IP → INSERT
    `{ip, count:1, lastCount, lastcountdato}`; if a row exists and last hit was >30 min ago → UPDATE
    `count = count+1, lastCount, lastcountdato` (`MY_Controller.php:79-88,65-78`). Fires on **every** action
    of this controller (constructor).
  - **INSERT/UPDATE `gahk_counterdato`** — counter middleware, only when `needCountByDate` (a new IP or a
    >30-min repeat): if a row for today's `dato` exists → UPDATE `count+1`; else INSERT `{dato, count:1}`
    (`MY_Controller.php:91-108`).
  - No write to `gahk_news` from this controller (news editing is delegated to the `news` controller via an
    iframe in `editPageBox.php:162`).
- **Transactions / ordering:** none. `gahk_page`, `gahk_news`, `gahk_counter`, `gahk_counterdato` are all
  **MyISAM** — no transactions available. The counter does read-then-write without locking, so concurrent
  hits can race (lost increments / duplicate IP rows — note the explicit `"ERROR IN COUNTER"` echo guard at
  `MY_Controller.php:61` for the >1-row case).

## Business logic
- **`show($id)`** (`page.php:19-38`): loads the page row, pulls `bgpic`/`pageid`/`menucat` from row `[0]`,
  renders `layout/header.php`. Then **branches on `$pageId == 1`**:
  - `== 1` (front page): renders `home_page` + `news/begivenheder` + `news/news_ajax`. `home_page` is the
    wide front-page box; `begivenheder` is the hard-coded events box; `news_ajax` (with no `oldStyleNews`)
    renders the **Facebook page embed**.
  - otherwise: renders `standart_page` (the standard text page).
  - Finally renders `layout/bottom.php`. Both layouts pull `standart_page_setup` to print
    `header` + `text` (`standart_page_setup.php:2-17`).
  - ⚠ The `== 1` test is a loose comparison against the **route id**, so the front-page chrome is keyed to
    page id 1 specifically (hard-coded coupling).
- **`index()`** (`page.php:14-16`): simply calls `show(1)`.
- **`altfrontpage()`** (`page.php:41-60`): a variant front page. Always uses page id `1` (hard-coded,
  comment says "make param normally"). Renders `header` → **`standart_page`** (not `home_page`) → then,
  because `$pageId==1`, loads `News_model` and if `isAnyNewsLastTwoMonth()` sets `oldStyleNews=true` and
  renders `news/news_ajax` (the **legacy iframe news box**, `news/listBox`). No `begivenheder` box. Then
  `bottom`. This looks like an older/alternative front-page rendering kept around.
- **Editor selection (`home_page` vs `standart_page`):** front page (id 1) → `home_page`; every other id →
  `standart_page`; `altfrontpage` → `standart_page` regardless. `small_standart_page` is **not referenced**
  by this controller (it is a smaller box variant used elsewhere).
- **`edit($id)`** (`page.php:64-124`):
  1. Loads `form` helper + `session` lib; reads session `username`/`administrator`/`editpage`/`fullname`/`indstilling`.
  2. Loads the page row; sets `editable = 1`.
  3. **Auth:** if `!username` → `redirect("admin")`; elif `!editpage` → `echo "No rights to visit this page"` (and stops); else continues.
  4. Page-specific tabs: if `id == 5` → `showPylonCalendar=true` (pylon legates calendar edit iframe); if `id == 1` → `showNews=true` (news edit iframe).
  5. Flash banner: `uri->segment(4)` of `success`/`successbg`/`deletesuccess` toggles the matching alert.
  6. **Resets `$_SESSION['KCFINDER']`** to `{disabled:false, uploadDir:""}` (`page.php:115-117`) to authorize the KCFinder file browser for this request.
  7. Renders `layout/adminHeader.php` → `admin/editPageBox` → `layout/bottom.php`. `editPageBox` re-includes `standart_page_setup` (now with `editable`, so heading/body become `contenteditable`) and wires CKEditor inline + the KCFinder background picker.
- **`save($id)`** (`page.php:126-139`): same auth gate, then `update_by_id($id, $_POST)` and
  `redirect("page/edit/$id/success")`.
- **`savebg($id)`** (`page.php:143-157`): same auth gate, then `update_by_id($id, $_POST)` and
  `redirect("page/edit/$id/successbg")`.
- **Editor save mechanics (client side):** `editPageBox.php:5-12` — `ClickToSave()` reads CKEditor
  `headerField`/`textField` data into hidden inputs `header`/`text` and submits `#editform`
  (`form_open("page/save/$pageid")`). `ClickToSaveBg()` copies the chosen image `src` into hidden input
  `bgpic` and submits `#editbgform` (`form_open("page/savebg/$pageid")`).

## Outputs & side effects
- **Renders:** full HTML pages. Front page = `home_page` (wide content box) + `begivenheder` (hard-coded
  events) + Facebook embed; other pages = `standart_page`. The page background is set by injecting
  `bgpic` into an inline `<style>` `background: url(<?=$bgpic?>)` in `layout/head.php:21-31`.
- **Heading/body output:** `standart_page_setup.php` prints `$row->header` and `$row->text` with `<?= ?>`
  — **no escaping** (it's CMS HTML by design). In edit mode they are wrapped in
  `contenteditable='true'` `<h2 id='headerField'>` / `<div id='textField'>`.
- **Redirects:** `save` → `page/edit/{id}/success`; `savebg` → `page/edit/{id}/successbg`; unauthenticated
  `edit`/`save`/`savebg` → `admin`. Authenticated-but-no-`editpage` → plain `echo` (no redirect, partial page).
- **External calls / assets:** CKEditor (`public/js/ckeditor/ckeditor.js`), KCFinder file browser
  (`public/js/kcfinder/browse.php?type=images&dir=images/public`) opened in a popup, Facebook SDK +
  page plugin (`connect.facebook.net`, front page), Google Fonts (`fonts.googleapis.com` in `head.php`),
  Instagram/Facebook links in the hard-coded events. The legacy news box loads `news/listBox` in an iframe;
  pylon calendar edit loads `pylon/editCalendar`; news edit loads `news/listAndCreate`.
- **Session:** `edit` mutates `$_SESSION['KCFINDER']` (enables the uploader).
- **Visit counter write:** every hit to any action writes `gahk_counter`/`gahk_counterdato` (constructor
  `counter()`, see `01-infrastructure.md` A9). ⚠ This means **GET requests have DB write side effects**.
- **Reminder email side effect:** the constructor calls `sendAnsoegningPaamindelseIfTime()` on **every**
  hit (`page.php:11`). It computes the current week, queries `gahk_ansoegninger` reminders, and — **only if
  none yet this week** — would send a weekly reminder mail to `indstillingen@gahk.dk` and record it. ⚠ Both
  the `mail()` send and the insert are **commented out ("Disabled by request", `MY_Controller.php:117-119`)**,
  so today it does a read query and nothing else. See `01-infrastructure.md` A9.
- **Headers:** no explicit cache headers set in this controller (unlike F-001's constructor work).

## Dependencies
- **Cross-cutting infra used:** `MY_Controller` base — provides `session` lib + `gahk_helper` load,
  `counter()` (visit counter, runs every hit) and `sendAnsoegningPaamindelseIfTime()` (weekly reminder,
  disabled). See `01-infrastructure.md` A4 (sessions/auth), A5 (session keys), A9 (counter + reminder).
- **Models:** `Page_model` (CRUD on `gahk_page`); `News_model` (loaded only in `altfrontpage`);
  `Counter_model` (loaded by counter middleware); `Ansoegninger_model` (loaded by reminder middleware).
- **Helpers/libs:** `form` helper + `session` library (loaded in `edit`/`save`/`savebg`); `url` helper
  (`anchor`, `base_url`, `site_url`, `redirect`) used throughout the views.
- **External services:** CKEditor (inline rich-text), KCFinder (image browse/upload), Facebook SDK/page
  plugin, Google Fonts. jQuery/jQuery-UI/Bootstrap from `public/`.
- **Views:** `layout/{header,adminHeader,head,bottom,footer}`, `home_page`, `standart_page`,
  `standart_page_setup`, `admin/editPageBox`, `news/{begivenheder,news_ajax}`; sub-includes `submenu.php`,
  `adminSubmenu.php`.

## Security findings
| Issue | Location | Severity | Note |
|---|---|---|---|
| **Stored XSS in CMS content** | `standart_page_setup.php:4,14` (`<?=$row->header?>`/`<?=$row->text?>`), `head.php:24` (`background: url(<?=$bgpic?>)`) | **High** | `header`/`text` rendered unescaped to all public visitors; `save` stores raw CKEditor HTML with **no `xss_clean`/sanitization**. Any editor (or anyone who can POST to `save`) can inject persistent script served sitewide. `bgpic` is injected into inline CSS unescaped → CSS/`url()` injection. |
| **Mass-assignment on update** | `page.php:136,154` + `page_model.php:15-18` (`update_by_id($id,$_POST)`) | **High** | whole `$_POST` written to `gahk_page`; extra keys (`menuCat`, `bgpic` on `save`, even `id`) overwrite columns. |
| **No CSRF protection on `save`/`savebg`** | `page.php:126-157`; `editPageBox.php:108,143` (`form_open`) | **Medium** | `csrf_protection=false` sitewide (`01-infrastructure.md` A4). A forged POST from an authenticated editor's browser can rewrite any page's content/background. |
| **State change accepts any HTTP method** | `page.php:126,143` | **Low/Medium** | `save`/`savebg` are not method-restricted; a GET with query params would also update (combined with no CSRF). |
| **Weak authorization (truthy `editpage`)** | `page.php:83,133,151` | **Medium** | only checks `editpage` is truthy; no per-page scoping — any editor can edit every page id (incl. id 1). |
| **Authz failure leaks partial page** | `page.php:84,134,152` (`echo "No rights…"`) | **Low** | no redirect/403; just echoes text mid-render. |
| **Insecure file upload via KCFinder** | `editPageBox.php:54` + `page.php:115-117` (`$_SESSION['KCFINDER']['disabled']=false`, empty `uploadDir`) | **High** | KCFinder enabled to browse/upload into `images/public`; classic RCE/upload-bypass surface if KCFinder is unpatched. Needs audit of `public/js/kcfinder/`. |
| **SQL injection (id) — mitigated** | `page_model.php:10,16` | **Low** | `id` flows through CI `db->where('id',$id)` (escaped/bound). Not exploitable as written, but relies on active-record escaping. |
| **Counter writes on GET** | `MY_Controller.php:45-110` (constructor) | **Low** | every public GET writes DB (DoS/row-growth amplification; `gahk_counter` grows one row per distinct IP). |
| **Hard-coded external embeds / fonts** | `head.php:17`, `news_ajax.php:25`, `begivenheder.php:34-46` | **Low** | third-party JS (Facebook), external font CDN — privacy/CSP concerns. |

## Quirks, edge cases & suspected bugs
- **Reminder fires on every front-page hit:** `sendAnsoegningPaamindelseIfTime()` is called from the
  constructor on **every** action (`page.php:11`), so the weekly-reminder logic + a `gahk_ansoegninger`
  query run on every public page view. The send + the "already sent this week" insert are **both commented
  out** ("Disabled by request"), so it currently only burns a query. If re-enabled as-is it would spam
  because the insert that records "sent this week" is also disabled — the dedup would never persist.
- **Counter runs on every action including the editor**, so editing/saving also increments visit counts.
- **`home_page` vs `standart_page` is keyed to literal page id `1`** (`page.php:28`) — hard-coded coupling;
  changing the front page to another row would require code changes.
- **Slug ↔ page-id mapping lives only in `routes.php`** — there is no DB column tying a slug to a `gahk_page`
  row. The mapping is duplicated in three places: `routes.php` (public slugs), `layout/header.php:26-33`
  (public menu, 8 items), and `layout/adminHeader.php:34-41` (edit-menu → `page/edit/N`). These can drift.
  ⚠ The public menu’s "Historie" links to `kollegielivet/historie` (id 14) but `menuCat` highlighting uses a
  loop `1..8`/`1..7` that doesn't cleanly line up with page ids (`menucat` from the row vs menu index).
- **`altfrontpage` is dead/alternate code** — not referenced by any route; uses `standart_page` for the
  front page and the legacy iframe news box. Likely a leftover from before `home_page` + Facebook.
- **`begivenheder.php` events are hard-coded in source** (not DB-driven) and already contain a **past**
  event relative to today (2026-06-26): "Åbent Hus 2026-02-28" would now fall into "Tidligere begivenheder".
  Editors cannot change these without code edits, despite the editor UI suggesting content is editable.
- **`small_standart_page` view is unused** by this controller.
- **`get_page` has no `LIMIT 1`** and always uses row `[0]`; if `id` weren't unique it would silently pick
  the first. A non-existent id returns an empty array → `$data['page'][0]` triggers an undefined-index/notice
  and a fatal on `->bgpic` (no 404 handling; `404_override` is empty in `routes.php`).
- **`menucat`/`bgpic`/`pageid` are read from `[0]` with no existence guard** (`page.php:22-24`).

## Reimplementation notes (Django)
- **Views:** a `DetailView`/function view for `show` (slug or pk → `Page`), an editor `UpdateView`
  (login + `editpage`-equivalent permission) backed by an explicit `PageForm` (fields `header`, `text`,
  `bgpic` only — kills mass-assignment), and a separate small action for the background. Front page = a
  template branch on the page being the configured home page (don't hard-code pk 1 — make it config).
- **Model:** one `Page` model over `gahk_page` (`id, menuCat, header, text, bgpic`).
- **Templates:** base layout (header/footer) with a `home` vs `standard` block; render CMS `text`/`header`
  with **sanitization on output or on save** (allowlist HTML) — do not emit raw.
- **PRESERVE:** every named slug URL verbatim (301 map slug→page) for SEO; the inline-edit UX; the
  background-image mechanism (as an uploaded `ImageField`, not a free-text URL).
- **FIX (record + confirm first):** add CSRF + POST-only saves; sanitize stored CMS HTML; replace
  KCFinder with a vetted upload pipeline; scope edit permission; decide the reminder/counter fate
  (move counter off the request path, re-enable reminder properly or drop it).

## Open questions
- **Source of truth for slug ↔ page-id:** today it's `routes.php` + two menu templates, with no DB link.
  Should the Django `Page` own a `slug` column (and we generate the 301 map from it), or do we freeze the
  legacy mapping as a static redirect table? Needs a human decision.
- Is `altfrontpage` still reachable/used anywhere (e.g. an A/B link), or safe to drop?
- Should `begivenheder` events become DB/CMS-managed (the editor UI implies content is editable, but these
  are in code)?
- Confirm the exact `editpage`/`administrator` semantics and whether per-page edit scoping is desired.
- Is the weekly reminder meant to be re-enabled (and moved to a real cron), or permanently retired?
- What is page id 1’s intended canonical URL — `/` , `velkommen`, or both — for the 301 strategy?
