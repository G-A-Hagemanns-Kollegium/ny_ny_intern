"""Den Hurtige - short-lived urgent messages, replacing the kollegium's Messenger group.

Posts are deliberately ephemeral: they are relevant for the next 30-120 minutes and are then
*hard-deleted* (see QuickPostQuerySet.purge_expired), which is the whole point of the feature — a
thread that cannot accumulate off-topic history. Purging happens lazily on every feed load plus via
`manage.py purge_quick_posts` on a schedule (DEPLOY.md §4b), so a quiet week still drains the table.
"""

from datetime import datetime, timedelta
from typing import Any

from django.conf import settings
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver
from django.utils import timezone

# How long a post stays visible. The default matches the Messenger group's informal "relevant the
# next 30-60 min" convention; the compose form lets the author pick from DURATION_CHOICES.
DEFAULT_DURATION_MINUTES = 60
DURATION_CHOICES = [(30, "30 minutter"), (60, "1 time"), (120, "2 timer"), (240, "4 timer")]

# One-tap reactions offered by the picker. Any emoji is still accepted (forms.ReactionForm) — this
# is only the shortlist, because in a desktop browser a bare text field gives you a cursor and no
# help, while these are a single click. Written as escapes so the file stays ASCII-safe; the heart
# carries U+FE0F because that is the form every mobile keyboard sends, and counts must not split.
QUICK_EMOJI = [
    "👍",
    "❤️",
    "😂",
    "🎉",
    "🙏",
    "👀",
    "🔥",
    "😮",
    "😢",
    "👎",
    "✅",
    "❌",
    "☕",
    "🍺",
    "🍕",
    "🎂",
    "🚲",
    "🔑",
]


def get_default_expiration() -> datetime:
    """Default expiration time is 60 minutes from creation."""
    return timezone.now() + timedelta(minutes=DEFAULT_DURATION_MINUTES)


class QuickPostQuerySet(models.QuerySet["QuickPost"]):
    """Custom QuerySet to handle filtering and permanent deletion of expired posts."""

    def active(self) -> "QuickPostQuerySet":
        """Returns posts that have not yet expired."""
        return self.filter(expires_at__gt=timezone.now())

    def expired(self) -> "QuickPostQuerySet":
        """Returns posts that have reached or passed their expiration time."""
        return self.filter(expires_at__lte=timezone.now())

    def purge_expired(self) -> int:
        """Permanently deletes all expired posts. Returns the number of *posts* removed (the
        `delete()` total also counts cascaded comments, which is not what callers report)."""
        _total, per_model = self.expired().delete()
        return per_model.get("den_hurtige.QuickPost", 0)


class QuickPost(models.Model):
    """A short-lived, urgent message in 'Den Hurtige'."""

    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="quick_posts")
    content = models.TextField(help_text="Selve beskeden.")

    # Optional image attachment. FileField, not ImageField: ImageField requires Pillow, which is not
    # a dependency of this project (same call as rooms.RoomConditionScore.photo). The view validates
    # content type and size instead.
    image = models.FileField(
        upload_to="quick_posts/%Y/%m/",
        max_length=255,
        blank=True,
        help_text="Valgfrit billede.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(
        default=get_default_expiration,
        help_text="Hvornår opslaget udløber og slettes permanent.",
    )

    objects = QuickPostQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Hurtigt opslag"
        verbose_name_plural = "Hurtige opslag"
        # active() and purge_expired() both filter on expires_at and run on every feed load.
        indexes = [models.Index(fields=["expires_at"])]

    def __str__(self) -> str:
        return f"Opslag af {self.author} kl. {self.created_at:%H:%M}"

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    @property
    def minutes_left(self) -> int:
        """Whole minutes until expiry, floored at 0 — shown as 'udløber om N min' in the feed."""
        return max(0, int((self.expires_at - timezone.now()).total_seconds() // 60))


class QuickComment(models.Model):
    """A comment on a QuickPost. Deleted with its post when the post expires."""

    post = models.ForeignKey(QuickPost, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="quick_comments"
    )
    content = models.TextField()

    # Same FileField-not-ImageField call as QuickPost.image: ImageField needs Pillow, which is not a
    # dependency. The view validates content type and size.
    image = models.FileField(
        upload_to="quick_comments/%Y/%m/",
        max_length=255,
        blank=True,
        help_text="Valgfrit billede.",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    # Determines notification scope: everyone subscribed, or only the original poster.
    notify_everyone = models.BooleanField(
        default=False,
        help_text="Sand: push til alle abonnenter. Falsk: kun til opslagets forfatter.",
    )

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Kommentar"
        verbose_name_plural = "Kommentarer"

    def __str__(self) -> str:
        return f"Kommentar af {self.author} på opslag #{self.post.pk}"


@receiver(post_delete, sender=QuickPost)
@receiver(post_delete, sender=QuickComment)
def _delete_image_file(sender: type[models.Model], instance: models.Model, **kwargs: Any) -> None:  # noqa: ANN401
    """Remove an attached file from storage when its message or reply goes.

    Django stopped deleting FileField files on row delete in 1.3, so without this the *text* expires
    on schedule while the *photo* stays on disk forever — the opposite of what the feature promises,
    and an unbounded pile of orphaned uploads.

    Registered as a signal rather than overridden on delete() because purge_expired() issues a bulk
    queryset delete, which never calls Model.delete(), and replies are removed by cascade rather than
    directly. The trade-off is that a post_delete receiver disables Django's fast-delete path, so
    purging fetches rows before removing them — irrelevant at a few posts an hour.
    """
    image = getattr(instance, "image", None)
    if image:
        image.delete(save=False)


class QuickReaction(models.Model):
    """One emoji one resident put on one message.

    The unique constraint is what makes the endpoint a toggle rather than a counter: tapping an emoji
    you already used deletes the row instead of adding a second one, so a reaction cannot be
    double-counted and no separate "have I reacted?" bookkeeping is needed.

    Deliberately never notified — a dorm-wide feed where every 👍 buzzes everyone's phone is
    exactly the noise Den Hurtige exists to remove, and it would stop people reacting at all.
    """

    post = models.ForeignKey(QuickPost, on_delete=models.CASCADE, related_name="reactions")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="quick_reactions"
    )
    # Long enough for a ZWJ sequence: a family emoji is 7 code points, and skin-tone variants more.
    emoji = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Reaktion"
        verbose_name_plural = "Reaktioner"
        constraints = [
            # ONE reaction per person per message, not one of each emoji. Picking a different emoji
            # replaces yours; picking the one you already used clears it. The constraint is what
            # makes that safe under a double tap.
            models.UniqueConstraint(fields=["post", "author"], name="uniq_reaction_per_author")
        ]

    def __str__(self) -> str:
        return f"{self.emoji} af {self.author}"


class PushSubscription(models.Model):
    """One browser/device that has opted in to Den Hurtige notifications.

    Replaces django-webpush's three-table layout (SubscriptionInfo + PushInformation + Group). The
    Group indirection bought nothing here — there is exactly one audience, everyone who opted in —
    and its get_or_create keyed on every field, so a browser that merely bumped its user-agent
    string quietly produced a duplicate row and a duplicate notification.

    `endpoint` is the device identity assigned by the push service, so it is the natural key: the
    subscribe view upserts on it, which keeps re-subscribing (or a second person logging in on the
    same browser) to a single row.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions"
    )
    endpoint = models.URLField(max_length=500, unique=True)
    # Encryption material from the browser's PushSubscription — opaque base64url, not secrets of
    # ours: without them the push service cannot decrypt anything we send to this device.
    auth = models.CharField(max_length=100)
    p256dh = models.CharField(max_length=100)
    user_agent = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Push-abonnement"
        verbose_name_plural = "Push-abonnementer"

    def __str__(self) -> str:
        return f"Push-abonnement for {self.user}"

    def as_subscription_info(self) -> dict[str, object]:
        """The shape pywebpush expects — mirrors the browser's `PushSubscription.toJSON()`."""
        return {"endpoint": self.endpoint, "keys": {"auth": self.auth, "p256dh": self.p256dh}}
