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
from django.db.models import QuerySet
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from residents.models import Role
from residents.permissions import current_resident, request_has_role

from . import services
from .access import access_required, is_limited, request_allowed
from .forms import PushSubscriptionForm
from .models import (
    DEFAULT_DURATION_MINUTES,
    DURATION_CHOICES,
    PushSubscription,
    QuickComment,
    QuickPost,
)

# A "hurtig" message is a couple of lines, not an essay. Enforced server-side as well as via the
# textarea's maxlength so a crafted POST cannot turn the feed into a noticeboard.
MAX_CONTENT_CHARS = 500

VALID_DURATIONS = {minutes for minutes, _label in DURATION_CHOICES}


def _active_posts() -> QuerySet[QuickPost]:
    """Live posts, with expired ones purged on the way past. Traffic does the cleanup; the
    purge_quick_posts cron job (DEPLOY.md §4b) covers the weeks with none."""
    QuickPost.objects.purge_expired()
    return QuickPost.objects.active().select_related("author").prefetch_related("comments__author")


@access_required
def feed(request: HttpRequest) -> HttpResponse:
    return render(
        request,
        "den_hurtige/feed.html",
        {
            "posts": _active_posts(),
            "duration_choices": DURATION_CHOICES,
            "default_duration": DEFAULT_DURATION_MINUTES,
            "max_content_chars": MAX_CONTENT_CHARS,
            "push_configured": services.is_configured(),
            "vapid_public_key": services.vapid_public_key(),
            # Tells the testers the page is not live yet, so they do not assume silence means
            # nobody cares. Disappears on its own when ACCESS_ROLES is set to None.
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
        {"posts": _active_posts(), "max_content_chars": MAX_CONTENT_CHARS},
    )


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

    image = request.FILES.get("image")
    if image:  # backstop: the browser already downscales, this rejects non-images / oversized files
        if not (image.content_type or "").startswith("image/"):
            messages.warning(request, "Filen er ikke et billede og blev ikke gemt.")
            image = None
        elif cast("int", image.size) > settings.QUICK_POST_MAX_MB * 1024 * 1024:
            messages.warning(
                request,
                f"Billedet var for stort (over {settings.QUICK_POST_MAX_MB} MB) og blev ikke gemt.",
            )
            image = None

    post = QuickPost.objects.create(
        author=author,
        content=content,
        image=image or "",
        expires_at=timezone.now() + timedelta(minutes=minutes),
    )
    services.notify_new_post(post)
    messages.success(request, "Opslaget er slået op.")
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
        notify_everyone=request.POST.get("notify") == "alle",
    )
    services.notify_new_comment(comment)
    return redirect("den_hurtige:feed")


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
