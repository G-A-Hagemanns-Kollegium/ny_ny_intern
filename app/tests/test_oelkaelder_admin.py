"""ØK (role `oelkaelder`) manages the kiosk assortment/prices and corrects deposits (F-003)."""

from collections.abc import Callable

import pytest
from django.test import Client
from django.urls import reverse

from oelkaelder.models import Deposit, Product, Shopper


@pytest.mark.django_db
def test_product_create_and_price_update(make_resident: Callable) -> None:
    oek = make_resident(email="oek@gahk.dk", roles=("oelkaelder",))
    c = Client()
    c.force_login(oek)

    c.post(reverse("oelkaelder:product_create"), {"name": "Fadøl", "price_kr": "10,50", "active": "on"})
    p = Product.objects.get(name="Fadøl")
    assert p.price_ore == 1050  # kr -> øre, comma decimals accepted
    assert p.active

    c.post(
        reverse("oelkaelder:product_update", args=[p.id]), {"name": "Fadøl", "price_kr": "12", "active": "on"}
    )
    p.refresh_from_db()
    assert p.price_ore == 1200

    # Unchecking "active" (checkbox absent) takes it out of the till.
    c.post(reverse("oelkaelder:product_update", args=[p.id]), {"name": "Fadøl", "price_kr": "12"})
    p.refresh_from_db()
    assert p.active is False


@pytest.mark.django_db
def test_void_deposit_drops_out_of_derived_balance(make_resident: Callable) -> None:
    oek = make_resident(email="oek2@gahk.dk", roles=("oelkaelder",))
    shopper = Shopper.objects.create(resident=make_resident(email="buyer@gahk.dk"))
    dep = Deposit.objects.create(shopper=shopper, amount_ore=5000)
    assert shopper.balance_ore == 5000

    c = Client()
    c.force_login(oek)
    c.post(reverse("oelkaelder:void_deposit", args=[dep.id]))

    dep.refresh_from_db()
    assert dep.is_valid is False
    assert shopper.balance_ore == 0  # derived balance excludes the voided deposit


@pytest.mark.django_db
def test_product_management_is_oelkaelder_only(make_resident: Callable) -> None:
    plain = make_resident(email="plain@gahk.dk")
    c = Client()
    c.force_login(plain)
    assert c.get(reverse("oelkaelder:products")).status_code == 403
    assert c.post(reverse("oelkaelder:product_create"), {"name": "X", "price_kr": "5"}).status_code == 403
    assert not Product.objects.filter(name="X").exists()
