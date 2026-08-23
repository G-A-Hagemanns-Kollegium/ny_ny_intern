"""Push delivery for Den Hurtige.

Talks to pywebpush directly rather than through django-webpush. That package is a thin Django
wrapper whose useful surface we had already bypassed (its URLs, template tags, JS and service worker
all conflicted with this PWA), and the little that was left got in the way: its send helper swallows
410 internally and re-raises everything else, so a single dead endpoint aborted the loop and dropped
every remaining recipient — while a 410 looked like a success to the caller. Owning the ~30 lines
here means one error path instead of two, and one table instead of its three.

Delivery runs off the request thread: each subscription is a separate HTTPS round-trip to FCM/APNs
(~0.3-1 s), and gunicorn runs with `--timeout 60`, so a dorm-wide fan-out inline would kill the
worker. `_run_in_background` fires after the transaction commits, so the thread never races the post
it is announcing.
"""

import json
import logging
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING

from django.conf import settings
from django.db import connection, transaction
from django.db.models import QuerySet
from django.templatetags.static import static
from pywebpush import WebPushException, webpush

from . import channels
from .models import PushSubscription

if TYPE_CHECKING:
    from .models import QuickComment, QuickPost

logger = logging.getLogger(__name__)

# Time-to-live. A "Den Hurtige" message is worthless an hour later, so tell the push service to drop
# it rather than deliver it to a phone that comes back online tomorrow.
TTL_SECONDS = 3600

BODY_PREVIEW_CHARS = 120

# Endpoints a browser has permanently discarded. 410 Gone is the documented signal; FCM also answers
# 404 for an endpoint it no longer knows. Anything else may be transient, so the row is kept.
DEAD_ENDPOINT_STATUSES = (404, 410)


def is_configured() -> bool:
    """True when both VAPID keys are set. The subscribe UI reports 'not set up' otherwise, which is
    the normal dev state — the feed itself works fine without push."""
    return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY)


def vapid_public_key() -> str:
    return str(settings.VAPID_PUBLIC_KEY)


def _preview(text: str) -> str:
    text = " ".join(text.split())
    if len(text) <= BODY_PREVIEW_CHARS:
        return text
    return text[: BODY_PREVIEW_CHARS - 1].rstrip() + "…"


def _payload(head: str, body: str, url: str) -> dict[str, str]:
    """The JSON the service worker (app/templates/sw.js) reads: head/body/icon/url.

    `head` is the sender, not the feature. Every platform already labels the notification with the
    app it came from — iOS renders "from Den Hurtige" under the title from the manifest name — so a
    title like "Ny besked på Den Hurtige" said it twice and pushed the part that matters (who, and
    what they wrote) down into the body. Titling with the person and leaving the body to the message
    is what every chat app does, and it is what makes a lock screen readable at a glance.

    `url` is the *channel's* URL, so tapping the notification opens the feed the message is actually
    in rather than the default one. sw.js needs no change for this — it already reads `url` from the
    payload and hands it to notificationclick. Note there is still deliberately no `tag`: see sw.js
    for why (a shared tag makes each notification replace the last, so a second post would silently
    overwrite the first — as true within one channel as it was across the whole feed).
    """
    return {"head": head, "body": body, "icon": static("icons/icon-192x192.png"), "url": url}


def _channel_url(slug: str) -> str:
    """Deep link for a channel's push notification. A post filed under a channel that has since
    been retired from the registry links to the default feed rather than a 404."""
    channel = channels.lookup(slug) or channels.DEFAULT
    return channel.url


def subscribers(channel: str, exclude_user_id: int | None = None) -> QuerySet[PushSubscription]:
    """Every device that should hear about something in `channel`.

    Muting is per resident and stored as a row's *presence* (ChannelMute), so every channel notifies
    everyone until someone opts out — the opposite of a subscribe model, and deliberately so: a new
    channel that notifies nobody until people find it is a new channel nobody posts in.

    `exclude_user_id` drops one user's devices, normally the author's — they just pressed the
    button, so a push back to their own phone is pure noise.
    """
    qs = PushSubscription.objects.exclude(user__channel_mutes__channel=channel)
    if exclude_user_id is not None:
        qs = qs.exclude(user_id=exclude_user_id)
    return qs


def _send(subscription: PushSubscription, body: str) -> None:
    """One encrypted push. Raises WebPushException on any non-2xx from the push service."""
    webpush(
        subscription_info=subscription.as_subscription_info(),
        data=body,
        ttl=TTL_SECONDS,
        vapid_private_key=settings.VAPID_PRIVATE_KEY,
        # Built fresh every call on purpose: pywebpush writes `aud` and `exp` into this dict, so a
        # shared/module-level one would carry the first recipient's audience to everyone after it.
        vapid_claims={"sub": f"mailto:{settings.VAPID_ADMIN_EMAIL}"},
    )


def _dispatch(subscriptions: QuerySet[PushSubscription], payload: dict[str, str]) -> int:
    """Send `payload` to every subscription. Returns the number actually delivered.

    One bad endpoint must never cost the rest of the dorm its notification, so every device is
    isolated in its own try. Endpoints the browser has thrown away are deleted here rather than left
    to accumulate — nothing else ever cleans this table up.
    """
    body = json.dumps(payload)
    sent = attempted = 0
    for subscription in subscriptions:
        attempted += 1
        try:
            _send(subscription, body)
        except WebPushException as exc:
            # pywebpush leaves exc.response as None for connection-level failures, so read the
            # status defensively — a direct exc.response.status_code raises AttributeError there.
            status = getattr(exc.response, "status_code", None)
            if status in DEAD_ENDPOINT_STATUSES:
                subscription.delete()
            else:
                logger.warning("Den Hurtige: push failed (%s) for subscription %s", status, subscription.pk)
        except Exception:
            logger.exception("Den Hurtige: push crashed for subscription %s", subscription.pk)
        else:
            sent += 1
    # Always logged, including the zero cases: "no subscribers" and "every send failed" are
    # indistinguishable from the outside, and both look exactly like the feature being broken.
    logger.info("push delivered to %s/%s device(s)", sent, attempted)
    return sent


def _run_in_background(fn: Callable[[], object]) -> None:
    """Run `fn` in a daemon thread once the current transaction commits.

    on_commit keeps the thread from reading a post that a later rollback removes. The thread closes
    its own DB connection afterwards — without that, every push batch leaks a Postgres connection
    (conn_max_age=600 keeps them open).
    """

    def runner() -> None:
        try:
            fn()
        except Exception:
            logger.exception("Den Hurtige: background push batch failed")
        finally:
            connection.close()

    transaction.on_commit(lambda: threading.Thread(target=runner, daemon=True).start())


def notify_new_post(post: "QuickPost") -> None:
    """Announce a new post to every subscriber except its author, minus anyone who muted the
    channel it was posted in."""
    if not is_configured():
        return
    payload = _payload(post.author.full_name, _preview(post.content), _channel_url(post.channel))
    recipients = subscribers(post.channel, exclude_user_id=post.author_id)
    _run_in_background(lambda: _dispatch(recipients, payload))


def notify_new_comment(comment: "QuickComment") -> None:
    """Announce a comment. `notify_everyone` decides the audience; the commenter never gets their
    own comment back, and a reply to your own post notifies nobody.

    A direct reply reaches the original poster even if they muted the channel: they are not being
    broadcast at, they are being answered, and a mute is about the channel's chatter rather than
    about replies to one's own message.
    """
    if not is_configured():
        return
    channel = comment.post.channel
    if comment.notify_everyone:
        recipients = subscribers(channel, exclude_user_id=comment.author_id)
    elif comment.author_id == comment.post.author_id:
        return  # commenting on your own post: the only recipient would be yourself
    else:
        recipients = PushSubscription.objects.filter(user_id=comment.post.author_id)
    payload = _payload(
        f"{comment.author.full_name} svarede", _preview(comment.content), _channel_url(channel)
    )
    _run_in_background(lambda: _dispatch(recipients, payload))
