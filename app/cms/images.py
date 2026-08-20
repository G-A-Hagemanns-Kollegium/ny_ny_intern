"""Shared rules for CMS image uploads.

Kept out of models.py and admin.py because the model (upload path), the admin form and the upload
endpoint all need them, and a copy in each is how the three drift apart.

**No SVG.** An SVG is a document, not a picture: it can carry <script>, and served from our own
origin at /media/ a direct navigation to it would execute that script as us — straight past nh3,
which only ever sees the page HTML. The CMS-editor roles are trusted, but the sanitizer exists
precisely so a compromised editor account cannot inject script, and allowing SVG would hand that
back. Raster only; export vectors to PNG.
"""

from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError

ALLOWED_CONTENT_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})
ALLOWED_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".gif", ".webp"})
EXTENSION_HELP = "JPEG, PNG, GIF eller WebP"


def validate_upload(upload: Any) -> None:  # noqa: ANN401 — an UploadedFile from either caller
    """Raise ValidationError unless `upload` is an image we are willing to serve.

    Both the content type and the filename extension are checked. The content type is a hint the
    client controls, and the extension is what the file is ultimately served as — so an `image/png`
    header on a `.svg` name has to fail, and it does.
    """
    content_type = (getattr(upload, "content_type", "") or "").lower()
    name = (getattr(upload, "name", "") or "").lower()

    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ValidationError(f"Filen er ikke et billede (tilladt: {EXTENSION_HELP}).")
    if not any(name.endswith(ext) for ext in ALLOWED_EXTENSIONS):
        raise ValidationError(f"Filendelsen passer ikke til et billede (tilladt: {EXTENSION_HELP}).")
    if upload.size and upload.size > settings.CMS_IMAGE_MAX_MB * 1024 * 1024:
        raise ValidationError(f"Billedet er for stort (over {settings.CMS_IMAGE_MAX_MB} MB).")
