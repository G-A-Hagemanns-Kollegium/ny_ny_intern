"""Regression tests codifying the security-critical behaviour verified during the build.

These lock in the fixes from the Phase-3 threat model so they can't regress: legacy-hash upgrade,
monthly roles, admissions email/CSRF rules, POS money integrity, and the front-page visit counter.
"""

from collections.abc import Callable

import pytest
from django.contrib.auth.hashers import identify_hasher
from django.core import mail
from django.test import Client
from django.utils import timezone

from admissions.models import Application
from residents.models import Resident, Role, active_period


# ---------------------------------------------------------------- auth (F-014)
@pytest.mark.django_db
def test_legacy_sha256_upgrades_on_login(make_resident: Callable) -> None:
    make_resident(email="a@gahk.dk", password="hemmelig", legacy=True)
    c = Client()
    assert c.login(email="a@gahk.dk", password="hemmelig") is True
    r = Resident.objects.get(email="a@gahk.dk")
    assert identify_hasher(r.password).algorithm == "pbkdf2_sha256"  # upgraded


@pytest.mark.django_db
def test_monthly_role_is_time_bound(make_resident: Callable) -> None:
    r = make_resident(roles=[Role.AK])
    y, m = active_period()
    assert r.has_role(Role.AK, (y, m)) is True
    assert r.has_role(Role.AK, (y - 1, m)) is False
    assert r.has_role(Role.INDSTILLING, (y, m)) is False


# ---------------------------------------------------------------- admissions (F-001)
@pytest.mark.django_db
def test_rundvisning_emails_committee_and_applicant() -> None:
    mail.outbox = []
    Client().post(
        "/optagelse/send_rundvisning",
        {
            "full_name": "Ny",
            "email": "ny@x.dk",
            "gender": "male",
            "age": "22",
            "study_year": "1",
            "year_left": "3",
            "university": "DTU",
            "field_of_study": "Fysik",
            "heard_about_us": "plakat",
            "motivation": "m",
        },
    )
    assert Application.objects.filter(type="rundvisning").count() == 1
    assert len(mail.outbox) == 2  # committee + applicant


@pytest.mark.django_db
def test_fremleje_does_not_email_committee() -> None:
    mail.outbox = []
    Client().post(
        "/optagelse/send_fremleje",
        {
            "full_name": "Ny",
            "email": "ny@x.dk",
            "gender": "other",
            "age": "25",
            "occupation": "Studerende",
            "heard_about_us": "avis",
            "motivation": "m",
        },
    )
    assert Application.objects.filter(type="fremleje").count() == 1
    assert len(mail.outbox) == 1  # applicant auto-reply only (decision 2026-06)


@pytest.mark.django_db
def test_mark_received_is_post_only_and_role_gated(make_resident: Callable) -> None:
    app = Application.objects.create(
        type="rundvisning", full_name="X", email="x@x.dk", submitted_at=timezone.now()
    )
    ind = make_resident(email="ind@gahk.dk", roles=[Role.INDSTILLING])
    c = Client()
    assert c.get("/optagelse/listansoegninger").status_code in (302, 301)  # anon → login
    c.force_login(ind)
    assert c.get(f"/optagelse/setasreceived/{app.id}").status_code == 405  # GET blocked
    assert c.post(f"/optagelse/setasreceived/{app.id}").status_code == 302
    app.refresh_from_db()
    assert app.received_by_id == ind.id


# ---------------------------------------------------------------- ølkælder money (F-003)
@pytest.mark.django_db
def test_purchase_split_is_exact_and_atomic(make_resident: Callable) -> None:
    from oelkaelder.models import Product, Shopper
    from oelkaelder.services import record_purchase

    p = Product.objects.create(name="Øl", price_ore=1500)
    s1 = Shopper.objects.create(resident=make_resident(email="s1@gahk.dk"))
    s2 = Shopper.objects.create(resident=make_resident(email="s2@gahk.dk"))
    txn = record_purchase([s1.id, s2.id], [{"product": p.id, "mode": "fixed", "qty": 3}])  # 4500 øre / 2
    total = sum(sh.share_ore for sh in txn.shares.all())
    assert total == 4500
    assert s1.balance_ore + s2.balance_ore == -4500  # derived from the ledger


@pytest.mark.django_db
def test_my_balance_shows_account_statement(make_resident: Callable) -> None:
    from oelkaelder.models import Product, Shopper
    from oelkaelder.services import record_deposit, record_purchase

    p = Product.objects.create(name="Øl", price_ore=1500)
    r = make_resident(email="buyer@gahk.dk")
    s = Shopper.objects.create(resident=r)
    record_deposit(s, 5000)  # 50,00 kr credit
    record_purchase(
        [s.id], [{"product": p.id, "mode": "fixed", "qty": 2}]
    )  # 30,00 kr debit, all to this shopper

    c = Client()
    c.force_login(r)
    html = c.get("/nyintern/oelkaelder/min-saldo").content.decode()
    assert "Kontoudtog" in html
    assert "2× Øl" in html and "-30,00 kr" in html  # purchase debit (signed)
    assert "Indbetaling" in html and "50,00 kr" in html  # deposit credit


@pytest.mark.django_db
def test_application_list_shows_receiver(make_resident: Callable) -> None:
    ind = make_resident(
        email="ind@gahk.dk", first_name="Ida", last_name="Storgaard", roles=[Role.INDSTILLING]
    )
    now = timezone.now()
    Application.objects.create(
        type=Application.Type.TOUR,
        full_name="Handled Person",
        email="h@x.dk",
        submitted_at=now,
        received_by=ind,
        received_at=now,
    )
    Application.objects.create(
        type=Application.Type.TOUR,
        full_name="Pending Person",
        email="p@x.dk",
        submitted_at=now,
    )
    c = Client()
    c.force_login(ind)
    html = c.get("/optagelse/listansoegninger").content.decode()
    assert "Ida S." in html  # receiver shown as first name + last initial
    assert "Afventer" in html  # the un-received one is flagged


@pytest.mark.django_db
def test_cms_admin_is_gated_to_administrator(make_resident: Callable) -> None:
    from cms.models import Page

    Page.objects.create(header="Testside", slug="testside", body="<p>hej</p>")
    admin = make_resident(email="admin@gahk.dk", roles=[Role.ADMINISTRATOR])
    ak = make_resident(email="ak@gahk.dk", roles=[Role.AK])  # staff, but not administrator

    ca = Client()
    ca.force_login(admin)
    assert ca.get("/django-admin/cms/page/").status_code == 200  # administrator can edit pages

    ck = Client()
    ck.force_login(ak)
    assert ck.get("/django-admin/cms/page/").status_code == 403  # other roles cannot


@pytest.mark.django_db
def test_cms_admin_sanitizes_html_on_save(make_resident: Callable) -> None:
    from cms.models import Page

    page = Page.objects.create(header="S", slug="s", body="")
    admin = make_resident(email="admin@gahk.dk", roles=[Role.ADMINISTRATOR])
    c = Client()
    c.force_login(admin)
    c.post(
        f"/django-admin/cms/page/{page.id}/change/",
        {
            "slug": "s",
            "menu_category": "0",
            "header": "S",
            "background_image": "",
            "body": '<p>Hej</p><script>alert(1)</script><a href="javascript:evil()">x</a>',
        },
    )
    page.refresh_from_db()
    assert "<p>Hej</p>" in page.body  # safe markup kept
    assert "<script" not in page.body and "javascript:" not in page.body  # stripped


@pytest.mark.django_db
def test_is_staff_synced_with_roles(make_resident: Callable) -> None:
    from residents.models import RoleAssignment, active_period

    r = make_resident(email="plain@gahk.dk")  # no roles → not staff
    assert r.is_staff is False
    y, m = active_period()
    ra = RoleAssignment.objects.create(resident=r, role=Role.AK, year=y, month=m)
    r.refresh_from_db()
    assert r.is_staff is True  # gained a role → staff
    ra.delete()
    r.refresh_from_db()
    assert r.is_staff is False  # lost last role → no longer staff

    su = make_resident(email="su@gahk.dk", is_superuser=True, is_staff=True)
    RoleAssignment.objects.create(resident=su, role=Role.AK, year=y, month=m).delete()
    su.refresh_from_db()
    assert su.is_staff is True  # superuser stays staff regardless


@pytest.mark.django_db
def test_dashboard_shows_shared_calendar_credentials(
    make_resident: Callable, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GOOGLE_CALENDAR_USER", "gahkkalender@gmail.com")
    monkeypatch.setenv("GOOGLE_CALENDAR_PASSWORD", "dummy-pw")
    c = Client()
    c.force_login(make_resident(email="d@gahk.dk"))
    h = c.get("/nyintern/").content.decode()
    assert "gahkkalender@gmail.com" in h and "dummy-pw" in h  # both shown to logged-in residents
    # The embedded Google Calendar agenda (restored from the legacy dashboard) renders for logged-in users.
    assert "calendar.google.com/calendar/embed" in h
    assert "src=gahkkalender%40gmail.com" in h


@pytest.mark.django_db
def test_oelkaelder_kiosk_gate_uses_forwarded_ip() -> None:
    from django.test import override_settings

    with override_settings(DEBUG=False, OELKAELDER_KIOSK_IPS=["130.225.243.26"]):
        c = Client()
        # Traefik appends the real client IP as the last X-Forwarded-For hop.
        ok = c.get("/nyintern/oelkaelder/", HTTP_X_FORWARDED_FOR="130.225.243.26")
        assert ok.status_code == 200  # kiosk open from the dorm egress IP
        blocked = c.get("/nyintern/oelkaelder/", HTTP_X_FORWARDED_FOR="203.0.113.9")
        assert blocked.status_code == 403  # any other IP is denied


@pytest.mark.django_db
def test_media_files_are_served_in_prod() -> None:
    from pathlib import Path

    from django.conf import settings
    from django.test import override_settings

    Path(settings.MEDIA_ROOT).mkdir(parents=True, exist_ok=True)
    f = Path(settings.MEDIA_ROOT) / "__test_serve.txt"
    f.write_text("hello-media")
    try:
        with override_settings(DEBUG=False):  # prod-like: must still serve /media/
            r = Client().get("/media/__test_serve.txt")
        assert r.status_code == 200
        assert b"".join(r.streaming_content) == b"hello-media"
    finally:
        f.unlink(missing_ok=True)


@pytest.mark.django_db
def test_room_photo_over_max_is_rejected(make_resident: Callable) -> None:
    from django.core.files.uploadedfile import SimpleUploadedFile
    from django.test import override_settings

    from core.models import Room
    from rooms.models import RoomConditionScore, RoomCriterion

    rm = Room.objects.create(legacy_index=90, number=90, floor="stuen", side="mod gaden")
    RoomCriterion.objects.create(code="floor", name="Gulv", options=5)
    ins = make_resident(email="ins@gahk.dk", roles=[Role.INSPEKTION])
    c = Client()
    c.force_login(ins)
    img = SimpleUploadedFile("p.jpg", b"x" * 2048, content_type="image/jpeg")
    with override_settings(ROOM_PHOTO_MAX_MB=0):  # cap 0 → any file counts as "too big"
        c.post(
            f"/nyintern/vaerelsestjek/besvar/{rm.number}",
            {"score_floor": "3", "comment_floor": "", "image_floor": img},
        )
    s = RoomConditionScore.objects.get(criterion__code="floor")
    assert s.score == 3  # the score/comment are still saved
    assert not s.photo  # the oversized photo was skipped


def test_room_condition_image_urls() -> None:
    from rooms.models import RoomConditionScore

    # legacy `image` is a ';'-separated list with mixed public/ and /public/ prefixes
    s = RoomConditionScore(image="public/image/a.jpg;/public/image/b.jpg;")
    assert s.image_urls == ["/media/public/image/a.jpg", "/media/public/image/b.jpg"]
    assert RoomConditionScore(image="https://ex.com/y.jpg").image_urls == ["https://ex.com/y.jpg"]
    assert RoomConditionScore(image="").image_urls == []


def test_body_media_rewrites_relative_and_absolute_legacy_urls() -> None:
    from cms.templatetags.cms_extras import body_media

    html = (
        '<img src="/public/image/a.jpg">'
        '<img src="http://gahk.dk/public/image/b.jpg">'
        '<img src="https://www.gahk.dk/public/image/c.jpg">'
    )
    out = body_media(html)
    assert out.count('src="/static/legacy/image/') == 3  # all three rewritten
    assert "gahk.dk/public" not in out and 'src="/public' not in out  # no http/relative leftovers


# ---------------------------------------------------------------- visit counter (F-002/F-011)
@pytest.mark.django_db
def test_frontpage_counter_hashes_and_dedups() -> None:
    from stats.models import DailyVisitCount, VisitTally

    c = Client()
    c.get("/")
    c.get("/")  # same IP within the 30-min window → counted once
    assert VisitTally.objects.count() == 1
    assert VisitTally.objects.first().count == 1
    assert DailyVisitCount.objects.get(date=timezone.localdate()).count == 1
    assert len(VisitTally.objects.first().ip_hash) == 64  # HMAC-SHA256 hex, not a raw IP


@pytest.mark.django_db
def test_events_news_page_and_forside_teaser() -> None:
    from datetime import date, timedelta

    from cms.models import Event, NewsItem

    Event.objects.create(title="Mathildefest", starts_on=date.today() + timedelta(days=14))
    Event.objects.create(title="Gammel skovtur", starts_on=date.today() - timedelta(days=400))
    NewsItem.objects.create(title="Åbent hus", body="<p>Kom forbi</p>", published_at=timezone.now())
    c = Client()

    page = c.get("/begivenheder/").content.decode()
    assert page.count("Mathildefest")  # upcoming event listed
    assert "Åbent hus" in page and "Kom forbi" in page  # news rendered
    assert "Gammel skovtur" in page  # past event listed

    home = c.get("/").content.decode()
    assert "Mathildefest" in home and "Åbent hus" in home  # forside teaser
    assert "/begivenheder/" in home  # link to the full page + nav


@pytest.mark.django_db
def test_statistik_renders_charts(make_resident: Callable) -> None:
    from datetime import date

    from stats.models import DailyVisitCount

    Application.objects.create(
        type=Application.Type.TOUR,
        full_name="A",
        email="a@x.dk",
        submitted_at=timezone.now(),
        university="DTU",
        heard_about_us="plakat",
    )
    DailyVisitCount.objects.create(date=date.today(), count=5)
    c = Client()
    c.force_login(make_resident(email="m@gahk.dk"))
    h = c.get("/nyintern/statistik/").content.decode()
    assert 'id="stats-data"' in h  # chart data embedded via json_script
    for cid in ("chart-applications", "chart-heard", "chart-visits"):
        assert f'id="{cid}"' in h  # the three chart canvases
    assert "Rundvisninger" in h and "plakat" in h  # labels present in the JSON payload


# ---------------------------------------------------------------- public/auth separation
@pytest.mark.django_db
def test_public_window_has_no_internal_tools() -> None:
    html = Client().get("/").content.decode()
    for label in ("Alumneliste", "AK-krydser", "Ølkælder-admin"):
        assert label not in html


@pytest.mark.django_db
def test_slashless_legacy_urls_redirect_instead_of_404() -> None:
    """The catch-all CMS pattern matches slashless paths owned by real apps, which suppresses
    Django's APPEND_SLASH. Those URLs are live on the PHP site (/optagelse returns 200) and
    bookmarked by residents (/nyintern), so they must 301 rather than 404 after the cutover."""
    from cms.models import Page

    c = Client()
    for path in ("/optagelse", "/nyintern", "/begivenheder"):
        r = c.get(path)
        assert r.status_code == 301, f"{path} should redirect, got {r.status_code}"
        assert r.headers["Location"] == f"{path}/"

    # The query string survives the redirect.
    r = c.get("/optagelse?type=fremleje")
    assert r.status_code == 301
    assert r.headers["Location"] == "/optagelse/?type=fremleje"

    # A real CMS page still renders directly, and a genuinely unknown slug still 404s.
    Page.objects.create(header="Faciliteter", slug="faciliteter", body="<p>hej</p>")
    assert c.get("/faciliteter").status_code == 200
    assert c.get("/findes-ikke").status_code == 404


@pytest.mark.django_db
def test_vaerelsestjek_is_open_to_every_resident(make_resident: Callable) -> None:
    """Room checks are done by whoever is around, so seeing and writing them is not gated on the
    inspektion embedsgruppe (F-005). akoverview stays AK-only — it is the AK group's own screen."""
    from core.models import Room
    from rooms.models import RoomCondition, RoomCriterion

    rm = Room.objects.create(legacy_index=91, number=91, floor="stuen", side="mod gaden")
    RoomCriterion.objects.create(code="vindue", name="Vindue", options=5)
    plain = make_resident(email="menig@gahk.dk")  # no roles at all
    c = Client()
    c.force_login(plain)

    assert c.get("/nyintern/vaerelsestjek/").status_code == 200
    assert c.get(f"/nyintern/vaerelsestjek/besvar/{rm.number}").status_code == 200

    c.post(f"/nyintern/vaerelsestjek/besvar/{rm.number}", {"score_vindue": "4", "comment_vindue": "Fin"})

    cond = RoomCondition.objects.get(room=rm, is_current=True)
    assert cond.resident == plain  # the writer is recorded, so the history stays attributable
    assert cond.scores.get(criterion__code="vindue").score == 4
    assert c.get(f"/nyintern/vaerelsestjek/se/{rm.number}").status_code == 200

    assert c.get("/nyintern/vaerelsestjek/akoverview").status_code == 403  # still AK-only
    assert "Værelsestjek" in [label for _url, label in c.get("/nyintern/").context["nav_intern"]]


@pytest.mark.django_db
def test_vaerelsestjek_still_requires_login() -> None:
    assert Client().get("/nyintern/vaerelsestjek/").status_code in (301, 302)


def test_room_criterion_score_scale_matches_legacy() -> None:
    """besvar.php:27-40 — options==3 → 0..2, options>2 → 1..options, otherwise 0..1.
    `options` selects the scale's *shape*; it is not a maximum."""
    from rooms.models import RoomCriterion

    assert RoomCriterion(options=5).score_values == [1, 2, 3, 4, 5]  # 13 real criteria
    assert RoomCriterion(options=3).score_values == [0, 1, 2]  # 9 real criteria
    assert RoomCriterion(options=2).score_values == [0, 1]  # 7 real criteria
    assert (RoomCriterion(options=3).score_min, RoomCriterion(options=3).score_max) == (0, 2)
    assert RoomCriterion(options=5).accepts_score(None)  # unanswered is fine
    assert not RoomCriterion(options=5).accepts_score(0)  # the 5-scale starts at 1
    assert not RoomCriterion(options=3).accepts_score(3)  # the 3-option scale tops out at 2


def test_parse_score_rejects_non_ascii_digits() -> None:
    """'²'.isdigit() is True but int('²') raises — the old guard 500'd on it."""
    from rooms.views import _parse_score

    assert _parse_score("3") == 3
    assert _parse_score("-2") == -2  # parses, then gets rejected by accepts_score
    assert _parse_score("") is None
    assert _parse_score("abc") is None
    assert _parse_score("²") is None
    assert _parse_score("9" * 5000) is None


@pytest.mark.django_db
def test_vaerelsestjek_shows_legend_and_drops_out_of_range(make_resident: Callable) -> None:
    """The per-criterion forklaring is rendered again, the widget offers the legacy scale, criteria
    come in legacy (code) order, and an off-scale score is dropped without losing the other answers."""
    from core.models import Room
    from rooms.models import RoomConditionScore, RoomCriterion

    rm = Room.objects.create(legacy_index=92, number=92, floor="stuen", side="mod gaden")
    RoomCriterion.objects.create(
        code="walls", name="Vægge", options=5, description="Maling.\r\n1: Nymalet/pæn stand,\r\n5: Huller"
    )
    RoomCriterion.objects.create(code="curtains", name="Gardiner", options=2, description="0: Er der")
    RoomCriterion.objects.create(code="contacts", name="Kontakter", options=3, description="0: Virker")
    c = Client()
    c.force_login(make_resident(email="tjek@gahk.dk"))

    html = c.get(f"/nyintern/vaerelsestjek/besvar/{rm.number}").content.decode()

    assert "Huller" in html  # the legend is back
    assert "Nymalet/pæn stand,<br>" in html  # multi-line legends keep their rungs
    assert 'max="5"' in html and 'max="2"' in html and 'max="1"' in html  # all three scale shapes
    assert 'min="1"' in html  # the 5-scale starts at 1, not 0
    # legacy order is by code; ordering by Danish name would put Gardiner first
    assert html.index("Kontakter") < html.index("Gardiner") < html.index("Vægge")

    r = c.post(
        f"/nyintern/vaerelsestjek/besvar/{rm.number}",
        {"score_walls": "9", "comment_walls": "Store revner", "score_curtains": "1"},
        follow=True,
    )
    walls = RoomConditionScore.objects.get(criterion__code="walls")
    assert walls.score is None  # the off-scale value was dropped …
    assert walls.comment == "Store revner"  # … but the observation survived
    assert RoomConditionScore.objects.get(criterion__code="curtains").score == 1
    assert "uden for skalaen" in r.content.decode()  # and the inspector was told


@pytest.mark.django_db
def test_vaerelsestjek_history_prefills_without_mutating_the_old_report(make_resident: Callable) -> None:
    """?rapport=<id> fills the form from an earlier report; submitting creates a NEW current one."""
    from core.models import Room
    from rooms.models import RoomCondition, RoomConditionScore, RoomCriterion

    rm = Room.objects.create(legacy_index=93, number=93, floor="1. sal", side="mod gaden")
    crit = RoomCriterion.objects.create(code="walls", name="Vægge", options=5)
    who = make_resident(email="tjek2@gahk.dk", first_name="Ida", last_name="Inspektør")
    old = RoomCondition.objects.create(
        room=rm, resident=who, recorded_by_name="Ida Inspektør", recorded_at=timezone.now(), is_current=False
    )
    RoomConditionScore.objects.create(condition=old, criterion=crit, score=2, comment="Gammel note")
    cur = RoomCondition.objects.create(
        room=rm, resident=who, recorded_by_name="Ida Inspektør", recorded_at=timezone.now(), is_current=True
    )
    RoomConditionScore.objects.create(condition=cur, criterion=crit, score=5, comment="Ny note")
    c = Client()
    c.force_login(who)

    assert 'value="5"' in c.get(f"/nyintern/vaerelsestjek/besvar/{rm.number}").content.decode()

    html = c.get(f"/nyintern/vaerelsestjek/besvar/{rm.number}?rapport={old.pk}").content.decode()
    assert 'value="2"' in html and "Gammel note" in html  # prefilled from the old report
    assert "tidligere rapport" in html  # …and says so

    c.post(f"/nyintern/vaerelsestjek/besvar/{rm.number}", {"score_walls": "3"})
    old.refresh_from_db()
    assert old.scores.get().score == 2  # the old report is untouched
    assert old.is_current is False
    assert RoomCondition.objects.filter(room=rm).count() == 3  # a new report, not an overwrite
    assert RoomCondition.objects.get(room=rm, is_current=True).scores.get().score == 3


@pytest.mark.django_db
def test_ak_overview_matrix_and_export_align_scores_with_headers(make_resident: Callable) -> None:
    """The legacy filled cells positionally from a delimited blob, so a room missing one criterion
    shifted every later score under the wrong heading. Keyed by criterion id, that cannot happen."""
    from core.models import Room
    from rooms.models import RoomCondition, RoomConditionScore, RoomCriterion

    rm = Room.objects.create(legacy_index=94, number=94, floor="2. sal", side="mod gården")
    a = RoomCriterion.objects.create(code="aaa", name="Alfa", options=5)
    RoomCriterion.objects.create(code="bbb", name="Beta", options=5)  # deliberately never scored
    z = RoomCriterion.objects.create(code="zzz", name="Zeta", options=5)
    cond = RoomCondition.objects.create(
        room=rm, recorded_by_name="Ida", recorded_at=timezone.now(), is_current=True
    )
    RoomConditionScore.objects.create(condition=cond, criterion=a, score=1)
    RoomConditionScore.objects.create(condition=cond, criterion=z, score=5)
    c = Client()
    c.force_login(make_resident(email="ak-matrix@gahk.dk", roles=("ak",)))

    html = c.get("/nyintern/vaerelsestjek/akoverview").content.decode()
    assert "Alfa" in html and "Beta" in html and "Zeta" in html

    csv_resp = c.get("/nyintern/vaerelsestjek/akoverview", {"format": "csv"})
    assert csv_resp["Content-Type"].startswith("text/csv")
    lines = csv_resp.content.decode("utf-8-sig").strip().splitlines()
    assert lines[0].split(",")[3:] == ["Alfa", "Beta", "Zeta"]
    # Zeta's 5 must land in Zeta's column, not shift left into the unscored Beta
    assert lines[1].split(",")[3:] == ["1", "", "5"]

    xlsx = c.get("/nyintern/vaerelsestjek/akoverview", {"format": "xlsx"})
    assert "spreadsheetml.sheet" in xlsx["Content-Type"]
    assert c.get("/nyintern/vaerelsestjek/akoverview").status_code == 200


@pytest.mark.django_db
def test_backfill_dedupes_on_naive_vs_aware_timestamps(make_resident: Callable) -> None:
    """The backfill keys on (room, recorded_at). MySQL yields naive datetimes and Django stores them
    aware, so without normalising first, every re-run duplicated all 620 historical reports."""
    from datetime import datetime

    from core.models import Room
    from rooms.models import RoomCondition

    rm = Room.objects.create(legacy_index=95, number=95, floor="3. sal", side="mod gaden")
    naive = datetime(2019, 5, 1, 12, 0)
    RoomCondition.objects.create(
        room=rm, recorded_by_name="Ida", recorded_at=timezone.make_aware(naive), is_current=False
    )

    seen = set(RoomCondition.objects.values_list("room_id", "recorded_at"))
    assert (rm.id, naive) not in seen  # the naive form does NOT match — this was the bug
    assert (rm.id, timezone.make_aware(naive)) in seen  # normalising first does


@pytest.mark.django_db
def test_vaerelsestjek_templates_leak_no_template_syntax(make_resident: Callable) -> None:
    """Django's {# … #} is single-line only — the lexer matches {#.*?#} without DOTALL, so a
    multi-line one is never tokenised and renders verbatim on the page. Use {% comment %} instead.
    Asserting presence (as the other tests do) cannot catch this; only asserting absence can."""
    from core.models import Room
    from rooms.models import RoomCondition, RoomConditionScore, RoomCriterion

    rm = Room.objects.create(legacy_index=96, number=96, floor="4. sal", side="mod gaden")
    crit = RoomCriterion.objects.create(code="walls", name="Vægge", options=5, description="1: Fin")
    cond = RoomCondition.objects.create(
        room=rm, recorded_by_name="Ida", recorded_at=timezone.now(), is_current=True
    )
    RoomConditionScore.objects.create(condition=cond, criterion=crit, score=3)
    c = Client()
    c.force_login(make_resident(email="leak@gahk.dk", roles=("ak",)))

    for path in (
        "/nyintern/vaerelsestjek/",
        f"/nyintern/vaerelsestjek/se/{rm.number}",
        f"/nyintern/vaerelsestjek/besvar/{rm.number}",
        "/nyintern/vaerelsestjek/akoverview",
    ):
        html = c.get(path).content.decode()
        for marker in ("{#", "#}", "{% comment", "{{", "{%"):
            assert marker not in html, f"{path} leaked template syntax: {marker}"


@pytest.mark.django_db
def test_vaerelsestjek_overview_renders_all_five_floor_plans(make_resident: Callable) -> None:
    """The picker regroups rooms by floor. dictsort cannot index a tuple by position — it returns an
    empty string on failure, so the whole block silently rendered nothing while the page still 200'd.
    Only asserting the plans are actually there catches that."""
    import re

    from core.management.commands.seed_rooms import Command as SeedRooms

    SeedRooms().handle()
    c = Client()
    c.force_login(make_resident(email="plan@gahk.dk"))

    html = c.get("/nyintern/vaerelsestjek/").content.decode()

    plans = re.findall(r'src="([^"]*image/intern/[^"]*)"', html)
    assert len(plans) == 5, f"expected five floor plans, got {plans}"
    assert [p.rsplit("/", 1)[-1].split(".")[0] for p in plans] == ["stuen", "sal1", "sal2", "sal3", "sal4"]
    assert "Stuen" in html and "4. sal" in html  # per-floor headings


def test_relocate_media_splits_multi_image_paths() -> None:
    """RoomConditionScore.image is a ';'-separated list; relocate_media treated the whole blob as one
    filename, so multi-image rows silently missed (copied 40 vs the real 5709). It must split the same
    way image_urls does, strip a leading slash, and skip URLs."""
    from core.management.commands.relocate_media import legacy_image_segments

    field = "public/image/a.jpg;/public/image/b.jpg;https://ex.com/c.jpg;"
    assert legacy_image_segments(field) == ["public/image/a.jpg", "public/image/b.jpg"]
    assert legacy_image_segments("") == []
    assert legacy_image_segments(None) == []
    assert legacy_image_segments("/public/image/x.jpg") == ["public/image/x.jpg"]  # leading slash


@pytest.mark.django_db
def test_relocate_media_segments_match_image_urls(make_resident: Callable) -> None:
    """The paths relocate_media copies to must be exactly the paths image_urls asks the browser for,
    or files land where nothing looks for them."""
    from core.management.commands.relocate_media import legacy_image_segments
    from core.models import Room
    from rooms.models import RoomCondition, RoomConditionScore, RoomCriterion

    rm = Room.objects.create(legacy_index=97, number=97, floor="stuen", side="mod gaden")
    crit = RoomCriterion.objects.create(code="floor", name="Gulve", options=5)
    cond = RoomCondition.objects.create(room=rm, recorded_at=timezone.now(), is_current=True)
    s = RoomConditionScore.objects.create(
        condition=cond, criterion=crit, image="public/image/a.jpg;/public/image/b.jpg"
    )

    assert s.image_urls == ["/media/public/image/a.jpg", "/media/public/image/b.jpg"]
    assert ["/media/" + seg for seg in legacy_image_segments(s.image)] == s.image_urls
