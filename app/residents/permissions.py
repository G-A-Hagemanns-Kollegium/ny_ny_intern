"""Authorization helpers built on the **monthly** role model (F-010).

A resident's privileges come from their RoleAssignments in the *active* period (the newest published
month). Superusers bypass. Replaces the legacy scattered/inverted per-controller session checks
(01-infrastructure.md A5).

Role preview ("view site as role"): a real superuser / administrator may set a session override so the
whole internal site renders as if they held a chosen role (or none). The distinction between *real*
roles (DB/superuser, never the session) and *effective* roles (what the current request is treated as)
is the security boundary — only `real_roles`/`can_preview` decide who may preview, and they never read
the session, so a forged/stale override on a non-admin is silently ignored.
"""

from functools import wraps

from django.contrib.auth.views import redirect_to_login
from django.core.exceptions import PermissionDenied

from .models import Role, active_period

ALL_ROLES = frozenset(Role.values)
PREVIEW_SESSION_KEY = "preview_roles"


def real_roles(user):
    """The user's ACTUAL role codes for the active period. Never affected by preview.

    Superuser and `administrator` => every role (all-access); anonymous => none. This is the only
    authorization reader of the DB / superuser flag.
    """
    if not user.is_authenticated:
        return set()
    if user.is_superuser:
        return set(ALL_ROLES)
    year, month = active_period()
    codes = set(user.role_assignments.filter(year=year, month=month).values_list("role", flat=True))
    if Role.ADMINISTRATOR in codes:
        return set(ALL_ROLES)
    return codes


def can_preview(user):
    """Only a real administrator (or superuser, who holds all roles) may use the preview tool."""
    return Role.ADMINISTRATOR in real_roles(user)


def effective_roles(request):
    """The role set this request is treated as: the preview override (only if the real user may
    preview), otherwise the real roles. Re-verifies `can_preview` against real roles every call."""
    if PREVIEW_SESSION_KEY in request.session and can_preview(request.user):
        raw = request.session.get(PREVIEW_SESSION_KEY) or []
        previewed = {c for c in raw if c in Role.values}
        if Role.ADMINISTRATOR in previewed:
            return set(ALL_ROLES)
        return previewed  # may be empty => plain resident
    return real_roles(request.user)


def has_active_role(user, *roles):
    """Backward-compatible, REAL-roles-only check (does not honor preview). Prefer `request_has_role`
    in views so preview is respected."""
    return not real_roles(user).isdisjoint(roles)


def request_has_role(request, *roles):
    """Request-aware role check that honors the preview override."""
    return not effective_roles(request).isdisjoint(roles)


def role_required(*roles):
    """View decorator: require one of `roles` in the *effective* role set (honors preview)."""

    def decorator(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return redirect_to_login(request.get_full_path())
            if effective_roles(request).isdisjoint(roles):
                raise PermissionDenied
            return view(request, *args, **kwargs)

        return wrapped

    return decorator


def require_can_preview(view):
    """Gate the preview switcher on the REAL admin role, so previewing 'beboer' cannot lock an admin
    out of ending the preview."""

    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect_to_login(request.get_full_path())
        if not can_preview(request.user):
            raise PermissionDenied
        return view(request, *args, **kwargs)

    return wrapped
