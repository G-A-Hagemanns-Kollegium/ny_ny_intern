# Feature: Portfolio — static JSON stub endpoint

- **Feature ID:** F-015
- **Source file(s):** `application/controllers/portfolio.php`, `application/views/portfolio.php`
- **URL / route:** `/portfolio/getPortfolio`
- **HTTP method(s):** GET
- **Access control:** **public, not enforced** — no auth check; emits `Access-Control-Allow-Origin: *`.

**Routes / actions:**
| Action | URL | Method | Access | Purpose |
|---|---|---|---|---|
| `getPortfolio` | `/portfolio/getPortfolio` | GET | public | returns a static JSON blob |
| `__construct` | — | — | — | `session_start()` + loads `session`/`form` (both unused) |

## Purpose
Appears to be an **abandoned stub**. The endpoint returns a fixed JSON document and nothing else —
there is no "portfolio" data, model, or UI behind it. The name suggests a feature that was scaffolded
but never built.

## Inputs
| Name | Source | Type | Required? | Validated/sanitized? | Used for |
|---|---|---|---|---|---|
| *(none)* | — | — | — | — | the action reads no request input |

## Database interactions
- **Tables touched:** none.
- **Reads:** none.
- **Writes:** none. (Unlike most App A controllers, `portfolio` does **not** call `counter()`, so no
  `gahk_counter` write either.)
- **Transactions / ordering:** n/a.

## Business logic
`getPortfolio()` sets CORS + JSON headers and returns the `portfolio` view. The view
(`application/views/portfolio.php`) is the literal three-line document `{ "test": "hej" }`. No branching,
no data.

## Outputs & side effects
- Renders the static JSON `{"test":"hej"}` with `Content-Type: application/json; charset=utf-8`.
- Sets `Access-Control-Allow-Origin: *` (readable cross-origin by any site).
- No redirects, emails, files, DB, or session writes.

## Dependencies
- **Cross-cutting infra used:** `MY_Controller` base + `session` library + `form` helper are loaded in
  the constructor but **unused**; no other infra (no counter, no DB) — see `01-infrastructure.md` A9.
- None external.

## Security findings
| Issue | Location (file:line) | Severity | Note |
|---|---|---|---|
| Wide-open CORS on a public endpoint | `portfolio.php:15` | Low | `ACAO: *`; harmless today (static stub) but a footgun if real data is ever added here |
| No CSRF / no auth | whole controller | Low | acceptable for a read-only static stub; flagged for completeness |

## Quirks, edge cases & suspected bugs
- The view is a hardcoded `{"test":"hej"}` placeholder — strong evidence this is **dead/stub code**.
- `session_start()` + `session`/`form` loaded but never used.
- Returns the view (`$return=false` in the `load->view` call despite the `return`), so output is echoed.

## Reimplementation notes (Django)
- Almost certainly **DROP** unless an external embed actually consumes `/portfolio/getPortfolio`. If kept,
  it's a one-line JSON view. Preserve the URL only if an external consumer is confirmed.

## Open questions
- Does anything external call `/portfolio/getPortfolio`? (Access logs — scope §8.6.) If not, delete it.
- Was a "portfolio" feature ever intended? If so, what was it meant to expose?
