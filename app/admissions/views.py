"""Admissions views (F-001).

Public: tour (rundvisning) and sublet (fremleje) forms. Per the 2026-06 decisions:
  * rundvisning notifies the committee (indstillingen) + sends the applicant an auto-reply;
  * fremleje sends the applicant an auto-reply only — the committee is NOT emailed (the request just
    appears in the list view).
Admin (role `indstilling`): list / detail / mark-received. Mark-received is POST-only (the legacy
GET was CSRF-able). All fixes from F-001 (mass-assignment, SQLi, auth, CSRF) are structural here.
"""

import json
import logging
import urllib.parse
import urllib.request

from django.conf import settings
from django.contrib import messages
from django.core.mail import send_mail
from django.core.paginator import Paginator
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from residents.permissions import role_required

from .forms import FremlejeForm, RundvisningForm
from .models import Application

logger = logging.getLogger(__name__)

# Cloudflare Turnstile server-side verification endpoint (fixed, HTTPS-only).
TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def index(request):
    return render(request, "optagelse/landing.html")


def _verify_turnstile(request):
    """Verify the Cloudflare Turnstile token. Skipped (returns True) when no secret is configured (dev)."""
    secret = settings.TURNSTILE_SECRET_KEY
    if not secret:
        return True
    token = request.POST.get("cf-turnstile-response", "")
    if not token:
        return False
    data = urllib.parse.urlencode(
        {
            "secret": secret,
            "response": token,
            "remoteip": request.META.get("REMOTE_ADDR", ""),
        }
    ).encode()
    try:
        # URL is a fixed HTTPS constant, not user-controlled — safe from B310 scheme abuse.
        with urllib.request.urlopen(TURNSTILE_VERIFY_URL, data=data, timeout=5) as resp:  # nosec B310
            return bool(json.loads(resp.read()).get("success"))
    except Exception:
        logger.warning("Turnstile verification request failed", exc_info=True)
        return False


def _apply(request, form_class, app_type, post_url, title, notify_committee, show_criteria=False, intro=""):
    form = form_class()
    if request.method == "POST":
        form = form_class(request.POST)
        turnstile_ok = _verify_turnstile(request)
        if form.is_valid() and turnstile_ok:
            app = form.save(commit=False)
            app.type = app_type
            app.submitted_at = timezone.now()
            app.save()
            _send_emails(app, notify_committee)
            return redirect("admissions:success")
        if not turnstile_ok:
            messages.error(request, "Captcha-verifikation fejlede. Prøv igen.")
    return render(
        request,
        "optagelse/apply_form.html",
        {
            "form": form,
            "post_url": post_url,
            "title": title,
            "show_criteria": show_criteria,
            "intro": intro,
            "turnstile_site_key": settings.TURNSTILE_SITE_KEY,
        },
    )


def ansoeg(request):
    return _apply(
        request,
        RundvisningForm,
        Application.Type.TOUR,
        "admissions:send_rundvisning",
        "Anmod om rundvisning",
        notify_committee=True,
        show_criteria=True,
        intro=(
            "Udfyld formularen for at anmode om en rundvisning. Indstillingen kontakter dig, "
            "hvis der er udsigt til ledige værelser, og din profil passer."
        ),
    )


def fremlej(request):
    return _apply(
        request,
        FremlejeForm,
        Application.Type.SUBLET,
        "admissions:send_fremleje",
        "Ansøg om fremleje",
        notify_committee=False,
        intro=("Skal du fremleje et værelse midlertidigt? Udfyld formularen, så vender vi tilbage til dig."),
    )


def success(request):
    return render(request, "optagelse/success.html")


def _send_emails(app, notify_committee):
    """Best-effort; a mail failure must not lose the saved application."""
    try:
        if notify_committee:
            body = (
                f"Ny {app.get_type_display().lower()}-anmodning:\n\n"
                f"Navn: {app.full_name}\nE-mail: {app.email}\nAlder: {app.age}\n"
                f"Hørt om os: {app.heard_about_us}\n\nMotivation:\n{app.motivation}\n"
            )
            send_mail(
                f"GAHK {app.get_type_display()}: {app.full_name}",
                body,
                settings.DEFAULT_FROM_EMAIL,
                [settings.INDSTILLING_EMAIL],
                fail_silently=True,
            )
        send_mail(
            "GAHK – vi har modtaget din henvendelse",
            f"Kære {app.full_name}\n\nTak for din henvendelse. Vi vender tilbage.\n\nMvh. Indstillingen",
            settings.DEFAULT_FROM_EMAIL,
            [app.email],
            fail_silently=True,
        )
    except Exception:
        logger.exception("Failed sending admissions email for application %s", app.pk)


# ---- indstilling review ----
@role_required("indstilling")
def list_applications(request):
    qs = Application.objects.select_related("received_by")
    page = Paginator(qs, 50).get_page(request.GET.get("page"))
    return render(request, "optagelse/list.html", {"page_obj": page})


@role_required("indstilling")
def show_application(request, pk):
    app = get_object_or_404(Application, pk=pk)
    return render(request, "optagelse/detail.html", {"app": app})


@require_POST
@role_required("indstilling")
def mark_received(request, pk):
    app = get_object_or_404(Application, pk=pk)
    if not app.received_by_id:
        app.received_by = request.user
        app.received_at = timezone.now()
        app.save(update_fields=["received_by", "received_at"])
    return redirect("admissions:show", pk=pk)
