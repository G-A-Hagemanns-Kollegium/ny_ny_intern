"""Ølkælder views (F-003). Kiosk (LAN-IP gated, no login) for the till; member balance view;
ølkælder-admin screens for deposits/balances."""

import json
from datetime import datetime
from typing import TypedDict

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from residents.permissions import current_resident, role_required

from .models import Deposit, Product, PurchaseShare, Shopper
from .services import record_deposit, record_purchase


class _Entry(TypedDict):
    created_at: datetime
    text: str
    amount_ore: int


def _client_ip(request: HttpRequest) -> str:
    """The till's real IP. Behind Coolify/Traefik, REMOTE_ADDR is the proxy, so trust the last hop of
    X-Forwarded-For (the IP Traefik observed — the rightmost entry is the one it appended, not a value
    a client could spoof). Safe only because gunicorn is reachable *only* via the proxy."""
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if xff:
        return xff.split(",")[-1].strip()
    return request.META.get("REMOTE_ADDR", "")


def _is_kiosk(request: HttpRequest) -> bool:
    return settings.DEBUG or _client_ip(request) in settings.OELKAELDER_KIOSK_IPS


def shop(request: HttpRequest) -> HttpResponse:
    if not _is_kiosk(request):
        raise PermissionDenied("Tillen er kun tilgængelig fra kollegiets netværk.")
    products = Product.objects.filter(active=True).order_by("-highlighted", "name")
    shoppers = Shopper.objects.filter(active=True).select_related("resident").order_by("resident__first_name")
    # Tiles are server-rendered (the till's iPad runs iOS 10.3 and cannot use the Alpine/Tailwind
    # bundle); the template's inline ES5 only enhances them. See app/templates/oelkaelder/shop.html.
    return render(request, "oelkaelder/shop.html", {"products": products, "shoppers": shoppers})


@require_POST
def purchase(request: HttpRequest) -> HttpResponseRedirect:
    if not _is_kiosk(request):
        raise PermissionDenied
    shopper_ids = [int(x) for x in request.POST.getlist("shopper")]
    try:
        lines = json.loads(request.POST.get("basket", "[]"))
        if not isinstance(lines, list):
            raise ValueError("Ugyldig kurv.")
        txn = record_purchase(shopper_ids, lines)
        messages.success(request, f"Køb registreret (#{txn.id}).")
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, Product.DoesNotExist) as e:
        messages.error(request, str(e) or "Ugyldigt køb.")
    return redirect("oelkaelder:shop")


@login_required
def my_balance(request: HttpRequest) -> HttpResponse:
    """Balance + a combined account statement (deposits as credits, purchase shares as debits)."""
    accounts = list(current_resident(request).shopper_accounts.all())
    shares = (
        PurchaseShare.objects.filter(shopper__in=accounts, transaction__is_valid=True)
        .select_related("transaction")
        .prefetch_related("transaction__items__product")
    )
    deposits = Deposit.objects.filter(shopper__in=accounts, is_valid=True)
    entries: list[_Entry] = [
        _Entry(
            created_at=s.transaction.created_at,
            text=", ".join(f"{i.quantity}× {i.product.name}" for i in s.transaction.items.all()) or "Køb",
            amount_ore=-s.share_ore,  # debit
        )
        for s in shares
    ] + [
        _Entry(created_at=d.created_at, text="Indbetaling", amount_ore=d.amount_ore)  # credit
        for d in deposits
    ]
    entries.sort(key=lambda e: e["created_at"], reverse=True)
    return render(
        request,
        "oelkaelder/my.html",
        {
            "accounts": [(a, a.balance_ore) for a in accounts],
            "entries": entries[:100],
        },
    )


@role_required("oelkaelder")
def admin(request: HttpRequest) -> HttpResponse:
    shoppers = Shopper.objects.filter(active=True).select_related("resident")
    rows = sorted(((s, s.balance_ore) for s in shoppers), key=lambda t: t[1])
    deposits = (
        Deposit.objects.filter(is_valid=True).select_related("shopper__resident").order_by("-created_at")[:15]
    )
    return render(request, "oelkaelder/admin.html", {"rows": rows, "deposits": deposits})


@require_POST
@role_required("oelkaelder")
def add_deposit(request: HttpRequest, pk: int) -> HttpResponseRedirect:
    shopper = get_object_or_404(Shopper, pk=pk)
    try:
        kr = float(request.POST.get("amount_kr", "0").replace(",", "."))
        record_deposit(shopper, round(kr * 100))
        messages.success(request, f"Indbetaling registreret for {shopper.resident.full_name}.")
    except ValueError as e:
        messages.error(request, str(e))
    return redirect("oelkaelder:admin")


@require_POST
@role_required("oelkaelder")
def void_deposit(request: HttpRequest, pk: int) -> HttpResponseRedirect:
    """Soft-delete a mistaken deposit (is_valid=False) — the balance is derived, so it just drops out."""
    deposit = get_object_or_404(Deposit, pk=pk, is_valid=True)
    deposit.is_valid = False
    deposit.save(update_fields=["is_valid"])
    messages.success(request, "Indbetaling annulleret.")
    return redirect("oelkaelder:admin")


# ---- product & price management (ØK role) ----
def _kr_to_ore(value: str) -> int:
    ore = round(float((value or "0").replace(",", ".")) * 100)
    if ore <= 0:
        raise ValueError("Prisen skal være positiv.")
    return ore


@role_required("oelkaelder")
def products(request: HttpRequest) -> HttpResponse:
    """Manage the kiosk assortment: name, price, in/out of the till, featured, and image."""
    return render(
        request,
        "oelkaelder/products.html",
        {"products": Product.objects.order_by("-active", "-highlighted", "name")},
    )


@require_POST
@role_required("oelkaelder")
def product_create(request: HttpRequest) -> HttpResponseRedirect:
    name = (request.POST.get("name") or "").strip()
    if not name:
        messages.error(request, "Produktet skal have et navn.")
        return redirect("oelkaelder:products")
    try:
        price_ore = _kr_to_ore(request.POST.get("price_kr", ""))
    except ValueError as e:
        messages.error(request, str(e))
        return redirect("oelkaelder:products")
    Product.objects.create(
        name=name,
        price_ore=price_ore,
        active="active" in request.POST,
        highlighted="highlighted" in request.POST,
        image=request.FILES.get("image") or "",
    )
    messages.success(request, f"«{name}» oprettet.")
    return redirect("oelkaelder:products")


@require_POST
@role_required("oelkaelder")
def product_update(request: HttpRequest, pk: int) -> HttpResponseRedirect:
    product = get_object_or_404(Product, pk=pk)
    name = (request.POST.get("name") or "").strip()
    if not name:
        messages.error(request, "Produktet skal have et navn.")
        return redirect("oelkaelder:products")
    try:
        product.price_ore = _kr_to_ore(request.POST.get("price_kr", ""))
    except ValueError as e:
        messages.error(request, str(e))
        return redirect("oelkaelder:products")
    product.name = name
    product.active = "active" in request.POST
    product.highlighted = "highlighted" in request.POST
    if request.FILES.get("image"):
        product.image = request.FILES["image"]
    product.save()
    messages.success(request, f"«{name}» opdateret.")
    return redirect("oelkaelder:products")
