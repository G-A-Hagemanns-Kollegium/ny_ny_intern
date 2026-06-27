"""Public CMS pages (F-006) — read-only rendering of migrated Page content.

Content is code/fixture-managed (no runtime editing), so the body is trusted GAHK copy and rendered
with `|safe` in the template. URLs match the legacy slugs (incl. multi-segment) for SEO.
"""
from django.shortcuts import get_object_or_404, render

from .models import Page


def _render(request, page):
    return render(request, "cms/page.html", {"page": page, "bg_image": page.background_image})


HOME_HERO = "/public/image/upload/images/72352712_3043170802378120_6023122459278966784_n.jpg"


def home(request):
    # `/` is the canonical front page (legacy default_controller was page/show/1, "velkommen").
    page = Page.objects.filter(id=1).first()  # reuse its body as the intro text
    return render(request, "cms/home.html", {"page": page, "bg_image": HOME_HERO})


def page(request, url_path):
    return _render(request, get_object_or_404(Page, slug=url_path.strip("/")))
