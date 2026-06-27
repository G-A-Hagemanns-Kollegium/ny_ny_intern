# Feature: Stamtræ — alumni "family tree" (fadder/fylgje lineage) visualization

- **Feature ID:** F-011
- **Source file(s):** `application/controllers/intern/stamtree.php`, `application/models/stamtree_model.php`,
  `application/libraries/GahkTree.php`, view `application/views/intern/stamtree.php`
  (chrome via `application/views/intern/header.php` + `footer.php`, base `application/core/MY_Controller.php`)
- **URL / route:** `GET /nyintern/stamtree/` (and `/nyintern/stamtree`) — default action `index`.
  Routing is generic: `routes.php:75-77` maps `nyintern/(:any)` → `intern/$1`, so `nyintern/stamtree` →
  `intern/stamtree` (controller `Stamtree`, default method `index`). There is **no** explicit `stamtree` route line.
- **HTTP method(s):** GET only (the controller exposes a single `index` action; no POST handling).
- **Access control:** **logged-in** only, enforced **inline in `index`** (not by a central guard).
  `index` reads session `username` (`stamtree.php:31`); if falsy it stores `current_url()` in flashdata
  `redirectToUrlAfterLogin` and `redirect("nyintern/admin")` (`stamtree.php:34-38`). This is the standard
  internal-area login pattern (same shape as F-001's admin actions; session userdata per `01-infrastructure.md`
  A4/A5). No role/`akRole` check — any authenticated alumne may view.

**Routes / actions:**
| Action | URL | Method | Access | Purpose |
|---|---|---|---|---|
| `index` | `/nyintern/stamtree/` | GET | logged-in (`username` set) | Build alumni lineage tree from `intern_alumne` and render the D3 visualization |

## Purpose
A logged-in resident opens the "Stamtræ" (family tree) page in the internal area and sees an interactive,
collapsible D3 tree of GAHK alumni lineage. Each resident has a *fylgje* (the person who "sponsored"/preceded
them — the fadder/fylgje relationship), and the page draws everyone as descendants of a synthetic root node,
"Hagemanns Ånd", building the genealogy of who-followed-whom in move-in order.

## Inputs
| Name | Source | Type | Required? | Validated/sanitized? | Used for |
|---|---|---|---|---|---|
| session `username` | CI session userdata | string | yes (login gate) | n/a (trusted session) | login check (`stamtree.php:31,34`); also drives header menu/chrome |
| session `fullname` | CI session userdata | string | no | n/a | read into `$fullname` (`stamtree.php:32`) but **never used** in the controller |
| session `fullname`,`alumne_id`,`akRole`,`indstilling`,`inspektion`,`kokkengruppe`,`oelkaelder`,`administrator` | CI session | mixed | no | n/a | injected by `showInternPage()` (`MY_Controller.php:14-32`) for header/footer chrome only |
| `intern_alumne` rows | DB (read) | result objects | n/a | values are **trusted from DB, not escaped** | source of tree nodes — see DB interactions |
| `$params = ['1' => 'Dummy Poulsen']` | hardcoded in constructor | array | n/a | n/a | passed to `GahkTree` library loader (`stamtree.php:23-24`); inert — see quirks |

There are **no** request parameters (no GET query, no route segments, no POST body) consumed by this feature.

## Database interactions
- **Tables touched:** `intern_alumne` (READ only).
- **Reads:** `Stamtree_model->getAllAlumner()` (`stamtree_model.php:15-17`):
  ```sql
  SELECT ID, CONCAT_WS(' ', firstName, lastName) AS name, fylgje, moveInDay
  FROM intern_alumne
  ORDER BY moveInDay ASC
  ```
  Column roles in the tree:
  - **Node label / identity:** `name` = `CONCAT_WS(' ', firstName, lastName)`. ⚠ Identity is by **display name string**, not by `ID`. `ID` is selected but never used by the controller.
  - **Parent link:** `fylgje` (a free-text `text NOT NULL` column holding the parent's *name string*, matched against other rows' `name`). It is **not** a foreign key to `intern_alumne.ID`.
  - **Ordering:** `moveInDay` (`date`) — `ORDER BY moveInDay ASC` so a parent (earlier move-in) is processed before its children (intended invariant, see business logic / quirks).
  Real `intern_alumne` columns (schema): `ID int`, `firstName text`, `lastName text`, `fylgje text`,
  `birthday date`, `moveInDay date`, `moveOutDay date NULL`, `study text`, `phone text`, `email text`,
  `password text`, `networkClosed tinyint`, `networkClosedDetails text NULL`. Engine MyISAM, `utf8mb3_danish_ci`.
- **Writes:** **none.** No INSERT/UPDATE/DELETE in this feature. (The visit counter does **not** run here — see quirks.)
- **Transactions / ordering:** no transactions. Only ordering significance is the `ORDER BY moveInDay ASC`
  on the single read, which the build algorithm relies on (see business logic).

## Business logic
The tree is built in two passes by `buildTree($dataSet)` (`stamtree.php:115-168`), over the alumni list
sorted by `moveInDay ASC`, using the minimal `GahkTree` node class (`name` + `children[]`, with `addChild()`).

1. **Create synthetic root** `$T = new GahkTree("Hagemanns Ånd")` (`stamtree.php:117`).
2. **Fix parents (orphan repair)** (`stamtree.php:120-137`): for every alumne `$s`, check whether its
   `fylgje` value matches some other row's `name` via `nameInResultSet()` (linear scan, first match;
   `stamtree.php:57-84`). If **no** matching parent exists in the set, overwrite `$s->fylgje = "Hagemanns Ånd"`
   so the node will hang off the root. (Matched parents are left unchanged.)
3. **Build** (`stamtree.php:151-158`): seed a name→node map `$MDMAMap = ["Hagemanns Ånd" => $T]`, then for
   each `$s` in order call `addToTree($s, $MDMAMap, $T)`:
   - Look up the parent node `$P = $Map[$alumne->fylgje]` (`stamtree.php:92`).
   - Create `$child = new GahkTree($alumne->name)` (`stamtree.php:96`).
   - If `$P` is not null: `$P->addChild($child)` and register `$Map[$alumne->name] = $child` (`stamtree.php:101-104`).
   - **Else** (`$P` is null): `echo "FEJL!!"` and the child is silently dropped (`stamtree.php:105-107`).
4. Return `$T`; the controller `json_encode`s it with `JSON_THROW_ON_ERROR` into `$data['treeOut']`
   (`stamtree.php:50`) and renders `intern/stamtree`.

Pseudocode:
```
rows = getAllAlumner()                       # ordered by moveInDay ASC
root = node("Hagemanns Ånd")
for s in rows:                               # pass 1: orphan repair
    if not any(r.name == s.fylgje for r in rows):
        s.fylgje = "Hagemanns Ånd"
map = { "Hagemanns Ånd": root }
for s in rows:                               # pass 2: link
    parent = map[s.fylgje]                   # may be undefined/null
    child  = node(s.name)
    if parent is not null:
        parent.addChild(child)
        map[s.name] = child
    else:
        echo "FEJL!!"                        # child dropped
return root
```
**Missing-parent handling:** pass 1 reroutes *unknown* parents to the root. The `"FEJL!!"` branch in pass 2
fires only when the parent name *exists in the set* but its node is **not yet in `$Map`** at the time the
child is processed — i.e. the `moveInDay ASC` ordering failed to place the parent first (parent moved in
on/after the child, equal dates, NULL/`0000-00-00` dates, or a duplicate-name collision). See quirks.

## Outputs & side effects
- **Renders:** `intern/stamtree` wrapped by `showInternPage()` → `intern/header.php` + view + `intern/footer.php`
  (`stamtree.php:52`, `MY_Controller.php:35-37`). The view inlines the tree JSON into a JS array
  `var treeData = [ <?=$treeOut?> ];` (`views/intern/stamtree.php:31-33`) and runs the d3.v3 collapsible-tree
  script (adapted from d3noob bl.ocks 8375092). `root = treeData[0]` (`views/intern/stamtree.php:57`), nodes
  labelled by `d.name`, click toggles `children`/`_children`. Container `<div id="stamtree">` between literal
  `------` separators (placeholder markup, `views/intern/stamtree.php:20-26`).
- **`"FEJL!!"` echo:** printed directly to the response stream by `addToTree()` whenever a parent node is
  missing from the map (`stamtree.php:106`). Because it is echoed *before* `showInternPage()` builds output,
  it appears at the very top of the HTML, above the header — debug-grade leakage, one per orphan.
- **Redirect:** unauthenticated → `redirect("nyintern/admin")` with flashdata `redirectToUrlAfterLogin`
  (`stamtree.php:35-37`).
- **Headers/session:** `session_start()` is called in the constructor (`stamtree.php:10`) in addition to CI's
  session library — see findings. No custom headers set by this feature.
- **Visit counter:** ⚠ **NOT written.** Neither `Stamtree::__construct` nor `MY_Controller::__construct`
  calls `counter()`. The base constructor (`MY_Controller.php:5-10`) only loads `session` + `gahk_helper`.
  This **contradicts** the task context ("MY_Controller constructor runs the visit counter on every hit") —
  see findings. (Contrast F-001/`optagelse`, which calls `counter()` explicitly from its own constructor.)

## Dependencies
- **Cross-cutting infra used:** `MY_Controller` base (session bootstrap + `gahk_helper`), CI DB sessions and
  session userdata login pattern (`01-infrastructure.md` A4/A5), `showInternPage()` chrome wrapper
  (header/footer + session-var injection, `MY_Controller.php:12-43`). The standard counter (A9) is **not**
  invoked here.
- **Library:** `GahkTree` (`libraries/GahkTree.php`) — a 23-line node class: public `$name`, `$children[]`,
  `getName()`, `addChild(GahkTree)`. Uses PHP 8 constructor-property-promotion (`function __construct(public $name)`).
- **Loaded but inert:** `form` helper, `session` library, `url` helper (`base_url`/`current_url` are used),
  and the `GahkTree` library loaded with constructor params `['1' => 'Dummy Poulsen']` (`stamtree.php:13-24`).
- **Frontend:** D3 v3 (`public/intern/d3.v3.min.js`, included globally in `header.php:35`), jQuery, Bootstrap;
  page CSS `public/intern/css/stamtree.css` (`header.php:27`). Menu item "Stamtræ" → `nyintern/stamtree`
  (`header.php:90`).
- **Model:** `Stamtree_model` (only `getAllAlumner()` is used by this feature).

## Security findings
| Issue | Location (file:line) | Severity | Note |
|---|---|---|---|
| **Stored XSS** — alumne names emitted into inline `<script>` unescaped | view `stamtree.php:32` (`<?=$treeOut?>`) + names from `intern_alumne.firstName/lastName` | **High** | `json_encode` (no `JSON_HEX_*` flags) does not escape `</script>` or `<!--`; a name containing `</script>` breaks out of the JS context → arbitrary script. Names are admin-entered but still untrusted. |
| **Debug output leak** — `echo "FEJL!!"` to live response | `stamtree.php:106` | **Low** | Leaks internal state to authenticated users; pollutes HTML. Not exploitable but unprofessional. |
| **No CSRF** | site-wide `csrf_protection=false` (`01-infrastructure.md` A4) | **Low** | Read-only GET feature; no state change, so low impact. |
| **No authorization granularity** | `stamtree.php:31-38` | **Info** | Any logged-in alumne sees full lineage incl. all current resident names — by design, but no role gate. |
| **SQL injection** | `stamtree_model.php:15-16` | **None** | `getAllAlumner()` takes no parameters; static query. (The other model methods are dead — see quirks.) |
| **Double session start** | `stamtree.php:10` raw `session_start()` + CI `session` lib | **Info** | Possible "session already started" notice depending on PHP config; not a vuln. |

## Quirks, edge cases & suspected bugs
- **`"FEJL!!"` debug echo (`stamtree.php:106`):** fires when a child's named parent exists in the dataset but
  hasn't been added to `$Map` yet. The code comment at `stamtree.php:145` ("As we sort by moveinDate the parent
  will always exist") shows the author *assumed* `moveInDay ASC` guarantees parent-before-child. That breaks if:
  parent and child share a `moveInDay`, parent has a later/NULL/`0000-00-00` `moveInDay`, or two alumni share
  the same `name` (the map is keyed by name). On the `FEJL` branch the child is **silently dropped** from the tree.
- **Dead model code (confirmed):** `Stamtree_model` contains `getNewestAnsoegninger`, `numberOfAnsoegninger`,
  `getAnsoegningerById`, `getAnsoegningerByWeek`, `getAnsoegningerByMonth`, `getAnsoegningerByStudyAndMonth`,
  `getAnsoegningerByStudyAndThisYear`, `getAnsoegningerByHowYourHeardAndThisYear`, `setAnsoegningAsReceived`,
  `insertPaamindelseForWeek` (`stamtree_model.php:21-107`) — copy-pasted from `Ansoegninger_model` (F-001).
  Grep confirms **none** are called from `stamtree.php`. They reference `gahk_ansoegninger` /
  `gahk_ansoegninger_paamindelse` and carry the same SQLi (`$id`/`$from`/`$to` interpolation) as F-001, but are
  **dead here** — do not port. Several (`getAnsoegningerByWeek`) are even commented "Currently not used".
- **Identity by name, not ID (`stamtree_model.php:16`):** the whole algorithm keys on the concatenated name
  string. Two alumni with identical full names collide in `$Map`/`nameInResultSet` (later one overwrites the
  earlier node reference). `ID` is selected but ignored.
- **Inert constructor params (`stamtree.php:23-24`):** `['1' => 'Dummy Poulsen']` is passed to the `GahkTree`
  loader, but `GahkTree::__construct(public $name)` is always called explicitly with real names elsewhere; the
  CI-loaded singleton instance is never used. Author comment confirms it's only to satisfy the constructor.
- **Orphan handling is silent** (pass 1) but **late-parent handling is loud** (`FEJL!!`, pass 2) — two different
  failure modes, inconsistent treatment.
- **No empty-set handling:** if `getAllAlumner()` returns no rows, `$T` is just the root; the view does
  `root = treeData[0]` which is the root object — renders a single node. (No crash.)
- **`moveOutDay` ignored:** former residents (moved out) are included identically; the tree never prunes them.
- **`fullname` read but unused** in the controller (`stamtree.php:32`).
- **Mojibake risk:** `intern_alumne` is `utf8mb3_danish_ci`; Danish characters in names flow straight into JSON/JS
  — confirm encoding end-to-end in ETL.

## Reimplementation notes (Django)
- **View:** a single `LoginRequiredMixin` `TemplateView` (GET) that queries the `Alumne` model and serializes the
  tree to JSON for the template (or a separate JSON endpoint the D3 view fetches).
- **Model:** `Alumne` over `intern_alumne`. The lineage should become a proper **self-referential FK**
  (`fylgje → Alumne`) instead of a free-text name match — **FIX** the name-based matching, but **PRESERVE** the
  synthetic root "Hagemanns Ånd" and the move-in ordering for visual parity. Build the tree server-side with a
  dict keyed by PK; reroute true orphans to root; **drop** the `FEJL!!`/silent-drop behavior (log instead).
- **Template:** keep the D3 collapsible-tree JS but **FIX** the XSS by emitting the tree via
  `json_script` / properly escaped JSON, not raw `<?=?>` interpolation. Drop the dead ansoegninger model methods.
- **URL pattern:** preserve `/nyintern/stamtree/` (path `nyintern/stamtree/`).

## Open questions
- Is `fylgje` semantically the **fadder/fylgje** (sponsor) of each resident, and is the intended display a true
  genealogy? Confirm the relationship's direction and meaning with a human (the name-string design suggests it
  was never enforced as a real FK).
- Should the tree include **moved-out** alumni (`moveOutDay` set), or only current residents? Current code shows everyone.
- Is the `"FEJL!!"` case ever actually hit in production data (do parent move-in dates ever tie/postdate
  children)? Needed to decide whether silent child-dropping has been masking missing nodes.
- Are duplicate full names possible in the historical data (the name-keyed map would silently merge them)?
- Should non-resolvable `fylgje` values keep collapsing to the root, or surface as a data-quality report?
- Confirm there is genuinely no visit-counter expectation for this page (it differs from other internal
  controllers that call `counter()` explicitly).
