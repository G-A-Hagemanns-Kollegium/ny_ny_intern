"""CMS content (F-006/07/08). Content is **code/version-controlled**, not edited at runtime
(decided 2026-06): there is no inline editor, no CKEditor, no KCFinder. These models hold the data
(migrated + maintained via fixtures), rendered read-only with template autoescaping. HTML bodies are
sanitized on import as defence-in-depth.

The one runtime-editable exception is CmsImage: editors upload pictures rather than committing them
to the repo (the old workflow), and the body HTML references them by /media/ URL.
"""

from pathlib import Path
from typing import Any

from django.conf import settings
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver

from core.files import delete_attached_files


class Page(models.Model):  # gahk_page
    menu_category = models.PositiveSmallIntegerField(default=0)  # legacy menuCat (nav highlighting)
    slug = models.SlugField(
        max_length=80, unique=True, blank=True, null=True
    )  # seeded from legacy routes.php; NULL when unmapped
    header = models.CharField(max_length=255)
    body = models.TextField(blank=True)  # legacy `text` (HTML), sanitized on import
    background_image = models.CharField(max_length=255, blank=True)  # legacy bgpic

    def __str__(self) -> str:
        return self.slug or self.header


class NewsItem(models.Model):  # gahk_news — archive-only (live site shows the Facebook feed, F-007)
    title = models.CharField(max_length=255)
    body = models.TextField(blank=True)
    published_at = models.DateTimeField()

    class Meta:
        ordering = ["-published_at"]

    def __str__(self) -> str:
        return self.title


class PylonEvent(models.Model):  # gahk_pylon_calendar — likely retired; migrated as archive
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    starts_on = models.DateField()

    class Meta:
        ordering = ["starts_on"]

    def __str__(self) -> str:
        return f"{self.starts_on}: {self.title}"


class Event(
    models.Model
):  # NEW — replaces the hard-coded array in legacy begivenheder.php (developer-edited)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    starts_on = models.DateField()

    class Meta:
        ordering = ["starts_on"]

    def __str__(self) -> str:
        return f"{self.starts_on}: {self.title}"


class CmsImage(models.Model):
    """An image an editor uploaded for use in page/news/event HTML.

    Exists so putting a picture on the site no longer means committing a file to the repo and
    hand-writing a path: upload here, and the body editor inserts the <img> for you.

    FileField, not ImageField: ImageField requires Pillow, which is not a dependency of this project
    (same call as rooms.RoomConditionScore.photo). core.uploads does the checking.
    """

    file = models.FileField(upload_to="cms/%Y/%m/", max_length=255, verbose_name="Fil")
    # Doubles as the default alt text when the image is inserted, so a described image starts
    # accessible instead of relying on the editor to remember.
    caption = models.CharField(
        max_length=255, blank=True, verbose_name="Beskrivelse", help_text="Bruges som alt-tekst."
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="cms_images",
    )

    class Meta:
        ordering = ["-uploaded_at"]
        verbose_name = "Billede"
        verbose_name_plural = "Billeder"

    def __str__(self) -> str:
        # `file.name` is Optional to the type checker (a FileField can be blank), so fall back
        # rather than let Path() take a None.
        return self.caption or Path(self.file.name or "").name or "(uden fil)"

    @property
    def url(self) -> str:
        return self.file.url if self.file else ""


@receiver(post_delete, sender=CmsImage)
def _delete_cms_image_file(sender: type[CmsImage], instance: CmsImage, **kwargs: Any) -> None:  # noqa: ANN401
    """Drop the file from storage with the row — Django has not done this since 1.3, and an orphaned
    upload is invisible: nothing lists it and nothing ever cleans it up. See core.files."""
    delete_attached_files(instance)
