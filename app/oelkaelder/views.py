"""Ølkælder views (F-003). Kiosk (LAN-IP gated, no login) for the till; member balance view;
ølkælder-admin screens for deposits/balances."""
from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.db.models import Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from residents.permissions import role_required

from .models import Product, Shopper
from .services import record_deposit, record_purchase


def _is_kiosk(request):
    return settings.DEBUG or request.META.get("REMOTE_ADDR") in settings.OELKAELDER_KIOSK_IPS


def shop(request):
    if not _is_kiosk(request):
        raise PermissionDenied("Tillen er kun tilgængelig fra kollegiets netværk.")
    return render(request, "oelkaelder/shop.html", {
        "products": Product.objects.filter(active=True).order_by("name"),
        "shoppers": Shopper.objects.filter(active=True).select_related("resident"),
    })


@require_POST
def purchase(request):
    if not _is_kiosk(request):
        raise PermissionDenied
    shopper_ids = request.POST.getlist("shopper")
    quantities = {}
    for p in Product.objects.filter(active=True):
        q = request.POST.get(f"qty_{p.id}", "")
        if q.isdigit() and int(q) > 0:
            quantities[p.id] = int(q)
    try:
        txn = record_purchase(shopper_ids, quantities)
        messages.success(request, f"Køb registreret (#{txn.id}).")
    except ValueError as e:
        messages.error(request, str(e))
    return redirect("oelkaelder:shop")


@login_required
def my_balance(request):
    accounts = request.user.shopper_accounts.all()
    return render(request, "oelkaelder/my.html", {
        "accounts": [(a, a.balance_ore) for a in accounts],
    })


@role_required("oelkaelder")
def admin(request):
    shoppers = Shopper.objects.filter(active=True).select_related("resident")
    rows = sorted(((s, s.balance_ore) for s in shoppers), key=lambda t: t[1])
    return render(request, "oelkaelder/admin.html", {"rows": rows})


@require_POST
@role_required("oelkaelder")
def add_deposit(request, pk):
    shopper = get_object_or_404(Shopper, pk=pk)
    try:
        kr = float(request.POST.get("amount_kr", "0").replace(",", "."))
        record_deposit(shopper, round(kr * 100))
        messages.success(request, f"Indbetaling registreret for {shopper.resident.full_name}.")
    except ValueError as e:
        messages.error(request, str(e))
    return redirect("oelkaelder:admin")
