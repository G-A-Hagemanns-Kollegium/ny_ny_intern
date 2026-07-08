"""Regression tests codifying the security-critical behaviour verified during the build.

These lock in the fixes from the Phase-3 threat model so they can't regress: legacy-hash upgrade,
monthly roles, admissions email/CSRF rules, POS money integrity, and the front-page visit counter.
"""

import pytest
from django.contrib.auth.hashers import identify_hasher
from django.core import mail
from django.test import Client
from django.utils import timezone

from admissions.models import Application
from residents.models import Resident, Role, active_period


# ---------------------------------------------------------------- auth (F-014)
@pytest.mark.django_db
def test_legacy_sha256_upgrades_on_login(make_resident):
    make_resident(email="a@gahk.dk", password="hemmelig", legacy=True)
    c = Client()
    assert c.login(email="a@gahk.dk", password="hemmelig") is True
    r = Resident.objects.get(email="a@gahk.dk")
    assert identify_hasher(r.password).algorithm == "pbkdf2_sha256"  # upgraded


@pytest.mark.django_db
def test_monthly_role_is_time_bound(make_resident):
    r = make_resident(roles=[Role.AK])
    y, m = active_period()
    assert r.has_role(Role.AK, (y, m)) is True
    assert r.has_role(Role.AK, (y - 1, m)) is False
    assert r.has_role(Role.INDSTILLING, (y, m)) is False


# ---------------------------------------------------------------- admissions (F-001)
@pytest.mark.django_db
def test_rundvisning_emails_committee_and_applicant():
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
def test_fremleje_does_not_email_committee():
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
def test_mark_received_is_post_only_and_role_gated(make_resident):
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
def test_purchase_split_is_exact_and_atomic(make_resident):
    from oelkaelder.models import Product, Shopper
    from oelkaelder.services import record_purchase

    p = Product.objects.create(name="Øl", price_ore=1500)
    s1 = Shopper.objects.create(resident=make_resident(email="s1@gahk.dk"))
    s2 = Shopper.objects.create(resident=make_resident(email="s2@gahk.dk"))
    txn = record_purchase([s1.id, s2.id], {p.id: 3})  # 4500 øre / 2
    total = sum(sh.share_ore for sh in txn.shares.all())
    assert total == 4500
    assert s1.balance_ore + s2.balance_ore == -4500  # derived from the ledger


@pytest.mark.django_db
def test_my_balance_shows_account_statement(make_resident):
    from oelkaelder.models import Product, Shopper
    from oelkaelder.services import record_deposit, record_purchase

    p = Product.objects.create(name="Øl", price_ore=1500)
    r = make_resident(email="buyer@gahk.dk")
    s = Shopper.objects.create(resident=r)
    record_deposit(s, 5000)  # 50,00 kr credit
    record_purchase([s.id], {p.id: 2})  # 30,00 kr debit, all to this shopper

    c = Client()
    c.force_login(r)
    html = c.get("/nyintern/oelkaelder/min-saldo").content.decode()
    assert "Kontoudtog" in html
    assert "2× Øl" in html and "-30,00 kr" in html  # purchase debit (signed)
    assert "Indbetaling" in html and "50,00 kr" in html  # deposit credit


@pytest.mark.django_db
def test_application_list_shows_receiver(make_resident):
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
def test_cms_admin_is_gated_to_administrator(make_resident):
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
def test_cms_admin_sanitizes_html_on_save(make_resident):
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
def test_is_staff_synced_with_roles(make_resident):
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
def test_dashboard_shows_shared_calendar_credentials(make_resident, monkeypatch):
    monkeypatch.setenv("GOOGLE_CALENDAR_USER", "gahkkalender@gmail.com")
    monkeypatch.setenv("GOOGLE_CALENDAR_PASSWORD", "dummy-pw")
    c = Client()
    c.force_login(make_resident(email="d@gahk.dk"))
    h = c.get("/nyintern/").content.decode()
    assert "gahkkalender@gmail.com" in h and "dummy-pw" in h  # both shown to logged-in residents


@pytest.mark.django_db
def test_oelkaelder_kiosk_gate_uses_forwarded_ip():
    from django.test import override_settings

    with override_settings(DEBUG=False, OELKAELDER_KIOSK_IPS=["130.225.243.26"]):
        c = Client()
        # Traefik appends the real client IP as the last X-Forwarded-For hop.
        ok = c.get("/nyintern/oelkaelder/", HTTP_X_FORWARDED_FOR="130.225.243.26")
        assert ok.status_code == 200  # kiosk open from the dorm egress IP
        blocked = c.get("/nyintern/oelkaelder/", HTTP_X_FORWARDED_FOR="203.0.113.9")
        assert blocked.status_code == 403  # any other IP is denied


@pytest.mark.django_db
def test_media_files_are_served_in_prod():
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
def test_room_photo_over_max_is_rejected(make_resident):
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


def test_room_condition_image_url():
    from rooms.models import RoomConditionScore

    assert (
        RoomConditionScore(image="public/image/intern/roomimages/112/a.jpg").image_url
        == "/media/public/image/intern/roomimages/112/a.jpg"
    )
    assert RoomConditionScore(image="https://ex.com/y.jpg").image_url == "https://ex.com/y.jpg"
    assert RoomConditionScore(image="").image_url == ""


def test_body_media_rewrites_relative_and_absolute_legacy_urls():
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
def test_frontpage_counter_hashes_and_dedups():
    from stats.models import DailyVisitCount, VisitTally

    c = Client()
    c.get("/")
    c.get("/")  # same IP within the 30-min window → counted once
    assert VisitTally.objects.count() == 1
    assert VisitTally.objects.first().count == 1
    assert DailyVisitCount.objects.get(date=timezone.localdate()).count == 1
    assert len(VisitTally.objects.first().ip_hash) == 64  # HMAC-SHA256 hex, not a raw IP


@pytest.mark.django_db
def test_events_news_page_and_forside_teaser():
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
def test_statistik_renders_charts(make_resident):
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
def test_public_window_has_no_internal_tools():
    html = Client().get("/").content.decode()
    for label in ("Alumneliste", "AK-krydser", "Ølkælder-admin"):
        assert label not in html
