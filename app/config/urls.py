"""Root URLconf. Preserves the legacy public URLs (`/`, Danish slugs incl. multi-segment ones like
`faciliteter/vaerelse`) for SEO. Django's own admin is moved to /django-admin/ so the legacy public-site
admin can keep /admin later (F-002)."""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.generic import RedirectView, TemplateView
from django.views.static import serve

from cms import views as cms_views
from events import views as events_views

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("intern/", include("residents.urls")),
    re_path(r"^nyintern/(?P<rest>.*)$", RedirectView.as_view(url="/intern/%(rest)s", permanent=True)),
    path("optagelse/", include("admissions.urls")),
    path("admin/", include("residents.urls_admin")),  # legacy public-site admin (F-002)
    path("", cms_views.home, name="home"),
    path("begivenheder/", cms_views.events_news, name="events_news"),
    # The subscribable calendar feed, mounted at the ROOT rather than under /intern/ and carrying no
    # auth decorator — the token in the path is the credential (see events.views.calendar_feed).
    #
    # Root-mounted on purpose: if /intern/ is ever gated at the proxy, or somebody adds Django's
    # LoginRequiredMiddleware, a feed underneath it dies SILENTLY. Calendar clients do not report a
    # failed refresh; they just stop updating, which is the worst failure this feature can have.
    path("kalender/<str:token>.ics", events_views.calendar_feed, name="events_feed"),
    # User-uploaded media (room-inspection photos, relocated legacy images). Served by Django in EVERY
    # environment: WhiteNoise handles only *static*, and DEBUG-only serving would 404 these in prod.
    # Low volume for this app; the serve view is path-traversal-safe. Files are public by URL (as the
    # legacy /public/ images were).
    re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
    # PWA service worker for Den Hurtige. Must be served from the ROOT path: a service worker's
    # default scope is its own directory, so only a root-scoped worker covers /intern/. Served via
    # TemplateView because static/ would put it under /static/ and cap its scope there.
    path(
        "sw.js",
        TemplateView.as_view(template_name="sw.js", content_type="application/javascript"),
        name="pwa_service_worker",
    ),
    # catch-all CMS page lookup by (possibly multi-segment) slug — must stay last
    re_path(r"^(?P<url_path>[\w/-]+?)/?$", cms_views.page, name="page"),
]
