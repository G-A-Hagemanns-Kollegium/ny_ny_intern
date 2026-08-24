"""Den Hurtige — the intern feed of short-lived urgent messages that replaces the Messenger group.

Anyone who can reach it may post, comment and subscribe to push — but access itself is gated by
den_hurtige.access, and individual channels may narrow that further (den_hurtige.channels). Posts
self-destruct:
`feed` purges expired ones on the way in, so the thread cannot accumulate the off-topic history
admins struggled with on Messenger. Notification fan-out lives in services.py and runs off the
request thread.

Every view here is scoped to one channel, with one deliberate exception: the purge. See
`_active_posts`.
"""

from datetime import timedelta
from typing import NamedTuple

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.core.files.uploadedfile import UploadedFile
from django.db.models import Count, QuerySet
from django.http import Http404, HttpRequest, HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from core.push import handle_subscription_request
from core.reactions import apply_toggle, reaction_rows
from core.uploads import check_image_upload
from residents.permissions import current_resident, effective_roles

from . import channels, services
from .access import access_required, can_moderate, is_limited, request_allowed
from .channels import Channel
from .forms import ReactionForm
from .models import (
    DURATION_CHOICES,
    QUICK_EMOJI,
    ChannelMute,
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


def _active_posts(channel: Channel) -> QuerySet[QuickPost]:
    """One channel's live posts, with expired ones purged on the way past. Traffic does the cleanup;
    the purge_quick_posts cron job (DEPLOY.md §4b) covers the weeks with none.

    The purge is deliberately NOT scoped to `channel`. Filtering it would mean a channel nobody has
    opened this week keeps its expired posts — and their images — until the half-hourly cron gets to
    them, which quietly turns "the post is gone in an hour" into "the post is gone in an hour, in
    the busy channel". Sweep everything, then read one channel.
    """
    QuickPost.objects.purge_expired()
    return (
        QuickPost.objects.filter(channel=channel.slug)
        .active()
        .select_related("author")
        .prefetch_related("comments__author", "reactions")
        # Chat order: oldest first, newest at the bottom by the composer. QuickPost.Meta.ordering
        # stays newest-first for the admin and everything else that lists posts as records.
        .order_by("created_at")
    )


def reactions_for(post: QuickPost, user_id: int) -> list[dict[str, object]]:
    """[{emoji, count, mine}] for one message, most-used first.

    A thin adapter over core.reactions.reaction_rows, which holds the counting and ordering shared
    with opslagstavlen. Kept as a named function here because the feed and the toggle both call it
    with a post, and because tests import it from this module.
    """
    return reaction_rows(post.reactions.all(), user_id)


def posts_for(request: HttpRequest, channel: Channel) -> list[QuickPost]:
    """One channel's active messages, each carrying `reaction_rows` for the template.

    Attached here rather than resolved in the template because a Django template cannot call a
    function with arguments, and the "did *I* react?" flag depends on the current user.
    """
    user_id = current_resident(request).pk
    posts = list(_active_posts(channel))
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


def _channel_or_404(request: HttpRequest, slug: str | None) -> Channel:
    """Resolve a channel for a full page view, or 404.

    An unknown slug and a channel this resident may not open answer the same way on purpose: a 403
    would confirm that "inspektion-internt" exists to someone who cannot read it.
    """
    channel = channels.lookup(slug)
    if channel is None or not channels.allowed(channel, effective_roles(request)):
        raise Http404("Ingen kanal med det navn.")
    return channel


def channel_counts() -> dict[str, int]:
    """{slug: live post count} for the tab strip, in one query.

    Not an unread count — that would need per-user last-seen state written on every feed load, and
    an out-of-band swap to keep the strip fresh against the 20-second poll. For a feed whose posts
    expire, "how much is live in there right now" is the more honest number anyway, and the push
    notification remains the signal that something actually happened.
    """
    rows = QuickPost.objects.active().values("channel").annotate(n=Count("id"))
    return {row["channel"]: row["n"] for row in rows}


class Tab(NamedTuple):
    """One entry in the channel strip. Built here rather than looked up in the template, because a
    Django template cannot index a dict by a variable key — the alternative was a templatetags
    package existing solely to provide `get_item`."""

    channel: Channel
    # Not `count`: a NamedTuple field of that name shadows tuple.count, which mypy rejects outright.
    live: int
    current: bool


def _channel_context(request: HttpRequest, channel: Channel) -> dict[str, object]:
    """The tab strip's data. Read by the page and by nothing else — the poll swaps only the message
    list, so the counts refresh on navigation rather than every 20 seconds."""
    counts = channel_counts()
    return {
        "channel": channel,
        "tabs": [
            Tab(c, counts.get(c.slug, 0), c.slug == channel.slug)
            for c in channels.visible(effective_roles(request))
        ],
        "muted": ChannelMute.objects.filter(
            resident=current_resident(request), channel=channel.slug
        ).exists(),
    }


@access_required
def feed(request: HttpRequest, channel: str | None = None) -> HttpResponse:
    resolved = _channel_or_404(request, channel)
    return render(
        request,
        "den_hurtige/feed.html",
        {
            "posts": posts_for(request, resolved),
            "duration_choices": DURATION_CHOICES,
            # Per channel: a plan for tonight and a lost bike key go stale on different schedules.
            "default_duration": resolved.default_duration,
            "max_content_chars": MAX_CONTENT_CHARS,
            "push_configured": services.is_configured(),
            "vapid_public_key": services.vapid_public_key(),
            # Whether ANY of this resident's devices wants this topic. The browser cannot answer it
            # (one endpoint serves every topic), so the toggle's initial state is rendered here.
            "push_subscribed": services.is_subscribed(current_resident(request)),
            "quick_emoji": QUICK_EMOJI,
            "can_moderate": can_moderate(request),
            # Tells the testers the page is not live yet, so they do not assume silence means
            # nobody cares. Disappears on its own when ACCESS_ROLES is set to None.
            "limited_rollout": is_limited(),
            **_channel_context(request, resolved),
        },
    )


def feed_items(request: HttpRequest) -> HttpResponse:
    """Just the post list, for the 20-second poll that keeps the feed live.

    Deliberately not decorated: @access_required redirects or raises, and htmx would swap the login
    page (or a 403 body) into the middle of the feed. A 204 makes htmx do nothing instead, and hands
    an unauthorised caller no data either way — so this is a quieter gate, not a weaker one.

    The channel arrives as a query parameter rather than a path segment: this is a partial, never a
    URL anyone shares, and keeping it off the path meant the poll wiring in feed.html changed by one
    attribute instead of the whole route. An unknown or forbidden channel takes the same 204 exit as
    an expired session, for the same reason — the alternative is a 404 body swapped into the feed.
    """
    if not request_allowed(request):
        return HttpResponse(status=204)
    channel = channels.lookup(request.GET.get("kanal"))
    if channel is None or not channels.allowed(channel, effective_roles(request)):
        return HttpResponse(status=204)
    return render(
        request,
        "den_hurtige/_posts.html",
        {
            "posts": posts_for(request, channel),
            "max_content_chars": MAX_CONTENT_CHARS,
            "quick_emoji": QUICK_EMOJI,
            "can_moderate": can_moderate(request),
        },
    )


def _validated_image(request: HttpRequest) -> UploadedFile | None:
    """The uploaded image, or None with a warning shown.

    A backstop, not the main defence: imageupload.ts already downscales in the browser. This rejects
    a crafted or oversized upload, and warns rather than failing the whole submission — losing an
    urgent message because the photo was wrong is the worse outcome. Shared by messages and replies
    so the two can never drift apart on what they accept.

    What counts as an acceptable image lives in core.uploads, so this cannot drift from the CMS and
    værelsestjek again. It previously accepted anything whose content type began with `image/`,
    which let an SVG through — a document that executes script when opened from our own /media/.
    """
    image = request.FILES.get("image")
    if not image:
        return None
    error = check_image_upload(image, settings.QUICK_POST_MAX_MB)
    if error is not None:
        messages.warning(request, f"{error} Billedet blev ikke gemt.")
        return None
    return image


def _channel_of(post: QuickPost) -> str:
    """Where to send someone back to after acting on `post`. A post filed under a channel that has
    since been retired from the registry lands on the default feed rather than a dead URL."""
    channel = channels.lookup(post.channel) or channels.DEFAULT
    return channel.url


def _posting_channel(request: HttpRequest) -> Channel:
    """The channel a submitted form belongs to.

    Falls back to the default rather than erroring, exactly as an unrecognised `duration` is coerced
    below: a resident who has typed an urgent message should not lose it to a hidden field they
    never saw. A channel they may not post in does not silently fall back, though — that would move
    their message somewhere they did not choose.
    """
    channel = channels.lookup(request.POST.get("kanal")) or channels.DEFAULT
    if not channels.allowed(channel, effective_roles(request)):
        raise PermissionDenied
    return channel


@require_POST
@access_required
def create_post(request: HttpRequest) -> HttpResponseRedirect:
    author = current_resident(request)
    channel = _posting_channel(request)
    content = (request.POST.get("content") or "").strip()
    if not content:
        messages.error(request, "Skriv en besked før du slår op.")
        return redirect(channel.url)
    if len(content) > MAX_CONTENT_CHARS:
        messages.error(request, f"Beskeden må højst fylde {MAX_CONTENT_CHARS} tegn.")
        return redirect(channel.url)

    try:
        minutes = int(request.POST.get("duration", channel.default_duration))
    except ValueError:
        minutes = channel.default_duration
    if minutes not in VALID_DURATIONS:
        minutes = channel.default_duration

    post = QuickPost.objects.create(
        author=author,
        channel=channel.slug,
        content=content,
        image=_validated_image(request) or "",
        expires_at=timezone.now() + timedelta(minutes=minutes),
    )
    services.notify_new_post(post)
    # No success message on purpose: the message appearing at the bottom of the feed *is* the
    # confirmation, and no chat app interrupts you to say a send worked. The warnings above (a
    # rejected image, over-long text) still surface, because those change what was actually posted.
    return redirect(channel.url)


@require_POST
@access_required
def create_comment(request: HttpRequest, pk: int) -> HttpResponseRedirect:
    author = current_resident(request)
    post = get_object_or_404(QuickPost.objects.active(), pk=pk)
    # Replies, deletions and reactions take the channel from the post, never from the request: the
    # post already knows where it lives, so there is no hidden field to disagree with.
    back = _channel_of(post)
    content = (request.POST.get("content") or "").strip()
    if not content:
        messages.error(request, "Skriv en kommentar.")
        return redirect(back)
    if len(content) > MAX_CONTENT_CHARS:
        messages.error(request, f"Kommentaren må højst fylde {MAX_CONTENT_CHARS} tegn.")
        return redirect(back)

    comment = QuickComment.objects.create(
        post=post,
        author=author,
        content=content,
        image=_validated_image(request) or "",
        notify_everyone=request.POST.get("notify") == "alle",
    )
    services.notify_new_comment(comment)
    return redirect(back)


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
        # Set / move / clear lives in core.reactions so Den Hurtige and opslagstavlen cannot drift
        # into different semantics for the same widget.
        apply_toggle(QuickReaction.objects, author=resident, emoji=form.cleaned_data["emoji"], post=post)
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
    """Authors clean up after themselves; administrators and Inspektionen moderate. Everyone else
    gets a 403."""
    post = get_object_or_404(QuickPost, pk=pk)
    if post.author_id != current_resident(request).pk and not can_moderate(request):
        raise PermissionDenied
    back = _channel_of(post)
    post.delete()
    messages.success(request, "Opslaget er slettet.")
    return redirect(back)


@require_POST
@access_required
def toggle_mute(request: HttpRequest, channel: str) -> HttpResponseRedirect:
    """Silence, or un-silence, push from one channel for this resident.

    A row exists only while the channel is muted, so the absence of a row is "notify me" — every
    channel is on until someone turns it off (see ChannelMute for why that direction). Idempotent in
    both directions: a double-tap on a slow connection cannot end up with two rows or an exception.
    """
    resolved = _channel_or_404(request, channel)
    resident = current_resident(request)
    removed, _per_model = ChannelMute.objects.filter(resident=resident, channel=resolved.slug).delete()
    if removed:
        messages.success(request, f"Du får igen notifikationer fra {resolved.name}.")
    else:
        # get_or_create, not create: two taps racing each other would otherwise hit the
        # uniq_channel_mute constraint and 500 on what is meant to be a toggle.
        ChannelMute.objects.get_or_create(resident=resident, channel=resolved.slug)
        messages.success(request, f"Notifikationer fra {resolved.name} er slået fra.")
    return redirect(resolved.url)


@require_POST
@login_required
def save_subscription(request: HttpRequest) -> HttpResponse:
    """Store (or drop) this browser's opt-in to Den Hurtige notifications.

    @login_required rather than @access_required, with the access gate re-applied *inside*: the
    endpoint is shared with opslagstavlen (which every resident may use), so gating the whole view
    on ACCESS_ROLES would lock plain residents out of subscribing to the noticeboard.

    That inner check is a no-op today — ACCESS_ROLES is None now that the trial is over — but it is
    what makes re-gating the feature (access.py's documented one-line edit) actually re-gate it.
    Without it, narrowing ACCESS_ROLES would still leave anyone able to register for its
    notifications.

    The per-topic upsert/teardown itself is core.push.handle_subscription_request.
    """
    if not request_allowed(request):
        return HttpResponse(status=403)
    return handle_subscription_request(request, services.TOPIC)
