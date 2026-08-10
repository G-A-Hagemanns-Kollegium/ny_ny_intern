"""CMS editing in Django admin — the single, role-gated write path back into page content.

Per F-006 the CMS is otherwise a read-only renderer of code/fixture-managed content. This re-enables
editing of Pages / news / events, tied to the **content-editor roles** — administrator, indstilling,
inspektion and pr (the frontpage/PR group) — or a superuser, via `has_active_role`. Django's per-model
permission bits are not used (role-holders have `is_staff` but no perms, so without these overrides
they'd see nothing).

`Page.body` etc. are rendered with `|safe`, but every editable field is run through `clean_html` on
save (see the *AdminForm classes), so a content editor cannot inject scripts/dangerous HTML.
"""

from django import forms
from django.contrib import admin
from django.http import HttpRequest

from residents.permissions import CMS_EDITOR_ROLES, has_active_role

from .models import Event, NewsItem, Page
from .sanitize import clean_html


class PageAdminForm(forms.ModelForm):
    class Meta:
        model = Page
        fields = ["slug", "menu_category", "header", "body", "background_image"]

    def clean_body(self) -> str | None:
        return clean_html(self.cleaned_data.get("body", ""))


class NewsItemAdminForm(forms.ModelForm):
    class Meta:
        model = NewsItem
        fields = ["title", "body", "published_at"]

    def clean_body(self) -> str | None:
        return clean_html(self.cleaned_data.get("body", ""))


class EventAdminForm(forms.ModelForm):
    class Meta:
        model = Event
        fields = ["title", "description", "starts_on"]

    def clean_description(self) -> str | None:
        return clean_html(self.cleaned_data.get("description", ""))


class ContentEditorAdmin(admin.ModelAdmin):
    """Base admin whose every access check requires one of the real CMS-editor roles (or superuser)."""

    def _may(self, request: HttpRequest) -> bool:
        return has_active_role(request.user, *CMS_EDITOR_ROLES)

    def has_module_permission(self, request: HttpRequest) -> bool:
        return self._may(request)

    def has_view_permission(self, request: HttpRequest, obj: object | None = None) -> bool:
        return self._may(request)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return self._may(request)

    def has_change_permission(self, request: HttpRequest, obj: object | None = None) -> bool:
        return self._may(request)

    def has_delete_permission(self, request: HttpRequest, obj: object | None = None) -> bool:
        return self._may(request)


@admin.register(Page)
class PageAdmin(ContentEditorAdmin):
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
class NewsItemAdmin(ContentEditorAdmin):
    form = NewsItemAdminForm
    list_display = ("title", "published_at")
    search_fields = ("title", "body")
    ordering = ("-published_at",)


@admin.register(Event)
class EventAdmin(ContentEditorAdmin):
    form = EventAdminForm
    list_display = ("title", "starts_on")
    search_fields = ("title", "description")
    ordering = ("starts_on",)
