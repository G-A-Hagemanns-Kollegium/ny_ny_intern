# Feature: News — news/events CRUD (legacy, largely superseded by an embedded Facebook feed)

- **Feature ID:** F-007
- **Source file(s):** `application/controllers/news.php`, `application/models/news_model.php`
  (reads CMS chrome via `application/models/page_model.php`);
  views `application/views/news/{news_box,show_box,edit_news_box,create_box,news_ajax,begivenheder}.php`,
  `application/views/standart_page.php`, `application/views/layout/{header,adminHeader,bottom}.php`.
  Embedding/wiring lives in `application/controllers/page.php` (`show`, `altfrontpage`).
- **URL / route:** (route segment `news → News` controller; CI default-route mapping, no custom route entry needed)
  - `GET  /news/listBox[?from=N]` — iframe-embedded news list fragment (full HTML page, `<base target="_parent">`)
  - `GET  /news/show/{id}` — single news article (full themed page)
  - `GET  /news/listAndCreate[?from=N]` — admin iframe list of news with edit/delete/create links (full HTML page)
  - `GET  /news/edit/{id}` — admin edit form for one news item (full themed admin page, CKEditor)
  - `GET  /news/create` — admin "new news" form (full themed admin page, CKEditor)
  - `POST /news/save` — create-or-update a news item
  - `GET  /news/delete/{id}` — delete a news item ⚠ **no auth check**
- **HTTP method(s):** GET + POST (`save` is the only POST; `delete` mutates on GET)
- **Access control:** **Mixed, enforced inline per action (no central guard):**
  - Public (unauthenticated): `listBox`, `show`, `listAndCreate`. ⚠ `listAndCreate` renders admin edit/delete
    links but is itself **not gated** (see findings).
  - Admin-gated: `edit`, `create`, `save` require session `username` **and** `editpage` truthy
    (`!$username` → `redirect("admin")`; `!$editpage` → `echo "No rights to visit this page"`). Standard CI
    session userdata — see `01-infrastructure.md` A4/A5.
  - ⚠ **`delete/{id}` has NO authentication or authorization check at all** — anyone can delete any news row
    by hitting the URL (`news.php:173-176`). **Confirmed.** High-severity auth bypass; see findings.

**Routes / actions:**
| Action | URL | Method | Access | Purpose |
|---|---|---|---|---|
| `listBox` | `/news/listBox[?from=N]` | GET | public | iframe news-list fragment (1 item/page) |
| `show` | `/news/show/{id}` | GET | public | single news article, themed page |
| `listAndCreate` | `/news/listAndCreate[?from=N]` | GET | public ⚠ (renders admin links) | admin-style list (10/page) + create link |
| `edit` | `/news/edit/{id}` | GET | `username` + `editpage` | edit form for one item |
| `create` | `/news/create` | GET | `username` + `editpage` | blank create form |
| `save` | `/news/save` | POST | `username` + `editpage` | INSERT (id==-1) or UPDATE |
| `delete` | `/news/delete/{id}` | GET | **none — not enforced** | DELETE the row |

## Purpose
A legacy in-house news/announcement system. Editors with `editpage` rights write short news posts in a
CKEditor inline editor; visitors saw the newest post in a small box on the front page, paginated one at a
time, with a "Læs mere" link to a full article page. **Per the manifest this is largely retired:** the front
page now embeds a Facebook Page plugin instead, and the old iframe news list is dead code on the live front
page (see Business logic / Quirks). A separate hard-coded "Begivenheder" (events) box lives in the same view
folder but has its events written directly into the PHP view file.

## Inputs
| Name | Source | Type | Required? | Validated/sanitized? | Used for |
|---|---|---|---|---|---|
| `{id}` (segment 3) | route | int-ish string | for `show`/`edit`/`delete` | **none** | passed raw into SQL (`get`) / `db->delete`/`db->update` WHERE |
| `from` | GET | int | no (default 0) | **none** | pagination offset, used raw in `LIMIT $from, $rowsPerPage` (`getNewest`) |
| `id` | POST (`save`) | string | yes (`$_POST['id']` read unchecked) | **none** | branch key: `'-1'` → insert, else update target id; then `unset` from payload |
| `title` | POST (`save`) | string | no (form always sends, may be empty) | **none** (CKEditor client-side only) | stored to `gahk_news.title` |
| `text` | POST (`save`) | text/HTML | no | **none** — raw HTML body from CKEditor | stored to `gahk_news.text` |
| *(any other POST key)* | POST (`save`) | — | no | none | ⚠ inserted/updated verbatim if key matches a column — **mass-assignment** |
| session: `username`, `administrator`, `editpage`, `fullname` | session | mixed | for admin actions | CI session — auth + view chrome |
| `$_SESSION['KCFINDER']` (`disabled`, `uploadDir`) | server-set | array | n/a | set by `edit`/`create` to enable KCFinder file uploads in CKEditor |

Note: `save` reads `$_POST['id']` with no `isset` guard (PHP notice if absent). The model `add()` appends
server-side `day`,`month`,`year`,`timestamp`; it does **not** set `title`/`text` itself — those come only from
`$_POST`.

## Database interactions
- **Tables touched:** `gahk_news` (R/W), `gahk_page` (R), `gahk_counter` / `gahk_counterdato` (W, via counter middleware).
- **Reads (`gahk_news`):**
  - `get($id)` — `SELECT * FROM gahk_news WHERE id = '$id'` (raw interpolation). Used by `show` and `edit`.
  - `getNewest($from,$to)` — `SELECT * FROM gahk_news ORDER BY id DESC LIMIT $from, $to` (raw). Used by `listBox`
    (`$to`=1) and `listAndCreate` (`$to`=10).
  - `numberOfNews()` — `SELECT * FROM gahk_news` then `num_rows()` (loads all rows just to count) → page count.
  - `isAnyNewsLastTwoMonth()` — `SELECT * FROM gahk_news WHERE timestamp > '<strtotime(-2 month)>'`; returns
    1/0. Used by `listBox` to set `$shownews` (JS hides the box if 0); also called from `page::altfrontpage`.
- **Reads (`gahk_page`):** `Page_model->get_page(1)` — pulls the home page row (id=1) purely for theme chrome:
  `bgpic` and `menuCat` (and the whole row into `$data['page']`). `show`/`edit`/`create` all read page id `1`.
  `gahk_news` carries no page link; this read only supplies header background + selected-menu state.
- **Writes (`gahk_news`):**
  - **INSERT** via `News_model->add($_POST)` — when `save` and `$_POST['id'] == '-1'`. Inserts the whole
    (id-stripped) `$_POST` array (so `title`,`text`) plus model-set `day`=`date('j')`, `month`=`date('n')`,
    `year`=`date('Y')`, `timestamp`=`time()`. Columns: `id` (auto), `title`, `text`, `day`, `month`, `year`,
    `timestamp`. ⚠ Any extra POST key matching a column is written (mass-assignment).
  - **UPDATE** via `News_model->update($_POST, $id)` — when `save` and `id != '-1'`:
    `UPDATE gahk_news SET <posted cols> WHERE id = $id` (id passed through `db->where()` — escaped). Does **not**
    refresh `day`/`month`/`year`/`timestamp` (edit keeps original date).
  - **DELETE** via `News_model->delete($id)` — `db->delete('gahk_news', ['id'=>$id])` (id escaped by AR).
    Triggered by `delete/{id}` with **no auth** (see findings).
  - **INSERT/UPDATE `gahk_counter` / `gahk_counterdato`** — side effect of `MY_Controller::counter()`, called
    from this controller's constructor on **every** action (`news.php:9`; see `01-infrastructure.md` A9).
- **Transactions / ordering:** none. `gahk_news` is **MyISAM** (no transactions). `numberOfNews()` does a full
  table scan into PHP for a count; harmless at current volume but O(n).

## Business logic
- **`listBox`** (`rowsPerPage = 1`): reads `from` (default 0), sets the Danish `$months` array, computes
  `$shownews` from `isAnyNewsLastTwoMonth()`, fetches the single newest unseen page via `getNewest($from,1)`,
  computes `numberofpages = ceil(count/1)` and `currentpage = from/1`, renders `news_box.php` as a **standalone
  full HTML page** (own DOCTYPE, `<base target="_parent">`). The view's inline JS hides `#news_box` in the
  **parent** document if `$shownews == 0`, and auto-resizes the parent iframe. ⚠ Note `listBox` redundantly
  re-`load->model('News_model')` though already loaded in the constructor.
- **`show($id)`**: fetches `get($id)`, builds theme chrome from `gahk_page` id 1, sets `pageid=1`,
  `editable=1`, renders `header` + `show_box` + `bottom`. `show_box` prints `$news[0]->title`, date from
  `$months[$month-1]`, and `$news[0]->text` **raw** (unescaped HTML). No guard for empty result → if `{id}`
  matches no row, `$news[0]` is undefined (PHP notice / blank).
- **`listAndCreate`** (`rowsPerPage = 10`): same pagination shape; renders `edit_news_box.php` as a standalone
  full HTML page (a table of items with pencil/edit and trash/delete links and an "Opret ny nyhed" → `create`
  button). ⚠ This action is **not auth-gated** even though it exposes edit/delete links; it is intended to be
  iframe-embedded inside the gated `page/edit/1` admin screen, but is directly reachable. ⚠ Its `$months`
  array has **Aug, Okt, Sep** out of order (`news.php:61`) vs the correct order used elsewhere — cosmetic bug.
- **`edit($id)` / `create`**: identical auth gate — `!username` → `redirect("admin")`; `!editpage` →
  `echo "No rights to visit this page"` (then continues to render nothing else — function returns).
  On success: stash session values into `$data`, initialise `$_SESSION['KCFINDER']` (enable CKEditor file
  browser, empty upload dir), and render `adminHeader` + `standart_page` + `create_box` + `bottom`. `edit`
  also loads `get($id)` so `create_box` pre-fills the existing title/text (`isset($news)` branch). ⚠ `edit`
  passes `$data` to `create_box`; `create` calls `load->view('news/create_box.php')` **without `$data`**, so
  the "new" branch (no `$news`) is taken — fine, but inconsistent.
- **`save`** (POST): same auth gate. Then `$id = $_POST['id']; unset($_POST['id']);` and branch:
  `id == '-1'` → `add($_POST)` (insert); else → `update($_POST,$id)`. Always `redirect("page/edit/1/success")`.
- **`delete($id)`**: ⚠ **no auth** — straight `delete($id)` then `redirect("page/edit/1/deletesuccess")`.
- **Old-news iframe vs Facebook-plugin switch (`news_ajax.php`):** the front-page news box is decided by whether
  `$oldStyleNews` is set. `page::show(1)` (the **live default** front page) loads `news/news_ajax` **without**
  ever setting `$oldStyleNews`, so the `else` branch always runs → renders the **Facebook Page plugin**
  (`facebook.com/pages/GA-Hagemanns-Kollegium/299814993380395`, `connect.facebook.net/.../sdk.js`,
  `xfbml=1&version=v2.3`). `$oldStyleNews=true` is set **only** in `page::altfrontpage()` (an alternate,
  non-default action), which is the sole path that shows the old iframe (`<iframe src="news/listBox">`).
  **Therefore on the live site the entire `news/listBox` + `news_box.php` chain is effectively dead.** A
  comment in `news_ajax.php` says so verbatim: *"This is a old news system which is replaced by facebook."*
- **Hard-coded events (`begivenheder.php`):** loaded by `page::show(1)` alongside `news_ajax`. The events list
  is a **PHP array literal inside the view** (currently "Fællessang" 2025-11-26 and "Åbent Hus" 2026-02-28).
  It compares each `datetime` to `now` to split into upcoming vs past, renders titles/dates `htmlspecialchars`-
  escaped but the `content` HTML **raw** (contains hard-coded Instagram/Facebook links). A header comment notes
  this file is **not part of the original structure** (added after the GAHK-EDB/gahk-legacy snapshot). It does
  not touch the DB at all.

## Outputs & side effects
- **Renders:**
  - `listBox` → `news_box.php`: standalone HTML fragment for an iframe; foreach over `$news` prints
    `word_limiter($row->text,40)` (truncated, **not** stripped of tags) + a "Læs mere" link; numeric pager.
  - `show` → themed page (`header`+`show_box`+`bottom`) with lightbox JS; full article body raw HTML.
  - `listAndCreate` → `edit_news_box.php`: standalone admin HTML with CKEditor script tag, edit/delete links, pager.
  - `edit`/`create` → `adminHeader`+`standart_page`+`create_box`+`bottom`: inline CKEditor (`titleField`,
    `textField` contenteditable; toolbars `TE`/`HE`); `ClickToSave()` copies CKEditor data into hidden
    `title`/`text` inputs and submits `form_open("news/save")`.
- **Redirects:** `save` → `page/edit/1/success`; `delete` → `page/edit/1/deletesuccess`; unauthenticated
  `edit`/`create`/`save` → `admin`.
- **Plain echo:** `"No rights to visit this page"` when logged-in but `!editpage`.
- **External calls:** Facebook JS SDK + Page plugin (front page, via `news_ajax`); CKEditor + KCFinder
  (`public/js/ckeditor/ckeditor.js`) in edit/create; jQuery lightbox lib in `show_box`. Instagram/Facebook
  links hard-coded in `begivenheder`.
- **Session/headers:** `edit`/`create` write `$_SESSION['KCFINDER']`. Constructor (`MY_Controller`) sets the
  no-cache headers from `01-infrastructure.md` A9.
- **Counter write:** visit-counter INSERT/UPDATE on **every** action (incl. `delete`), see A9.

## Dependencies
- **Cross-cutting infra used:** `MY_Controller` base (session bootstrap + visit counter on every hit — A9),
  CI DB sessions + session userdata auth (`01-infrastructure.md` A4/A5), no-cache header middleware (A9).
  Referenced by name, not re-described.
- **Models:** `News_model` (CRUD over `gahk_news`), `Page_model` (`get_page(1)` for theme chrome only).
- **Helpers/libraries:** `text` helper (`word_limiter` in `listBox`), `form` helper + `session` library
  (loaded per-action in `edit`/`create`/`save`).
- **External services:** Facebook Page plugin / JS SDK (front-page news replacement), CKEditor 4 inline +
  KCFinder file browser, jQuery lightbox.
- **Views depend on:** `layout/head.php`, `layout/footer.php`, `layout/submenu.php`/`adminSubmenu.php`
  (included by header/adminHeader), `standart_page_setup` (via `standart_page`).

## Security findings
| Issue | Location | Severity | Note |
|---|---|---|---|
| **Auth bypass — unauthenticated delete** | `news.php:173-176` (`delete($id)`) | **High** | no session/role check; any visitor can `GET /news/delete/{id}` and destroy any news row (no CSRF either) |
| SQL injection via `{id}` | `news_model.php:24` (`get`: `WHERE id = '$id'`) | **High** | route segment interpolated raw into SQL |
| SQL injection via `from` | `news_model.php:38` (`getNewest`: `LIMIT $from, $to`) | **High** | `$_GET['from']` concatenated raw into SQL |
| Stored XSS — news body rendered raw | `show_box.php:22` (`<?=$news[0]->text?>`), `create_box.php:25` | **High** | CKEditor HTML stored unescaped and echoed unescaped; editor input never server-sanitized |
| Stored XSS — list preview | `news_box.php:33` (`word_limiter($row->text,40)`) | **Medium** | truncates but does not strip tags (comment even notes `strip_tags()` was intended) |
| Mass-assignment on insert/update | `news.php:165,167` + `news_model.php:10-21` (`add/update($_POST)`) | **Medium** | whole `$_POST` written; attacker can set arbitrary `gahk_news` columns |
| Missing CSRF on state change | `save` (POST) and `delete` (GET) | **Medium** | `csrf_protection=false` site-wide (`01-infra` A4); `delete` mutates on GET |
| `listAndCreate` reachable unauthenticated | `news.php:54-71` | **Medium** | exposes edit/delete link targets to anyone (delete is the real exposure above) |
| No empty-result guards | `show_box.php:19`, `edit`/`show` | **Low** | bad/missing `{id}` → undefined `$news[0]` (info-leak via PHP notices) |
| Facebook 3rd-party embed / privacy | `news_ajax.php:21-31` | **Low** | loads Facebook SDK on the public front page (tracking, no consent gate) |

## Quirks, edge cases & suspected bugs
- **Facebook supersession is the live state:** `page::show(1)` never sets `$oldStyleNews`, so the front page
  always renders the Facebook plugin; the entire `listBox`/`news_box.php` iframe path is **dead on the live
  site** and only reachable via the unused `page::altfrontpage()` action or by hitting `/news/listBox` directly.
- **Hard-coded events array in the view** (`begivenheder.php:26-51`) — events are PHP literals (dates
  2025-11-26, 2026-02-28); editing events means editing code. File header notes it is **not** part of the
  original legacy structure (added later).
- `edit` passes `$data` to `create_box` but `create` does not (`news.php:106` vs `142`) — relies on `isset($news)`.
- `save` reads `$_POST['id']` with no `isset` (PHP notice on direct/empty POST).
- `update` does not refresh the date fields — editing a post keeps its original `day/month/year/timestamp`.
- Out-of-order `$months` in `listAndCreate` (`...Aug, Okt, Sep...`, `news.php:61`); correct order in `listBox`/`show`.
- `numberOfNews()` loads all rows to count them (`SELECT *` + `num_rows()`).
- `pageId = 5` class var declared (`news.php:4`) but never used; all page reads hard-code id 1.
- `listBox` re-loads `News_model` though the constructor already did.
- `gahk_news` is `latin1_swedish_ci` while `gahk_page` is `utf8mb3` — Danish chars in titles/bodies need
  careful latin1→utf8 handling in ETL (`01-infra` A2).

## Reimplementation notes (Django)
- If rebuilt: a single `News` model over `gahk_news` (fields `id, title, text, day, month, year, timestamp`;
  prefer a real `DateTimeField` over the split day/month/year/epoch ints), a paginated `ListView`, a
  `DetailView` for `show`, and `CreateView`/`UpdateView`/`DeleteView` gated by a proper permission
  (`editpage` → group/permission). A `ModelForm` with explicit fields kills mass-assignment; the ORM kills the
  raw `WHERE`/`LIMIT` injection; auto-escaping templates + a sanitizer (e.g. bleach) on the CKEditor body kill
  stored XSS. **FIX:** require auth+permission on **delete** (and move it to POST + CSRF); unify the editor
  permission check; sanitize/escape the body. **PRESERVE:** `/news/show/{id}` URL if any old links remain.
  Move `begivenheder` events into the DB/admin rather than a code array.
- **Worth rebuilding?** Probably **retire**: the news box is already replaced by the Facebook Page plugin and
  the iframe path is dead; only `begivenheder` (events) and possibly archived `show/{id}` links carry value.

## Open questions
- Is the in-house news system still used **at all**, or fully replaced by the Facebook feed? The live front
  page only shows Facebook, but `gahk_news` rows and `/news/show/{id}` links may still exist/be linked.
- Should the unauthenticated `delete` ever have worked for the public, or is it a latent bug that simply
  hasn't been exploited because the links live behind the admin iframe? (Treat as bug; confirm before "fixing".)
- Should events (`begivenheder`) become editable data (DB + admin) in the rebuild, or stay developer-edited?
- Is `page::altfrontpage` (the only old-news-iframe path) reachable/used anywhere, or fully dead?
- Confirm `gahk_page` id 1 is the intended source of the news pages' theme chrome (it is only used for
  `bgpic`/`menuCat`).
