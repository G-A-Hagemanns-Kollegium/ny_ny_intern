"""Root URLconf. Preserves the legacy public URLs (`/`, Danish slugs incl. multi-segment ones like
`faciliteter/vaerelse`) for SEO. Django's own admin is moved to /django-admin/ so the legacy public-site
admin can keep /admin later (F-002)."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path

from cms import views as cms_views

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("nyintern/", include("residents.urls")),
    path("optagelse/", include("admissions.urls")),
    path("admin/", include("residents.urls_admin")),  # legacy public-site admin (F-002)
    path("", cms_views.home, name="home"),
    path("begivenheder/", cms_views.events_news, name="events_news"),
    # catch-all CMS page lookup by (possibly multi-segment) slug — must stay last
    re_path(r"^(?P<url_path>[\w/-]+?)/?$", cms_views.page, name="page"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
