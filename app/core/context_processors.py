"""Sidebar navigation, available to every template."""


def navigation(request):
    return {
        # Public site nav, matching the legacy gahk.dk menu (labels + order)
        "nav_legacy": [
            ("/", "Hjem"),
            ("/kollegielivet/historie", "Historie"),
            ("/vision", "Vision"),
            ("/kollegielivet", "Kollegielivet"),
            ("/faciliteter", "Faciliteter"),
            ("/optagelse/", "Optagelse"),
            ("/legater", "Legater"),
            ("/kontakt", "Kontakt"),
        ],
        "nav_public": [
            ("/", "Forside"),
            ("/faciliteter", "Faciliteter"),
            ("/kollegielivet", "Kollegielivet"),
            ("/vision", "Vision"),
            ("/legater", "Legater"),
            ("/kontakt", "Kontakt"),
            ("/optagelse/", "Optagelse"),
        ],
        "nav_intern": [
            ("/nyintern/", "Dashboard"),
            ("/nyintern/alumneliste/", "Alumneliste"),
            ("/nyintern/ak/", "AK-krydser"),
            ("/nyintern/oelkaelder/min-saldo", "Ølkælder"),
            ("/nyintern/statistik/", "Statistik"),
        ],
    }
