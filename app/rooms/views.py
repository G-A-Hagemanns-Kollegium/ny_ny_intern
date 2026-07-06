"""Rooms views: vaerelsestjek (F-005 condition inspection). soegvaerelse (F-004) added separately.

F-005 fixes: ORM (no SQLi), role-gated (inspektion for inspecting, ak for the AK overview — fixes the
broken `!$username && !empty($ak)` guard), CSRF, and the unflag-old + create-new write is atomic.
Only the current condition is kept. (Per-criterion image *upload* is a later refinement — see model note;
legacy image path references are shown read-only.)
"""

from django.db import transaction
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone

from core.models import Room
from residents.permissions import role_required

from .models import RoomCondition, RoomConditionScore, RoomCriterion


@role_required("inspektion")
def overview(request):
    rooms = Room.objects.order_by("number")
    current = {c.room_id: c for c in RoomCondition.objects.filter(is_current=True)}
    rows = [(r, current.get(r.id)) for r in rooms]
    return render(request, "vaerelsestjek/overview.html", {"rows": rows})


@role_required("ak")
def akoverview(request):
    conditions = RoomCondition.objects.filter(is_current=True).select_related("room").order_by("room__number")
    return render(request, "vaerelsestjek/akoverview.html", {"conditions": conditions})


@role_required("inspektion")
def room(request, room_id):
    rm = get_object_or_404(Room, number=room_id)
    cond = RoomCondition.objects.filter(room=rm, is_current=True).first()
    scores = cond.scores.select_related("criterion").order_by("criterion__name") if cond else []
    return render(request, "vaerelsestjek/room.html", {"room": rm, "cond": cond, "scores": scores})


@role_required("inspektion")
def besvar(request, room_id):
    rm = get_object_or_404(Room, number=room_id)
    criteria = list(RoomCriterion.objects.order_by("name"))

    if request.method == "POST":
        with transaction.atomic():
            RoomCondition.objects.filter(room=rm, is_current=True).update(is_current=False)
            cond = RoomCondition.objects.create(
                room=rm,
                resident=request.user,
                recorded_by_name=request.user.full_name,
                recorded_at=timezone.now(),
                is_current=True,
            )
            for crit in criteria:
                raw = request.POST.get(f"score_{crit.code}", "").strip()
                comment = request.POST.get(f"comment_{crit.code}", "").strip()
                photo = request.FILES.get(f"image_{crit.code}")
                if raw or comment or photo:
                    RoomConditionScore.objects.create(
                        condition=cond,
                        criterion=crit,
                        score=int(raw) if raw.lstrip("-").isdigit() else None,
                        comment=comment,
                        photo=photo or "",
                    )
        return redirect("vaerelsestjek:room", room_id=rm.number)

    cur = RoomCondition.objects.filter(room=rm, is_current=True).first()
    existing = {s.criterion_id: s for s in cur.scores.all()} if cur else {}
    rows = [(c, existing.get(c.id)) for c in criteria]
    return render(request, "vaerelsestjek/besvar.html", {"room": rm, "rows": rows})
