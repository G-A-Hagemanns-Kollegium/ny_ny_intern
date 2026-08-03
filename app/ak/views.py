"""AK views (F-009). Members see their own balance/log; AK officers (role `ak`) see everyone and can
add/adjust crosses for anyone. Balance is the SUM of ledger entries."""

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Sum
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from residents.models import Resident, active_period
from residents.permissions import current_resident, role_required

from .models import AkEntry


@login_required
def my_ak(request: HttpRequest) -> HttpResponse:
    user = current_resident(request)
    return render(
        request,
        "ak/my.html",
        {
            "balance": AkEntry.balance_for(user),
            "entries": user.ak_entries.all()[:100],
        },
    )


@require_POST
@login_required
def add_self_entry(request: HttpRequest) -> HttpResponseRedirect:
    """A resident logs their own AK labour: a positive number of krydser + a required description
    (mirrors the legacy 'addtolog' on one's own log). AK officers review/adjust via the overview."""
    resident = current_resident(request)
    reason = (request.POST.get("reason") or "").strip()
    try:
        krydser = int(request.POST.get("krydser", "0"))
    except ValueError:
        krydser = 0
    if krydser < 1:
        messages.error(request, "Antal krydser skal være et positivt heltal.")
    elif not reason:
        messages.error(request, "Skriv en beskrivelse af det udførte arbejde.")
    else:
        AkEntry.objects.create(
            resident=resident,
            delta=krydser,
            kind=AkEntry.Kind.LABOUR,
            reason=reason,
            created_by=resident,
            created_at=timezone.now(),
        )
        messages.success(request, f"{krydser} kryds registreret.")
    return redirect("ak:index")


@role_required("ak")
def overview(request: HttpRequest) -> HttpResponse:
    year, month = active_period()
    residents = Resident.objects.filter(residencies__year=year, residencies__month=month).distinct()
    balances = dict(
        AkEntry.objects.values_list("resident").annotate(b=Sum("delta")).values_list("resident", "b")
    )
    rows = sorted(((r, balances.get(r.id, 0)) for r in residents), key=lambda t: t[1])
    return render(request, "ak/overview.html", {"rows": rows, "period": f"{year}-{month:02d}"})


@role_required("ak")
def resident_log(request: HttpRequest, pk: int) -> HttpResponse:
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
def add_entry(request: HttpRequest, pk: int) -> HttpResponseRedirect:
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
            created_by=current_resident(request),
            created_at=timezone.now(),
        )
    return redirect("ak:log", pk=pk)


@require_POST
@role_required("ak")
def delete_entry(request: HttpRequest, pk: int, entry_id: int) -> HttpResponseRedirect:
    AkEntry.objects.filter(id=entry_id, resident_id=pk).delete()
    return redirect("ak:log", pk=pk)
