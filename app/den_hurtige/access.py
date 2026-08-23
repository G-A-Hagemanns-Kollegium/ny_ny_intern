"""Who may reach Den Hurtige — the single switch for its staged rollout.

The feature is being trialled with the administrator group and Inspektionen before the whole
kollegium is invited, so that a bad notification experience (or a Brave user who cannot subscribe)
is discovered by three people rather than a hundred.

    TO OPEN IT TO EVERY RESIDENT: set ACCESS_ROLES = None.

That one edit widens the views, the sidebar entry and the live-feed poll together. Note that it does
NOT widen individual channels: den_hurtige.channels carries its own per-channel `roles`, which
stacks on top of this one — so a channel restricted to a role stays restricted after the rollout
ends. This gate is about the feature; that one is about one feed within it.

Once the rollout is finished, `ACCESS_ROLES = None` leaves the module doing useful work still —
MODERATOR_ROLES lives here, and `roles_allowed` is the function den_hurtige.channels.allowed
mirrors — so it need not be deleted along with the trial.
"""

from collections.abc import Collection
from functools import wraps

from django.contrib.auth.views import redirect_to_login
from django.core.exceptions import PermissionDenied
from django.http import HttpRequest, HttpResponse

from residents.models import Role
from residents.permissions import View, effective_roles

# None = every logged-in resident. A tuple = only those roles (administrator implies every role, so
# administrators and superusers are always in).
#
# Still gated while channels are being tried out: the trial group sees all five feeds, so the tab
# strip's live-post counts will mostly read zero until the rollout opens. That is the trial, not a
# bug — whether topic channels help is a question only a full kollegium can answer.
ACCESS_ROLES: tuple[str, ...] | None = (Role.ADMINISTRATOR, Role.INSPEKTION)

# Who may delete somebody else's message. Inspektionen keep the kollegium's house rules, so they
# moderate the chat the same way they do everything else; administrator is listed for readability
# even though it already implies every role (see residents.permissions.real_roles).
MODERATOR_ROLES = (Role.ADMINISTRATOR, Role.INSPEKTION)


def can_moderate(request: HttpRequest) -> bool:
    """Whether this request may delete other people's messages. Uses *effective* roles, so an
    administrator previewing as a beboer correctly loses the delete buttons."""
    return request.user.is_authenticated and not effective_roles(request).isdisjoint(MODERATOR_ROLES)


def is_limited() -> bool:
    """Whether the rollout gate is still on — drives the "under test" banner on the feed.

    A function, not a re-exported constant: `from .access import ACCESS_ROLES` binds the value at
    import time, and Django imports view modules lazily on the first request, so such a binding
    silently freezes to whatever the constant happened to be then. Everything here reads the module
    global when called instead.
    """
    return ACCESS_ROLES is not None


def roles_allowed(roles: Collection[str]) -> bool:
    """Whether a role set may use Den Hurtige. Takes roles rather than a request so the sidebar,
    which only has the effective role set to hand, can ask the same question as the views."""
    return ACCESS_ROLES is None or not set(roles).isdisjoint(ACCESS_ROLES)


def request_allowed(request: HttpRequest) -> bool:
    """Same question for a request. Uses *effective* roles, so an administrator previewing as a
    plain beboer is locked out too — which is exactly the rollout being simulated."""
    return request.user.is_authenticated and roles_allowed(effective_roles(request))


def access_required(view: View) -> View:
    """@login_required plus the rollout gate. Mirrors residents.permissions.role_required, except
    the roles are read per request instead of bound at import — so flipping ACCESS_ROLES (or
    overriding it in a test) takes effect without re-importing the view module."""

    @wraps(view)
    def wrapped(request: HttpRequest, *args: object, **kwargs: object) -> HttpResponse:
        if not request.user.is_authenticated:
            return redirect_to_login(request.get_full_path())
        if not roles_allowed(effective_roles(request)):
            raise PermissionDenied
        return view(request, *args, **kwargs)

    return wrapped
