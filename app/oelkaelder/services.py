"""Ølkælder money operations (F-003).

The purchase path is the security-critical one. Fixes vs legacy:
  * **server-side pricing** — line prices come from Product.price_ore, never the client;
  * **atomic** — the whole transaction (txn + items + shares) is one DB transaction;
  * **exact split** — largest-remainder so the per-shopper shares sum to the item total (in øre).
Balances are derived (see Shopper.balance_ore), so there is no mutable saldo to corrupt.
"""

from django.db import transaction
from django.utils import timezone

from .models import LogEntry, Product, PurchaseShare, Shopper, Transaction, TransactionItem


def largest_remainder(total: int, n: int) -> list[int]:
    base, rem = divmod(total, n)
    return [base + 1 if i < rem else base for i in range(n)]


@transaction.atomic
def record_purchase(shopper_ids: list[int], quantities: dict[int, int]) -> Transaction:
    """quantities: {product_id: qty}. Returns the created Transaction. Raises ValueError on bad input."""
    shoppers = list(Shopper.objects.filter(id__in=shopper_ids, active=True))
    if not shoppers:
        raise ValueError("Vælg mindst én aktiv shopper.")

    txn = Transaction.objects.create(created_at=timezone.now())
    total = 0
    for pid, qty in quantities.items():
        qty = int(qty)
        if qty <= 0:
            continue
        product = Product.objects.get(id=pid, active=True)  # price from DB, not the client
        line = product.price_ore * qty
        TransactionItem.objects.create(transaction=txn, product=product, quantity=qty, price_ore=line)
        total += line

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
