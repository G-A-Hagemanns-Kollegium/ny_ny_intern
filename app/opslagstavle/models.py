"""Opslagstavlen — the kollegium's noticeboard, replacing its Facebook group.

Content with a lifetime of weeks to years: important events, the results of værelsesrunden,
birthdays, practical notices. That is the whole reason this is not Den Hurtige, whose docstring
promises the opposite ("deliberately ephemeral… a thread that cannot accumulate off-topic history")
and whose posts are hard-deleted after 30 minutes to 24 hours.

Two things follow from posts living for years rather than minutes, and both are deliberate
divergences from the sibling feature:

  * **Retention is a policy, not the point.** Posts are purged after ~2 years by
    `manage.py purge_notices` on a nightly schedule — but *pinned* posts are exempt, because a pin
    is Inspektionen saying "the kollegium keeps this". There is no lazy purge on page load (Den
    Hurtige has one): its tolerance is minutes, so a missed cron is visibly wrong within the hour;
    here the tolerance is months, and a DELETE on every page load would run for years finding
    nothing.
  * **The body is Markdown, rendered on read.** Only the source is stored — see core.markdown for
    why that is worth a few milliseconds a page.
"""

from datetime import timedelta
from typing import Any

from django.conf import settings
from django.db import models
from django.db.models import F
from django.db.models.signals import post_delete
from django.dispatch import receiver

from core.files import delete_attached_files

# ~2 years (shortened from five after user testing: a board people actually read does not need a
# half-decade of history, and a shorter window is the point of leaving Facebook). Leap days are noise
# at this horizon, so plain 365-day years rather than dateutil.
RETENTION_DAYS = 365 * 2

# An uploaded image nobody referenced within this window is an abandoned draft (the composer was
# opened, pictures were added, the tab was closed). Long enough that removing an image and
# immediately re-adding it cannot lose the file.
ORPHAN_IMAGE_GRACE = timedelta(days=1)

# A pinned post is both permanently above everything else *and* exempt from the purge, so an
# unbounded pin list would quietly turn "pin" into "keep forever" and fill the top of the board.
MAX_PINNED = 5

MAX_BODY_CHARS = 8_000
MAX_COMMENT_CHARS = 1_000


class Category(models.TextChoices):
    """The fixed set from the feature request.

    Values are ASCII because they appear in a querystring (`?kategori=vaerelsesrunde`); the labels
    carry the Danish. A lookup table would need an admin, a seed and a migration per entry, for a set
    that changes about once a year.
    """

    NYT = "nyt", "Nyt & info"
    BEGIVENHED = "begivenhed", "Begivenhed"
    VAERELSESRUNDE = "vaerelsesrunde", "Værelsesrunden"
    FOEDSELSDAG = "foedselsdag", "Fødselsdag"
    PRAKTISK = "praktisk", "Praktisk"
    ANDET = "andet", "Andet"


class NoticeQuerySet(models.QuerySet["Notice"]):
    def pinned(self) -> "NoticeQuerySet":
        """Pinned posts, newest pin first — so pinning a second thing puts it on top, which is what
        a moderator expects. (A boolean flag could not express that.)"""
        return self.filter(pinned_at__isnull=False).order_by(F("pinned_at").desc())

    def unpinned(self) -> "NoticeQuerySet":
        """Everything else, newest first. The board paginates *this*, and renders `pinned()` above
        the paginator on every page — otherwise a pin would only be visible on page 1, which makes
        pinning pointless once the board is a few pages deep."""
        return self.filter(pinned_at__isnull=True).order_by("-created_at")

    def expired(self, now: Any = None) -> "NoticeQuerySet":  # noqa: ANN401 — a datetime
        """Past the retention window and not pinned. Reads as the policy sentence it enforces."""
        from django.utils import timezone

        cutoff = (now or timezone.now()) - timedelta(days=RETENTION_DAYS)
        return self.filter(created_at__lt=cutoff, pinned_at__isnull=True)


class Notice(models.Model):
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notices")
    category = models.CharField(
        max_length=20, choices=Category.choices, default=Category.NYT, verbose_name="Kategori"
    )
    body = models.TextField(
        verbose_name="Indhold",
        help_text="Markdown. Kun kilden gemmes — HTML dannes når opslaget vises.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    # Set explicitly by the edit view, deliberately NOT auto_now: auto_now fires on every save(), so
    # pinning a post would stamp it "Redigeret" with Inspektionen's timestamp. Readers see this, and
    # a false edit marker is worse than none.
    edited_at = models.DateTimeField(null=True, blank=True)

    # Pinning as a nullable timestamp rather than a boolean. One column answers three questions:
    # is it pinned, how do pins order among themselves (newest pin first), and is it exempt from
    # retention (`pinned_at__isnull=True` is literally the purge filter). A boolean would need both
    # extra columns anyway to answer the other two.
    pinned_at = models.DateTimeField(null=True, blank=True)
    pinned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pinned_notices",
    )

    objects = NoticeQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Opslag"
        verbose_name_plural = "Opslag"
        # The list is always "optional category filter + newest first"; this composite serves the
        # filtered and the unfiltered query. Deliberately NO index on pinned_at and none on
        # created_at alone: two years at this kollegium's volume is a few hundred rows, where Postgres
        # seq-scans faster than it reads an index, and an unused index is a write cost plus a lie
        # about which queries matter.
        indexes = [models.Index(fields=["category", "-created_at"], name="notice_cat_recent_idx")]
        # NO CheckConstraint tying pinned_by to pinned_at, tempting as it looks: pinned_by is
        # SET_NULL, so deleting the resident who pinned a post would violate it and make the delete
        # fail. The pair is maintained by the pin view instead.

    def __str__(self) -> str:
        # No title to name a post by any more, so identify it the way the board does: by who wrote
        # it. The pk keeps two posts from one person distinguishable in the admin changelist.
        return f"Opslag #{self.pk} af {self.author.full_name}"

    @property
    def is_pinned(self) -> bool:
        return self.pinned_at is not None


class NoticeComment(models.Model):
    """A reply to a notice. **Plain text, deliberately not Markdown.**

    Keeping Markdown to the post body confines the embedded-image lifecycle (see NoticeImage) to one
    model, keeps the compose toolbar single-purpose, and matches how people actually comment.
    Rendered autoescaped with `white-space: pre-wrap` and `|urlize`, exactly like a Den Hurtige
    reply. Reversible: allowing Markdown later is a template change and a test.
    """

    notice = models.ForeignKey(Notice, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notice_comments"
    )
    body = models.TextField(max_length=MAX_COMMENT_CHARS, verbose_name="Kommentar")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Kommentar"
        verbose_name_plural = "Kommentarer"

    def __str__(self) -> str:
        return f"Kommentar af {self.author} på #{self.notice_id}"


class NoticeReaction(models.Model):
    """One emoji one resident put on one notice. Semantics and grammar are shared with Den Hurtige
    (core.reactions, core.emoji): a different emoji moves yours, the same one clears it."""

    notice = models.ForeignKey(Notice, on_delete=models.CASCADE, related_name="reactions")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notice_reactions"
    )
    # Long enough for a ZWJ sequence: a family emoji is 7 code points, skin-tone variants more.
    emoji = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Reaktion"
        verbose_name_plural = "Reaktioner"
        constraints = [
            # Present from migration 0001 on purpose: den_hurtige had to ship a RunPython data step
            # (its migration 0004) to collapse pre-existing duplicates when this constraint was
            # added late. Starting with it means that can never be needed here.
            models.UniqueConstraint(fields=["notice", "author"], name="uniq_notice_reaction_per_author")
        ]

    def __str__(self) -> str:
        return f"{self.emoji} af {self.author}"


class NoticeImage(models.Model):
    """An image uploaded from the compose toolbar and referenced by URL from a Notice body.

    The FK is nullable because the image is uploaded *before* the post exists — the toolbar inserts
    `![alt](url)` into a textarea, and there is no server-side draft to attach it to. It is claimed
    at save time by parsing the Markdown (opslagstavle.images), which is what turns "delete a post,
    its pictures go" into a database property (CASCADE plus the post_delete receiver below) rather
    than a nightly body-scanning job that can never be exact.

    FileField, not ImageField: ImageField requires Pillow, which is not a dependency of this project
    (same call as QuickPost.image, CmsImage.file, RoomConditionScore.photo). core.uploads validates.
    """

    notice = models.ForeignKey(Notice, null=True, blank=True, on_delete=models.CASCADE, related_name="images")
    file = models.FileField(upload_to="opslag/%Y/%m/", max_length=255, verbose_name="Fil")
    # Doubles as the Markdown alt text the toolbar inserts, so a described image starts accessible.
    alt = models.CharField(max_length=255, blank=True, verbose_name="Beskrivelse")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="notice_images",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]
        verbose_name = "Billede"
        verbose_name_plural = "Billeder"
        # Serves the orphan sweep: unclaimed rows older than the grace period.
        indexes = [models.Index(fields=["notice", "uploaded_at"], name="notice_img_orphan_idx")]

    def __str__(self) -> str:
        return self.alt or (self.file.name or "(uden fil)")

    @property
    def url(self) -> str:
        return self.file.url if self.file else ""


@receiver(post_delete, sender=NoticeImage)
def _delete_notice_files(sender: type[models.Model], instance: models.Model, **kwargs: Any) -> None:  # noqa: ANN401
    """Remove the upload from storage when its row goes.

    Registered as a signal rather than an override of delete() for two reasons that both matter
    here: the retention command issues a *bulk* queryset delete, which never calls Model.delete(),
    and these rows are usually removed by cascade from Notice rather than directly. See core.files.
    """
    delete_attached_files(instance)
