"""The till kiosk (`shop`) is server-rendered and dependency-free so it runs on the physical till's
iPad (iOS 10.3), which cannot parse the Tailwind/Alpine frontend bundle (F-003)."""

from collections.abc import Callable

import pytest
from django.test import Client
from django.test.utils import override_settings
from django.urls import reverse

from oelkaelder.models import Product, PurchaseShare, Shopper

# The Django test client's REMOTE_ADDR is 127.0.0.1; whitelisting it opens the IP-gated kiosk.
ON_TILL = override_settings(OELKAELDER_KIOSK_IPS=["127.0.0.1"])


@ON_TILL
@pytest.mark.django_db
def test_shop_renders_server_side_tiles_without_frontend_bundle(make_resident: Callable) -> None:
    shopper = Shopper.objects.create(resident=make_resident(email="buyer@gahk.dk"))
    Product.objects.create(name="Fadøl", price_ore=1050, active=True)

    html = Client().get(reverse("oelkaelder:shop")).content.decode()

    # Tiles come from the server (not client templating): product + shopper are present in the HTML.
    assert "Fadøl" in html
    assert 'data-price="1050"' in html
    assert f'data-rid="{shopper.resident_id}"' in html
    assert f'action="{reverse("oelkaelder:purchase")}"' in html
    # The till's iOS 10.3 Safari can't parse the Tailwind/Alpine bundle — it must not be referenced.
    assert "dist/app.js" not in html
    assert "dist/app.css" not in html
    assert "x-data" not in html


@ON_TILL
@pytest.mark.django_db
def test_purchase_contract_unchanged(make_resident: Callable) -> None:
    """The rewritten form must still POST `shopper` (repeated) + `qty_<id>` so `purchase` works."""
    shopper = Shopper.objects.create(resident=make_resident(email="b2@gahk.dk"))
    product = Product.objects.create(name="Sodavand", price_ore=800, active=True)

    resp = Client().post(
        reverse("oelkaelder:purchase"),
        {"shopper": str(shopper.pk), f"qty_{product.pk}": "2"},
    )

    assert resp.status_code == 302  # redirect back to the till
    share = PurchaseShare.objects.get(shopper=shopper)
    assert share.share_ore == 1600  # 2 × 800, single shopper gets the whole total


@override_settings(DEBUG=False, OELKAELDER_KIOSK_IPS=[])
@pytest.mark.django_db
def test_shop_blocked_off_network() -> None:
    assert Client().get(reverse("oelkaelder:shop")).status_code == 403
