# Feature: Ølkælder — beer-cellar POS / shop (internal area)

- **Feature ID:** F-003
- **Source file(s):** `application/controllers/intern/oelkaelder.php`, `application/models/oelkaelder_model.php`,
  `application/models/internshop_model.php`, `application/helpers/oelkaelder_helper.php`,
  views `application/views/intern/{oelkaelderadmin, oelkaelderassortment, oelkaelderoverview, oelkaelderproducts,
  oelkaelderreport, oelkaeldersales, oelkaeldersalesquantity, oelkealderallsales, activeshoppers, shopperlist}.php`
  (+ `intern/statusreply.php` for `purchase`). Reads alumni via `Adminuser_model`.
- **URL / route:** wildcard `nyintern/(:any) → intern/$1` (see `01-infrastructure.md` route table). Controller class `Oelkaelder`, so:
  - `GET  /nyintern/oelkaelder/` — index (redirects to `nyintern/admin`)
  - `GET  /nyintern/oelkaelder/products` — JSON list of active products
  - `POST /nyintern/oelkaelder/purchase` — record a sale (**auth commented out — open endpoint**)
  - `GET  /nyintern/oelkaelder/activeShoppers` — JSON list of active shoppers
  - `GET  /nyintern/oelkaelder/transactions/{alumnumId}` — `var_dump` of a shopper's transactions (debug)
  - `GET/POST /nyintern/oelkaelder/overview[/{alumnumId}[/{startItem}]]` — a shopper's account overview
  - `GET  /nyintern/oelkaelder/allsales[/{startItem}[/{lowerAmount}]]` — all sales (admin)
  - `GET  /nyintern/oelkaelder/allsalesoverview[/{startItem}[/{lowerAmount}]]` — duplicate of `allsales`
  - `GET  /nyintern/oelkaelder/deactivate/{shopperId}` — deactivate a shopper (state change on GET)
  - `POST /nyintern/oelkaelder/activate` — reactivate a shopper
  - `GET  /nyintern/oelkaelder/deactivateProduct/{productId}` — deactivate product (state change on GET)
  - `GET  /nyintern/oelkaelder/activateProduct/{productId}` — activate product (state change on GET)
  - `POST /nyintern/oelkaelder/setWarningMail` — update a warning-mail config row
  - `POST /nyintern/oelkaelder/depositReport` — deposit report over a date range
  - `POST /nyintern/oelkaelder/saleReport` — sales (by money) report over a date range
  - `POST /nyintern/oelkaelder/saleReportQuantity` — sales (by quantity) report over a date range
  - `POST /nyintern/oelkaelder/addShopper` — register an alumnus as a shopper
  - `GET  /nyintern/oelkaelder/deleteDeposit/{depositId}` — void a deposit (money change on GET)
  - `GET  /nyintern/oelkaelder/deleteTransaction/{transactionId}/{alumnumId}` — void a sale, refund (money change on GET)
  - `GET/POST /nyintern/oelkaelder/admin` — admin dashboard; POST applies deposits
  - `POST /nyintern/oelkaelder/upload` — upload a product image
  - `GET/POST /nyintern/oelkaelder/assortment` — product list; POST updates prices / adds product
  - `GET  /nyintern/oelkaelder/shopperList` — JSON list of current-month alumni (for the till)
- **HTTP method(s):** GET + POST. ⚠ Several state-changing actions are reachable via **GET** (deactivate/activate product, deleteDeposit, deleteTransaction).
- **Access control:** Mixed, enforced inline per action — **no central guard**:
  - **JSON/till endpoints** (`products`, `activeShoppers`, `transactions`, `shopperList`): require a session `username` **OR** caller IP in the GAHK ranges (`insideGAHK()` from `gahk_helper.php:3`, see `01-infrastructure.md` A4). Login is *not* required from a GAHK IP.
  - **`purchase`**: ⚠ **NO access control at all** — the auth block is entirely commented out (`oelkaelder.php:43-49`). Open POST write endpoint. Also sets `Access-Control-Allow-Origin: *`.
  - **`overview`**: requires session `username` OR `oelkaelder` role; a non-`oelkaelder` user may only view their own `alumne_id`.
  - **Admin actions** (`allsales`, `allsalesoverview`, `deactivate`, `activate`, `deactivateProduct`, `activateProduct`, `setWarningMail`, `depositReport`, `saleReport`, `saleReportQuantity`, `addShopper`, `deleteDeposit`, `deleteTransaction`, `admin`, `assortment`): gated on the session `oelkaelder` role flag only (`01-infrastructure.md` A5). ⚠ Most check **only** `!$oelkaelder` and do **not** also require `username`.
  - **`upload`**: ⚠ **NO access control at all** — no auth check whatsoever (`oelkaelder.php:504-522`).

**Routes / actions:**
| Action | URL | Method | Access | Purpose |
|---|---|---|---|---|
| `index` | `/nyintern/oelkaelder/` | GET | any | redirect to `nyintern/admin` |
| `products` | `/nyintern/oelkaelder/products` | GET | login OR GAHK IP | JSON active products (till menu) |
| `purchase` | `/nyintern/oelkaelder/purchase` | POST | ⚠ **none (commented out)** | record a sale, debit saldi |
| `activeShoppers` | `/nyintern/oelkaelder/activeShoppers` | GET | login OR GAHK IP | JSON active shoppers + saldo |
| `transactions` | `/nyintern/oelkaelder/transactions/{alumnumId}` | GET | login OR GAHK IP | ⚠ `var_dump` debug dump |
| `overview` | `/nyintern/oelkaelder/overview[/{alumnumId}[/{startItem}]]` | GET/POST | login OR `oelkaelder`; own acct unless `oelkaelder` | account statement |
| `allsales` | `/nyintern/oelkaelder/allsales[/{start}[/{lower}]]` | GET | `oelkaelder` | global sales feed |
| `allsalesoverview` | `/nyintern/oelkaelder/allsalesoverview[/...]` | GET | `oelkaelder` | duplicate of `allsales` |
| `deactivate` | `/nyintern/oelkaelder/deactivate/{shopperId}` | GET | `oelkaelder` | set shopper inactive |
| `activate` | `/nyintern/oelkaelder/activate` | POST | `oelkaelder` | set shopper active |
| `deactivateProduct` | `/nyintern/oelkaelder/deactivateProduct/{productId}` | GET | `oelkaelder` | set product inactive |
| `activateProduct` | `/nyintern/oelkaelder/activateProduct/{productId}` | GET | `oelkaelder` | set product active |
| `setWarningMail` | `/nyintern/oelkaelder/setWarningMail` | POST | `oelkaelder` | edit warning-mail config |
| `depositReport` | `/nyintern/oelkaelder/depositReport` | POST | `oelkaelder` | deposits per shopper in period |
| `saleReport` | `/nyintern/oelkaelder/saleReport` | POST | `oelkaelder` | sales by money in period |
| `saleReportQuantity` | `/nyintern/oelkaelder/saleReportQuantity` | POST | `oelkaelder` | sales by quantity in period |
| `addShopper` | `/nyintern/oelkaelder/addShopper` | POST | `oelkaelder` | register alumnus as shopper |
| `deleteDeposit` | `/nyintern/oelkaelder/deleteDeposit/{depositId}` | GET | `oelkaelder` | void deposit, reverse saldo |
| `deleteTransaction` | `/nyintern/oelkaelder/deleteTransaction/{txId}/{alumnumId}` | GET | `oelkaelder` | void sale, refund saldi |
| `admin` | `/nyintern/oelkaelder/admin` | GET/POST | `oelkaelder` | dashboard; POST records deposits |
| `upload` | `/nyintern/oelkaelder/upload` | POST | ⚠ **none** | upload product image |
| `assortment` | `/nyintern/oelkaelder/assortment` | GET/POST | `oelkaelder` | product CRUD / pricing |
| `shopperList` | `/nyintern/oelkaelder/shopperList` | GET | login OR GAHK IP | JSON current-month alumni |

## Purpose
The Ølkælder is the dorm's beer-cellar shop run on an honor-system tab. A self-service till (typically the GAHK-LAN tablet) pulls the product menu and the list of registered shoppers as JSON, then POSTs a basket of items + one or more shoppers to `purchase`; each shopper's running balance (`saldo`, kept in øre, normally negative = debt) is debited their split share. Residents see their own statement under `overview`; the cellar managers (role `oelkaelder`) register/deactivate shoppers, record cash deposits, void mistaken sales/deposits, manage the product assortment and prices, configure low-balance warning emails, and pull sales/deposit reports.

## Inputs
| Name | Source | Type | Required? | Validated/sanitized? | Used for |
|---|---|---|---|---|---|
| session `username` | CI session | string | for most actions | n/a | auth (login check) |
| session `oelkaelder` | CI session | bool/flag | for admin actions | n/a | role gate |
| session `alumne_id` | CI session | int | overview default | n/a | which account to view |
| caller IP (`$_SERVER['REMOTE_ADDR']`) | server | string | alt to login on JSON endpoints | exact match vs hardcoded list | `insideGAHK()` gate |
| raw request body (`php://input`) | POST body | JSON | yes (`purchase`) | `json_decode(..., JSON_THROW_ON_ERROR)`; **no schema/auth validation** | the transaction object |
| `transaction.shoppers[]` | JSON | array of alumnumIds | yes | existence checked via `shopperExists` | who is billed |
| `transaction.items[]` | JSON | array `{productId, current_price, weight_price, quantity}` | yes | `itemExists(productId)` only | basket; price math |
| `transaction.date` | JSON | string datetime | yes | **none** — raw into SQL INSERT | transaction timestamp |
| `{alumnumId}` | URL segment | int | varies | **none** — raw into SQL | look up shopperId |
| `{startItem}` | URL segment | int | no (default 0) | **none** — raw into `LIMIT/OFFSET` | pagination |
| `{lowerAmount}` | URL segment | number | no (default 0) | **none** — `*100` raw into SQL | min-amount filter (kr→øre) |
| `{shopperId}` | URL segment | int | yes (deactivate) | **none** — raw into SQL UPDATE | shopper to deactivate |
| `{productId}` | URL segment | int | yes | **none** — raw into SQL UPDATE | product to (de)activate |
| `{depositId}` | URL segment | int | yes | **none** — raw into SQL | deposit to void |
| `{transactionId}` | URL segment | int | yes | **none** — raw into SQL | transaction to void |
| `$_POST['shopperId']` | POST | int | activate | **none** — raw into SQL | shopper to reactivate |
| `$_POST['updateSaldo']` | POST | flag | admin | presence check | trigger deposit loop |
| `$_POST['deposit<shopperId>']` | POST (dynamic keys) | money string | admin | `priceStrToOrens()`; skipped if `""` | deposit amount per shopper |
| `$_POST['warningNumber']` | POST | int | setWarningMail | presence check | which warning row (1/2) |
| `$_POST['message']` | POST | text | setWarningMail | **none** — raw into SQL | warning email body |
| `$_POST['amount']` | POST | money | setWarningMail | `*100` (kr→øre); **not numeric-checked** | warning threshold (øre) |
| `$_POST['active']` | POST | `"on"`/other | setWarningMail | `== "on" ? 1 : 0` | warning enabled |
| `$_POST['startdate']`, `$_POST['enddate']` | POST | date strings | reports | **none** — raw into SQL (`'$x 00:00:00'`) | report period |
| `$_POST['overviewMonth']` | POST | `"month:year"` (0-based month) | no (default = prev month) | `explode(":")` only | overview month filter |
| `$_POST['alumnumId']` | POST | int | addShopper | presence check; **raw into SQL** | new shopper's alumnus |
| `$_POST['updatePrice']` | POST | flag | assortment | presence check | trigger price-update loop |
| `$_POST['productId<n>']` | POST (dynamic) | int | assortment | **none** — raw into SQL | which product to reprice |
| `$_POST['price<id>']` | POST (dynamic) | int (øre) | assortment | indirectly via `validPrice` | new unit price |
| `$_POST['weight_price<id>']` | POST (dynamic) | int (øre/0.1kg) | assortment | indirectly via `validPrice` | new weight price |
| `$_POST['price_steps<id>']` | POST (dynamic) | `"a;b;c;d"` | assortment | `validPrice` format check; quoted into SQL | tiered price config |
| `$_POST['addProduct']` | POST | flag | assortment | presence check | trigger add-product |
| `$_POST['productName']` | POST | string | addProduct | non-empty; **not** sanitized; raw into SQL | product name |
| `$_POST['productPrice']` | POST | int (øre) | addProduct | non-empty **and** `is_numeric` | product price |
| `$_POST['productImage']` | POST | string (url/filename) | addProduct | non-empty; raw into SQL | product image url |
| `userfile` | uploaded file | jpg/png | upload | CI `upload` lib: types jpg\|png, max 100KB, 400×400 | saved to disk |

## Database interactions
- **Tables touched:** `intern_oelkaelder_product`, `intern_oelkaelder_saldo`, `intern_oelkaelder_deposit`, `intern_oelkaelder_transaction`, `intern_oelkaelder_transaction_item`, `intern_oelkaelder_purchase`, `intern_oelkaelder_log`, `intern_oelkaelder_warnings`, `intern_shopper`, `intern_alumne`, `intern_alumne_liste` (read, via `Internshop_model`). **All MyISAM** — no transactions. *(Correction: `oelkaelder` does **not** call `$this->counter()`, so it writes no `gahk_counter`/`gahk_counterdato` — see `99-index.md` §2.)*

- **Reads:**
  - `intern_oelkaelder_product` — active products (`getActiveProducts`), all products (`getProducts`), single product (`getProduct`), existence (`itemExists`). Columns: `productId, name, current_price, weight_price, price_steps, imageurl, active, highlighted`.
  - `intern_oelkaelder_saldo` — shopper balance/active (`getShopperInfo`), shopper list join (`getShopperList`). Columns: `shopperId, saldo, active`.
  - `intern_oelkaelder_deposit` — single (`getDeposit`), validity (`depositValid`), per-shopper valid (`getDeposits`), period (`getDepositsInPeriod`, `getDepositReport`). Columns: `ID, shopperId, amount, time, valid`.
  - `intern_oelkaelder_transaction` — validity (`transactionValid`), joins. Columns: `ID, time, valid`.
  - `intern_oelkaelder_transaction_item` — items + price sum (`getTransactionItems`, `getPrice`), reports. Columns: `transactionId, productId, quantity, price`.
  - `intern_oelkaelder_purchase` — which shoppers on a transaction (`getShoppers`), feeds (`getTransactions`, `getTransactionOverview`). Columns: `shopperId, transactionId`.
  - `intern_oelkaelder_warnings` — warning config (`getWarning`). Columns: `id, message, amount, active`.
  - `intern_shopper` — alumnus↔shopper mapping (`getShopperId`, `getAlumnumId`, `shopperExists`). Columns: `shopperId, alumnumId`.
  - `intern_alumne` — names/email (`getAlumnumName`, `getAlumnumMail`, `getNonshopperAlumni`, joins). `getAlumneOnId` via `Adminuser_model`.
  - `intern_alumne` + `intern_alumne_liste` — current-month alumni for the till (`Internshop_model::getShopperList`, latest `monthNumber`).

- **Writes:**
  - **INSERT `intern_oelkaelder_log`** (`appendLog`) — on every mutating action: Purchase, Deactivate, Activate, Deactivate/Activate product, Deposit, Add shopper, Delete deposit/transaction, Price/weight/steps update, Product added. Stores `time` + free-text `log` (includes `$username` and, for purchase, the **entire raw request JSON**).
  - **INSERT `intern_oelkaelder_transaction`** (`createTransaction`) — one row per sale; `time` = client-supplied `$transaction->date` (raw). ⚠ Table name hardcoded with DB prefix `gahk_dk.intern_oelkaelder_transaction`.
  - **INSERT `intern_oelkaelder_transaction_item`** (`addItem`, via CI `db->insert` — **escaped**) — one row per basket item; `{transactionId, productId, quantity, price}` where `price` is computed (see logic).
  - **INSERT `intern_oelkaelder_purchase`** (`addShopper`, via `db->insert` — escaped) — one row per (shopper × transaction).
  - **UPDATE `intern_oelkaelder_saldo` SET saldo = saldo + amount WHERE shopperId** (`changeSaldo`) — fired on purchase (debit share), deposit (credit), deleteDeposit (reverse), deleteTransaction (refund share). Read-modify-write, **not atomic**.
  - **INSERT `intern_oelkaelder_deposit`** (`addDeposit`) — records a cash deposit `{shopperId, amount, time}` then calls `changeSaldo(+amount)`.
  - **UPDATE `intern_oelkaelder_deposit` SET valid=0 WHERE ID** (`invalidateDeposit`) — soft-delete on `deleteDeposit`, then `changeSaldo(-amount)`.
  - **UPDATE `intern_oelkaelder_transaction` SET valid=0 WHERE ID** (`invalidateTransaction`) — soft-delete on `deleteTransaction`, after refunding each shopper their share.
  - **INSERT `intern_shopper` (shopperId NULL, alumnumId)** then **INSERT `intern_oelkaelder_saldo` (shopperId=insert_id, saldo=0, active=1)** (`addNewShopper`) — register a shopper. ⚠ No dup check; an alumnus can be registered twice.
  - **UPDATE `intern_oelkaelder_saldo` SET active=0/1 WHERE shopperId** (`updateShopperStatus`) — (de)activate shopper.
  - **UPDATE `intern_oelkaelder_product` SET active=0/1 WHERE productId** (`updateProductStatus`).
  - **INSERT `intern_oelkaelder_product` (name, current_price, imageurl, active=1, highlighted=0)** (`addProduct`). `weight_price`/`price_steps` left at default. ⚠ `current_price` stored **verbatim from `$_POST['productPrice']`** — no `*100`, so unit differs from the editing path (which writes øre). See Quirks.
  - **UPDATE `intern_oelkaelder_product` SET current_price=$price WHERE productId** (`updateProductPrice`).
  - **UPDATE `intern_oelkaelder_product` SET weight_price=$weight_price WHERE productId** (`updateWeightPrice`).
  - **UPDATE `intern_oelkaelder_product` SET price_steps="$price_steps" WHERE productId** (`updatePriceSteps`).
  - **UPDATE `intern_oelkaelder_warnings` SET message, amount, active WHERE id** (`updateWarning`).
  - *(No `gahk_counter`/`gahk_counterdato` write — this controller does not call `counter()`; correction per `99-index.md` §2.)*

- **Transactions / ordering:** ⚠ **Critical.** A purchase is a multi-row write: INSERT transaction → N× INSERT items → M× INSERT purchase rows → recompute price from the just-inserted items → M× `changeSaldo` (each a read-then-write of `saldo`). None of this is wrapped in a DB transaction and **the tables are MyISAM (no transaction support)**. A failure or concurrent request mid-sequence leaves a partial/inconsistent state (e.g. items inserted but a shopper undebited, or lost-update on concurrent saldo writes for the same shopper). `deleteTransaction` (refund all shoppers, then invalidate) and `deleteDeposit` (invalidate, then reverse saldo) have the same non-atomic money-then-flag ordering. `addDeposit` likewise (insert deposit, then change saldo).

## Business logic
- **`purchase($transaction)`** (the money path):
  ```
  if shoppers empty            -> return "No shoppers specified"
  for each shopper(alumnumId):
      shopperId = getShopperId(alumnumId)
      if not shopperExists      -> return "Unkown shopper"   (sic)
  if items empty               -> return "No items"
  for each item:
      if not itemExists(productId) -> return "Unknown items"
  txId = createTransaction(transaction.date)     # INSERT
  for each item: addItem(txId, item)             # INSERT item, price computed:
        if item.current_price == 0:
            if item.weight_price != 0: price = round(weight_price * quantity); quantity = 1   # weighed goods
            else:                      price = round(quantity * 100); quantity = 1             # "Andet"/free-amount: quantity entered is kroner
        else:                          price = round(current_price * 100) * quantity           # normal: kr→øre
  for each shopper: addShopper(txId, shopperId)  # INSERT purchase row
  price = getPrice(txId)                          # SUM(items.price) re-read from DB
  priceShare = -1 * (price / shopperCount)        # negative = debit; split equally
  for each shopper: changeSaldo(shopperId, priceShare)   # UPDATE saldo
  return "OK"
  ```
  Note the client sends prices in **kroner** (`current_price`, `weight_price`); the server multiplies by 100 to store øre. The split is an even division by shopper count and is **not** rounded to whole øre (`price / shopperCount` is a float; stored into an int column → MySQL rounds/truncates on write). Validation only checks *existence*, never that client-supplied prices match the DB product price — **the client dictates the price** (see findings).
- **`changeSaldo($shopperId, $amount)`**: read current saldo → `newSaldo = saldo + amount` → fire `sendWarning(1,...)` and `sendWarning(2,...)` → UPDATE saldo. Warning fires only when `warning.active && oldSaldo > threshold && newSaldo < threshold` (a downward threshold crossing), emailing the alumnus with `SALDOSALDOSALDO` replaced by `newSaldo/100` kroner.
- **`addDeposit`**: insert deposit row (positive amount) + `changeSaldo(+amount)` (credit). Deposit amounts entered as kroner in the admin form, converted via `priceStrToOrens` (×100).
- **`deleteDeposit($depositId)`**: if deposit `valid==1` → set `valid=0` and `changeSaldo(-amount)` (reverse the credit); returns shopperId so the controller can redirect. Idempotent guard via `valid` flag.
- **`deleteTransaction($transactionId)`**: if not `valid` → return (idempotent). Else fetch transaction, `refundShare = price / shopperCount`, `changeSaldo(+refundShare)` for **each** shopper, then `invalidateTransaction`. ⚠ Refund is **positive** for everyone — symmetrical to purchase's negative debit.
- **`admin` POST**: if `updateSaldo` set, loop `$_POST`; any key starting `deposit` with non-empty value → parse trailing shopperId, convert kr→øre, `addDeposit`. Builds a human-readable `depositStr` receipt string for the page.
- **`assortment` POST**: if `updatePrice`, loop keys starting `productId`; for each, read old product, `validPrice()` the new price/weight/steps; if it fails, set `$error` and `break`; else conditionally UPDATE each of price/weight/steps **only when changed**. If `addProduct`, validate name/price/image non-empty and price numeric, then `addProduct`.
- **`validPrice($price,$weight_price,$price_steps,$name)`**: `price_steps` (if non-empty) must be exactly 4 numeric `;`-separated values. Returns `""` (valid) only when exactly one pricing mode is set: `(price!=0, weight=0, steps="")` OR `(price==0, weight!=0, steps!="")` OR `(price==0, weight==0, steps!="")`; otherwise an error string. ⚠ The middle clause requires steps non-empty for a weight-priced product, which looks unintended (see Quirks).
- **`overview`**: defaults to viewing `session.alumne_id`; non-`oelkaelder` users redirected to `nyintern` if they request another id. If the alumnus has no shopper row, shows empty. Month filter (`overviewMonth`) default = previous month (`date("n")-1`). `getShoppingOverview` does per-product spend split by purchase count using a MySQL session var `@count`.
- **`shopperList`** (`Internshop_model`): only alumni in the **latest** `intern_alumne_liste.monthNumber` (current residents), for the till's shopper picker.

## Outputs & side effects
- **JSON (to till / any caller):** `products`, `activeShoppers`, `shopperList` render JSON views with `Access-Control-Allow-Origin: *`. `purchase` returns `statusreply` JSON `{status: "OK"|error}` with ACAO:* **and** `Access-Control-Allow-Headers`.
- **HTML (intern pages, via `showInternPage`):** `overview`, `allsales`/`allsalesoverview`, `admin`, `assortment`. Report views (`oelkaelderreport`, `oelkaeldersales`, `oelkaeldersalesquantity`) are rendered directly via `load->view` (no intern chrome).
- **Debug output:** ⚠ `transactions()` does `var_dump($transactions)` — raw object dump to the browser. `upload()` `var_dump`s the upload error string on failure.
- **Redirects:** index → `nyintern/admin`; unauthorized → `nyintern/admin` (JSON paths, with `redirectToUrlAfterLogin` flashdata) or `nyintern/oelkaelder/overview` / `nyintern` (role paths). Most admin mutations redirect back to `admin`/`assortment`/`overview/{id}`/`allsales`.
- **Emails:** low-balance warning mail sent via PHP `mail()` from `bierkeller@gahk.dk` (`sendWarning`), only on downward threshold crossing, for warnings 1 and 2.
- **Files written:** `upload` saves a jpg/png to `./public/image/intern/oel/` via CI `upload` library. `assortment` lists files there via `directory_map`.
- **Headers:** ⚠ `Access-Control-Allow-Origin: *` on `products`, `purchase`, `activeShoppers`, `shopperList`.
- **Session:** sets `redirectToUrlAfterLogin` flashdata on unauthenticated JSON access. Constructor calls `session_start()` then `parent::__construct()` (MY_Controller — visit counter, etc., `01-infrastructure.md` A9).

## Dependencies
- **Cross-cutting infra used:** `MY_Controller` base (note: does **not** call `counter()`, so no visit-counter write); CI DB sessions / `username`+`oelkaelder` role userdata (A4/A5); raw interpolated SQL pattern (A3); `gahk_helper::insideGAHK()` IP gate (A4).
- **Models:** `Oelkaelder_model` (all POS logic), `Internshop_model` (current-month shopper list), `Adminuser_model` (`getAlumneOnId` for other-person overview).
- **Helpers:** `oelkaelder_helper` (`priceStrToOrens`/`orensToPriceStr`), `form`, `directory` (loaded inside `getProductPhotos`).
- **Libraries:** `session`, `upload` (loaded per-request in `upload()`).
- **External services:** PHP `mail()` (warning emails); filesystem (`./public/image/intern/oel/`).

## Security findings
| Issue | Location (file:line) | Severity | Note |
|---|---|---|---|
| Open unauthenticated write endpoint | `oelkaelder.php:40-62` (`purchase`, auth commented out) | **Critical** | anyone on the internet can record sales and debit any shopper's saldo |
| Open unauthenticated file upload | `oelkaelder.php:504-522` (`upload`) | **High** | no auth; only type/size checks; writes into web-served dir |
| Client-controlled pricing | `oelkaelder_model.php:135-156, 462-505` | **High** | server never compares item price to DB product price; basket prices come from the client (`current_price`/`weight_price`/`quantity`) |
| `Access-Control-Allow-Origin: *` on writes | `oelkaelder.php:33,57,76,609` | **High** | combined with open `purchase`, enables cross-origin abuse |
| SQL injection (raw interpolation) | throughout `oelkaelder_model.php` (e.g. `:20,24,38,43,55,108,114,189,194,236`) | **High** | URL segments, `$_POST` (message, alumnumId, startdate, name, price_steps) and client JSON (`transaction.date`) concatenated into SQL (`01-infra` A3) |
| State change via GET | `oelkaelder.php:219,254,269,399,416` | **High** | deactivate/activate product, deleteDeposit, deleteTransaction mutate money/state on GET — CSRF + prefetch/crawler risk |
| No CSRF protection | all POST actions | **Medium** | `csrf_protection=false` site-wide (`01-infra` A4) |
| Debug data disclosure | `oelkaelder.php:94` (`var_dump` transactions), `:516` (upload errors) | **Medium** | leaks internal object structure to browser |
| Email body injection | `oelkaelder_model.php:69-70,250-262` | **Medium** | `$_POST['message']` stored raw and emailed; `mail()` headers fixed but body user-controlled |
| Missing auth on admin role paths | most admin actions check only `!$oelkaelder` | **Low** | relies solely on session role flag; no `username` co-check |
| Stored data in JSON/HTML unescaped | `activeshoppers.php`, `oelkaelderproducts.php`, etc. | **Medium** | product `name`/`imageurl` and alumnus names emitted into JSON without escaping (breaks JSON / XSS if names contain quotes) |
| Hardcoded internal IP allowlist | `gahk_helper.php:4` | **Low** | spoofable `REMOTE_ADDR` if behind proxy; brittle (`01-infra` A4) |
| Mass-ish dynamic POST key handling | `oelkaelder.php:450,537` | **Low** | iterates arbitrary `$_POST` keys (`deposit*`, `productId*`) — unexpected keys can drive writes |

## Quirks, edge cases & suspected bugs
- ⚠ **`addProduct` price unit mismatch.** New products store `current_price` = `$_POST['productPrice']` **verbatim** (`addProduct`, model:24), while the assortment edit path and the purchase math treat `current_price` as **øre**. So a product added via the form is priced inconsistently with edited products (likely meant to be øre, or the form sends øre — unconfirmed). `weight_price`/`price_steps` are not set on add.
- ⚠ **`allsalesoverview` is a verbatim duplicate** of `allsales` (same body, same view). Dead/redundant route.
- ⚠ **`allsales`/`allsalesoverview` reference `$overview`** (`oelkaelder.php:180,211`) which is never assigned — passes `null` to the view (PHP notice).
- ⚠ **`overview` warning-mail amount comparison** uses kroner-vs-øre consistently in `sendWarning` (both in øre), but the threshold from `setWarningMail` is `$_POST['amount']*100` while `$_POST['amount']` isn't numeric-validated — non-numeric → 0.
- ⚠ **No duplicate-shopper guard** in `addNewShopper`; registering the same alumnus twice creates two shopper rows / saldi.
- ⚠ **`validPrice` weight clause** requires `price_steps != ""` for a weight-priced product (`oelkaelder.php:496`), which contradicts the intent that weight pricing and step pricing are separate modes. Appears to be a logic bug; combined with the third clause (`price==0,weight==0,steps!=""`) the weighed-only configuration is rejected.
- **`transactions()` debug `var_dump`** is clearly leftover debug code, not a real endpoint.
- **Money split not rounded to øre**: `price/shopperCount` float written to an `int` saldo — fractional øre silently lost; refund uses the same formula so a split purchase then voided may not perfectly net to zero across shoppers.
- **`createTransaction` hardcodes the schema name** `gahk_dk.intern_oelkaelder_transaction` (model:131) — breaks if the DB is renamed.
- **`getShopperId` / `getAlumnumId` assume `result()[0]` exists** — an unknown id throws (undefined index), e.g. `overview` calls `getShopperId` and only afterwards checks for `""`.
- **`getShopperList($active)`** in `Oelkaelder_model` shadows `Internshop_model::getShopperList()` (no-arg) — different queries, similar names; `shopperList()` action uses the Internshop one.
- **Typo** `"Unkown shopper"` in the purchase status reply.
- Product names in seed data contain Danish chars (`Grøn`, `Guld øl`) — `intern_oelkaelder_product` is `utf8mb3_danish_ci` but `name`/`imageurl` columns are forced `latin1` — mojibake risk in ETL (`01-infra` A2).

## Reimplementation notes (Django)
- **Views:** JSON endpoints (`products`, `activeShoppers`, `shopperList`) → DRF/`JsonResponse` API views behind real auth (token or session) — drop ACAO:* or scope it. `purchase` → an authenticated POST API view in a DB **transaction**, with **server-side price lookup** (never trust client prices). Admin pages → `oelkaelder`-group-gated `FormView`/`ListView`; reports → filtered list views. `upload` → an authenticated `FormView` with `ImageField` validation.
- **Models:** `Product`, `Shopper`, `Saldo` (or merge into Shopper), `Deposit`, `Transaction`, `TransactionItem`, `Purchase` (M2M shopper↔transaction), `Warning`, `Log`. Use `select_for_update` + `F()` expressions for saldo math; store money as integer øre consistently.
- **FIX (record + confirm first):** re-enable auth on `purchase`; move all state-changing GETs to POST+CSRF; compute prices server-side; unify the product price unit; wrap purchase/void/deposit in atomic transactions; remove `var_dump`s.
- **PRESERVE:** the øre money model, the equal-split billing, the soft-delete (`valid`) semantics for void/refund, the downward-threshold warning-mail behavior, and the till JSON shapes (field names) for the existing tablet client. Keep `/nyintern/oelkaelder/*` URLs if the tablet hardcodes them.

## Open questions
- Is `purchase` deliberately open (the till is a kiosk on the GAHK LAN and login was a nuisance), or is the commented-out auth an accidental/temporary state? The other JSON endpoints still use `insideGAHK()`, suggesting an IP gate was intended.
- What unit does the *add-product* form actually submit for `productPrice` — kroner or øre? Determines whether `addProduct` is a real bug.
- Is `allsalesoverview` reachable/used, or fully dead? Both routes render the same view.
- Intended `validPrice` rules for weight-only products — is the `price_steps != ""` requirement on the weight clause a bug?
- Should fractional-øre loss in equal splits be addressed (largest-remainder allocation), or is current truncation acceptable to "diff against old site"?
- Are warning emails (PHP `mail()` from `bierkeller@gahk.dk`) still desired, and what are the two threshold rows' real values?
- Who legitimately calls the JSON endpoints from outside login (the till's IP/device) — needed to design the replacement auth.
