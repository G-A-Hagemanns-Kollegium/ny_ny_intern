"""Ølkælder — beer-cellar POS (F-003).

Fixes baked in: all money is **integer øre** (never float); a shopper's **balance is derived from the
ledger** (deposits - purchase shares of valid transactions), eliminating the non-atomic read-modify-write
`saldo` bug; line prices come from the product (server-side pricing, never the client); a purchase's
split is stored per shopper with **largest-remainder** rounding so shares sum exactly to the price; the
purchase write (transaction + items + shares) is wrapped in `transaction.atomic` at the view layer.
"""

from django.db import models
from django.db.models import Sum
from django.utils import timezone


class Product(models.Model):  # intern_oelkaelder_product
    name = models.CharField(max_length=255)
    price_ore = models.PositiveIntegerField()  # legacy current_price (normalized to øre)
    weight_price_ore = models.PositiveIntegerField(null=True, blank=True)
    price_steps = models.JSONField(
        null=True, blank=True
    )  # legacy price_steps text (no weight-only product today)
    image = models.FileField(upload_to="oel/", max_length=500, blank=True)  # legacy imageurl (can be long)
    active = models.BooleanField(default=True)
    highlighted = models.BooleanField(default=False)

    def __str__(self) -> str:
        return self.name


class Shopper(models.Model):  # intern_shopper (+ intern_oelkaelder_saldo.active)
    resident = models.ForeignKey(
        "residents.Resident", on_delete=models.CASCADE, related_name="shopper_accounts"
    )
    active = models.BooleanField(default=True)

    def __str__(self) -> str:
        return self.resident.full_name

    @property
    def balance_ore(self) -> int:
        """Derived balance = valid deposits - this shopper's share of valid transactions."""
        deposits = self.deposits.filter(is_valid=True).aggregate(s=Sum("amount_ore"))["s"] or 0
        spent = (
            self.purchase_shares.filter(transaction__is_valid=True).aggregate(s=Sum("share_ore"))["s"] or 0
        )
        return deposits - spent


class Deposit(models.Model):  # intern_oelkaelder_deposit
    shopper = models.ForeignKey(Shopper, on_delete=models.CASCADE, related_name="deposits")
    amount_ore = models.PositiveIntegerField()
    created_at = models.DateTimeField(default=timezone.now)
    is_valid = models.BooleanField(default=True)  # soft-delete (legacy `valid`)


class Transaction(models.Model):  # intern_oelkaelder_transaction
    created_at = models.DateTimeField(default=timezone.now)
    is_valid = models.BooleanField(default=True)

    class Meta:
        ordering = ["-created_at"]


class TransactionItem(models.Model):  # intern_oelkaelder_transaction_item
    transaction = models.ForeignKey(Transaction, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="+")
    quantity = models.PositiveIntegerField(default=1)
    price_ore = models.PositiveIntegerField()  # server-computed line total (quantity × product price)


class PurchaseShare(models.Model):  # intern_oelkaelder_purchase (+ the per-shopper split amount, NEW)
    transaction = models.ForeignKey(Transaction, on_delete=models.CASCADE, related_name="shares")
    shopper = models.ForeignKey(Shopper, on_delete=models.PROTECT, related_name="purchase_shares")
    share_ore = models.PositiveIntegerField()  # largest-remainder split; shares sum to the transaction total

    class Meta:
        constraints = [models.UniqueConstraint(fields=["transaction", "shopper"], name="uniq_txn_shopper")]


class Warning(models.Model):  # intern_oelkaelder_warnings (debt-threshold warning emails)
    message = models.TextField(blank=True)
    threshold_ore = models.IntegerField()  # legacy amount; e.g. 10000 (=100 kr), 20000 (=200 kr)
    active = models.BooleanField(default=True)


class LogEntry(models.Model):  # intern_oelkaelder_log (audit trail)
    created_at = models.DateTimeField(default=timezone.now)
    message = models.TextField()

    class Meta:
        ordering = ["-created_at"]
