"""Who may do what on opslagstavlen.

**No staged-rollout gate**, deliberately unlike den_hurtige/access.py. The feature replaces a
Facebook group everyone is already in, so a board only Inspektionen can see has no content and
cannot be meaningfully trialled — the trial would prove nothing. Den Hurtige's gate exists because
*notifications* were the risky part (a bad buzz experience for a hundred people at once); here
notifications are per-topic and default to off, so that blast radius is already contained by design.

Views are therefore plain @login_required, and the sidebar entry is unconditional — which makes the
"the sidebar must never advertise a page that answers 403" invariant hold trivially.

Every check below reads *effective* roles, so an administrator using the preview tool to view the
site as a beboer correctly loses the pin and delete controls. That real/effective split is the
security boundary in this codebase (see residents.permissions).
"""

from django.http import HttpRequest

from residents.permissions import MODERATION_ROLES, request_has_role

from .models import Notice, NoticeComment


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
