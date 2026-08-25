"""Public CMS pages (F-006) — read-only rendering of migrated Page content.

Content is code/fixture-managed (no runtime editing), so the body is trusted GAHK copy and rendered
with `|safe` in the template. URLs match the legacy slugs (incl. multi-segment) for SEO.
"""

from django.db.models import Q
from django.http import Http404, HttpRequest, HttpResponse, HttpResponsePermanentRedirect
from django.shortcuts import render
from django.urls import Resolver404, resolve
from django.utils import timezone

from .models import Event, NewsItem, Page


def _section_nav(current: Page) -> tuple[str, list]:
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
    links = [{"url": "/" + (p.slug or ""), "header": p.header, "current": p.id == current.id} for p in pages]
    return section_title, links


def _render(request: HttpRequest, page: Page) -> HttpResponse:
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


def home(request: HttpRequest) -> HttpResponse:
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


def events_news(request: HttpRequest) -> HttpResponse:
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


def page(request: HttpRequest, url_path: str) -> HttpResponse:
    """Catch-all CMS lookup by slug, with a slash-appending fallback.

    This pattern is last in the URLconf but still matches *slashless* paths owned by a real app -
    `/optagelse`, `/nyintern`, `/intern`, `/begivenheder`. Because a pattern matched, Django's
    APPEND_SLASH never fires, so those legacy URLs 404ed instead of redirecting to their real view
    (the live PHP site served `/optagelse` with a 200, and `/intern` is how residents reach the
    portal; `/nyintern` redirects to it). Restore
    APPEND_SLASH's behaviour for exactly the paths this view swallows: if no CMS page owns the slug
    but `<path>/` resolves to some *other* view, 301 there.
    """
    slug = url_path.strip("/")
    if found := Page.objects.filter(slug=slug).first():
        return _render(request, found)

    candidate = f"/{slug}/"
    try:
        match = resolve(candidate)
    except Resolver404:
        raise Http404(f"No CMS page with slug {slug!r}") from None
    if match.func is page:  # the catch-all again - genuinely nothing here
        raise Http404(f"No CMS page with slug {slug!r}")
    query = request.META.get("QUERY_STRING", "")
    return HttpResponsePermanentRedirect(f"{candidate}?{query}" if query else candidate)
