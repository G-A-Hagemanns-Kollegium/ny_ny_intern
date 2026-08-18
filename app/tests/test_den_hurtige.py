"""Den Hurtige: feed lifecycle, notification targeting, and the subscribe endpoint.

Push delivery is exercised without touching the network. Notification *targeting* is tested by
collapsing `services._run_in_background` to a direct call and swapping `services._dispatch` for a
recorder, so the assertions are about who would be notified. The delivery loop itself is tested
separately by stubbing `services._send`, the single place that calls pywebpush.
"""

import base64
import json
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.conf import settings as django_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import Client, RequestFactory
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from pywebpush import WebPushException

from den_hurtige import access, services
from den_hurtige.checks import check_vapid_public_key
from den_hurtige.models import (
    QUICK_EMOJI,
    PushSubscription,
    QuickComment,
    QuickPost,
    QuickReaction,
)
from den_hurtige.views import posts_for, reactions_for
from residents.models import Resident, Role

FEED_URL = "/nyintern/den-hurtige/"

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def rollout_open(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lift the staged-rollout gate for the whole module.

    Den Hurtige is limited to the administrator group while it is trialled
    (den_hurtige.access.ACCESS_ROLES), but that restriction is temporary and every test outside the
    "staged rollout" section is about behaviour that outlives it. Without this they would all have
    to hand their residents an administrator role, which would quietly stop them testing what a
    normal resident experiences. The rollout tests re-enable the gate via `rollout_limited`.
    """
    monkeypatch.setattr(access, "ACCESS_ROLES", None)


@pytest.fixture
def rollout_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    """Restore the trial gate — runs after the autouse fixture, so it wins."""
    monkeypatch.setattr(access, "ACCESS_ROLES", (Role.ADMINISTRATOR,))


def subscribe(user: Resident, endpoint: str) -> PushSubscription:
    """Register a fake device for `user`."""
    return PushSubscription.objects.create(
        user=user, endpoint=endpoint, auth="a" * 22, p256dh="p" * 87, user_agent="pytest"
    )


@pytest.fixture
def pushes(monkeypatch: pytest.MonkeyPatch, settings: object) -> list[tuple[list[int], dict]]:
    """Records (recipient user ids, payload) for every notification the code would send."""
    settings.VAPID_PUBLIC_KEY = "test-public-key"  # type: ignore[attr-defined]
    settings.VAPID_PRIVATE_KEY = "test-private-key"  # type: ignore[attr-defined]
    recorded: list[tuple[list[int], dict]] = []

    def fake_dispatch(subscriptions: object, payload: dict) -> int:
        ids = sorted(subscriptions.values_list("user_id", flat=True))  # type: ignore[attr-defined]
        recorded.append((ids, payload))
        return len(ids)

    monkeypatch.setattr(services, "_dispatch", fake_dispatch)
    monkeypatch.setattr(services, "_run_in_background", lambda fn: fn())
    return recorded


# --- PWA plumbing -------------------------------------------------------------------------------


def test_service_worker_is_served_from_the_site_root(client: Client) -> None:
    """A service worker's scope is capped at its own directory, so only a root-served /sw.js can
    receive pushes for /nyintern/. Also proves the CMS slug catch-all does not swallow the path."""
    response = client.get("/sw.js")

    assert response.status_code == 200
    assert response["Content-Type"] == "application/javascript"
    body = response.content.decode()
    assert "addEventListener('push'" in body
    assert "{%" not in body and "{{" not in body  # unrendered template syntax would break the worker


def test_manifest_points_at_the_feed_and_ships_every_icon_it_references() -> None:
    """The manifest is hand-maintained JSON that nothing else validates: a start_url outside `scope`
    or a missing icon file makes browsers refuse to install the app, with no server-side error."""
    static_dir = Path(django_settings.BASE_DIR) / "static"
    manifest = json.loads((static_dir / "manifest.json").read_text(encoding="utf-8"))

    assert manifest["start_url"] == FEED_URL
    assert FEED_URL.startswith(manifest["scope"])
    assert {icon["purpose"] for icon in manifest["icons"]} >= {"any", "maskable"}
    for icon in manifest["icons"]:
        assert (static_dir / icon["src"].removeprefix("/static/")).is_file(), icon["src"]


def _vapid_pair() -> tuple[str, str]:
    """A throwaway P-256 pair in the raw base64url form the app expects. Generated rather than
    hardcoded so the tests never carry key material, real or otherwise."""
    key = ec.generate_private_key(ec.SECP256R1())
    b64 = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b"=").decode()  # noqa: E731
    point = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return b64(point), b64(key.private_numbers().private_value.to_bytes(32, "big"))


GOOD_PUBLIC, GOOD_PRIVATE = _vapid_pair()
OTHER_PUBLIC, OTHER_PRIVATE = _vapid_pair()
# 65 bytes with the right 0x04 tag, but the coordinates are not on the curve. Passes a pure shape
# check and is then rejected by the browser's push service as an opaque failure.
OFF_CURVE = base64.urlsafe_b64encode(b"\x04" + b"\x01" * 64).rstrip(b"=").decode()
# The body of a public_key.pem — SPKI DER, not the raw point. The most tempting wrong value.
SPKI_DER = (
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEgoXFqQdn2xSbAJlFjidkDqZ50LpS"
    "7q7l91RkEPpL3e6yazihJmXw6JUEGTQROvV0MowPIRtZUXkRfP1XIf_R8g=="
)


@pytest.mark.parametrize(
    ("public_key", "private_key", "expected_id"),
    [
        (GOOD_PUBLIC, GOOD_PRIVATE, None),
        ("", "", None),  # unset: push disabled on purpose, not an error
        ("not base64!!", GOOD_PRIVATE, "den_hurtige.E001"),
        (SPKI_DER, GOOD_PRIVATE, "den_hurtige.E002"),
        (GOOD_PUBLIC, "", "den_hurtige.E003"),
        (OFF_CURVE, GOOD_PRIVATE, "den_hurtige.E004"),
        (GOOD_PUBLIC, "tooshort", "den_hurtige.E005"),
        # Regenerating the pair and updating only one env var — silent, and fatal to every push.
        (GOOD_PUBLIC, OTHER_PRIVATE, "den_hurtige.E006"),
    ],
)
def test_vapid_configuration_is_validated_at_startup(
    settings: object, public_key: str, private_key: str, expected_id: str | None
) -> None:
    """A wrong key pair is invisible server-side — the page renders, the button appears, and only
    the browser objects, as a generic failure. `manage.py check` has to be what catches it."""
    settings.VAPID_PUBLIC_KEY = public_key  # type: ignore[attr-defined]
    settings.VAPID_PRIVATE_KEY = private_key  # type: ignore[attr-defined]

    errors = check_vapid_public_key(None)

    assert [e.id for e in errors] == ([expected_id] if expected_id else [])


# --- staged rollout ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    ["", "opret", "1/kommentar", "1/slet", "1/reaktion", "abonner"],
)
def test_every_endpoint_is_closed_to_non_administrators(
    client: Client, make_resident: Callable[..., Resident], rollout_limited: None, path: str
) -> None:
    """While ACCESS_ROLES is set, a plain resident must not reach any of it — not just the page.
    Parametrised over every route so a new view cannot quietly be added outside the gate."""
    client.force_login(make_resident(email="beboer@gahk.dk"))

    url = FEED_URL + path
    response = client.get(url) if path == "" else client.post(url)

    assert response.status_code == 403


def test_administrators_get_in(
    client: Client, make_resident: Callable[..., Resident], rollout_limited: None
) -> None:
    client.force_login(make_resident(email="admin@gahk.dk", roles=(Role.ADMINISTRATOR,)))

    response = client.get(FEED_URL)

    assert response.status_code == 200
    assert "Under test" in response.content.decode()  # testers are told it is not live yet


def test_the_poll_stays_quiet_for_non_administrators(
    client: Client, make_resident: Callable[..., Resident], rollout_limited: None
) -> None:
    """204 rather than 403: htmx would swap a 403 body into the feed. Still leaks nothing."""
    author = make_resident(email="admin@gahk.dk", roles=(Role.ADMINISTRATOR,))
    QuickPost.objects.create(author=author, content="Hemmelig testbesked")
    client.force_login(make_resident(email="beboer@gahk.dk"))

    response = client.get(FEED_URL + "opslag")

    assert response.status_code == 204
    assert b"Hemmelig testbesked" not in response.content


def test_the_sidebar_only_advertises_the_page_to_those_who_can_open_it(
    client: Client, make_resident: Callable[..., Resident], rollout_limited: None
) -> None:
    """A visible link that answers 403 is worse than no link."""
    client.force_login(make_resident(email="beboer@gahk.dk"))
    assert FEED_URL not in client.get("/nyintern/").content.decode()

    client.force_login(make_resident(email="admin@gahk.dk", roles=(Role.ADMINISTRATOR,)))
    assert FEED_URL in client.get("/nyintern/").content.decode()


def test_clearing_access_roles_opens_it_to_every_resident(
    client: Client,
    make_resident: Callable[..., Resident],
    rollout_limited: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The documented way to end the rollout is ACCESS_ROLES = None. Asserted end to end so the
    switch cannot rot: the roles are read per request, not bound when the views are imported, so
    flipping the constant is genuinely all it takes."""
    client.force_login(make_resident(email="beboer@gahk.dk"))
    assert client.get(FEED_URL).status_code == 403  # gate on

    monkeypatch.setattr(access, "ACCESS_ROLES", None)  # the one documented edit

    assert client.get(FEED_URL).status_code == 200
    assert client.get(FEED_URL + "opslag").status_code == 200
    assert FEED_URL in client.get("/nyintern/").content.decode()  # and the sidebar follows


def test_preview_as_a_plain_resident_is_locked_out(
    client: Client, make_resident: Callable[..., Resident], rollout_limited: None
) -> None:
    """The gate reads *effective* roles, so an admin previewing as a beboer sees what a beboer sees
    — which is the whole point of the preview tool during a staged rollout."""
    admin = make_resident(email="admin@gahk.dk", roles=(Role.ADMINISTRATOR,))
    client.force_login(admin)
    session = client.session
    session["preview_roles"] = []
    session.save()

    assert client.get(FEED_URL).status_code == 403


# --- feed & lifecycle -------------------------------------------------------------------------


def test_feed_requires_login(client: Client) -> None:
    response = client.get(FEED_URL)
    assert response.status_code == 302
    assert "/nyintern/admin/login" in response["Location"]


def test_feed_purges_expired_posts(client: Client, make_resident: Callable[..., Resident]) -> None:
    user = make_resident(email="a@gahk.dk")
    stale = QuickPost.objects.create(
        author=user, content="Kaffe for en time siden", expires_at=timezone.now() - timedelta(minutes=1)
    )
    fresh = QuickPost.objects.create(author=user, content="Kaffe i køkkenet nu")

    client.force_login(user)
    body = client.get(FEED_URL).content.decode()

    assert not QuickPost.objects.filter(pk=stale.pk).exists()  # hard-deleted, not just hidden
    assert QuickPost.objects.filter(pk=fresh.pk).exists()
    assert "Kaffe i køkkenet nu" in body
    assert "Kaffe for en time siden" not in body


def test_purge_expired_reports_post_count_not_cascaded_rows(
    make_resident: Callable[..., Resident],
) -> None:
    user = make_resident(email="a@gahk.dk")
    post = QuickPost.objects.create(
        author=user, content="udløbet", expires_at=timezone.now() - timedelta(minutes=1)
    )
    QuickComment.objects.create(post=post, author=user, content="en kommentar")

    assert QuickPost.objects.purge_expired() == 1  # not 2 (the comment cascades with it)


def test_create_post_honours_the_chosen_duration(
    client: Client, make_resident: Callable[..., Resident], pushes: list
) -> None:
    user = make_resident(email="a@gahk.dk")
    client.force_login(user)

    client.post(FEED_URL + "opret", {"content": "Fælles opvask", "duration": "120"})

    post = QuickPost.objects.get()
    assert 118 <= post.minutes_left <= 120


def test_create_post_rejects_an_unknown_duration(
    client: Client, make_resident: Callable[..., Resident], pushes: list
) -> None:
    user = make_resident(email="a@gahk.dk")
    client.force_login(user)

    client.post(FEED_URL + "opret", {"content": "Fest", "duration": "99999"})

    assert QuickPost.objects.get().minutes_left <= 60  # clamped back to the default


def test_create_post_stores_an_attached_image(
    client: Client, make_resident: Callable[..., Resident], pushes: list, settings: object, tmp_path: Path
) -> None:
    """MEDIA_ROOT is redirected at the tmp dir: the happy path actually writes a file, and the repo's
    app/media/ is not a dumping ground for test uploads."""
    settings.MEDIA_ROOT = tmp_path  # type: ignore[attr-defined]
    user = make_resident(email="a@gahk.dk")
    client.force_login(user)
    image = SimpleUploadedFile("kaffe.jpg", b"\xff\xd8\xff" + b"x" * 512, content_type="image/jpeg")

    client.post(FEED_URL + "opret", {"content": "Se her", "duration": "60", "image": image})

    post = QuickPost.objects.get()
    assert post.image.name.startswith("quick_posts/")
    assert post.image.read() == b"\xff\xd8\xff" + b"x" * 512
    assert (tmp_path / post.image.name).is_file()


@pytest.mark.parametrize("remove", ["expire", "delete"])
def test_an_attached_image_is_erased_with_its_post(
    make_resident: Callable[..., Resident], settings: object, tmp_path: Path, remove: str
) -> None:
    """The feature promises posts disappear. Django has not deleted FileField files on row delete
    since 1.3, so without the post_delete receiver the text would expire on schedule while the photo
    stayed on disk forever. Both removal paths are covered: purge_expired() issues a *bulk* delete
    that never calls Model.delete(), so it is the one most likely to leak."""
    settings.MEDIA_ROOT = tmp_path  # type: ignore[attr-defined]
    user = make_resident(email="a@gahk.dk")
    post = QuickPost.objects.create(
        author=user,
        content="Se her",
        image=SimpleUploadedFile("k.jpg", b"jpegbytes", content_type="image/jpeg"),
    )
    stored = tmp_path / post.image.name
    assert stored.is_file()

    if remove == "expire":
        QuickPost.objects.filter(pk=post.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        QuickPost.objects.purge_expired()
    else:
        post.delete()

    assert not stored.exists(), "the image outlived its post"


@pytest.mark.parametrize(
    ("filename", "content_type", "max_mb", "reason"),
    [
        ("evil.pdf", "application/pdf", 5, "not an image"),
        ("huge.jpg", "image/jpeg", 0, "over the size cap"),  # cap 0 → any file is too big
    ],
)
def test_create_post_drops_a_bad_image_but_keeps_the_message(
    client: Client,
    make_resident: Callable[..., Resident],
    pushes: list,
    settings: object,
    tmp_path: Path,
    filename: str,
    content_type: str,
    max_mb: int,
    reason: str,
) -> None:
    """A rejected attachment must not take the post down with it — the text is the point, the image
    is a nicety, and re-typing an urgent message because a file was wrong is the worst outcome."""
    settings.MEDIA_ROOT = tmp_path  # type: ignore[attr-defined]
    settings.QUICK_POST_MAX_MB = max_mb  # type: ignore[attr-defined]
    user = make_resident(email="a@gahk.dk")
    client.force_login(user)
    upload = SimpleUploadedFile(filename, b"x" * 2048, content_type=content_type)

    response = client.post(
        FEED_URL + "opret", {"content": "Vigtig besked", "duration": "60", "image": upload}, follow=True
    )

    post = QuickPost.objects.get()
    assert post.content == "Vigtig besked"
    assert not post.image, f"{reason}: the file should not have been stored"
    assert not any(tmp_path.rglob("*")), "nothing should have been written to MEDIA_ROOT"
    assert any("blev ikke gemt" in str(m) for m in response.context["messages"])


def test_delete_post_is_author_or_administrator_only(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    author = make_resident(email="a@gahk.dk")
    other = make_resident(email="b@gahk.dk")
    admin = make_resident(email="c@gahk.dk", roles=(Role.ADMINISTRATOR,))
    post = QuickPost.objects.create(author=author, content="mit opslag")

    client.force_login(other)
    assert client.post(f"{FEED_URL}{post.pk}/slet").status_code == 403
    assert QuickPost.objects.filter(pk=post.pk).exists()

    client.force_login(admin)
    assert client.post(f"{FEED_URL}{post.pk}/slet").status_code == 302
    assert not QuickPost.objects.filter(pk=post.pk).exists()


def test_den_hurtige_pages_leak_no_template_syntax(
    client: Client, make_resident: Callable[..., Resident], settings: object
) -> None:
    """Django's {# … #} is single-line only; a multi-line one renders verbatim onto the page. This
    has bitten base.html and both feed templates already — assert every Den Hurtige surface is
    clean, with content present so the post/comment branches actually render."""
    settings.VAPID_PUBLIC_KEY = GOOD_PUBLIC  # type: ignore[attr-defined]
    settings.VAPID_PRIVATE_KEY = GOOD_PRIVATE  # type: ignore[attr-defined]
    author = make_resident(email="a@gahk.dk")
    post = QuickPost.objects.create(author=author, content="Kaffe i køkkenet")
    QuickComment.objects.create(post=post, author=author, content="Jeg kommer")
    client.force_login(author)

    for path in (FEED_URL, FEED_URL + "opslag"):
        body = client.get(path).content.decode()
        assert "Kaffe i køkkenet" in body, f"{path} rendered no posts — the check would be vacuous"
        for leaked in ("{#", "#}", "{%", "%}", "{{", "}}"):
            assert leaked not in body, f"{path} leaked {leaked!r}"


def test_the_poll_resolves_roles_once_per_request(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    """The access gate, the sidebar's effective_roles and can_preview all ask for the role set. Each
    used to hit the DB, so this endpoint — which every open tab calls every 20 seconds — cost three
    RoleAssignment queries and three active_period lookups. residents.permissions.real_roles now
    memoises per request; this pins that down, since the regression would be silent."""
    author = make_resident(email="a@gahk.dk")
    QuickPost.objects.create(author=author, content="Kaffe")
    client.force_login(author)
    client.get(FEED_URL + "opslag")  # warm any one-off caches

    with CaptureQueriesContext(connection) as captured:
        client.get(FEED_URL + "opslag")

    sql = [q["sql"] for q in captured.captured_queries]
    assert sum("residents_roleassignment" in s for s in sql) == 1
    assert sum("residents_residency" in s for s in sql) == 1


def test_feed_items_returns_only_the_post_list(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    """The poll target is a fragment, not a page — swapping a full document into #js-feed would
    nest a second <html> and a second compose form inside the feed."""
    user = make_resident(email="a@gahk.dk")
    QuickPost.objects.create(author=user, content="Kaffe i køkkenet")
    client.force_login(user)

    body = client.get(FEED_URL + "opslag").content.decode()

    assert "Kaffe i køkkenet" in body
    assert "<html" not in body
    assert "Slå op" not in body  # the compose form lives outside the polled region


def test_feed_items_picks_up_a_post_made_after_the_page_loaded(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    reader = make_resident(email="a@gahk.dk")
    poster = make_resident(email="b@gahk.dk")
    client.force_login(reader)
    assert "Fest i kælderen" not in client.get(FEED_URL).content.decode()

    QuickPost.objects.create(author=poster, content="Fest i kælderen")

    assert "Fest i kælderen" in client.get(FEED_URL + "opslag").content.decode()


def test_feed_items_expires_posts_live(client: Client, make_resident: Callable[..., Resident]) -> None:
    user = make_resident(email="a@gahk.dk")
    QuickPost.objects.create(author=user, content="udløbet", expires_at=timezone.now() - timedelta(minutes=1))
    client.force_login(user)

    body = client.get(FEED_URL + "opslag").content.decode()

    assert "udløbet" not in body
    assert not QuickPost.objects.exists()  # the poll purges too, so the feed drains itself


def test_feed_items_returns_204_for_an_expired_session(client: Client) -> None:
    """htmx follows redirects, so @login_required here would swap the login page into the feed.
    204 means 'no update' and leaks nothing."""
    response = client.get(FEED_URL + "opslag")

    assert response.status_code == 204
    assert response.content == b""


# --- notification targeting -------------------------------------------------------------------


def test_new_post_notifies_subscribers_except_the_author(
    client: Client, make_resident: Callable[..., Resident], pushes: list
) -> None:
    author = make_resident(email="a@gahk.dk")
    other = make_resident(email="b@gahk.dk")
    subscribe(author, "https://push.example/author")
    subscribe(other, "https://push.example/other")

    client.force_login(author)
    client.post(FEED_URL + "opret", {"content": "Der er kage i køkkenet", "duration": "60"})

    (recipients, payload) = pushes[0]
    assert recipients == [other.pk]
    assert "Der er kage i køkkenet" in payload["body"]
    assert payload["url"] == FEED_URL


def test_comment_notifies_only_the_original_poster_by_default(
    client: Client, make_resident: Callable[..., Resident], pushes: list
) -> None:
    author = make_resident(email="a@gahk.dk")
    commenter = make_resident(email="b@gahk.dk")
    bystander = make_resident(email="c@gahk.dk")
    for user in (author, commenter, bystander):
        subscribe(user, f"https://push.example/{user.pk}")
    post = QuickPost.objects.create(author=author, content="Nogen der har en boremaskine?")

    client.force_login(commenter)
    client.post(f"{FEED_URL}{post.pk}/kommentar", {"content": "Ja, kom forbi 42", "notify": "op"})

    (recipients, _payload) = pushes[0]
    assert recipients == [author.pk]


def test_comment_can_notify_everyone_except_the_commenter(
    client: Client, make_resident: Callable[..., Resident], pushes: list
) -> None:
    author = make_resident(email="a@gahk.dk")
    commenter = make_resident(email="b@gahk.dk")
    bystander = make_resident(email="c@gahk.dk")
    for user in (author, commenter, bystander):
        subscribe(user, f"https://push.example/{user.pk}")
    post = QuickPost.objects.create(author=author, content="Fest i kælderen?")

    client.force_login(commenter)
    client.post(f"{FEED_URL}{post.pk}/kommentar", {"content": "Ja! Kl 21", "notify": "alle"})

    (recipients, _payload) = pushes[0]
    assert recipients == sorted([author.pk, bystander.pk])


def test_commenting_on_your_own_post_notifies_nobody(
    client: Client, make_resident: Callable[..., Resident], pushes: list
) -> None:
    author = make_resident(email="a@gahk.dk")
    subscribe(make_resident(email="b@gahk.dk"), "https://push.example/other")
    post = QuickPost.objects.create(author=author, content="Kaffe kl 15")

    client.force_login(author)
    client.post(f"{FEED_URL}{post.pk}/kommentar", {"content": "Rettelse: kl 16", "notify": "op"})

    assert pushes == []  # the only candidate recipient would have been the commenter


def test_nothing_is_sent_when_vapid_keys_are_missing(
    client: Client, make_resident: Callable[..., Resident], pushes: list, settings: object
) -> None:
    settings.VAPID_PUBLIC_KEY = ""  # type: ignore[attr-defined]
    settings.VAPID_PRIVATE_KEY = ""  # type: ignore[attr-defined]
    author = make_resident(email="a@gahk.dk")
    subscribe(make_resident(email="b@gahk.dk"), "https://push.example/other")

    client.force_login(author)
    client.post(FEED_URL + "opret", {"content": "Hej", "duration": "60"})

    assert pushes == []


# --- delivery loop ------------------------------------------------------------------------------


def _raiser(status: int | None) -> WebPushException:
    """A WebPushException carrying `status`, or one with response=None as pywebpush raises for a
    connection-level failure — the case that makes a bare `exc.response.status_code` blow up."""
    if status is None:
        return WebPushException("connection refused")
    return WebPushException("failed", response=type("Response", (), {"status_code": status})())


def test_dispatch_drops_a_gone_subscription_and_keeps_going(
    monkeypatch: pytest.MonkeyPatch, make_resident: Callable[..., Resident]
) -> None:
    """A 410 endpoint must be deleted, and must not cost the later recipients their notification."""
    dead = subscribe(make_resident(email="a@gahk.dk"), "https://push.example/dead")
    alive = subscribe(make_resident(email="b@gahk.dk"), "https://push.example/alive")
    seen: list[str] = []

    def fake_send(subscription: PushSubscription, body: str) -> None:
        seen.append(subscription.endpoint)
        if subscription.endpoint.endswith("dead"):
            raise _raiser(410)

    monkeypatch.setattr(services, "_send", fake_send)

    sent = services._dispatch(services.subscribers().order_by("pk"), {"head": "h", "body": "b"})

    assert seen == ["https://push.example/dead", "https://push.example/alive"]
    assert sent == 1
    assert not PushSubscription.objects.filter(pk=dead.pk).exists()
    assert PushSubscription.objects.filter(pk=alive.pk).exists()


@pytest.mark.parametrize("status", [503, None])
def test_dispatch_keeps_a_subscription_that_failed_transiently(
    monkeypatch: pytest.MonkeyPatch, make_resident: Callable[..., Resident], status: int | None
) -> None:
    """A server error or a dropped connection is not evidence the endpoint is gone — keep the row so
    the next post retries it."""
    kept = subscribe(make_resident(email="a@gahk.dk"), "https://push.example/flaky")

    def fake_send(subscription: PushSubscription, body: str) -> None:
        raise _raiser(status)

    monkeypatch.setattr(services, "_send", fake_send)

    assert services._dispatch(services.subscribers(), {"head": "h", "body": "b"}) == 0
    assert PushSubscription.objects.filter(pk=kept.pk).exists()


def test_dispatch_sends_the_payload_as_json(
    monkeypatch: pytest.MonkeyPatch, make_resident: Callable[..., Resident]
) -> None:
    """sw.js parses the body with event.data.json(), so it must arrive as a JSON string."""
    subscribe(make_resident(email="a@gahk.dk"), "https://push.example/one")
    bodies: list[str] = []
    monkeypatch.setattr(services, "_send", lambda sub, body: bodies.append(body))

    services._dispatch(services.subscribers(), {"head": "Hej", "body": "kaffe", "url": FEED_URL})

    assert json.loads(bodies[0]) == {"head": "Hej", "body": "kaffe", "url": FEED_URL}


# --- subscribe endpoint -------------------------------------------------------------------------


def _subscribe_body(**extra: object) -> str:
    payload = {
        "status_type": "subscribe",
        "subscription": {
            "endpoint": "https://fcm.googleapis.com/fcm/send/abc",
            "keys": {"auth": "a" * 22, "p256dh": "p" * 87},
        },
        "user_agent": "pytest",
    }
    payload.update(extra)
    return json.dumps(payload)


def test_subscribe_requires_login(client: Client) -> None:
    response = client.post(FEED_URL + "abonner", data=_subscribe_body(), content_type="application/json")
    assert response.status_code == 302
    assert "/nyintern/admin/login" in response["Location"]


def test_subscribe_binds_the_device_to_the_logged_in_user(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    """The audience comes from the session, never the request body — django-webpush's endpoint took
    a group name from the payload, so anyone could have joined the dorm's notification list."""
    user = make_resident(email="a@gahk.dk")
    client.force_login(user)

    response = client.post(
        FEED_URL + "abonner", data=_subscribe_body(user="somebody-else"), content_type="application/json"
    )

    assert response.status_code == 201
    subscription = PushSubscription.objects.get()
    assert subscription.user_id == user.pk
    assert subscription.endpoint == "https://fcm.googleapis.com/fcm/send/abc"


def test_resubscribing_the_same_device_updates_rather_than_duplicates(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    """The endpoint is the device identity. django-webpush keyed on every field, so a browser that
    merely changed its user-agent string silently produced a second row and a double notification."""
    first = make_resident(email="a@gahk.dk")
    second = make_resident(email="b@gahk.dk")

    client.force_login(first)
    client.post(FEED_URL + "abonner", data=_subscribe_body(), content_type="application/json")
    client.force_login(second)  # same browser, different resident logs in
    client.post(
        FEED_URL + "abonner", data=_subscribe_body(user_agent="pytest/2"), content_type="application/json"
    )

    subscription = PushSubscription.objects.get()  # exactly one row, not two
    assert subscription.user_id == second.pk  # and it no longer pushes to the previous owner
    assert subscription.user_agent == "pytest/2"


def test_unsubscribe_removes_the_device(client: Client, make_resident: Callable[..., Resident]) -> None:
    user = make_resident(email="a@gahk.dk")
    client.force_login(user)
    client.post(FEED_URL + "abonner", data=_subscribe_body(), content_type="application/json")

    response = client.post(
        FEED_URL + "abonner",
        data=_subscribe_body(status_type="unsubscribe"),
        content_type="application/json",
    )

    assert response.status_code == 202
    assert not PushSubscription.objects.exists()


def test_unsubscribe_cannot_remove_another_residents_device(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    """Endpoints are guessable-ish strings that travel in push traffic; deleting must be scoped to
    the requesting user so a replayed endpoint cannot silence someone else's phone."""
    owner = make_resident(email="a@gahk.dk")
    attacker = make_resident(email="b@gahk.dk")
    client.force_login(owner)
    client.post(FEED_URL + "abonner", data=_subscribe_body(), content_type="application/json")

    client.force_login(attacker)
    response = client.post(
        FEED_URL + "abonner",
        data=_subscribe_body(status_type="unsubscribe"),
        content_type="application/json",
    )

    assert response.status_code == 202  # nothing to report to the caller
    assert PushSubscription.objects.filter(user=owner).exists()  # but the owner's device survives


@pytest.mark.parametrize(
    "body",
    ["not json", json.dumps(["a", "list"]), json.dumps({"status_type": "nonsense"})],
)
def test_subscribe_rejects_malformed_payloads(
    client: Client, make_resident: Callable[..., Resident], body: str
) -> None:
    client.force_login(make_resident(email="a@gahk.dk"))
    response = client.post(FEED_URL + "abonner", data=body, content_type="application/json")
    assert response.status_code == 400


# --- emoji reactions -----------------------------------------------------------------------------

THUMB = "\U0001f44d"
PARTY = "\U0001f389"


def react(client: Client, post: QuickPost, emoji: str) -> object:
    return client.post(f"{FEED_URL}{post.pk}/reaktion", {"emoji": emoji})


def test_a_reaction_toggles_off_when_tapped_again(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    """The unique constraint is what makes this a toggle rather than a counter: tapping your own
    emoji again removes it instead of adding a second row."""
    user = make_resident(email="a@gahk.dk")
    post = QuickPost.objects.create(author=user, content="Kaffe")
    client.force_login(user)

    react(client, post, THUMB)
    assert QuickReaction.objects.count() == 1

    react(client, post, THUMB)
    assert QuickReaction.objects.count() == 0


def test_reactions_count_per_emoji_and_flag_your_own(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    """Counts are per emoji across people; `mine` is what makes your own pill render active."""
    author = make_resident(email="a@gahk.dk")
    other = make_resident(email="b@gahk.dk")
    third = make_resident(email="c@gahk.dk")
    post = QuickPost.objects.create(author=author, content="Fest i kaelderen")

    client.force_login(author)
    react(client, post, THUMB)
    client.force_login(third)
    react(client, post, PARTY)
    client.force_login(other)
    response = react(client, post, THUMB)  # a third person, same emoji as the author

    rows = {r["emoji"]: r for r in reactions_for(post, other.pk)}
    assert rows[THUMB]["count"] == 2
    assert rows[PARTY]["count"] == 1
    assert rows[THUMB]["mine"] is True  # `other` used this one
    assert rows[PARTY]["mine"] is False  # ...but not this one
    assert b"<html" not in response.content  # a fragment, not a whole page


@pytest.mark.parametrize(
    "emoji",
    [
        "LOL",
        "123",
        "",
        "x" * 80,
        "<b>hi</b>",
        THUMB + " ok",  # an emoji smuggling text alongside it
    ],
)
def test_only_emoji_are_accepted_as_reactions(
    client: Client, make_resident: Callable[..., Resident], emoji: str
) -> None:
    """Allowing any emoji means arbitrary text reaches the database, so the validator is a real
    gate rather than a formality."""
    user = make_resident(email="a@gahk.dk")
    post = QuickPost.objects.create(author=user, content="Kaffe")
    client.force_login(user)

    react(client, post, emoji)

    assert not QuickReaction.objects.exists()


@pytest.mark.parametrize(
    "emoji",
    [
        THUMB,
        "\U0001f469\u200d\U0001f467",  # ZWJ sequence
        "\U0001f44d\U0001f3fd",  # skin-tone modifier
        "\u2764\ufe0f",  # VS16 presentation selector
    ],
)
def test_real_emoji_are_accepted(client: Client, make_resident: Callable[..., Resident], emoji: str) -> None:
    """Plain, ZWJ-joined, skin-toned and VS16 forms all have to get through."""
    user = make_resident(email="a@gahk.dk")
    post = QuickPost.objects.create(author=user, content="Kaffe")
    client.force_login(user)

    react(client, post, emoji)

    assert QuickReaction.objects.get().emoji == emoji


def test_reacting_notifies_nobody(
    client: Client, make_resident: Callable[..., Resident], pushes: list
) -> None:
    """Reactions are deliberately silent: a dorm-wide feed where every thumbs-up buzzes every phone
    is the noise this feature exists to remove."""
    author = make_resident(email="a@gahk.dk")
    reactor = make_resident(email="b@gahk.dk")
    subscribe(author, "https://push.example/author")
    post = QuickPost.objects.create(author=author, content="Kaffe")

    client.force_login(reactor)
    react(client, post, THUMB)

    assert pushes == []


def test_reactions_die_with_their_post(client: Client, make_resident: Callable[..., Resident]) -> None:
    user = make_resident(email="a@gahk.dk")
    post = QuickPost.objects.create(author=user, content="Kaffe")
    client.force_login(user)
    react(client, post, THUMB)

    QuickPost.objects.filter(pk=post.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
    QuickPost.objects.purge_expired()

    assert not QuickReaction.objects.exists()


# --- chat layout ---------------------------------------------------------------------------------


def test_the_feed_reads_oldest_first(client: Client, make_resident: Callable[..., Resident]) -> None:
    """Chat order: the newest message sits next to the composer at the bottom. The model's own
    ordering stays newest-first for the admin, so this is asserted on the rendered page."""
    user = make_resident(email="a@gahk.dk")
    first = QuickPost.objects.create(author=user, content="Foerste besked")
    second = QuickPost.objects.create(author=user, content="Anden besked")
    client.force_login(user)

    body = client.get(FEED_URL).content.decode()

    assert body.index("Foerste besked") < body.index("Anden besked")
    assert list(QuickPost.objects.all()) == [second, first]  # admin still sees newest-first


def test_consecutive_messages_from_one_person_are_grouped(
    make_resident: Callable[..., Resident],
) -> None:
    """Without grouping a short back-and-forth renders as a stack of cards — the forum look this
    redesign removes."""
    author = make_resident(email="a@gahk.dk")
    other = make_resident(email="b@gahk.dk")
    QuickPost.objects.create(author=author, content="Foerst")
    QuickPost.objects.create(author=author, content="Og saa")  # same author, seconds apart
    QuickPost.objects.create(author=other, content="Svar")  # a different author breaks the group

    request = RequestFactory().get(FEED_URL)
    request.user = author

    assert [p.grouped for p in posts_for(request)] == [False, True, False]


def test_the_feed_costs_no_extra_query_per_reaction(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    """Reactions are counted in Python over a prefetch. A per-post aggregate would be an N+1 on a
    page that re-renders itself every 20 seconds."""
    user = make_resident(email="a@gahk.dk")
    client.force_login(user)
    for n in range(3):
        post = QuickPost.objects.create(author=user, content=f"Besked {n}")
        react(client, post, THUMB)
    client.get(FEED_URL + "opslag")  # warm

    with CaptureQueriesContext(connection) as captured:
        client.get(FEED_URL + "opslag")

    hits = [q for q in captured.captured_queries if "den_hurtige_quickreaction" in q["sql"]]
    assert len(hits) == 1, "one prefetch for the whole page, not one query per message"


def test_a_message_notification_is_titled_with_the_sender(
    client: Client, make_resident: Callable[..., Resident], pushes: list
) -> None:
    """Every platform already labels a notification with the app it came from — iOS renders
    "from Den Hurtige" under the title, taken from the manifest name. Repeating it in the title
    spent the most valuable line on the lock screen saying nothing, and pushed who-said-what into
    the body. Sender in the title, message in the body, as in any chat app."""
    author = make_resident(email="a@gahk.dk", first_name="Magnus", last_name="Pedersen")
    subscribe(make_resident(email="b@gahk.dk"), "https://push.example/other")

    client.force_login(author)
    client.post(FEED_URL + "opret", {"content": "Hello, world", "duration": "60"})

    (_recipients, payload) = pushes[0]
    assert payload["head"] == "Magnus Pedersen"
    assert payload["body"] == "Hello, world"
    # The two halves of the redundancy that made this look wrong on the phone:
    assert "Den Hurtige" not in payload["head"]
    assert "Magnus Pedersen" not in payload["body"]


def test_a_reply_notification_says_who_replied(
    client: Client, make_resident: Callable[..., Resident], pushes: list
) -> None:
    """A reply still has to be distinguishable from a new message, but "svarede" carries that
    without naming the app again."""
    author = make_resident(email="a@gahk.dk")
    commenter = make_resident(email="b@gahk.dk", first_name="Magnus", last_name="Pedersen")
    subscribe(author, "https://push.example/author")
    post = QuickPost.objects.create(author=author, content="Kaffe")

    client.force_login(commenter)
    client.post(f"{FEED_URL}{post.pk}/kommentar", {"content": "Hello, world", "notify": "op"})

    (_recipients, payload) = pushes[0]
    assert payload["head"] == "Magnus Pedersen svarede"
    assert payload["body"] == "Hello, world"
    assert "Den Hurtige" not in payload["head"]


def test_posting_shows_no_confirmation_message(
    client: Client, make_resident: Callable[..., Resident], pushes: list
) -> None:
    """The message appearing in the feed is the confirmation. A toast on every send is noise in a
    chat — but the warnings that change what was posted must still come through."""
    user = make_resident(email="a@gahk.dk")
    client.force_login(user)

    response = client.post(
        FEED_URL + "opret", {"content": "Kaffe i koekkenet", "duration": "60"}, follow=True
    )

    assert list(response.context["messages"]) == []


def test_a_rejected_image_still_warns(
    client: Client, make_resident: Callable[..., Resident], pushes: list, settings: object, tmp_path: Path
) -> None:
    """Removing the success toast must not silence the warnings — those tell you the post is not
    what you thought you sent."""
    settings.MEDIA_ROOT = tmp_path  # type: ignore[attr-defined]
    client.force_login(make_resident(email="a@gahk.dk"))

    response = client.post(
        FEED_URL + "opret",
        {
            "content": "Se her",
            "duration": "60",
            "image": SimpleUploadedFile("evil.pdf", b"x" * 100, content_type="application/pdf"),
        },
        follow=True,
    )

    assert any("blev ikke gemt" in str(m) for m in response.context["messages"])


def test_the_reaction_picker_offers_one_tap_emoji(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    """A bare text input was the first attempt: on a desktop browser that is a cursor and no help.
    The shortlist has to render as real buttons, with the free field kept for anything else."""
    user = make_resident(email="a@gahk.dk")
    QuickPost.objects.create(author=user, content="Kaffe")
    client.force_login(user)

    html = client.get(FEED_URL).content.decode()

    assert html.count('class="emoji-choice"') == len(QUICK_EMOJI)
    for emoji in QUICK_EMOJI:
        assert emoji in html
    assert 'class="emoji-other"' in html  # "any emoji" is still reachable
    assert 'name="emoji"' in html


def test_a_quick_emoji_button_reacts(client: Client, make_resident: Callable[..., Resident]) -> None:
    """The shortlist posts the same endpoint as the pills, so it toggles identically."""
    user = make_resident(email="a@gahk.dk")
    post = QuickPost.objects.create(author=user, content="Kaffe")
    client.force_login(user)

    react(client, post, QUICK_EMOJI[0])

    assert QuickReaction.objects.get().emoji == QUICK_EMOJI[0]


def test_the_heart_in_the_shortlist_matches_what_keyboards_send(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    """U+2764 without U+FE0F would count separately from the heart every phone keyboard emits,
    silently splitting one reaction into two columns."""
    user = make_resident(email="a@gahk.dk")
    post = QuickPost.objects.create(author=user, content="Kaffe")
    other = make_resident(email="b@gahk.dk")
    client.force_login(user)

    react(client, post, "\u2764\ufe0f")  # from the picker
    client.force_login(other)
    react(client, post, "\u2764\ufe0f")  # typed on a phone

    assert "\u2764\ufe0f" in QUICK_EMOJI
    assert [r["count"] for r in reactions_for(post, user.pk)] == [2]


# --- one reaction per person ---------------------------------------------------------------------


def test_a_second_emoji_replaces_your_first(client: Client, make_resident: Callable[..., Resident]) -> None:
    """One person, one reaction per message. Picking a different emoji moves yours instead of
    stacking a second, so nobody can carpet a message in five reactions."""
    user = make_resident(email="a@gahk.dk")
    post = QuickPost.objects.create(author=user, content="Kaffe")
    client.force_login(user)

    react(client, post, THUMB)
    react(client, post, PARTY)

    assert QuickReaction.objects.count() == 1
    assert QuickReaction.objects.get().emoji == PARTY
    assert [r["emoji"] for r in reactions_for(post, user.pk)] == [PARTY]


def test_different_people_still_react_independently(
    client: Client, make_resident: Callable[..., Resident]
) -> None:
    """The limit is per person, not per message — a message can still collect many reactions."""
    author = make_resident(email="a@gahk.dk")
    other = make_resident(email="b@gahk.dk")
    post = QuickPost.objects.create(author=author, content="Kaffe")

    client.force_login(author)
    react(client, post, THUMB)
    client.force_login(other)
    react(client, post, PARTY)

    assert QuickReaction.objects.count() == 2


@pytest.mark.parametrize(
    "pasted",
    [
        "\U0001f44d\U0001f389",  # two pasted together
        "\U0001f44d\U0001f389\U0001f525",  # three
        "\U0001f44d\U0001f44d",  # the same one twice
    ],
)
def test_pasting_several_emoji_is_rejected(
    client: Client, make_resident: Callable[..., Resident], pasted: str
) -> None:
    """The "Anden emoji" field accepts a paste, and several emoji are all category So — so a length
    check alone let someone land three of them in a single reaction bubble."""
    user = make_resident(email="a@gahk.dk")
    post = QuickPost.objects.create(author=user, content="Kaffe")
    client.force_login(user)

    react(client, post, pasted)

    assert not QuickReaction.objects.exists()


@pytest.mark.parametrize(
    "emoji",
    [
        "\U0001f1e9\U0001f1f0",  # flag: two regional indicators are one emoji
        "1\ufe0f\u20e3",  # keycap: the one place a digit is legitimate
    ],
)
def test_multi_codepoint_emoji_are_still_one_emoji(
    client: Client, make_resident: Callable[..., Resident], emoji: str
) -> None:
    """Rejecting multiple emoji must not reject the single ones that happen to be several code
    points — the naive fix breaks flags, keycaps and family sequences."""
    user = make_resident(email="a@gahk.dk")
    post = QuickPost.objects.create(author=user, content="Kaffe")
    client.force_login(user)

    react(client, post, emoji)

    assert QuickReaction.objects.get().emoji == emoji


# --- images on replies ----------------------------------------------------------------------------


def test_a_reply_can_carry_an_image(
    client: Client, make_resident: Callable[..., Resident], pushes: list, settings: object, tmp_path: Path
) -> None:
    settings.MEDIA_ROOT = tmp_path  # type: ignore[attr-defined]
    author = make_resident(email="a@gahk.dk")
    replier = make_resident(email="b@gahk.dk")
    post = QuickPost.objects.create(author=author, content="Hvem har mistet en nogle?")
    client.force_login(replier)

    client.post(
        f"{FEED_URL}{post.pk}/kommentar",
        {
            "content": "Den her?",
            "image": SimpleUploadedFile("noegle.jpg", b"\xff\xd8\xffx" * 40, content_type="image/jpeg"),
        },
    )

    comment = QuickComment.objects.get()
    assert comment.image.name.startswith("quick_comments/")
    assert (tmp_path / comment.image.name).is_file()


def test_a_reply_image_is_erased_with_its_post(
    client: Client, make_resident: Callable[..., Resident], settings: object, tmp_path: Path
) -> None:
    """Replies are removed by cascade, never by Model.delete(), so the file-cleanup receiver has to
    be registered for QuickComment as well or the photo outlives the thread."""
    settings.MEDIA_ROOT = tmp_path  # type: ignore[attr-defined]
    user = make_resident(email="a@gahk.dk")
    post = QuickPost.objects.create(author=user, content="Kaffe")
    comment = QuickComment.objects.create(
        post=post,
        author=user,
        content="Se her",
        image=SimpleUploadedFile("k.jpg", b"jpegbytes", content_type="image/jpeg"),
    )
    stored = tmp_path / comment.image.name
    assert stored.is_file()

    post.delete()  # cascades to the reply

    assert not stored.exists(), "the reply image outlived its thread"


def test_a_bad_reply_image_is_dropped_but_the_reply_survives(
    client: Client, make_resident: Callable[..., Resident], pushes: list, settings: object, tmp_path: Path
) -> None:
    settings.MEDIA_ROOT = tmp_path  # type: ignore[attr-defined]
    author = make_resident(email="a@gahk.dk")
    replier = make_resident(email="b@gahk.dk")
    post = QuickPost.objects.create(author=author, content="Kaffe")
    client.force_login(replier)

    response = client.post(
        f"{FEED_URL}{post.pk}/kommentar",
        {
            "content": "Jeg kommer",
            "image": SimpleUploadedFile("evil.pdf", b"x" * 100, content_type="application/pdf"),
        },
        follow=True,
    )

    comment = QuickComment.objects.get()
    assert comment.content == "Jeg kommer"
    assert not comment.image
    assert any("blev ikke gemt" in str(m) for m in response.context["messages"])


def test_the_reply_form_accepts_files(client: Client, make_resident: Callable[..., Resident]) -> None:
    """Without the multipart encoding the browser posts the filename as text and the image is
    silently lost — the kind of thing no server-side test would otherwise notice."""
    user = make_resident(email="a@gahk.dk")
    QuickPost.objects.create(author=user, content="Kaffe")
    client.force_login(user)

    html = client.get(FEED_URL).content.decode()

    form = html.split('class="reply-form"')[1].split("</form>")[0]
    assert 'enctype="multipart/form-data"' in html.split('class="reply-form"')[0][-120:] or (
        "multipart/form-data" in form
    )
    assert 'type="file"' in form
    assert 'accept="image/*"' in form
