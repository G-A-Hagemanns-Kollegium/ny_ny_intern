import csv
import io
import os
from datetime import date

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from core.models import Cleaning, Room, Workgroup

from .models import (
    WORKGROUP_ROLE,
    WORKGROUP_ROLE_VALUES,
    Residency,
    Resident,
    Role,
    RoleAssignment,
    active_period,
    next_period,
)
from .permissions import effective_roles, role_required


@login_required
def dashboard(request):
    """Internal landing page (F-013). Shows the member's active-month roles and the shared
    WiFi/calendar info — now gated by authentication (not campus IP) with secrets read from env.
    Uses effective roles so the preview override is reflected here too."""
    year, month = active_period()
    roles = sorted(effective_roles(request))
    return render(
        request,
        "residents/dashboard.html",
        {
            "period": f"{year}-{month:02d}",
            "roles": roles,
            "wifi_password": os.environ.get("WIFI_PASSWORD", ""),
            "calendar_user": os.environ.get("GOOGLE_CALENDAR_USER", ""),
        },
    )


# ---- Alumneliste: the resident directory (F-010) ----
DA_MONTHS = [
    "",
    "januar",
    "februar",
    "marts",
    "april",
    "maj",
    "juni",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "december",
]


def _directory_rows(year, month, query):
    qs = (
        Residency.objects.filter(year=year, month=month)
        .select_related("resident", "resident__sponsor", "room", "workgroup", "cleaning")
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


def _parse_period(request):
    """The (year, month) chosen via ?period=YYYY-M, or the active period as default."""
    try:
        y, m = (request.GET.get("period") or "").split("-")
        y, m = int(y), int(m)
        if 1 <= m <= 12:
            return y, m
    except ValueError:
        pass
    return active_period()


def _period_options(selected):
    """All months that have a published list, newest first, for the history picker."""
    periods = Residency.objects.values_list("year", "month").distinct().order_by("-year", "-month")
    return [
        {"value": f"{y}-{m}", "label": f"{DA_MONTHS[m].capitalize()} {y}", "selected": (y, m) == selected}
        for y, m in periods
    ]


@login_required
def directory(request):
    """Full directory page (login-required). Legacy `json()` was campus-IP gated; with real auth the
    members-only login is the control (F-010). HTMX powers the live search; the period picker shows any
    past month's list (the legacy "oldLists")."""
    year, month = _parse_period(request)
    return render(
        request,
        "alumneliste/directory.html",
        {
            "rows": _directory_rows(year, month, request.GET.get("q", "")),
            "periods": _period_options((year, month)),
            "period_value": f"{year}-{month}",
            "period_label": f"{DA_MONTHS[month].capitalize()} {year}",
        },
    )


@login_required
def directory_rows(request):
    """HTMX fragment: just the filtered table rows (for the selected period)."""
    year, month = _parse_period(request)
    return render(
        request, "alumneliste/_rows.html", {"rows": _directory_rows(year, month, request.GET.get("q", ""))}
    )


def _iso(d):
    return d.isoformat() if d else ""


def _fylgje(residency):
    r = residency.resident
    return r.sponsor.full_name if r.sponsor_id else r.fylgje_raw


# Single source of truth for the alumneliste columns (order matches the HTML table + the exports).
DIRECTORY_COLUMNS = [
    ("Navn", lambda x: x.resident.full_name),
    ("Værelse", lambda x: f"{x.room.number:03d}"),
    ("Embedsgruppe", lambda x: x.workgroup.name if x.workgroup_id else ""),
    ("Rengøring", lambda x: x.cleaning.name if x.cleaning_id else ""),
    ("Fylgje", _fylgje),
    ("Fødselsdag", lambda x: _iso(x.resident.birthday)),
    ("Indflyttet", lambda x: _iso(x.resident.move_in_date)),
    ("Studie", lambda x: x.resident.study),
    ("Telefon", lambda x: x.resident.phone),
    ("Email", lambda x: x.resident.email),
]


@login_required
def directory_export(request):
    """Export the selected month's alumneliste as CSV or Excel (?format=csv|xlsx)."""
    year, month = _parse_period(request)
    rows = _directory_rows(year, month, request.GET.get("q", ""))
    headers = [label for label, _ in DIRECTORY_COLUMNS]
    fname = f"alumneliste-{year}-{month:02d}"

    if request.GET.get("format") == "xlsx":
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.title = f"{year}-{month:02d}"
        ws.append(headers)
        for r in rows:
            ws.append([fn(r) for _, fn in DIRECTORY_COLUMNS])
        buf = io.BytesIO()
        wb.save(buf)
        resp = HttpResponse(
            buf.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        resp["Content-Disposition"] = f'attachment; filename="{fname}.xlsx"'
        return resp

    # CSV — UTF-8 with BOM so Excel opens Danish characters correctly.
    resp = HttpResponse(content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{fname}.csv"'
    resp.write("﻿")  # UTF-8 BOM
    writer = csv.writer(resp)
    writer.writerow(headers)
    for r in rows:
        writer.writerow([fn(r) for _, fn in DIRECTORY_COLUMNS])
    return resp


# ---- Stamtræ: the fylgje lineage (F-011) ----
def _fylgje_forest():
    """Build the sponsor (fylgje) tree from resolved Resident.sponsor links. Residents with no (resolved)
    sponsor are roots under "Hagemanns Ånd". Cycle-safe; siblings ordered by move-in then name."""
    residents = list(Resident.objects.select_related("sponsor").all())
    ids = {r.id for r in residents}
    children = {}
    for r in residents:
        children.setdefault(r.sponsor_id if r.sponsor_id in ids else None, []).append(r)

    def _sorted(rs):
        return sorted(rs, key=lambda c: (c.move_in_date or date.min, c.first_name, c.last_name))

    def _node(r, seen):
        seen = seen | {r.id}
        kids = [_node(k, seen) for k in _sorted(children.get(r.id, [])) if k.id not in seen]
        return {"resident": r, "children": kids}

    return [_node(r, set()) for r in _sorted(children.get(None, []))]


@login_required
def stamtree(request):
    """GAHK's stamtræ — the fylgje lineage of all alumner, rooted in "Hagemanns Ånd"."""
    return render(request, "stamtree/stamtree.html", {"forest": _fylgje_forest()})


# ---- Next month's list — indstilling's monthly update task (F-010) ----
def _sync_month_roles(resident_id, workgroup, year, month, is_admin):
    """Privileged-workgroup roles are derived from the chosen embedsgruppe: clear then re-add. The
    `administrator` role is not a workgroup, so it is preserved/carried separately."""
    RoleAssignment.objects.filter(
        resident_id=resident_id, year=year, month=month, role__in=WORKGROUP_ROLE_VALUES
    ).delete()
    role = WORKGROUP_ROLE.get(workgroup.name) if workgroup else None
    if role:
        RoleAssignment.objects.get_or_create(resident_id=resident_id, role=role, year=year, month=month)
    if is_admin:
        RoleAssignment.objects.get_or_create(
            resident_id=resident_id, role=Role.ADMINISTRATOR, year=year, month=month
        )


def _pick(mapping, raw):
    """Look up an id (from a POST field) in an {id: obj} map; None if blank/invalid."""
    return mapping.get(int(raw)) if raw and raw.isdigit() else None


def _send_welcome_email(request, resident):
    """Welcome a newly created resident with a link to set their password (F-014). Best-effort — a
    mail failure must not undo the creation."""
    uid = urlsafe_base64_encode(force_bytes(resident.pk))
    token = default_token_generator.make_token(resident)
    set_link = request.build_absolute_uri(
        reverse("password_reset_confirm", kwargs={"uidb64": uid, "token": token})
    )
    reset_link = request.build_absolute_uri(reverse("password_reset"))
    send_mail(
        "Velkommen til GAHK Intern",
        (
            f"Kære {resident.first_name}\n\n"
            f"Du er blevet oprettet på GAHKs interne netværk med e-mailen {resident.email}.\n\n"
            f"Sæt dit kodeord her:\n{set_link}\n\n"
            f"Hvis linket er udløbet, kan du anmode om et nyt på:\n{reset_link}\n\n"
            f"Mvh. Indstillingen"
        ),
        settings.DEFAULT_FROM_EMAIL,
        [resident.email],
        fail_silently=True,
    )


def _room_taken(room, year, month, exclude_resident_id=None):
    """True if `room` already has an occupant that month (optionally ignoring one resident)."""
    qs = Residency.objects.filter(year=year, month=month, room=room)
    if exclude_resident_id is not None:
        qs = qs.exclude(resident_id=exclude_resident_id)
    return qs.exists()


@role_required("indstilling")  # administrator/superuser pass via all-access
def next_month_list(request):
    """Indstilling (and admin) prepare next month's alumneliste: copy the list forward, then edit each
    resident's room, embedsgruppe (workgroup) and cleaning, and add/remove people. A privileged
    embedsgruppe grants the matching role for next month; `administrator` is carried forward. Changes
    take effect only when next month becomes the active period (see active_period)."""
    cy, cm = active_period()
    ny, nm = next_period((cy, cm))
    rooms = list(Room.objects.order_by("number"))
    workgroups = list(Workgroup.objects.order_by("name"))
    cleanings = list(Cleaning.objects.order_by("name"))

    if request.method == "POST":
        action = request.POST.get("action")
        admins = set(
            RoleAssignment.objects.filter(year=cy, month=cm, role=Role.ADMINISTRATOR).values_list(
                "resident_id", flat=True
            )
        )
        room_by_id = {r.id: r for r in rooms}
        wg_by_id = {w.id: w for w in workgroups}
        cl_by_id = {c.id: c for c in cleanings}

        if action == "copy":  # seed next month from the current list
            with transaction.atomic():
                for res in Residency.objects.filter(year=cy, month=cm).select_related("workgroup"):
                    Residency.objects.update_or_create(
                        resident_id=res.resident_id,
                        year=ny,
                        month=nm,
                        defaults={
                            "room": res.room,
                            "workgroup": res.workgroup,
                            "cleaning_id": res.cleaning_id,
                        },
                    )
                    _sync_month_roles(res.resident_id, res.workgroup, ny, nm, res.resident_id in admins)
            messages.success(request, f"Listen er kopieret til {ny}-{nm:02d}.")

        elif action == "save":  # edit room/workgroup/cleaning + remove people
            removed, intended = set(), {}  # intended: rid -> (room, workgroup, cleaning)
            for res in Residency.objects.filter(year=ny, month=nm):
                rid = res.resident_id
                if request.POST.get(f"remove_{rid}"):
                    removed.add(rid)
                    continue
                room = _pick(room_by_id, request.POST.get(f"room_{rid}", "")) or res.room
                intended[rid] = (
                    room,
                    _pick(wg_by_id, request.POST.get(f"workgroup_{rid}", "")),
                    _pick(cl_by_id, request.POST.get(f"cleaning_{rid}", "")),
                )
            # No two residents may share a room in the same month.
            occupancy = {}
            for rid, (room, _wg, _cl) in intended.items():
                occupancy.setdefault(room.id, []).append(rid)
            clashes = sorted(
                room_by_id[room_id].number for room_id, rids in occupancy.items() if len(rids) > 1
            )
            if clashes:
                nums = ", ".join(f"{n:03d}" for n in clashes)
                messages.error(
                    request, f"To beboere kan ikke have samme værelse ({nums}). Ingen ændringer gemt."
                )
            else:
                with transaction.atomic():
                    RoleAssignment.objects.filter(resident_id__in=removed, year=ny, month=nm).delete()
                    Residency.objects.filter(resident_id__in=removed, year=ny, month=nm).delete()
                    for rid, (room, wg, cl) in intended.items():
                        Residency.objects.filter(resident_id=rid, year=ny, month=nm).update(
                            room=room, workgroup=wg, cleaning=cl
                        )
                        _sync_month_roles(rid, wg, ny, nm, rid in admins)
                messages.success(request, "Ændringer gemt.")

        elif action == "add_existing":  # add a resident already in the system
            room = _pick(room_by_id, request.POST.get("room", ""))
            resident = _pick({r.id: r for r in Resident.objects.all()}, request.POST.get("resident", ""))
            if not (resident and room):
                messages.error(request, "Vælg både en beboer og et værelse.")
            elif _room_taken(room, ny, nm, exclude_resident_id=resident.id):
                messages.error(request, f"Værelse {room.number:03d} er allerede optaget i {ny}-{nm:02d}.")
            else:
                wg = _pick(wg_by_id, request.POST.get("workgroup", ""))
                Residency.objects.update_or_create(
                    resident_id=resident.id,
                    year=ny,
                    month=nm,
                    defaults={
                        "room": room,
                        "workgroup": wg,
                        "cleaning": _pick(cl_by_id, request.POST.get("cleaning", "")),
                    },
                )
                _sync_month_roles(resident.id, wg, ny, nm, resident.id in admins)
                messages.success(request, f"{resident.full_name} tilføjet til {ny}-{nm:02d}.")

        elif action == "add_new":  # create a new resident and add them
            email = (request.POST.get("email") or "").strip().lower()
            first = (request.POST.get("first_name") or "").strip()
            last = (request.POST.get("last_name") or "").strip()
            room = _pick(room_by_id, request.POST.get("room", ""))
            if not (email and first and last and room):
                messages.error(request, "Udfyld navn, e-mail og værelse for at tilføje en ny beboer.")
            elif Resident.objects.filter(email=email).exists():
                messages.error(request, "Der findes allerede en beboer med den e-mail.")
            elif _room_taken(room, ny, nm):
                messages.error(request, f"Værelse {room.number:03d} er allerede optaget i {ny}-{nm:02d}.")
            else:
                wg = _pick(wg_by_id, request.POST.get("workgroup", ""))
                with transaction.atomic():
                    r = Resident(email=email, first_name=first, last_name=last)
                    r.set_unusable_password()  # they set one via the welcome/password-reset link (F-014)
                    r.save()
                    Residency.objects.create(
                        resident=r,
                        room=room,
                        workgroup=wg,
                        cleaning=_pick(cl_by_id, request.POST.get("cleaning", "")),
                        year=ny,
                        month=nm,
                    )
                    _sync_month_roles(r.id, wg, ny, nm, False)
                _send_welcome_email(request, r)
                messages.success(
                    request, f"{first} {last} oprettet og tilføjet til {ny}-{nm:02d}. Velkomstmail sendt."
                )

        return redirect("next_month_list")

    next_rows = list(
        Residency.objects.filter(year=ny, month=nm)
        .select_related("resident", "room", "workgroup", "cleaning")
        .order_by("room__number")
    )
    in_next = {r.resident_id for r in next_rows}
    available = (
        Resident.objects.filter(is_active=True).exclude(id__in=in_next).order_by("first_name", "last_name")
    )
    return render(
        request,
        "alumneliste/next_month.html",
        {
            "next_rows": next_rows,
            "has_list": bool(next_rows),
            "rooms": rooms,
            "workgroups": workgroups,
            "cleanings": cleanings,
            "available": available,
            "target": f"{ny}-{nm:02d}",
            "current_period": f"{cy}-{cm:02d}",
            "priv_names": sorted(WORKGROUP_ROLE.keys()),
        },
    )
