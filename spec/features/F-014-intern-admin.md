# Feature: Intern Admin — members-area authentication (login, logout, profile, forgot/reset password)

- **Feature ID:** F-014
- **Source file(s):** `application/controllers/intern/admin.php`,
  `application/models/internuser_model.php`, `application/models/adminuser_model.php`,
  views `application/views/intern/{login,editinfo,changepass,header,footer}.php`,
  `application/views/intern/forgotpass/{forgotpass,vispass}.php`
- **URL / route:** base `/nyintern/admin/` (via `nyintern/(:any) → intern/$1`)
- **HTTP method(s):** GET + POST
- **Access control:** **Mixed, enforced inline (no central guard):** login/forgot/reset flows are public
  (they bootstrap auth); `editinfo` and `changepassword` require a session `username` (else flashdata +
  redirect to `nyintern/admin`). Auth model = the standard CI session userdata + the parallel
  `intern_alumne_sessions` cookie token described in `01-infrastructure.md` A4.

**Routes / actions:**
| Action | URL | Method | Access | Purpose |
|---|---|---|---|---|
| `index` | `/nyintern/admin/` | GET | public | if logged in → `nyintern`, else show login |
| `login` | `/nyintern/admin/login` | GET+POST | public | authenticate (cookie auto-login, then form) |
| `logout` | `/nyintern/admin/logout` | GET | logged-in | clear token + destroy session |
| `editinfo` | `/nyintern/admin/editinfo` | GET+POST | logged-in | edit own email/phone |
| `changepassword` | `/nyintern/admin/changepassword` | GET+POST | logged-in | change own password |
| `forgotpass` | `/nyintern/admin/forgotpass[/success]` | GET | public | forgot-password form |
| `receivedmail` | `/nyintern/admin/receivedmail` | POST | public | issue + email a reset link |
| `resetpass` | `/nyintern/admin/resetpass/{linkId}` | GET | public (link-holder) | set + display a temp password |

## Purpose
The front door to the members area (`nyintern`). Residents/officers log in with email + password,
stay logged in via a remember-me cookie, edit their contact info, change their password, and recover a
lost password by email. It also decides, at login, whether the user is a plain member or an admin
(and with which role flags).

## Inputs
| Name | Source | Type | Required? | Validated/sanitized? | Used for |
|---|---|---|---|---|---|
| `email` | POST (login) | string | yes (`required`) | none (raw into SQL) | login lookup |
| `password` | POST (login) | string | yes (`required`) | `hash('sha256',…)` in controller | login lookup (hashed) |
| `session_token` | cookie | string | no | none (raw into SQL) | cookie auto-login (`loginSession`) |
| `email` | POST (editinfo) | string | yes | `required\|valid_email` | UPDATE `intern_alumne.email` |
| `phone` | POST (editinfo) | string | yes | `required\|min_length[8]` | UPDATE `intern_alumne.phone` |
| `oldpassword` | POST (changepassword) | string | yes | `required`; checked vs stored sha256 | verify before change |
| `newpassword` | POST (changepassword) | string | yes | `required`; must equal `confpassword` | new password |
| `confpassword` | POST (changepassword) | string | yes | `required` | confirm |
| `email` | POST (receivedmail) | string | yes | `xss_clean` (not SQL-escaped) | find alumne, send reset link |
| `{linkId}` | route segment 4 (resetpass) | string | yes | none (raw into SQL) | look up `intern_forgotpassword.link` |
| segment 4 (`success`) | route (forgotpass/changepassword) | flag | no | n/a | show success message |
| session: `username`, `alumne_id` | session | mixed | for logged-in actions | auth + record identity |

## Database interactions
**Tables touched:** `intern_alumne` (R/W), `intern_alumne_sessions` (R/W), `intern_forgotpassword` (R/W), `gahk_admin_user` (R, join).

- **Reads:**
  - `Adminuser_model->loginSession()` / `login()` — `intern_alumne` ⋈ `intern_alumne_sessions` ⋈
    `gahk_admin_user` (cookie token, or email+sha256). The join's presence/absence of a
    `gahk_admin_user` row (column `ak`) is how admin status is decided.
  - `Internuser_model->loginSession()` / `login()` — `intern_alumne` (+ `intern_alumne_sessions`).
  - `Internuser_model->getUser($alumneId)` (editinfo prefill), `getAlumneByEmail($email)` (receivedmail),
    `getAlumneIdByForgotPassLinkId($linkId)` (resetpass).
- **Writes:**
  - **DELETE + INSERT `intern_alumne_sessions`** — `createSession($alumneId)` clears the user's old token
    then inserts `(alumnum_id, session_id=sha256(alumneId+microtime+rand))`; sets a `session_token`
    cookie (~24h). Called on **form** login success.
  - **DELETE `intern_alumne_sessions`** — `clearSession()` on logout (by `session_id` cookie) + deletes cookie.
  - **UPDATE `intern_alumne` SET email, phone WHERE id** — `editinfo` (only when form validates).
  - **UPDATE `intern_alumne` SET password=sha256(new) WHERE id** — `changePassword()` (after verifying old).
  - **INSERT `intern_forgotpassword` (link=sha1(time()), alumneid)** — `receivedmail` when the email exists.
  - **UPDATE `intern_alumne` SET password=sha256(temp) WHERE id** — `resetpass` when the link resolves.
- **Transactions / ordering:** none; all MyISAM (no transactions). `createSession` is delete-then-insert
  (not atomic, but single-user scope so low risk).

## Business logic
- **`login`** (`admin.php:101-168`): (1) try cookie auto-login — `Adminuser_model->loginSession()`, else
  `Internuser_model->loginSession()`; if a row returns → `startSession()`. (2) Else if the form validates,
  `Adminuser_model->login(email, sha256(password))`, falling back to `Internuser_model->login(...)`; on
  success `createSession()` + `startSession()`; else show error. ⚠ Note `createSession` (the remember-me
  token) is written on **form** login but **not** on cookie auto-login.
- **`startSession`** (`:170-191`): sets `username`(=email), `alumne_id`, `fullname`; sets the role flags
  (`administrator`, `editpage`, `indstilling`, `akRole`, `inspektion`, `kokkengruppe`, `oelkaelder`)
  **only if `isset($result[0]->ak)`** — i.e. only when a `gahk_admin_user` row was joined. Then redirects
  to `redirectToUrlAfterLogin` flashdata or the current URI.
- **`changepassword`**: validate three fields; require `newpassword == confpassword`; `changePassword`
  re-checks the old password against the stored unsalted sha256 before updating; on success → logout.
- **Forgot/reset flow** (resolved in `01-infrastructure.md` A4): `receivedmail` finds the alumne by email,
  inserts a reset link `sha1(time())`, emails it; `resetpass` sets the password to
  `random_int(5,10000)."#glemaldrig"`, stores its sha256, and **displays the temp password in plaintext**
  via `vispass.php`.

## Outputs & side effects
- **Renders:** login form, edit-info form, change-password form, forgot-password form, and the
  temp-password display — all wrapped in `intern/header`+`footer`.
- **Redirects:** `nyintern` (already-logged-in / after login), `nyintern/admin` (logout, unauthenticated
  guard), `nyintern/admin/forgotpass/success` (after receivedmail).
- **Emails:** `receivedmail` sends the reset-link email via PHP `mail()` (From `it@gahk.dk`, fixed subject).
  ⚠ Note this uses raw `mail()` directly, **not** the SMTP config used by `optagelse` (F-001).
- **Cookies:** `session_token` set (~24h) on form login; deleted on logout.
- **Session:** all userdata keys above set on login; `sess_destroy()` + `session_unset()` on logout.
- **No visit-counter write** (this controller does not call `counter()`).

## Dependencies
- **Cross-cutting infra used:** `MY_Controller` base + CI session library, the dual session mechanism
  (CI DB sessions + `intern_alumne_sessions` token), `form` helper, `form_validation` — see
  `01-infrastructure.md` A1/A4. **Does not** use the visit counter or the email SMTP config.
- **Models:** `Internuser_model`, `Adminuser_model`.
- **Quirk dependency:** constructor calls native `session_start()` *and* loads the CI `session` library
  (two session systems in one request).

## Security findings
| Issue | Location (file:line) | Severity | Note |
|---|---|---|---|
| SQL injection via `email` (login) | `internuser_model.php:14`, `adminuser_model.php:13` | **High** | raw `email='$email'` in auth query → injection/auth-bypass surface |
| SQL injection via reset `linkId` | `internuser_model.php:76` (`getAlumneIdByForgotPassLinkId`) | **High** | route segment concatenated raw |
| SQL injection via `email` (receivedmail) | `internuser_model.php:67` (`getAlumneByEmail`) | **High** | `xss_clean` ≠ SQL escaping |
| Unsalted sha256 password storage | `internuser_model.php:109,113`; auth in `adminuser_model.php:13` | **High** | shared `intern_alumne.password`; migrate w/ rehash-on-login |
| Weak reset flow | `admin.php:240,301-310` | **High** | `sha1(time())` link (predictable, no expiry), temp pw ~10k space + fixed suffix, shown plaintext |
| Reset link not one-time; password rewritten on every GET | `admin.php:291-312` | **High** | each visit to `/resetpass/{link}` re-randomises + re-displays the password; row never deleted from `intern_forgotpassword` |
| User enumeration | `admin.php:264` | **Medium** | distinct response for unknown email |
| No CSRF | login/editinfo/changepassword/receivedmail (POST); `resetpass` mutates on GET | **Medium** | `csrf_protection=false` site-wide (`01-infra` A4) |
| Insecure remember-me cookie | `internuser_model.php:55-61` | **Medium** | `session_token` not flagged secure/httponly; `cookie_secure=false`; token = sha256 of guessable-ish inputs |
| Two parallel session systems | `admin.php:6` + CI sessions | **Low** | native `session_start()` + CI session lib; confusing, easy to desync |

## Quirks, edge cases & suspected bugs
- **`resetpass` is not idempotent and not one-time:** visiting the emailed link *changes* the password
  every time and shows the new one; the `intern_forgotpassword` row is never invalidated. Anyone who
  obtains/guesses the `sha1(time())` link can repeatedly reset+read the password.
- `receivedmail` `echo`s "Denne mail er ikke registreret" for unknown emails **and then** calls
  `redirect()` — output-before-header may break the redirect (CI uses `header()`), and it leaks existence.
- Remember-me token is written only on **form** login, not cookie auto-login — minor inconsistency.
- Admin-ness is inferred purely from `isset($result[0]->ak)` (the join), so a member without a
  `gahk_admin_user` row gets no role flags — by design, but brittle.
- `sendMail()` here uses raw `mail()`, diverging from the SMTP path used elsewhere (F-001) — different
  deliverability/spoofing profile.

## Reimplementation notes (Django)
- Replace wholesale with Django's auth: `LoginView`/`LogoutView`, `PasswordChangeView`, and the built-in
  **password-reset** flow (signed, time-limited, single-use tokens — fixes the entire reset section) +
  CSRF + secure session cookies. Migrate legacy hashes via a custom hasher that recognises unsalted
  sha256 and **upgrades on next login** (scope §5). Collapse the two session mechanisms into Django sessions.
- **Model:** one user model over `intern_alumne` with the `gahk_admin_user` flags as groups/permissions
  (shared with F-002).
- **PRESERVE:** the `/nyintern/admin/*` URLs and the redirect-after-login behaviour.
- **FIX (confirm first):** make reset links single-use/expiring; stop displaying passwords; add CSRF;
  make `resetpass` non-mutating on GET.

## Open questions
- Is the `intern_alumne_sessions` remember-me token consumed by anything else, or safe to replace entirely
  with Django sessions?
- Are reset links intended to be one-time/expiring (the email says "within three days and two hours" but
  nothing enforces it)? Confirm before changing behaviour.
- Should both members and admins share one login (current behaviour), and is the `gahk_admin_user`-join =
  admin rule the intended authorization source of truth?
