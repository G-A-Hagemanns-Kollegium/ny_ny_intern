"""Sidebar navigation + role/preview state, available to every template."""

from collections.abc import Collection

from django.conf import settings
from django.http import HttpRequest

from den_hurtige.access import roles_allowed as den_hurtige_allowed
from residents.permissions import CMS_EDITOR_ROLES, can_preview, effective_roles

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


NavItem = tuple[str, str, str]  # (url, label, icon-key from the base.html sprite)
NavSection = tuple[str, list[NavItem]]


def _nav_intern(roles: Collection[str]) -> list[NavSection]:
    """Internal menu grouped into sidebar sections, built from the *effective* role set: base items for
    every resident plus each embedsgruppe's admin tools. Each item is (url, label, icon); empty sections
    are dropped. Honors the preview override (roles come from effective_roles)."""
    oversigt: list[NavItem] = [("/nyintern/", "Dashboard", "dashboard")]
    # Den Hurtige is limited to the administrator group during its trial; the single switch is
    # den_hurtige.access.ACCESS_ROLES. Asking it here keeps the sidebar from advertising a page that
    # would answer 403, and means opening the rollout needs no change in this file.
    if den_hurtige_allowed(roles):
        oversigt.append(("/nyintern/den-hurtige/", "Den Hurtige", "flash"))
    oversigt += [
        ("/nyintern/alumneliste/", "Alumneliste", "list"),
        ("/nyintern/stamtree/", "Stamtræ", "tree"),
        ("/nyintern/statistik/", "Statistik", "chart"),
    ]
    vaerelser: list[NavItem] = [
        ("/nyintern/soegvaerelse/", "Søg værelse", "house"),
        ("/nyintern/vaerelsestjek/", "Værelsestjek", "inspect"),  # open to every resident
    ]
    if "indstilling" in roles:
        vaerelser.append(("/nyintern/soegvaerelse/admin", "Værelsesudbud", "offer"))
    grupper: list[NavItem] = [
        ("/nyintern/ak/", "AK-krydser", "check"),
        ("/nyintern/oelkaelder/min-saldo", "Ølkælder", "beer"),
    ]
    if "ak" in roles:
        grupper.append(("/nyintern/ak/admin", "AK-oversigt", "check"))
    if "oelkaelder" in roles:
        # Salgsoverblik / Personoversigt are sub-pages reached from Ølkælder-admin, not separate nav items.
        grupper.append(("/nyintern/oelkaelder/admin", "Ølkælder-admin", "beer"))
    if "regnskab" in roles:
        grupper.append(("/nyintern/regnskab/", "Regnskab", "receipt"))
    administration: list[NavItem] = []
    if "indstilling" in roles:
        administration.append(("/optagelse/listansoegninger", "Ansøgninger", "inbox"))
    if not set(roles).isdisjoint(CMS_EDITOR_ROLES):  # administrator/indstilling/inspektion/pr
        administration.append(("/django-admin/cms/", "Rediger indhold", "edit"))
    if "administrator" in roles:
        administration.append(("/admin/", "Site-admin", "gear"))
        administration.append(("/admin/roles", "Roller", "users"))
    ressourcer: list[NavItem] = [
        (settings.WIKI_URL, "Wiki", "book"),
        (settings.FEEDBACK_URL, "Fejl & ønsker", "bug"),
    ]
    # kokkengruppe: no dedicated screen today (documented gap; no menu item).
    sections: list[NavSection] = [
        ("Oversigt", oversigt),
        ("Værelser", vaerelser),
        ("Grupper & konti", grupper),
        ("Administration", administration),
        ("Ressourcer", ressourcer),
    ]
    return [s for s in sections if s[1]]


def navigation(request: HttpRequest) -> dict[str, object]:
    authed = request.user.is_authenticated
    roles = effective_roles(request) if authed else set()
    previewer = can_preview(request.user) if authed else False
    ctx: dict[str, object] = {
        "nav_legacy": NAV_LEGACY,
        "nav_public": NAV_PUBLIC,
        "nav_intern": _nav_intern(roles) if authed else [],
        "effective_roles": sorted(roles),
        "preview_active": bool(previewer and "preview_roles" in request.session),
        "can_preview": previewer,
        "wiki_url": settings.WIKI_URL,
    }
    # DEV-ONLY simulated clock bar (F-004 local testing). Only when DEBUG and logged in; inert in prod.
    if settings.DEBUG and authed:
        from core.clock import current_date

        ctx["dev_clock_debug"] = True
        ctx["dev_clock_date"] = current_date()
    return ctx
