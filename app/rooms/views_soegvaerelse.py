"""Søg værelse — room-application lottery (F-004).

Fresh-start build (legacy priorities/offers were destroyed by the cascade-delete bug). Fixes: ORM,
atomic multi-row submit (application + priorities + orlov), detail visible to owner OR indstilling
(the legacy ownership check was inverted), and **close_offer scoped to the offer's month** (the legacy
DELETE spanned all months). `indstilling` is the admin role; members must give at least one priority.
"""

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from core.models import Room
from residents.permissions import current_resident, request_has_role, role_required

from .kvotient import compute_k, month_index
from .models import KvotientApplication, KvotientOrlov, KvotientPriority, RoomOffer


@login_required
def soeg(request: HttpRequest) -> HttpResponse:
    resident = current_resident(request)
    offers = RoomOffer.objects.select_related("room").order_by("month", "room__number")
    offered_rooms = [o.room for o in offers]
    if request.method == "POST":
        try:
            ty, tm = int(request.POST["target_year"]), int(request.POST["target_month"])
            dy, dm = int(request.POST["done_year"]), int(request.POST["done_month"])
        except (KeyError, ValueError):
            messages.error(request, "Udfyld måneder korrekt.")
            return render(request, "soegvaerelse/apply.html", {"offered_rooms": offered_rooms})
        orlov_months = int(request.POST.get("orlov_months") or 0)
        room_ids = [int(r) for r in request.POST.getlist("priority") if r]
        if not room_ids:
            messages.error(request, "Vælg mindst én prioritet.")
            return render(request, "soegvaerelse/apply.html", {"offered_rooms": offered_rooms})
        if not resident.move_in_date:
            messages.error(request, "Din indflytningsdato mangler — kontakt indstillingen.")
            return render(request, "soegvaerelse/apply.html", {"offered_rooms": offered_rooms})

        target = month_index(ty, tm)
        move_in = month_index(resident.move_in_date.year, resident.move_in_date.month)
        done = month_index(dy, dm)
        k = compute_k(move_in, done, target, orlov_months)
        with transaction.atomic():
            app = KvotientApplication.objects.create(
                resident=resident,
                move_month=target,
                move_in_month=move_in,
                done_studying_month=done,
                k=k,
                apply_datetime=timezone.now(),
            )
            for i, rid in enumerate(room_ids, start=1):
                KvotientPriority.objects.create(application=app, room_id=rid, priority=i, month=target)
            if orlov_months > 0:
                KvotientOrlov.objects.create(
                    application=app, start_month=target, end_month=target + orlov_months
                )
        messages.success(request, f"Ansøgning sendt (K={k}).")
        return redirect("soegvaerelse:my")
    return render(request, "soegvaerelse/apply.html", {"offered_rooms": offered_rooms})


@login_required
def my(request: HttpRequest) -> HttpResponse:
    resident = current_resident(request)
    apps = resident.kvotient_applications.prefetch_related("priorities__room").order_by("-apply_datetime")
    return render(request, "soegvaerelse/my.html", {"apps": apps})


@login_required
def detail(request: HttpRequest, pk: int) -> HttpResponse:
    app = get_object_or_404(KvotientApplication, pk=pk)
    if app.resident_id != request.user.id and not request_has_role(request, "indstilling"):
        raise PermissionDenied
    return render(request, "soegvaerelse/detail.html", {"app": app})


@role_required("indstilling")
def admin(request: HttpRequest) -> HttpResponse:
    return render(
        request,
        "soegvaerelse/admin.html",
        {
            "offers": RoomOffer.objects.select_related("room").order_by("month", "room__number"),
            "rooms": Room.objects.order_by("number"),
        },
    )


@require_POST
@role_required("indstilling")
def create_offer(request: HttpRequest) -> HttpResponseRedirect:
    try:
        room = Room.objects.get(number=int(request.POST["room"]))
        target = month_index(int(request.POST["year"]), int(request.POST["month"]))
        RoomOffer.objects.get_or_create(room=room, month=target)
        messages.success(request, f"Tilbud oprettet: {room} ({target}).")
    except (KeyError, ValueError, Room.DoesNotExist):
        messages.error(request, "Ugyldigt værelse eller måned.")
    return redirect("soegvaerelse:admin")


@role_required("indstilling")
def applicants(request: HttpRequest, offer_id: int) -> HttpResponse:
    offer = get_object_or_404(RoomOffer, pk=offer_id)
    prios = (
        KvotientPriority.objects.filter(room=offer.room, application__move_month=offer.month)
        .select_related("application", "application__resident")
        .order_by("-application__k", "application__apply_datetime", "priority")
    )
    return render(request, "soegvaerelse/applicants.html", {"offer": offer, "prios": prios})


@require_POST
@role_required("indstilling")
def close_offer(request: HttpRequest, offer_id: int) -> HttpResponseRedirect:
    offer = get_object_or_404(RoomOffer, pk=offer_id)
    with transaction.atomic():
        # scoped to THIS offer's month only (fixes the legacy cross-month cascade delete)
        app_ids = list(
            KvotientApplication.objects.filter(priorities__room=offer.room, move_month=offer.month)
            .values_list("id", flat=True)
            .distinct()
        )
        KvotientApplication.objects.filter(id__in=app_ids).delete()  # cascades priorities + orlov
        offer.delete()
    messages.success(request, f"Tilbud lukket; {len(app_ids)} ansøgning(er) i måneden ryddet.")
    return redirect("soegvaerelse:admin")
