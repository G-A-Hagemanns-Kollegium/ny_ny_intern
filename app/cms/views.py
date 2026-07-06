"""Public CMS pages (F-006) — read-only rendering of migrated Page content.

Content is code/fixture-managed (no runtime editing), so the body is trusted GAHK copy and rendered
with `|safe` in the template. URLs match the legacy slugs (incl. multi-segment) for SEO.
"""

from django.db.models import Q
from django.shortcuts import get_object_or_404, render
from django.utils import timezone

from .models import Event, NewsItem, Page


def _section_nav(current):
    """Sibling pages in the same top-level section (derived from the slug prefix) for the sidebar.

    Returns (section_title, links). Empty when the page stands alone (no siblings to list).
    """
    if not current.slug:
        return "", []
    section = current.slug.split("/")[0]
    pages = list(Page.objects.filter(Q(slug=section) | Q(slug__startswith=section + "/")).order_by("slug"))
    if len(pages) < 2:
        return "", []
    section_title = next((p.header for p in pages if p.slug == section), current.header)
    links = [{"url": "/" + p.slug, "header": p.header, "current": p.id == current.id} for p in pages]
    return section_title, links


def _render(request, page):
    section_title, section_links = _section_nav(page)
    return render(
        request,
        "cms/page.html",
        {
            "page": page,
            "bg_image": page.background_image,
            "section_title": section_title,
            "section_links": section_links,
        },
    )


HOME_HERO = "/public/image/upload/images/72352712_3043170802378120_6023122459278966784_n.jpg"


def home(request):
    # `/` is the canonical front page (legacy default_controller was page/show/1, "velkommen").
    page = Page.objects.filter(id=1).first()  # reuse its body as the intro text
    today = timezone.localdate()
    return render(
        request,
        "cms/home.html",
        {
            "page": page,
            "bg_image": HOME_HERO,
            "upcoming_events": Event.objects.filter(starts_on__gte=today).order_by("starts_on")[:3],
            "latest_news": NewsItem.objects.all()[:4],
        },
    )


def events_news(request):
    """Public "Nyheder & Begivenheder" page (F-007/F-008): upcoming + past events and the news archive."""
    today = timezone.localdate()
    return render(
        request,
        "cms/events_news.html",
        {
            "upcoming_events": Event.objects.filter(starts_on__gte=today).order_by("starts_on"),
            "past_events": Event.objects.filter(starts_on__lt=today).order_by("-starts_on")[:20],
            "news": NewsItem.objects.all()[:40],
            "bg_image": "",
        },
    )


def page(request, url_path):
    return _render(request, get_object_or_404(Page, slug=url_path.strip("/")))
