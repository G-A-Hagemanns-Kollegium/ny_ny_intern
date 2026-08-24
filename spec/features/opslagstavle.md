# Feature: Opslagstavlen — the kollegium's noticeboard

**Unnumbered on purpose.** `F-001`–`F-015` are legacy-parity documents: each one carries a
"Source file(s)" header pointing at a PHP controller, and `99-index.md` states they cover every live
controller in the old app. Opslagstavlen is greenfield, so giving it an `F-016` would make every
existing `F-0NN` citation in the code ambiguous. Den Hurtige — the other greenfield feature — has no
spec file at all and documents itself through module docstrings; this file exists because the
*rejected alternatives* below are worth writing down somewhere, and a docstring is the wrong place
for "here is what we decided not to do".

## What it is, and what it replaces

The kollegium used a Facebook group for information relevant to the dorm: important events, the
results of værelsesrunden, birthdays, practical notices. This replaces it: Markdown posts with
images, comments and reactions, at `/nyintern/opslagstavle/`, open to every resident.

**What it is not:** Den Hurtige. That feature is a chat whose messages are hard-deleted after 30
minutes to 24 hours, and whose model docstring promises exactly that ("deliberately ephemeral… a
thread that cannot accumulate off-topic history"). Content that should still be findable next month
belongs here; content relevant for the next few hours belongs there. The two share reactions, image
validation, the emoji grammar and the push transport — all extracted to `core` — and deliberately
share nothing else.

## Access

| Action | Who |
| --- | --- |
| Read, post, comment, react | every logged-in resident |
| Edit a post | **the author only** |
| Delete a post | the author, or `administrator` / `inspektion` |
| Delete a comment | the comment's author, or `administrator` / `inspektion` |
| Pin / unpin (max 5) | `administrator` / `inspektion` |

All checks read *effective* roles (`residents.permissions.request_has_role`), so an administrator
using the preview tool to view the site as a beboer correctly loses the moderation controls.

Moderators can delete but **not** edit someone else's post: the post keeps its author's name, so
silently rewriting words that may already have replies referring to them is worse than removing it —
deleting is visible, editing is not. Comment deletion deliberately excludes the *post's* author, for
the same kind of reason: letting people moderate replies to their own post invites exactly the
disputes Inspektionen exists to settle.

## Routes

`/nyintern/opslagstavle/` (board), `<pk>` (permalink), `opret`, `<pk>/rediger`, `<pk>/slet`,
`<pk>/fastgoer`, `<pk>/kommentar`, `kommentar/<pk>/slet`, `<pk>/reaktion`, `forhaandsvisning`,
`billede`, `abonner`. Namespaced `opslagstavle:`.

## Data model

`Notice` (author, title, category, Markdown body, `created_at`, `edited_at`, `pinned_at`,
`pinned_by`), `NoticeComment`, `NoticeReaction`, `NoticeImage`. Category is a fixed `TextChoices` set
with ASCII values (they appear in `?kategori=`) and Danish labels.

**Pinning is a nullable timestamp, not a boolean.** One column answers three questions: is it
pinned, how do pins order among themselves (newest pin first — a boolean cannot express that, so
pinning a six-month-old post would drop it below a newer pin), and is it exempt from retention
(`pinned_at__isnull=True` *is* the purge filter). `pinned_by` is the audit trail, because "who
pinned this, and when" is the first thing Inspektionen will be asked.

**`edited_at` is set explicitly by the edit view, never `auto_now`.** `auto_now` fires on every
`save()`, so pinning would stamp a post "Redigeret" with the moderator's action — and readers see
that marker, so a false one is worse than none.

## Markdown

`markdown-it-py` with the `default` preset and `html=False`, then `nh3`. Two independent defences:
raw HTML is escaped to text by the parser and never becomes a node, *and* the generated HTML is
sanitised against a tight allowlist (no `style`/`class`/`id` — there is no `*` bucket at all, unlike
`cms/sanitize.py`, which is generous for trusted editors preserving migrated page formatting).
`nh3`'s `attribute_filter` additionally drops off-site `<img src>`: a remote image on an internal
page is a tracking pixel that hands a third party the IP and read-time of every resident who opens
the post.

**Rendered on read; only the Markdown source is stored.** See "rejected" below.

## Retention

`manage.py purge_notices`, nightly at 03:40 (DEPLOY.md §4b). Posts older than 2 × 365 days are
hard-deleted **unless pinned** — a pin is Inspektionen deciding the kollegium keeps that one, which
makes it the retention override. Comments, reactions and image rows cascade; image *files* go via the
`post_delete` receiver on `NoticeImage`. The same command sweeps uploads that were never referenced
by a saved post, after a day's grace.

The window was **shortened from five years to two after user testing**: a board people actually read
does not need half a decade of history, and a shorter window is closer to the point of leaving
Facebook. `opslagstavle.models.RETENTION_DAYS` is the single knob.

## Notifications

Web Push, reusing `core.push`, with a **separate opt-in** from Den Hurtige: a browser has exactly one
push endpoint per service-worker registration, so consent is two boolean columns on
`core.PushSubscription`, and subscribing to one topic must never touch the other's.

New post → all board subscribers except the author. New comment → **the post's author only** (a
thread with twenty replies must not be twenty dorm-wide pushes, which is why there is no "underret
alle" checkbox here). Reactions → nobody, ever. The notification links to the individual post.

## Decisions and rejected alternatives

Each of these is something a future contributor will reasonably want to "improve". They were
considered and rejected on purpose.

**Storing rendered HTML in a `body_html` column.** Rejected. The sanitiser allowlist is security
config and *will* change; render-on-read means a tightening applies to every existing post the
moment the deploy lands. Storing HTML makes a re-render management command mandatory, with
cron's failure mode — silence — and no lazy guard is even possible, because nothing on a page load
can detect HTML produced under an older allowlist without re-rendering it anyway. The cost is a few
milliseconds per page (pure-Python markdown-it plus Rust nh3, on a page that does not poll). If
profiling ever disagrees, the escape hatch is `cache.get_or_set` keyed on
`(pk, edited_at or created_at)` — no schema change.

**A generic-FK `core.Reaction` table shared with Den Hurtige.** Rejected. A `GenericForeignKey` has
no database-level foreign key, so the retention command's *bulk* delete would leave orphaned reaction
rows behind unless every model also carried a `GenericRelation`. A purge that silently leaks rows for
the lifetime of the board is precisely the failure mode this feature must not have. Each app keeps a
concrete table; the *semantics* are shared (`core.reactions`).

**An abstract base model for "authored content with images".** Rejected. It would save about six
lines (`author`, `created_at`, `body`) and cost `"%(class)s"`-templated `related_name`s — so reverse
accessors stop being greppable — plus a coupling that puts Den Hurtige's schema on this feature's
release cadence. The models genuinely diverge: `expires_at`/`minutes_left` against
`title`/`category`/`pinned_at`/`pinned_by`/`edited_at` and a reverse-FK image relation.

**A nightly sweep that scans post bodies for each image's URL** (the `CmsImageAdmin.usage` pattern).
Rejected. It is O(images × posts) with a `LIKE '%…%'` no index can serve, and it can never be exact —
a URL inside a fenced code block looks like a reference — which leaves a choice between leaking files
forever and occasionally deleting a live image. Instead the reference is turned back into a real FK
at save time by parsing the Markdown token stream (`core.markdown.extract_image_names`), so "delete a
post, its pictures go" is a database property.

**A staged-rollout gate like `den_hurtige.access.ACCESS_ROLES`.** Rejected. The feature replaces a
group everyone was already in, so a board only Inspektionen can see has no content and cannot be
meaningfully trialled. Den Hurtige's gate exists because *notifications* were the risky part; here
they are per-topic and default off, so that blast radius is already contained.

**A 20-second poll, and the `no-zoom chat-page` body class.** Rejected, and there are tests asserting
their absence — they look like omissions and are decisions. Polling a paginated five-year archive
would fight the pager, throw away the reader's place, and re-render every post's Markdown server-side
every 20 seconds per open tab. Pinch-zoom matters on a long post with a table. If "what is new since
I last looked" turns out to matter, the honest cheap version is a `last_seen` timestamp driving an
"N nye opslag" banner.

**A lazy purge on page load**, which Den Hurtige does and DEPLOY.md otherwise argues for. Rejected
here: its tolerance is minutes, so a missed cron is visibly wrong within the hour; this feature's
tolerance is months, and putting a potentially large DELETE on every board request to insure against
that is a bad trade.

**Markdown in comments.** Deferred, not refused. Keeping it to the post body confines the
embedded-image lifecycle to one model and the compose toolbar to one purpose. Allowing it later is a
template change and a test.

**A `CheckConstraint` that `pinned_by` is set iff `pinned_at` is.** Rejected: `pinned_by` is
`SET_NULL`, so deleting the resident who pinned a post would violate it and make the delete fail.

**Client-side Markdown for the preview.** Rejected. It would be a second implementation with a
second allowlist, and the first time they disagreed the author would see one thing while the board
showed another — the classic "the preview kept my HTML, the saved post stripped it" bug. The preview
is an htmx POST through the same `core.markdown` call, so it is byte-identical by construction, and a
test asserts it.
