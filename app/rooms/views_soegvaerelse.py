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
from residents.models import Residency, next_period
from residents.permissions import current_resident, request_has_role, role_required

from .kvotient import compute_k, month_choices, month_index, month_label
from .models import KvotientApplication, KvotientOrlov, KvotientPriority, RoomOffer


def allocate_round(month: int) -> dict[int, KvotientApplication]:
    """Global greedy room allocation for a round (all offers in `month`), ported from the legacy
    wonRoomAlgorithm: walk every applicant's room priorities in K order (highest K first, then
    apply-time, then priority) and give each applicant their highest-priority still-free room; each
    resident wins at most one room. Returns {room_id: winning application}."""
    offered_room_ids = set(RoomOffer.objects.filter(month=month).values_list("room_id", flat=True))
    prios = (
        KvotientPriority.objects.filter(room_id__in=offered_room_ids, application__move_month=month)
        .select_related("application", "application__resident", "room")
        .order_by("-application__k", "application__apply_datetime", "priority")
    )
    winners: dict[int, KvotientApplication] = {}
    won_residents: set[int] = set()
    for p in prios:
        if p.room_id not in winners and p.application.resident_id not in won_residents:
            winners[p.room_id] = p.application
            won_residents.add(p.application.resident_id)
    return winners


@login_required
def soeg(request: HttpRequest) -> HttpResponse:
    resident = current_resident(request)
    offers = RoomOffer.objects.select_related("room").order_by("month", "room__number")
    offered_rooms = [o.room for o in offers]
    target = month_index(*next_period())  # the lottery always allocates the upcoming month
    today = timezone.localdate()
    ctx = {
        "offered_rooms": offered_rooms,
        "target_month": target,
        "months": month_choices(),
        "study_years": range(today.year, today.year + 9),
    }
    if request.method == "POST":
        try:
            dy, dm = int(request.POST["done_year"]), int(request.POST["done_month"])
        except (KeyError, ValueError):
            messages.error(request, "Udfyld måneder korrekt.")
            return render(request, "soegvaerelse/apply.html", ctx)
        orlov_months = int(request.POST.get("orlov_months") or 0)
        room_ids = [int(r) for r in request.POST.getlist("priority") if r]
        if not room_ids:
            messages.error(request, "Vælg mindst én prioritet.")
            return render(request, "soegvaerelse/apply.html", ctx)
        if not resident.move_in_date:
            messages.error(request, "Din indflytningsdato mangler — kontakt indstillingen.")
            return render(request, "soegvaerelse/apply.html", ctx)

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
    return render(request, "soegvaerelse/apply.html", ctx)


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
    offers = list(RoomOffer.objects.select_related("room").order_by("month", "room__number"))
    alloc = {m: allocate_round(m) for m in {o.month for o in offers}}
    # (offer, current leading application) pairs — the live projected winner per room.
    offer_rows = [(o, alloc[o.month].get(o.room_id)) for o in offers]
    return render(
        request,
        "soegvaerelse/admin.html",
        {
            "offer_rows": offer_rows,
            "rooms": Room.objects.order_by("number"),
            "target_month": month_index(*next_period()),
        },
    )


@require_POST
@role_required("indstilling")
def create_offer(request: HttpRequest) -> HttpResponseRedirect:
    target = month_index(*next_period())  # offers are always for the upcoming month
    try:
        room = Room.objects.get(number=int(request.POST["room"]))
        RoomOffer.objects.get_or_create(room=room, month=target)
        messages.success(request, f"Tilbud oprettet: {room} ({month_label(target)}).")
    except (KeyError, ValueError, Room.DoesNotExist):
        messages.error(request, "Ugyldigt værelse.")
    return redirect("soegvaerelse:admin")


@role_required("indstilling")
def applicants(request: HttpRequest, offer_id: int) -> HttpResponse:
    offer = get_object_or_404(RoomOffer, pk=offer_id)
    prios = (
        KvotientPriority.objects.filter(room=offer.room, application__move_month=offer.month)
        .select_related("application", "application__resident")
        .order_by("-application__k", "application__apply_datetime", "priority")
    )
    winner = allocate_round(offer.month).get(offer.room_id)
    return render(
        request,
        "soegvaerelse/applicants.html",
        {"offer": offer, "prios": prios, "winner_app_id": winner.pk if winner else None},
    )


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


@require_POST
@role_required("indstilling")
def end_round(request: HttpRequest) -> HttpResponseRedirect:
    """Finish the round: allocate every offered room to its winner (highest-K, global greedy), move
    each winner into that room on the target month's list (Residency), then clear the round."""
    months = set(RoomOffer.objects.values_list("month", flat=True))
    if not months:
        messages.error(request, "Ingen aktive tilbud at afslutte.")
        return redirect("soegvaerelse:admin")
    assigned = 0
    with transaction.atomic():
        for month in months:
            year, month0 = divmod(month, 12)  # inverse of month_index -> (year, month-1)
            for room_id, app in allocate_round(month).items():
                Residency.objects.update_or_create(
                    resident_id=app.resident_id, year=year, month=month0 + 1, defaults={"room_id": room_id}
                )
                assigned += 1
            KvotientApplication.objects.filter(move_month=month).delete()  # cascades priorities + orlov
            RoomOffer.objects.filter(month=month).delete()
    messages.success(request, f"Runden er afsluttet — {assigned} værelse(r) tildelt.")
    return redirect("soegvaerelse:admin")
