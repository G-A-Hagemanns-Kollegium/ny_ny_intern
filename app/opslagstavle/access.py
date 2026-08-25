"""Who may reach opslagstavlen, and who may do what once they are there.

    TO OPEN IT TO EVERY RESIDENT: set ACCESS_ROLES = None.

That one edit widens every view, the sidebar entry and the notification audience together.

This module used to argue *against* a staged-rollout gate, on the grounds that the feature replaces
a Facebook group everyone is already in, so a board only Inspektionen can see has no content and
cannot be meaningfully trialled. That reasoning still holds for trialling the board as a *social
space* — and it is why the gate below is meant to come off quickly. It does not hold for the thing
actually being tested first: whether posting, Markdown, image upload, reactions, comments and push
work at all. Three people can answer that, and finding out with three is cheaper than with a
hundred.

The gate is deliberately a copy of den_hurtige/access.py's rather than a shared abstraction in
core/. Both are meant to be deleted once their feature is live, and a temporary thing should be
cheap to remove; a core/rollout.py both apps imported would outlive the reason it existed. If a
third feature ever wants one, that is the point to extract it.

Every check below reads *effective* roles, so an administrator using the preview tool to view the
site as a beboer is locked out too — which is exactly the rollout being simulated. That real/
effective split is the security boundary in this codebase (see residents.permissions).
"""

from collections.abc import Collection
from functools import wraps

from django.contrib.auth.views import redirect_to_login
from django.core.exceptions import PermissionDenied
from django.db.models import Q, QuerySet
from django.http import HttpRequest, HttpResponse

from residents.models import Role, RoleAssignment, active_period
from residents.permissions import MODERATION_ROLES, View, effective_roles, request_has_role

from .models import Notice, NoticeComment

# None = every logged-in resident. A tuple = only those roles (administrator implies every role, so
# administrators and superusers are always in).
#
# Gated for a first pass at the mechanics — see the module docstring for why this is temporary and
# why it is a copy of Den Hurtige's gate rather than a shared one.
ACCESS_ROLES: tuple[str, ...] | None = (Role.ADMINISTRATOR, Role.INSPEKTION)


def is_limited() -> bool:
    """Whether the gate is still on — drives the "under test" chip on the board.

    A function, not a re-exported constant: `from .access import ACCESS_ROLES` binds the value at
    import time, and Django imports view modules lazily on the first request, so such a binding
    would silently freeze to whatever the constant happened to be then. Everything here reads the
    module global when called instead.
    """
    return ACCESS_ROLES is not None


def roles_allowed(roles: Collection[str]) -> bool:
    """Whether a role set may use the board. Takes roles rather than a request so the sidebar, which
    only has the effective role set to hand, can ask the same question as the views."""
    return ACCESS_ROLES is None or not set(roles).isdisjoint(ACCESS_ROLES)


def request_allowed(request: HttpRequest) -> bool:
    return request.user.is_authenticated and roles_allowed(effective_roles(request))


def access_required(view: View) -> View:
    """@login_required plus the gate. Mirrors residents.permissions.role_required, except the roles
    are read per request instead of bound at import — so flipping ACCESS_ROLES (or overriding it in
    a test) takes effect without re-importing the view module.

    Every view gets this, not just the page: a partial that answered 200 to someone the page 403s
    would hand out the board's contents through the back door.
    """

    @wraps(view)
    def wrapped(request: HttpRequest, *args: object, **kwargs: object) -> HttpResponse:
        if not request.user.is_authenticated:
            return redirect_to_login(request.get_full_path())
        if not roles_allowed(effective_roles(request)):
            raise PermissionDenied
        return view(request, *args, **kwargs)

    return wrapped


def allowed_subscribers(qs: QuerySet) -> QuerySet:
    """Narrow a push audience to devices whose owner can actually open the board.

    Without this, gating the page would still notify every resident who had opted in before the gate
    went on — and tapping that notification lands on a 403. A notification you are not allowed to
    read is worse than no feature at all, so the audience is narrowed rather than the page alone.

    Filtered in SQL rather than by calling real_roles() per subscription: this runs on every post,
    and the role set lives in one RoleAssignment row per resident per month. Superusers are matched
    separately because they hold every role without holding any assignment.
    """
    if ACCESS_ROLES is None:
        return qs
    year, month = active_period()
    allowed = RoleAssignment.objects.filter(role__in=ACCESS_ROLES, year=year, month=month).values(
        "resident_id"
    )
    return qs.filter(Q(user_id__in=allowed) | Q(user__is_superuser=True))


def can_moderate(request: HttpRequest) -> bool:
    """Whether this request may delete other people's content and pin/unpin.

    Inspektionen keep the kollegium's house rules, so they moderate the board the same way they do
    everything else; administrator is included because it implies every role.
    """
    return request.user.is_authenticated and request_has_role(request, *MODERATION_ROLES)


def can_pin(request: HttpRequest) -> bool:
    """Same set as moderation. A separate name because they are separate powers conceptually, and
    splitting them later should not mean finding every call site."""
    return can_moderate(request)


def can_edit(request: HttpRequest, notice: Notice) -> bool:
    """The author, and only the author.

    Moderators may delete a post but never rewrite it. Silently editing someone else's text — text
    that may already have comments referring to it — is worse than removing it: the post keeps their
    name on it. Deleting is visible; editing is not.
    """
    return request.user.is_authenticated and notice.author_id == request.user.pk


def can_delete(request: HttpRequest, notice: Notice) -> bool:
    """The author cleans up after themselves; Inspektionen moderate."""
    if not request.user.is_authenticated:
        return False
    return notice.author_id == request.user.pk or can_moderate(request)


def can_delete_comment(request: HttpRequest, comment: NoticeComment) -> bool:
    """The comment's author, or a moderator.

    Deliberately **not** the notice's author: letting people moderate the replies to their own post
    invites exactly the disputes Inspektionen exists to settle, and "he deleted my comment" is a
    worse problem for the kollegium than an unwelcome reply staying up until someone impartial looks
    at it.
    """
    if not request.user.is_authenticated:
        return False
    return comment.author_id == request.user.pk or can_moderate(request)
