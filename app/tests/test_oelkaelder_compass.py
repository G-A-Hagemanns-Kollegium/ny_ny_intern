import json
from collections.abc import Callable
from datetime import timedelta

import pytest
from django.http import HttpResponse
from django.test import Client, override_settings
from django.urls import reverse
from django.utils import timezone

from oelkaelder.models import OelkaelderOffer
from residents.models import Resident

COMPASS_URL = reverse("oelkaelder:compass")


def _compass_page(client: Client, make_resident: Callable[..., Resident]) -> HttpResponse:
    client.force_login(make_resident(email="compass@gahk.dk"))
    return client.get(COMPASS_URL)


@pytest.mark.django_db
@override_settings(OLKAELDER_LATITUDE=55.6789, OLKAELDER_LONGITUDE=12.5678)
def test_compass_page_includes_configured_destination(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    response = _compass_page(client, make_resident)

    assert response.status_code == 200
    assert response.context["destination"] == {
        "name": "Ølkælderen",
        "latitude": 55.6789,
        "longitude": 12.5678,
    }
    marker = b'<script id="oelkaelder-destination" type="application/json">'
    payload = response.content.split(marker, maxsplit=1)[1].split(b"</script>", maxsplit=1)[0]
    assert json.loads(payload) == response.context["destination"]


@pytest.mark.django_db
def test_compass_page_shows_only_currently_visible_offers(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    now = timezone.now()
    OelkaelderOffer.objects.create(title="Aktivt tilbud", starts_at=now - timedelta(minutes=1))
    OelkaelderOffer.objects.create(title="Uden datogrænser")
    OelkaelderOffer.objects.create(title="Deaktiveret", is_active=False)
    OelkaelderOffer.objects.create(title="Fremtidigt", starts_at=now + timedelta(minutes=1))
    OelkaelderOffer.objects.create(title="Udløbet", ends_at=now - timedelta(minutes=1))

    response = _compass_page(client, make_resident)
    html = response.content.decode()

    assert "Aktivt tilbud" in html
    assert "Uden datogrænser" in html
    assert "Deaktiveret" not in html
    assert "Fremtidigt" not in html
    assert "Udløbet" not in html


@pytest.mark.django_db
def test_compass_page_has_friendly_empty_offer_state(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    response = _compass_page(client, make_resident)

    assert "Ingen tilbud lige nu — men kompasset virker stadig 🍺" in response.content.decode()
