"""Who gets notified about what on Den Hurtige — the policy half of push.

The transport (pywebpush, the background thread, dead-endpoint cleanup, the VAPID keys) lives in
core.push, shared with opslagstavlen. What stays here is the part that is genuinely this feature's:
its audience, its URL, and the wording on the lock screen.
"""

from typing import TYPE_CHECKING

from core import push

if TYPE_CHECKING:
    from residents.models import Resident

    from .models import QuickComment, QuickPost

# The topic name this feature subscribes and notifies under (core.push.TOPIC_FIELDS).
TOPIC = "den_hurtige"

FEED_URL = "/nyintern/den-hurtige/"


def is_configured() -> bool:
    """Re-exported so the feed view and its tests keep one import. See core.push."""
    return push.is_configured()


def vapid_public_key() -> str:
    return push.vapid_public_key()


def is_subscribed(resident: "Resident") -> bool:
    """Whether any of this resident's devices is opted in to Den Hurtige — the initial state of the
    subscribe toggle. Per *resident*, not per device: the page is rendered before JS has read this
    browser's endpoint, and "you have this on somewhere" is the honest thing to show at that point.
    The button corrects itself once push.ts compares the actual endpoint.
    """
    return push.subscribers(TOPIC).filter(user=resident).exists()


def notify_new_post(post: "QuickPost") -> None:
    """Announce a new post to every Den Hurtige subscriber except its author.

    The title is the sender's name, not the feature's: every platform already labels the
    notification with the app it came from, so "Ny besked på Den Hurtige" said it twice and pushed
    the part that matters — who, and what they wrote — down into the body. Titling with the person
    is what every chat app does, and what makes a lock screen readable at a glance.
    """
    push.notify(
        TOPIC,
        head=post.author.full_name,
        body=push.preview(post.content),
        url=FEED_URL,
        exclude_user_id=post.author_id,
    )


def notify_new_comment(comment: "QuickComment") -> None:
    """Announce a comment. `notify_everyone` decides the audience; the commenter never gets their
    own comment back, and a reply to your own post notifies nobody."""
    head = f"{comment.author.full_name} svarede"
    body = push.preview(comment.content)

    if comment.notify_everyone:
        push.notify(TOPIC, head=head, body=body, url=FEED_URL, exclude_user_id=comment.author_id)
        return
    if comment.author_id == comment.post.author_id:
        return  # commenting on your own post: the only recipient would be yourself
    recipients = push.subscribers(TOPIC).filter(user_id=comment.post.author_id)
    push.send(recipients, head=head, body=body, url=FEED_URL)
