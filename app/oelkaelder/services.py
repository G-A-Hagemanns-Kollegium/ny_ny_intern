"""Ølkælder money operations (F-003).

The purchase path is the security-critical one. Fixes vs legacy:
  * **server-side pricing** — line prices are recomputed from the Product, never trusted from the client
    (for betalingshop the chosen step must be one of the product's own price_steps);
  * **atomic** — the whole transaction (txn + items + shares) is one DB transaction;
  * **exact split** — largest-remainder so the per-shopper shares sum to the item total (in øre).
Balances are derived (see Shopper.balance_ore), so there is no mutable saldo to corrupt.
"""

from typing import Any

from django.db import transaction
from django.utils import timezone

from .models import LogEntry, Product, PurchaseShare, Shopper, Transaction, TransactionItem


def largest_remainder(total: int, n: int) -> list[int]:
    base, rem = divmod(total, n)
    return [base + 1 if i < rem else base for i in range(n)]


def _line_ore(product: Product, line: dict[str, Any]) -> tuple[int, int]:
    """Return (quantity_stored, price_ore) for one basket line, priced authoritatively from the product.

    Mirrors the legacy Oelkaelder_model::addItem. `mode`:
      * fixed  → price_ore x qty
      * step   → the tapped step (must be one of the product's price_steps) x qty
      * weight → weight_price_ore x grams / 100 (per-100g rate; no weight products in current data)
    Returns (0, 0) for a non-positive line so the caller skips it.
    """
    mode = line.get("mode", "fixed")
    if mode == "weight":
        grams = int(line.get("grams", 0))
        if grams <= 0:
            return 0, 0
        if not product.weight_price_ore:
            raise ValueError(f"{product.name} sælges ikke efter vægt.")
        return grams, round(product.weight_price_ore * grams / 100)
    if mode == "step":
        step_ore = int(line.get("step_ore", 0))
        if step_ore not in product.price_steps_ore():
            raise ValueError(f"Ugyldig pris for {product.name}.")
        qty = int(line.get("qty", 1))
        return (qty, step_ore * qty) if qty > 0 else (0, 0)
    qty = int(line.get("qty", 0))  # fixed
    return (qty, product.price_ore * qty) if qty > 0 else (0, 0)


@transaction.atomic
def record_purchase(shopper_ids: list[int], lines: list[dict[str, Any]]) -> Transaction:
    """lines: [{"product": id, "mode": "fixed|step|weight", "qty"/"grams"/"step_ore": ...}].
    Returns the created Transaction. Raises ValueError on bad input."""
    shoppers = list(Shopper.objects.filter(id__in=shopper_ids, active=True))
    if not shoppers:
        raise ValueError("Vælg mindst én aktiv shopper.")

    txn = Transaction.objects.create(created_at=timezone.now())
    total = 0
    for line in lines:
        product = Product.objects.get(id=int(line["product"]), active=True)  # priced from DB, not client
        quantity, price = _line_ore(product, line)
        if price <= 0:
            continue
        TransactionItem.objects.create(transaction=txn, product=product, quantity=quantity, price_ore=price)
        total += price

    if total <= 0:
        raise ValueError("Tom kurv.")  # rolls back the transaction

    for shopper, share in zip(
        sorted(shoppers, key=lambda s: s.id), largest_remainder(total, len(shoppers)), strict=False
    ):
        PurchaseShare.objects.create(transaction=txn, shopper=shopper, share_ore=share)

    LogEntry.objects.create(message=f"Køb txn#{txn.id}: {total} øre delt på {len(shoppers)} shopper(e).")
    return txn


@transaction.atomic
def record_deposit(shopper: Shopper, amount_ore: int) -> None:
    from .models import Deposit

    if amount_ore <= 0:
        raise ValueError("Beløb skal være positivt.")
    Deposit.objects.create(shopper=shopper, amount_ore=amount_ore, created_at=timezone.now())
    LogEntry.objects.create(message=f"Indbetaling {amount_ore} øre til shopper#{shopper.id}.")
