"""Authorization helpers built on the **monthly** role model (F-010).

A resident's privileges come from their RoleAssignments in the *active* period (the newest published
month). Superusers bypass. Replaces the legacy scattered/inverted per-controller session checks
(01-infrastructure.md A5).
"""
from functools import wraps

from django.contrib.auth.views import redirect_to_login
from django.core.exceptions import PermissionDenied

from .models import active_period


def has_active_role(user, *roles):
    if not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    year, month = active_period()
    return user.role_assignments.filter(role__in=roles, year=year, month=month).exists()


def role_required(*roles):
    """View decorator: require one of `roles` in the active period (or superuser)."""
    def decorator(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return redirect_to_login(request.get_full_path())
            if not has_active_role(request.user, *roles):
                raise PermissionDenied
            return view(request, *args, **kwargs)
        return wrapped
    return decorator
