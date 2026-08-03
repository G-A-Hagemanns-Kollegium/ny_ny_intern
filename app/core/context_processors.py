"""Sidebar navigation + role/preview state, available to every template."""

from collections.abc import Collection

from django.conf import settings
from django.http import HttpRequest

from residents.permissions import can_preview, effective_roles

# Public site nav, matching the legacy gahk.dk menu (labels + order)
NAV_LEGACY = [
    ("/", "Hjem"),
    ("/kollegielivet/historie", "Historie"),
    ("/vision", "Vision"),
    ("/kollegielivet", "Kollegielivet"),
    ("/faciliteter", "Faciliteter"),
    ("/begivenheder/", "Begivenheder"),
    ("/optagelse/", "Optagelse"),
    ("/legater", "Legater"),
    ("/kontakt", "Kontakt"),
]

NAV_PUBLIC = [
    ("/", "Forside"),
    ("/faciliteter", "Faciliteter"),
    ("/kollegielivet", "Kollegielivet"),
    ("/vision", "Vision"),
    ("/legater", "Legater"),
    ("/begivenheder/", "Begivenheder"),
    ("/kontakt", "Kontakt"),
    ("/optagelse/", "Optagelse"),
]


def _nav_intern(roles: Collection[str]) -> list[tuple[str, str]]:
    """Internal menu built from the *effective* role set: base items for every resident, plus each
    embedsgruppe's admin tools. Honors the preview override (roles come from effective_roles)."""
    items = [
        ("/nyintern/", "Dashboard"),
        ("/nyintern/alumneliste/", "Alumneliste"),
        ("/nyintern/stamtree/", "Stamtræ"),
        ("/nyintern/soegvaerelse/", "Søg værelse"),
        ("/nyintern/ak/", "AK-krydser"),
        ("/nyintern/oelkaelder/min-saldo", "Ølkælder"),
        ("/nyintern/statistik/", "Statistik"),
        (settings.WIKI_URL, "Wiki"),
        (settings.FEEDBACK_URL, "Fejl & ønsker"),
    ]
    if "inspektion" in roles:
        items.append(("/nyintern/vaerelsestjek/", "Værelsestjek"))
    if "ak" in roles:
        items.append(("/nyintern/ak/admin", "AK-oversigt"))
    if "oelkaelder" in roles:
        items.append(("/nyintern/oelkaelder/admin", "Ølkælder-admin"))
    if "regnskab" in roles:
        items.append(("/nyintern/regnskab/", "Regnskab"))
    if "indstilling" in roles:
        items.append(("/nyintern/soegvaerelse/admin", "Værelsesudbud"))
        items.append(("/optagelse/listansoegninger", "Ansøgninger"))
    if "administrator" in roles:
        items.append(("/admin/", "Site-admin"))
        items.append(("/admin/roles", "Roller"))
    # kokkengruppe: no dedicated screen today (documented gap; no menu item).
    return items


def navigation(request: HttpRequest) -> dict[str, object]:
    authed = request.user.is_authenticated
    roles = effective_roles(request) if authed else set()
    previewer = can_preview(request.user) if authed else False
    return {
        "nav_legacy": NAV_LEGACY,
        "nav_public": NAV_PUBLIC,
        "nav_intern": _nav_intern(roles) if authed else [],
        "effective_roles": sorted(roles),
        "preview_active": bool(previewer and "preview_roles" in request.session),
        "can_preview": previewer,
        "wiki_url": settings.WIKI_URL,
    }
