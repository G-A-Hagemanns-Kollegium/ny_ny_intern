"""Ølbuddet — the GAHK delivery game (hackathon feature).

Deliberately read-only and self-contained:

* No models, so no migrations and no new tables. The player's progress lives in the browser's
  localStorage; nothing the game does can touch a resident, an ølkælder balance or an AK cross.
* The two querysets below are plain reads used only to *flavour* the game (real room numbers, real
  product names). Both fall back to a built-in list when the tables are empty, so the page works on
  a fresh database and in tests without fixtures.
* The game itself is a separate JS bundle (static/dist/spil.js) loaded only by this page — it is not
  part of the site-wide app.js bundle.
"""

from typing import Any

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import HttpRequest, HttpResponse
from django.shortcuts import render

from core.models import Room
from oelkaelder.models import Product
from residents.models import Residency, active_period

# Shown when the ølkælder has no products (fresh dev DB). Names only — the game invents its own
# prices; it never reads or writes a real balance.
FALLBACK_GOODS = [
    "Tuborg Classic",
    "Grøn Tuborg",
    "Carlsberg",
    "Cocio",
    "Sodavand",
    "Faxe Kondi",
    "Chips",
    "Slik",
    "Chokolade",
    "Snacks",
    "Rom",
    "Vodka",
]

# How many goods the game may know about. The order generator only needs a handful of names.
MAX_GOODS = 24


def _rooms() -> list[dict[str, Any]]:
    """The 61 rooms as the game needs them: number, floor, side and who currently lives there.

    `who` is the occupant's **first name** off the alumneliste for the period in effect — the same
    list every logged-in resident already sees in full at /nyintern/alumneliste/, minus the surname,
    e-mail, study and dates. It is what makes a delivery feel like a delivery to somebody you know.
    Rooms with nobody on the current list come back blank and the client invents a name.

    An empty list means an unseeded database; the client then rebuilds the same map itself
    (see frontend/src/spil/building.ts).
    """
    year, month = active_period()
    occupants = {
        r.room_id: r.resident.first_name
        for r in Residency.objects.filter(year=year, month=month).select_related("resident")
    }
    return [
        {
            "n": r.number,
            "floor": r.floor,
            "side": r.side,
            "note": r.note,
            "who": occupants.get(r.pk, ""),
        }
        for r in Room.objects.all().order_by("number")
    ]


def _goods() -> list[str]:
    names = list(Product.objects.filter(active=True).order_by("name").values_list("name", flat=True))
    return names[:MAX_GOODS] if names else FALLBACK_GOODS


@login_required
def play(request: HttpRequest) -> HttpResponse:
    return render(
        request,
        "spil/spil.html",
        {
            "spil_rooms": _rooms(),
            "spil_goods": _goods(),
            # Sprite-atlas directory. Deliberately NOT {% static %}: under the hashed manifest
            # storage a {% static %} call for a file that does not exist yet is a hard 500, and the
            # atlas is optional by design (the game draws itself until somebody supplies art).
            "spil_assets": f"{settings.STATIC_URL}spil/",
        },
    )
