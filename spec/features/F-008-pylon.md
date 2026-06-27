# Feature: Pylon — public event/notice calendar + its editor

- **Feature ID:** F-008
- **Source file(s):** `application/controllers/pylon.php`, `application/models/pylon_calendar_model.php`
  (reads CMS text via `application/models/page_model.php`),
  views `application/views/pylon/{calendar_box,edit_calendar_template}.php`,
  `application/views/standart_page.php` + `standart_page_setup.php`, `application/views/layout/{header,bottom}.php`
- **URL / route:** (route `pylon → pylon/show`; so `/pylon/` runs `show`)
  - `GET  /pylon/` — public calendar (route remaps to `show`)
  - `GET  /pylon/show` — public calendar (same target, directly)
  - `GET  /pylon/index` — alias; just calls `show()`
  - `GET  /pylon/editCalendar` — **admin** iframe editor page
  - `POST /pylon/save_calendar` — **admin** create a calendar event
  - `GET  /pylon/delete/{id}` — **admin** delete a calendar event (state-changing GET)
- **HTTP method(s):** GET + POST
- **Access control:** **Mixed, enforced inline per action (no central guard):**
  - Public (unauthenticated): `index`, `show`.
  - Admin: `editCalendar`, `save_calendar`, `delete/{id}` require session `username` **and** `editpage`
    (standard CI session userdata — see `01-infrastructure.md` A4/A5). If `username` is missing →
    `redirect("admin")`; if `username` present but `editpage` falsy → `echo "No rights to visit this page"`
    (HTTP 200, no redirect, no `exit`).

**Routes / actions:**
| Action | URL | Method | Access | Purpose |
|---|---|---|---|---|
| `index` | `/pylon/index` | GET | public | alias → `show()` |
| `show` | `/pylon/` , `/pylon/show` | GET | public | render CMS page + upcoming-events calendar |
| `editCalendar` | `/pylon/editCalendar` | GET | `username` + `editpage` | iframe editor: list + create-event form |
| `save_calendar` | `/pylon/save_calendar` | POST | `username` + `editpage` | validate + INSERT event |
| `delete` | `/pylon/delete/{id}` | GET | `username` + `editpage` | DELETE event by id |

## Purpose
A visitor opens the public "pylon" page (`pageId = 5`) and sees a CMS-managed text block followed by a
"Kalender" table of upcoming dated notices/events (day, name, expandable description), sorted by date.
A logged-in editor with the `editpage` right uses a separate iframe-embedded editor to add new events
(name, day/month/year, description) and delete existing ones. Past events automatically drop off the
public list.

## Inputs
| Name | Source | Type | Required? | Validated/sanitized? | Used for |
|---|---|---|---|---|---|
| `name` | POST | string | yes (`required`) | **no** sanitize; only required-check | event title; INSERTed into `gahk_pylon_calendar.name` |
| `day` | POST | string | yes (`required`) | **no** sanitize | `mktime` day; INSERTed into `day` |
| `month` | POST | string | yes (`required`) | **no** sanitize | `mktime` month; INSERTed into `month` |
| `year` | POST | string | yes (`required`) | **no** sanitize | `mktime` year; INSERTed into `year` |
| `description` | POST | text | yes (`required`) | **no** sanitize | INSERTed into `description` |
| `timestamp` | computed | int | n/a | server-set via `mktime(0,0,0,month,day,year)` | INSERTed into `timestamp`; drives "upcoming" filter |
| `{id}` | route segment 3 | string | yes for `delete` | **none** | passed to `delete_event($id)` → `WHERE id = $id` (bound) |
| session: `username` | session | string | for admin actions | CI DB session | auth gate |
| session: `editpage` | session | mixed | for admin actions | CI DB session | authorization gate |
| flashdata `success` | session | string | no | n/a | success banner in editor (set by `save_calendar`/`delete`) |
| *(any other POST key)* | POST | — | no | none | ⚠ **mass-assignment** — inserted verbatim if key matches a `gahk_pylon_calendar` column (`id`!) — see findings |

## Database interactions
- **Tables touched:** `gahk_pylon_calendar` (R/W), `gahk_page` (R), `gahk_counter` / `gahk_counterdato` (W, via counter middleware).
- **Reads:**
  - `gahk_page` via `Page_model->get_page(5)` — returns the row for `pageId 5`; controller reads
    `bgpic`, `id`, `menuCat`; the view renders `header` + `text` (raw HTML). `WHERE id = 5` (bound).
  - `gahk_pylon_calendar` via `Pylon_calendar_model->get_active_events()` —
    `WHERE timestamp >= time() ORDER BY timestamp ASC` (only future/today-midnight-or-later events),
    used by both `show` and the editor.
- **Writes:**
  - **INSERT `gahk_pylon_calendar`** — `save_calendar`, only when `form_validation->run() == true`, via
    `add_event($_POST)`. ⚠ Inserts the **entire `$_POST` array** (after the controller injects
    `$_POST['timestamp']`). Real columns: `id, timestamp, day, month, year, name, description`.
    Any matching extra POST key is written; `id` is `NOT NULL` with no `AUTO_INCREMENT` declared in the
    dumped schema — see quirks.
  - **DELETE `gahk_pylon_calendar` WHERE id = {id}** — `delete($id)` → `delete_event($id)`
    (`db->delete('gahk_pylon_calendar', ['id' => $id])`, value bound/escaped). No existence check, no
    confirmation, no row-count check.
  - **INSERT/UPDATE `gahk_counter` / `gahk_counterdato`** — side effect of `MY_Controller::counter()`,
    called from this controller's constructor on **every** action (see `01-infrastructure.md` A9).
- **Transactions / ordering:** none. `gahk_pylon_calendar` is **MyISAM** (no transactions available).
  Each write is a single statement; no multi-step sequence.

## Business logic
- **`show()` / `index()`** (public):
  ```
  page = get_page(5)                      # gahk_page row 5
  bgpic, pageid, menucat = page[0].{bgpic,id,menuCat}
  calendar = get_active_events()          # timestamp >= now, asc
  months = ["Jan","Feb","Mar","Apr","Maj","Jun","Jul","Aug","Okt","Sep","Nov","Dec"]  # ⚠ Sep/Okt swapped
  render header → standart_page (CMS header+text) →
        if calendar has >=1 row: render pylon/calendar_box → bottom
  ```
  The calendar box is omitted entirely when there are no upcoming events
  (`is_countable($calendar) ? count($calendar) : 0`).
- **`editCalendar()`** (admin):
  ```
  if !username -> redirect("admin")
  elif !editpage -> echo "No rights to visit this page"   # 200, stops here
  else:
     if flashdata('success') != "" -> data.success = flashdata
     calendar = get_active_events(); months = [...]
     render pylon/edit_calendar_template   # full standalone HTML doc (own DOCTYPE), no header/bottom
  ```
- **`save_calendar()`** (admin, POST):
  ```
  same auth gate as editCalendar
  set_rules required: name, day, month, year, description
  if validation passes:
     $_POST['timestamp'] = mktime(0,0,0, month, day, year)
     add_event($_POST)                         # INSERT (whole $_POST)
     set_flashdata('success', '<b>Tak.</b> Indlægget er nu oprettet')
     redirect("pylon/editCalendar"); return
  else:
     re-render edit_calendar_template (validation_errors() shows generic Danish message)
  ```
- **`delete($id)`** (admin):
  ```
  loads session lib (note: does NOT load form/form_validation here)
  same auth gate
  delete_event($id)                            # DELETE WHERE id=$id
  set_flashdata('success', 'Indlægget er nu slettet')
  redirect("pylon/editCalendar")
  ```
- Special cases: there is **no validation that day/month/year are numeric or in range**; `mktime` will
  normalize/overflow garbage (e.g. month 13 → next year). Events are matched against `time()` at
  midnight of the event date, so an event "today" stays visible until `timestamp` (00:00) passes.

## Outputs & side effects
- **Public render (`show`):** `layout/header.php` (full DOCTYPE, nav with `menucat` highlight), then
  `standart_page` → `standart_page_setup` (loops `$page`, echoes `header` as `<h2>` and `text` **raw**)
  → `footer`, then conditionally `pylon/calendar_box` (the "Kalender" table; loads `public/js/pylon/pylon.js`
  for the click-to-expand description rows), then `layout/bottom.php`. ⚠ `standart_page` also loads
  `layout/footer` *inside* the content box, while `bottom.php` closes the document — footer placement
  differs from a normal flow but is the shared standard page pattern.
- **Editor render (`editCalendar`/invalid `save_calendar`):** `pylon/edit_calendar_template.php` — a
  **complete standalone HTML page with its own `<!DOCTYPE>`/`<html>`/`<head>`/`<body>`**, designed to be
  embedded in an iframe (`#calendarframe` in the parent doc; JS auto-resizes the iframe to content
  height). Shows the event list with trash-icon delete links (`site_url('/pylon/delete/'.$row->id)`),
  a generic validation-error alert, an optional success alert, and the create-event form
  (`form_open('pylon/save_calendar')`). No header/footer/nav chrome.
- **Redirects:** `save_calendar` (success) and `delete` → `pylon/editCalendar`; unauthenticated admin
  actions → `admin`.
- **Flash messages:** `success` flashdata on create/delete.
- **Emails / files / external calls:** none.
- **Headers/session:** standard `MY_Controller` constructor behavior (no-cache headers, session
  bootstrap — `01-infrastructure.md` A9); **visit-counter write on every hit** including admin actions
  (`gahk_counter`/`gahk_counterdato`).

## Dependencies
- **Cross-cutting infra used:** `MY_Controller` base (session bootstrap, visit counter via `counter()`,
  no-cache headers) — `01-infrastructure.md` A4/A5/A9. Auth gate = standard session `username`/`editpage`
  check (A4/A5). CSRF globally off (`config['csrf_protection'] = false`, A4). Referenced by name.
- **Models:** `Page_model` (`get_page`), `Pylon_calendar_model` (`get_active_events`, `add_event`,
  `delete_event`).
- **Libraries/helpers:** `form` helper, `form_validation`, `session` (loaded per-action in
  `editCalendar`/`save_calendar`; `delete` loads only `session`).
- **Views:** `layout/header.php`, `layout/head.php`, `submenu.php`, `standart_page` →
  `standart_page_setup` → `layout/footer`, `pylon/calendar_box`, `pylon/edit_calendar_template`,
  `layout/bottom.php`. Front-end: `public/js/pylon/pylon.js`.
- **External services:** none.

## Security findings
| Issue | Location | Severity | Note |
|---|---|---|---|
| Stored XSS via event fields | `pylon/calendar_box.php:11-16`, `edit_calendar_template.php:27-33` | **High** | `name`/`description` echoed raw (`<?=...?>`); inputs never sanitized in `save_calendar` |
| Stored XSS via CMS page text | `standart_page_setup.php:14` | **Medium** | `gahk_page.text` echoed raw (intended HTML CMS body; inherited site-wide) |
| Mass-assignment on insert | `pylon_calendar_model::add_event($_POST)` | **Medium** | whole `$_POST` inserted; attacker (an editor) can set `id` and any column |
| No CSRF protection | `save_calendar` (POST) + state-changing GET `delete/{id}` | **Medium** | `csrf_protection=false` site-wide (A4); `delete` mutates on a plain GET link |
| Authorization weakly typed | `pylon.php:47-51,74-78,108-112` | **Low** | gate is truthy `editpage`; any non-empty value grants access (consistent across actions here) |
| `delete` accepts unbounded id, no ownership/existence check | `pylon.php:102`, `delete_event` | **Low** | id is bound (no SQLi), but any editor can delete any event with no confirmation |
| Info: non-fatal authz failure | `pylon.php:50,77,111` | **Low** | `echo "No rights..."` without `exit` — request continues to PHP end; harmless here but pattern is fragile |

## Quirks, edge cases & suspected bugs
- ⚠ **Month array Sep/Okt swapped** (`["...","Jul","Aug","Okt","Sep","Nov","Dec"]`) in `show`,
  `editCalendar`, and `save_calendar` (`pylon.php:27,58,95`). Display label for month 9 shows "Okt" and
  month 10 shows "Sep". Same bug appears in F-001's `showAnsoegning`. **Cosmetic but visible; PRESERVE-then-decide.**
- ⚠ **`gahk_pylon_calendar.id` has no `AUTO_INCREMENT` in the dumped schema** (only `NOT NULL`). If the
  live DB lacks an auto-increment/trigger, `add_event` (which does not set `id`) would insert `id = 0`
  every time and collide after the first row. Needs verification against the live table definition —
  the dump may have stripped `AUTO_INCREMENT`/`PRIMARY KEY`. (Schema-as-dumped also shows no PK on this table.)
- **No numeric/range validation** on `day`/`month`/`year`; `mktime` silently normalizes overflow
  (e.g. day 32, month 13), producing a valid-but-unexpected `timestamp`.
- **Past events vanish automatically** — `timestamp >= time()` filter; editors can never see/edit/delete
  past events through the editor (the list only shows upcoming ones). Old rows accumulate undeleted in DB.
- **`save_calendar` validation error path** re-renders the editor but does **not** re-load `success`
  flashdata and uses `set_value()` to repopulate — fine; but the generic error message ("De markerede
  felter skal udfyldes.") doesn't say which field.
- `delete` does not load `form`/`form_validation` libs (unlike the other two) — harmless, just inconsistent.
- The `show` redirect target `redirect("admin")` (and editor `form_open('pylon/save_calendar')`) rely on
  CI base URL config; `admin` resolves via routes (see admin/login feature).
- Charset: `gahk_pylon_calendar` is `utf8mb3_unicode_ci` (NOT latin1 like some tables) — Danish chars in
  `name`/`description` should migrate cleanly, but confirm during ETL.

## Reimplementation notes (Django)
- **Views:** public `TemplateView`/function view (`show`) rendering CMS page (`gahk_page` row 5) + an
  upcoming-events queryset (`timestamp__gte=now`, ordered); an admin-gated editor as a `CreateView`/`ListView`
  combo (login + `editpage` permission) plus a POST-only delete. Use a real `Form` with explicit, validated
  fields (kills mass-assignment; validate day/month/year as integers / accept a real date field).
- **Model:** `PylonCalendarEvent` over `gahk_pylon_calendar` (`name`, `day`, `month`, `year`, `timestamp`,
  `description`; add proper auto PK). Consider deriving `timestamp`/date from a single `DateField`.
- **Template:** escape `name`/`description` on output (FIX the stored-XSS); the iframe editor can become a
  normal admin sub-page or stay iframe-embedded if the surrounding intern UI needs it.
- **PRESERVE:** public URL `/pylon/`, the "upcoming-only, ascending" listing, the click-to-expand
  description rows, the editor workflow. **FIX (record + confirm):** month-array Sep/Okt order; raw-HTML
  XSS; `delete` → POST + CSRF; numeric date validation.
- **URL patterns to keep:** `/pylon/` (public). Admin paths can be reorganized under the intern app.

## Open questions
- Does the live `gahk_pylon_calendar` table actually have `AUTO_INCREMENT` on `id`? The dump shows none —
  if truly absent, current inserts would be broken/colliding, which contradicts a working calendar.
  **Must confirm against the live schema before migrating.**
- Is the Sep/Okt month-label swap a real long-standing display bug (to fix) or has nobody noticed because
  few events fall in Sep/Oct? Confirm before "correcting".
- Is the iframe-embedded editor (`edit_calendar_template`) reached from an intern admin page that wraps it
  in `#calendarframe`? Where is that parent page, and should the Django version keep the iframe pattern?
- Should past events be retained/visible to editors (for editing/audit) rather than silently filtered out?
- Is `gahk_page` row 5 confirmed to be the intended "pylon" CMS copy?
