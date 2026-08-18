"""Den Hurtige — the intern feed of short-lived urgent messages that replaces the Messenger group.

Anyone who can reach it may post, comment and subscribe to push — but access itself is gated by
den_hurtige.access during the staged rollout (administrators only at first). Posts self-destruct:
`feed` purges expired ones on the way in, so the thread cannot accumulate the off-topic history
admins struggled with on Messenger. Notification fan-out lives in services.py and runs off the
request thread.
"""

import json
from datetime import timedelta
from typing import cast

from django.conf import settings
from django.contrib import messages
from django.core.exceptions import PermissionDenied
from django.core.files.uploadedfile import UploadedFile
from django.db.models import QuerySet
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from residents.models import Role
from residents.permissions import current_resident, request_has_role

from . import services
from .access import access_required, is_limited, request_allowed
from .forms import PushSubscriptionForm, ReactionForm
from .models import (
    DEFAULT_DURATION_MINUTES,
    DURATION_CHOICES,
    QUICK_EMOJI,
    PushSubscription,
    QuickComment,
    QuickPost,
    QuickReaction,
)

# A "hurtig" message is a couple of lines, not an essay. Enforced server-side as well as via the
# textarea's maxlength so a crafted POST cannot turn the feed into a noticeboard.
MAX_CONTENT_CHARS = 500

VALID_DURATIONS = {minutes for minutes, _label in DURATION_CHOICES}

# Messages from the same person closer together than this are drawn as one group, the way any
# chat client collapses a burst from one sender.
GROUPING_WINDOW = timedelta(minutes=5)


def _active_posts() -> QuerySet[QuickPost]:
    """Live posts, with expired ones purged on the way past. Traffic does the cleanup; the
    purge_quick_posts cron job (DEPLOY.md §4b) covers the weeks with none."""
    QuickPost.objects.purge_expired()
    return (
        QuickPost.objects.active()
        .select_related("author")
        .prefetch_related("comments__author", "reactions")
        # Chat order: oldest first, newest at the bottom by the composer. QuickPost.Meta.ordering
        # stays newest-first for the admin and everything else that lists posts as records.
        .order_by("created_at")
    )


def reactions_for(post: QuickPost, user_id: int) -> list[dict[str, object]]:
    """[{emoji, count, mine}] for one message, most-used first.

    Counted in Python over the prefetched rows rather than with an aggregate per post: the feed
    renders every active message, so a per-post query would be an N+1 on a page that polls itself
    every 20 seconds. Ties break on first use, which keeps the row from reshuffling under a thumb.
    """
    order: list[str] = []
    counts: dict[str, int] = {}
    mine: set[str] = set()
    for reaction in post.reactions.all():  # prefetched in the feed; one query in the toggle path
        if reaction.emoji not in counts:
            order.append(reaction.emoji)
            counts[reaction.emoji] = 0
        counts[reaction.emoji] += 1
        if reaction.author_id == user_id:
            mine.add(reaction.emoji)
    # First-use position captured *before* sorting: `order` is what we are sorting, so looking an
    # index up inside the key function would read a half-reordered list.
    first_seen = {emoji: i for i, emoji in enumerate(order)}
    order.sort(key=lambda e: (-counts[e], first_seen[e]))
    return [{"emoji": e, "count": counts[e], "mine": e in mine} for e in order]


def posts_for(request: HttpRequest) -> list[QuickPost]:
    """Active messages, each carrying `reaction_rows` for the template.

    Attached here rather than resolved in the template because a Django template cannot call a
    function with arguments, and the "did *I* react?" flag depends on the current user.
    """
    user_id = current_resident(request).pk
    posts = list(_active_posts())
    previous: QuickPost | None = None
    for post in posts:
        post.reaction_rows = reactions_for(post, user_id)  # type: ignore[attr-defined]
        # Same author, close in time → render as a continuation (no repeated avatar/name).
        post.grouped = bool(  # type: ignore[attr-defined]
            previous
            and previous.author_id == post.author_id
            and post.created_at - previous.created_at < GROUPING_WINDOW
        )
        previous = post
    return posts


@access_required
def feed(request: HttpRequest) -> HttpResponse:
    return render(
        request,
        "den_hurtige/feed.html",
        {
            "posts": posts_for(request),
            "duration_choices": DURATION_CHOICES,
            "default_duration": DEFAULT_DURATION_MINUTES,
            "max_content_chars": MAX_CONTENT_CHARS,
            "push_configured": services.is_configured(),
            "vapid_public_key": services.vapid_public_key(),
            # Tells the testers the page is not live yet, so they do not assume silence means
            # nobody cares. Disappears on its own when ACCESS_ROLES is set to None.
            "quick_emoji": QUICK_EMOJI,
            "limited_rollout": is_limited(),
        },
    )


def feed_items(request: HttpRequest) -> HttpResponse:
    """Just the post list, for the 20-second poll that keeps the feed live.

    Deliberately not decorated: @access_required redirects or raises, and htmx would swap the login
    page (or a 403 body) into the middle of the feed. A 204 makes htmx do nothing instead, and hands
    an unauthorised caller no data either way — so this is a quieter gate, not a weaker one.
    """
    if not request_allowed(request):
        return HttpResponse(status=204)
    return render(
        request,
        "den_hurtige/_posts.html",
        {
            "posts": posts_for(request),
            "max_content_chars": MAX_CONTENT_CHARS,
            "quick_emoji": QUICK_EMOJI,
        },
    )


def _validated_image(request: HttpRequest) -> UploadedFile | None:
    """The uploaded image, or None with a warning shown.

    A backstop, not the main defence: imageupload.ts already downscales in the browser. This rejects
    a crafted or oversized upload, and warns rather than failing the whole submission — losing an
    urgent message because the photo was wrong is the worse outcome. Shared by messages and replies
    so the two can never drift apart on what they accept.
    """
    image = request.FILES.get("image")
    if not image:
        return None
    if not (image.content_type or "").startswith("image/"):
        messages.warning(request, "Filen er ikke et billede og blev ikke gemt.")
        return None
    if cast("int", image.size) > settings.QUICK_POST_MAX_MB * 1024 * 1024:
        messages.warning(
            request,
            f"Billedet var for stort (over {settings.QUICK_POST_MAX_MB} MB) og blev ikke gemt.",
        )
        return None
    return image


@require_POST
@access_required
def create_post(request: HttpRequest) -> HttpResponseRedirect:
    author = current_resident(request)
    content = (request.POST.get("content") or "").strip()
    if not content:
        messages.error(request, "Skriv en besked før du slår op.")
        return redirect("den_hurtige:feed")
    if len(content) > MAX_CONTENT_CHARS:
        messages.error(request, f"Beskeden må højst fylde {MAX_CONTENT_CHARS} tegn.")
        return redirect("den_hurtige:feed")

    try:
        minutes = int(request.POST.get("duration", DEFAULT_DURATION_MINUTES))
    except ValueError:
        minutes = DEFAULT_DURATION_MINUTES
    if minutes not in VALID_DURATIONS:
        minutes = DEFAULT_DURATION_MINUTES

    post = QuickPost.objects.create(
        author=author,
        content=content,
        image=_validated_image(request) or "",
        expires_at=timezone.now() + timedelta(minutes=minutes),
    )
    services.notify_new_post(post)
    # No success message on purpose: the message appearing at the bottom of the feed *is* the
    # confirmation, and no chat app interrupts you to say a send worked. The warnings above (a
    # rejected image, over-long text) still surface, because those change what was actually posted.
    return redirect("den_hurtige:feed")


@require_POST
@access_required
def create_comment(request: HttpRequest, pk: int) -> HttpResponseRedirect:
    author = current_resident(request)
    post = get_object_or_404(QuickPost.objects.active(), pk=pk)
    content = (request.POST.get("content") or "").strip()
    if not content:
        messages.error(request, "Skriv en kommentar.")
        return redirect("den_hurtige:feed")
    if len(content) > MAX_CONTENT_CHARS:
        messages.error(request, f"Kommentaren må højst fylde {MAX_CONTENT_CHARS} tegn.")
        return redirect("den_hurtige:feed")

    comment = QuickComment.objects.create(
        post=post,
        author=author,
        content=content,
        image=_validated_image(request) or "",
        notify_everyone=request.POST.get("notify") == "alle",
    )
    services.notify_new_comment(comment)
    return redirect("den_hurtige:feed")


@require_POST
@access_required
def toggle_reaction(request: HttpRequest, pk: int) -> HttpResponse:
    """Set, change or clear this person's one emoji on a message, returning just its reaction row.

    Each resident has at most one reaction per message: a new emoji replaces theirs, and re-tapping
    the current one clears it. Deliberately silent — no notification is sent (see QuickReaction).

    Renders only the partial so a tap never re-renders the feed, which would collapse open threads
    and fight the 20-second poll.
    """
    post = get_object_or_404(QuickPost.objects.active(), pk=pk)
    resident = current_resident(request)
    form = ReactionForm(request.POST)
    if form.is_valid():
        emoji = form.cleaned_data["emoji"]
        existing = QuickReaction.objects.filter(post=post, author=resident).first()
        if existing is None:
            QuickReaction.objects.create(post=post, author=resident, emoji=emoji)
        elif existing.emoji == emoji:
            existing.delete()  # tapping the one you already used clears it
        else:
            # Move your reaction rather than stacking a second: one person, one emoji per message.
            existing.emoji = emoji
            existing.save(update_fields=["emoji"])
    # An invalid emoji falls through to a plain re-render: the row is still correct, and a one-tap
    # control has nowhere useful to put a validation error.
    return render(
        request,
        "den_hurtige/_reactions.html",
        {
            "post": post,
            "reactions": reactions_for(post, resident.pk),
            "quick_emoji": QUICK_EMOJI,
        },
    )


@require_POST
@access_required
def delete_post(request: HttpRequest, pk: int) -> HttpResponseRedirect:
    """Authors clean up after themselves; administrators moderate. Everyone else gets a 403."""
    post = get_object_or_404(QuickPost, pk=pk)
    if post.author_id != current_resident(request).pk and not request_has_role(request, Role.ADMINISTRATOR):
        raise PermissionDenied
    post.delete()
    messages.success(request, "Opslaget er slettet.")
    return redirect("den_hurtige:feed")


@require_POST
@access_required
def save_subscription(request: HttpRequest) -> HttpResponse:
    """Store (or drop) this browser's push subscription.

    Login-gated and CSRF-protected, unlike django-webpush's /webpush/save_information, which was
    @csrf_exempt and took its audience from the request body — anyone could have registered an
    endpoint and received every dorm message. Here the subscription is always bound to the session's
    own resident.
    """
    resident = current_resident(request)
    try:
        data = json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return HttpResponse(status=400)
    if not isinstance(data, dict):
        return HttpResponse(status=400)

    form = PushSubscriptionForm.from_payload(data)
    if not form.is_valid():
        return HttpResponse(status=400)
    fields = form.cleaned_data

    if fields["status_type"] == "unsubscribe":
        # Delete by endpoint only for this user: the endpoint identifies the device, and scoping to
        # the session's resident stops one person unsubscribing another's phone by replaying it.
        PushSubscription.objects.filter(user=resident, endpoint=fields["endpoint"]).delete()
        return HttpResponse(status=202)

    # Upsert on the endpoint: re-subscribing, or a second resident logging in on a shared browser,
    # must move the existing row rather than leave a stale one pushing to the previous owner.
    PushSubscription.objects.update_or_create(
        endpoint=fields["endpoint"],
        defaults={
            "user": resident,
            "auth": fields["auth"],
            "p256dh": fields["p256dh"],
            "user_agent": fields["user_agent"],
        },
    )
    return HttpResponse(status=201)
