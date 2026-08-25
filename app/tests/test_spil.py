"""Ølbuddet (the delivery game).

The point of these tests is not the game — it runs in the browser and nothing here can see it. It is
the *seam*: the page must be login-gated like every other internal page, it must survive an empty
database, and adding it must not have moved anything else.
"""

from collections.abc import Callable

import pytest
from django.test import Client

URL = "/nyintern/spil/"


@pytest.mark.django_db
def test_game_requires_login() -> None:
    assert Client().get(URL).status_code in (301, 302)


@pytest.mark.django_db
def test_game_renders_for_any_resident(make_resident: Callable) -> None:
    c = Client()
    c.force_login(make_resident(email="spil@gahk.dk"))
    res = c.get(URL)
    assert res.status_code == 200
    html = res.content.decode()
    assert "spil-canvas" in html
    # The room/goods payloads must be present and JSON-escaped (json_script), never inline JS.
    assert 'id="spil-rooms"' in html
    assert 'id="spil-goods"' in html
    assert "{{" not in html and "{%" not in html  # no leaked template syntax


@pytest.mark.django_db
def test_game_works_on_an_empty_database(make_resident: Callable) -> None:
    """No rooms seeded and no ølkælder products: the view must still answer 200 (the client falls
    back to its own copy of the room map)."""
    from core.models import Room
    from oelkaelder.models import Product

    assert not Room.objects.exists()
    assert not Product.objects.exists()
    c = Client()
    c.force_login(make_resident(email="spil-empty@gahk.dk"))
    assert c.get(URL).status_code == 200


@pytest.mark.django_db
def test_game_uses_real_rooms_and_products_when_present(make_resident: Callable) -> None:
    from core.models import Room
    from oelkaelder.models import Product

    Room.objects.create(legacy_index=1, number=1, floor="stuen", side="mod gaden")
    Product.objects.create(name="Grøn Tuborg", price_ore=1000, active=True)
    Product.objects.create(name="Udgået vare", price_ore=1000, active=False)

    c = Client()
    c.force_login(make_resident(email="spil-data@gahk.dk"))
    res = c.get(URL)
    assert res.context["spil_rooms"] == [
        {"n": 1, "floor": "stuen", "side": "mod gaden", "note": "", "who": ""}
    ]
    assert res.context["spil_goods"] == ["Grøn Tuborg"]  # inactive products stay out


@pytest.mark.django_db
def test_game_is_in_the_sidebar_for_everyone(make_resident: Callable) -> None:
    """It sits in its own 'Fritid' section at the bottom — visible to every logged-in resident, and
    not mixed in with the tools above it."""
    c = Client()
    c.force_login(make_resident(email="spil-nav@gahk.dk"))
    nav = c.get("/nyintern/").context["nav_intern"]
    assert nav[-1][0] == "Fritid"
    assert [(u, label) for u, label, _i in nav[-1][1]] == [(URL, "Ølbuddet")]


@pytest.mark.django_db
def test_game_writes_nothing(make_resident: Callable) -> None:
    """A GET of the game page must not create a single row anywhere — progress lives in the
    browser, and the page is a read-only guest in this database."""
    from django.apps import apps

    c = Client()
    c.force_login(make_resident(email="spil-ro@gahk.dk"))

    # Our own domain tables only — Django's session/log tables are the framework's business.
    models = [m for m in apps.get_models() if m._meta.managed and not m.__module__.startswith("django.")]
    before = {m: m.objects.count() for m in models}
    assert c.get(URL).status_code == 200
    after = {m: m.objects.count() for m in models}
    assert before == after


@pytest.mark.django_db
def test_game_names_the_current_occupant_but_only_their_first_name(make_resident: Callable) -> None:
    """The bud delivers to real people off the alumneliste — first names only. The surname, e-mail,
    study and dates that the directory page shows never reach the game payload."""
    from core.models import Room
    from residents.models import Residency, active_period

    room = Room.objects.create(legacy_index=12, number=101, floor="1. sal", side="mod gaden")
    who = make_resident(email="beboer101@gahk.dk", first_name="Karla", last_name="Zilverberg")
    year, month = active_period()
    Residency.objects.create(resident=who, room=room, year=year, month=month)

    c = Client()
    c.force_login(make_resident(email="spil-who@gahk.dk"))
    res = c.get(URL)
    assert res.context["spil_rooms"] == [
        {"n": 101, "floor": "1. sal", "side": "mod gaden", "note": "", "who": "Karla"}
    ]
    body = res.content.decode()
    # (a surname that cannot collide with "G. A. Hagemanns Kollegium" in the page chrome)
    assert "Zilverberg" not in body
    assert "beboer101@gahk.dk" not in body


@pytest.mark.django_db
def test_game_leaves_empty_rooms_unnamed(make_resident: Callable) -> None:
    """A room nobody is on the current list for comes back blank; the client invents a stand-in."""
    from core.models import Room

    Room.objects.create(legacy_index=12, number=101, floor="1. sal", side="mod gaden")
    c = Client()
    c.force_login(make_resident(email="spil-empty-room@gahk.dk"))
    assert c.get(URL).context["spil_rooms"][0]["who"] == ""
