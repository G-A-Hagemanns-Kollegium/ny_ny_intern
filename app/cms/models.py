"""CMS content (F-006/07/08). Content is **code/version-controlled**, not edited at runtime
(decided 2026-06): there is no inline editor, no CKEditor, no KCFinder. These models hold the data
(migrated + maintained via fixtures), rendered read-only with template autoescaping. HTML bodies are
sanitized on import as defence-in-depth.
"""

from django.db import models


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
