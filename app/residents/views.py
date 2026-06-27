import os

from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.shortcuts import render

from .models import Residency, active_period


@login_required
def dashboard(request):
    """Internal landing page (F-013). Shows the member's active-month roles and the shared
    WiFi/calendar info — now gated by authentication (not campus IP) with secrets read from env."""
    year, month = active_period()
    roles = list(
        request.user.role_assignments.filter(year=year, month=month)
        .values_list("role", flat=True)
    )
    return render(request, "residents/dashboard.html", {
        "period": f"{year}-{month:02d}",
        "roles": roles,
        "wifi_password": os.environ.get("WIFI_PASSWORD", ""),
        "calendar_user": os.environ.get("GOOGLE_CALENDAR_USER", ""),
    })


# ---- Alumneliste: the resident directory (F-010) ----
def _directory_rows(query):
    year, month = active_period()
    qs = (
        Residency.objects.filter(year=year, month=month)
        .select_related("resident", "room", "workgroup")
        .order_by("room__number")
    )
    q = (query or "").strip()
    if q:
        qs = qs.filter(
            Q(resident__first_name__icontains=q)
            | Q(resident__last_name__icontains=q)
            | Q(resident__study__icontains=q)
            | Q(resident__email__icontains=q)
        )
    return qs


@login_required
def directory(request):
    """Full directory page (login-required). Legacy `json()` was campus-IP gated; with real auth the
    members-only login is the control (F-010). HTMX powers the live search."""
    return render(request, "alumneliste/directory.html",
                  {"rows": _directory_rows(request.GET.get("q", ""))})


@login_required
def directory_rows(request):
    """HTMX fragment: just the filtered table rows."""
    return render(request, "alumneliste/_rows.html",
                  {"rows": _directory_rows(request.GET.get("q", ""))})
