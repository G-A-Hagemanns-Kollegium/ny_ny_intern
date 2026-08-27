"""The one image-upload policy (core.uploads), shared by the CMS, Den Hurtige, værelsestjek and
opslagstavlen.

Consolidating three drifted copies is only worth it if the policy itself is pinned down, so these
are pure unit tests over `check_image_upload` — no DB, no client. The per-feature *reactions* to a
rejection (refuse the form / warn and drop / answer 400) are tested with their own features.
"""

import pytest
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile

from core.uploads import check_image_upload, validate_image_upload

JPEG = b"\xff\xd8\xff" + b"x" * 64


def upload(name: str, content_type: str, body: bytes = JPEG) -> SimpleUploadedFile:
    return SimpleUploadedFile(name, body, content_type=content_type)


@pytest.mark.parametrize(
    ("name", "content_type"),
    [
        ("foto.jpg", "image/jpeg"),
        ("foto.jpeg", "image/jpeg"),
        ("plakat.png", "image/png"),
        ("logo.gif", "image/gif"),
        ("moderne.webp", "image/webp"),
        ("SKRIGENDE.JPG", "image/jpeg"),  # case must not matter
    ],
)
def test_a_real_raster_image_is_accepted(name: str, content_type: str) -> None:
    assert check_image_upload(upload(name, content_type), max_mb=5) is None


def test_an_svg_is_refused() -> None:
    """The whole reason this module exists. An SVG is a document that can carry <script>, and served
    from our own origin at /media/ a direct navigation would execute it as us — past nh3, which only
    ever sees page HTML."""
    assert check_image_upload(upload("logo.svg", "image/svg+xml"), max_mb=5) is not None


def test_a_disguised_extension_is_refused() -> None:
    """content_type is a hint the client controls; the extension is what the file is *served* as, so
    both have to agree before we will host it."""
    assert check_image_upload(upload("evil.svg", "image/png"), max_mb=5) is not None


def test_a_disguised_content_type_is_refused() -> None:
    assert check_image_upload(upload("foto.jpg", "image/svg+xml"), max_mb=5) is not None


@pytest.mark.parametrize("content_type", ["application/pdf", "text/html", "", "application/x-php"])
def test_a_non_image_is_refused(content_type: str) -> None:
    assert check_image_upload(upload("payload.jpg", content_type), max_mb=5) is not None


def test_the_size_cap_is_the_callers_to_choose() -> None:
    """Each feature passes its own settings value (CMS_IMAGE_MAX_MB, QUICK_POST_MAX_MB,
    ROOM_PHOTO_MAX_MB, NOTICE_IMAGE_MAX_MB), so the cap is an argument and not a global."""
    big = upload("stor.jpg", "image/jpeg", b"\xff\xd8\xff" + b"x" * (2 * 1024 * 1024))

    assert check_image_upload(big, max_mb=5) is None
    assert check_image_upload(big, max_mb=1) is not None


def test_the_messages_are_danish() -> None:
    """User-facing text is Danish; these strings are shown verbatim by every caller."""
    assert "billede" in (check_image_upload(upload("x.pdf", "application/pdf"), max_mb=5) or "")
    assert "stort" in (check_image_upload(upload("x.jpg", "image/jpeg"), max_mb=0) or "")


def test_the_validating_wrapper_raises_for_forms_and_json_endpoints() -> None:
    validate_image_upload(upload("ok.png", "image/png"), max_mb=5)  # must not raise

    with pytest.raises(ValidationError):
        validate_image_upload(upload("logo.svg", "image/svg+xml"), max_mb=5)
