"""Smoke test for the seed_demo dev fixture command: it should run, be idempotent, and produce
data that lights up the app's real queries (active period, roles, derived ølkælder balances)."""

import pytest
from django.core.management import call_command

from oelkaelder.models import Shopper
from residents.models import Resident, active_period
from residents.permissions import real_roles


@pytest.mark.django_db
def test_seed_demo_populates_and_is_idempotent() -> None:
    # --force because Django's test runner forces DEBUG=False, which the safety guard blocks.
    call_command("seed_demo", "--fresh", "--force", "--residents", "12", verbosity=0)
    first_count = Resident.objects.count()
    assert first_count == 12

    # Re-running with --fresh must not duplicate or raise (idempotent).
    # --force because Django's test runner forces DEBUG=False, which the safety guard blocks.
    call_command("seed_demo", "--fresh", "--force", "--residents", "12", verbosity=0)
    assert Resident.objects.count() == first_count

    # active_period follows the seeded current-month residencies.
    year, month = active_period()
    from django.utils import timezone

    today = timezone.localdate()
    assert (year, month) == (today.year, today.month)

    # Documented logins exist with the expected roles and password.
    formand = Resident.objects.get(email="formand@gahk.dk")
    assert "administrator" in real_roles(formand)
    assert formand.check_password("demo1234")

    # Derived ølkælder balance is computable (no crash, integer øre).
    shopper = Shopper.objects.first()
    assert isinstance(shopper.balance_ore, int)
