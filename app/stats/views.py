"""Statistics (F-012) — members-only (the legacy JSON feeders were unauthenticated). The "this year"
figures are correctly year-scoped (legacy bug used all-time)."""

from django.contrib.auth.decorators import login_required
from django.db.models import Count
from django.shortcuts import render
from django.utils import timezone

from admissions.models import Application
from stats.models import DailyVisitCount


@login_required
def stats(request):
    now = timezone.localtime()
    by_type = dict(Application.objects.values_list("type").annotate(c=Count("id")).values_list("type", "c"))
    # this-year "heard about us" for tours — year-scoped (the donut the legacy got wrong)
    heard_this_year = list(
        Application.objects.filter(type=Application.Type.TOUR, submitted_at__year=now.year)
        .exclude(heard_about_us="")
        .values("heard_about_us")
        .annotate(c=Count("id"))
        .order_by("-c")
    )
    by_university = list(
        Application.objects.filter(type=Application.Type.TOUR, submitted_at__year=now.year)
        .exclude(university="")
        .values("university")
        .annotate(c=Count("id"))
        .order_by("-c")[:15]
    )
    visits = DailyVisitCount.objects.order_by("-date")[:30]
    return render(
        request,
        "statistik/stats.html",
        {
            "year": now.year,
            "tours": by_type.get(Application.Type.TOUR, 0),
            "sublets": by_type.get(Application.Type.SUBLET, 0),
            "heard": heard_this_year,
            "universities": by_university,
            "visits": visits,
        },
    )
