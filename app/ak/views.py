"""AK views (F-009). Members see their own balance/log; AK officers (role `ak`) see everyone and can
add/adjust crosses for anyone. Balance is the SUM of ledger entries."""

from django.contrib.auth.decorators import login_required
from django.db.models import Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from residents.models import Resident, active_period
from residents.permissions import role_required

from .models import AkEntry


@login_required
def my_ak(request):
    return render(
        request,
        "ak/my.html",
        {
            "balance": AkEntry.balance_for(request.user),
            "entries": request.user.ak_entries.all()[:100],
        },
    )


@role_required("ak")
def overview(request):
    year, month = active_period()
    residents = Resident.objects.filter(residencies__year=year, residencies__month=month).distinct()
    balances = dict(
        AkEntry.objects.values_list("resident").annotate(b=Sum("delta")).values_list("resident", "b")
    )
    rows = sorted(((r, balances.get(r.id, 0)) for r in residents), key=lambda t: t[1])
    return render(request, "ak/overview.html", {"rows": rows, "period": f"{year}-{month:02d}"})


@role_required("ak")
def resident_log(request, pk):
    resident = get_object_or_404(Resident, pk=pk)
    return render(
        request,
        "ak/log.html",
        {
            "resident": resident,
            "balance": AkEntry.balance_for(resident),
            "entries": resident.ak_entries.all()[:200],
        },
    )


@require_POST
@role_required("ak")
def add_entry(request, pk):
    resident = get_object_or_404(Resident, pk=pk)
    try:
        delta = int(request.POST.get("delta", "0"))
    except ValueError:
        delta = 0
    if delta:
        AkEntry.objects.create(
            resident=resident,
            delta=delta,
            kind=AkEntry.Kind.LABOUR if delta > 0 else AkEntry.Kind.ADJUSTMENT,
            reason=request.POST.get("reason", "").strip(),
            created_by=request.user,
            created_at=timezone.now(),
        )
    return redirect("ak:log", pk=pk)


@require_POST
@role_required("ak")
def delete_entry(request, pk, entry_id):
    AkEntry.objects.filter(id=entry_id, resident_id=pk).delete()
    return redirect("ak:log", pk=pk)
