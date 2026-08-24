"""Shared rules for image uploads across every feature that accepts one.

One policy, two entry points. Callers keep their own *reaction* to a bad file — that is the part
that legitimately differs (the CMS admin refuses the form, Den Hurtige warns and drops the picture
but still posts the message, the opslagstavle answers 400 to a fetch) — but what counts as an
acceptable image is decided here, once.

Consolidated from three near-duplicates that had already drifted apart: cms/images.py (strict),
den_hurtige/views.py::_validated_image and rooms/views.py (both content-type-prefix only). The two
lenient copies accepted `image/svg+xml`, which is the exact hole the strict one was written to
close — see below.

**No SVG.** An SVG is a document, not a picture: it can carry <script>, and served from our own
origin at /media/ a direct navigation to it would execute that script as us — straight past nh3,
which only ever sees the page HTML. The CMS-editor roles are trusted, but the sanitizer exists
precisely so a compromised editor account cannot inject script, and allowing SVG would hand that
back. Værelsestjek is open to every resident, so there it was not even a compromised-account
question. Raster only; export vectors to PNG.
"""

from typing import Any

from django.core.exceptions import ValidationError

ALLOWED_CONTENT_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})
ALLOWED_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".gif", ".webp"})
EXTENSION_HELP = "JPEG, PNG, GIF eller WebP"


def check_image_upload(upload: Any, max_mb: int) -> str | None:  # noqa: ANN401 — an UploadedFile
    """Return a Danish error message, or None when `upload` is an image we are willing to serve.

    Both the content type and the filename extension are checked. The content type is a hint the
    client controls, and the extension is what the file is ultimately served as — so an `image/png`
    header on a `.svg` name has to fail, and it does.
    """
    content_type = (getattr(upload, "content_type", "") or "").lower()
    name = (getattr(upload, "name", "") or "").lower()

    if content_type not in ALLOWED_CONTENT_TYPES:
        return f"Filen er ikke et billede (tilladt: {EXTENSION_HELP})."
    if not any(name.endswith(ext) for ext in ALLOWED_EXTENSIONS):
        return f"Filendelsen passer ikke til et billede (tilladt: {EXTENSION_HELP})."
    size = getattr(upload, "size", 0) or 0
    if size > max_mb * 1024 * 1024:
        return f"Billedet er for stort (over {max_mb} MB)."
    return None


def validate_image_upload(upload: Any, max_mb: int) -> None:  # noqa: ANN401 — an UploadedFile
    """check_image_upload as a ValidationError — for ModelForms and JSON endpoints."""
    message = check_image_upload(upload, max_mb)
    if message is not None:
        raise ValidationError(message)
