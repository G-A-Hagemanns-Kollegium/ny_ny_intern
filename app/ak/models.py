"""AK — Aktivitetskrydser (F-009).

Each month every resident is assessed −2 krydser (the cost of the 2 hours of dorm labour they owe);
doing labour adds krydser back. The running balance may go negative (= behind/in debt); the goal is to
stay ≥ 0. The AK embedsgruppe (role `ak`) tracks and adjusts crosses, for themselves and others.

Modelled as an **append-only ledger** (one row per change) instead of the legacy running-total column +
buggy bulk ops (`monthNumber='24178'`, `-1*` insert). The balance is the SUM of entries — always
consistent, and the monthly assessment / labour / adjustments are just entries.
"""
from django.db import models
from django.db.models import Sum
from django.utils import timezone


class AkEntry(models.Model):
    class Kind(models.TextChoices):
        MONTHLY = "monthly", "Månedlig vurdering (−2)"
        LABOUR = "labour", "Udført arbejde"
        ADJUSTMENT = "adjustment", "Manuel justering"
        OPENING = "opening", "Startsaldo (migreret)"

    resident = models.ForeignKey(
        "residents.Resident", on_delete=models.CASCADE, related_name="ak_entries"
    )
    delta = models.IntegerField()  # krydser; negative allowed (debt), positive = credit
    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.ADJUSTMENT)
    reason = models.CharField(max_length=255, blank=True)  # legacy `comment`
    created_at = models.DateTimeField(default=timezone.now)
    # the officer who made the change; null for system/monthly/migrated entries
    created_by = models.ForeignKey(
        "residents.Resident", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="ak_entries_created",
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["resident", "created_at"])]

    def __str__(self):
        return f"{self.resident.full_name}: {self.delta:+d} ({self.get_kind_display()})"

    @staticmethod
    def balance_for(resident):
        return AkEntry.objects.filter(resident=resident).aggregate(b=Sum("delta"))["b"] or 0
