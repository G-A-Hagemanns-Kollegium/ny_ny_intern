"""CMS editing in Django admin — the single, role-gated write path back into page content.

Per F-006 the CMS is otherwise a read-only renderer of code/fixture-managed content. This re-enables
editing of Pages / news / events, but ties access to the **monthly `administrator` role** (or a
superuser) via `has_active_role` — not Django's per-model permission bits (role-holders have `is_staff`
but no perms, so without these overrides they'd see nothing).

Note: `Page.body` is rendered with `|safe`, so an administrator can inject arbitrary HTML — acceptable
because `administrator` is the top, trusted role. Add HTML sanitization on save if you want defence in
depth.
"""

from django import forms
from django.contrib import admin

from residents.permissions import has_active_role

from .models import Event, NewsItem, Page
from .sanitize import clean_html


class PageAdminForm(forms.ModelForm):
    class Meta:
        model = Page
        fields = "__all__"

    def clean_body(self):
        return clean_html(self.cleaned_data.get("body", ""))


class NewsItemAdminForm(forms.ModelForm):
    class Meta:
        model = NewsItem
        fields = "__all__"

    def clean_body(self):
        return clean_html(self.cleaned_data.get("body", ""))


class EventAdminForm(forms.ModelForm):
    class Meta:
        model = Event
        fields = "__all__"

    def clean_description(self):
        return clean_html(self.cleaned_data.get("description", ""))


class AdministratorContentAdmin(admin.ModelAdmin):
    """Base admin whose every access check requires the real `administrator` role (or superuser)."""

    def _may(self, request):
        return has_active_role(request.user, "administrator")

    def has_module_permission(self, request):
        return self._may(request)

    def has_view_permission(self, request, obj=None):
        return self._may(request)

    def has_add_permission(self, request):
        return self._may(request)

    def has_change_permission(self, request, obj=None):
        return self._may(request)

    def has_delete_permission(self, request, obj=None):
        return self._may(request)


@admin.register(Page)
class PageAdmin(AdministratorContentAdmin):
    form = PageAdminForm
    list_display = ("header", "slug", "menu_category")
    list_display_links = ("header",)
    search_fields = ("header", "slug", "body")
    fieldsets = (
        (None, {"fields": ("slug", "menu_category", "header", "background_image")}),
        (
            "Indhold (HTML)",
            {
                "fields": ("body",),
                "description": "Rå HTML — vises som den er. Billed-stier (/public/… eller /static/legacy/…) "
                "skal findes under static/legacy/ (kør sync_cms_media efter behov).",
            },
        ),
    )


@admin.register(NewsItem)
class NewsItemAdmin(AdministratorContentAdmin):
    form = NewsItemAdminForm
    list_display = ("title", "published_at")
    search_fields = ("title", "body")
    ordering = ("-published_at",)


@admin.register(Event)
class EventAdmin(AdministratorContentAdmin):
    form = EventAdminForm
    list_display = ("title", "starts_on")
    search_fields = ("title", "description")
    ordering = ("starts_on",)
