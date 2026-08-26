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
from django.conf import settings
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.urls import URLPattern, path
from django.utils.html import format_html

from core.uploads import validate_image_upload
from residents.permissions import CMS_EDITOR_ROLES, current_resident, has_active_role

from .models import CmsImage, Event, NewsItem, Page
from .sanitize import clean_html


class BodyEditorMixin:
    """Adds the upload/insert toolbar above a form's HTML fields.

    Plain admin-side JavaScript: Django admin does not load the Vite bundle (that is the intern
    shell only), so this cannot use Alpine or htmx and never goes through the frontend build.
    """

    class Media:
        js = ("cms/insert_image.js",)


class PageAdminForm(BodyEditorMixin, forms.ModelForm):
    class Meta:
        model = Page
        fields = ["slug", "menu_category", "header", "body", "background_image"]

    def __init__(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        super().__init__(*args, **kwargs)
        # Pick the background from the library rather than typing a path. The model field stays a
        # CharField — no migration, no data change, only the widget differs. Whatever is stored today
        # is kept as an option, so the migrated /public/… paths round-trip untouched.
        current = self.instance.background_image if self.instance else ""
        choices: list[tuple[str, str]] = [("", "— ingen —")]
        choices += [(image.url, str(image)) for image in CmsImage.objects.all()]
        if current and current not in {value for value, _label in choices}:
            choices.insert(1, (current, f"{current} (nuværende)"))
        self.fields["background_image"] = forms.ChoiceField(
            choices=choices, required=False, label="Baggrundsbillede"
        )

    def clean_body(self) -> str | None:
        return clean_html(self.cleaned_data.get("body", ""))


class NewsItemAdminForm(BodyEditorMixin, forms.ModelForm):
    class Meta:
        model = NewsItem
        fields = ["title", "body", "published_at"]

    def clean_body(self) -> str | None:
        return clean_html(self.cleaned_data.get("body", ""))


class EventAdminForm(BodyEditorMixin, forms.ModelForm):
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
                "description": "Rå HTML — vises som den er. Brug knappen over feltet til at uploade "
                "og indsætte billeder. Gamle stier (/public/… eller /static/legacy/…) virker "
                "fortsat; de ligger under static/legacy/ (kør sync_cms_media efter behov).",
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


class CmsImageAdminForm(forms.ModelForm):
    class Meta:
        model = CmsImage
        fields = ["file", "caption"]

    def clean_file(self) -> object:
        upload = self.cleaned_data.get("file")
        # Validate only a *new* upload: re-saving an existing row hands back a FieldFile, which has
        # no content_type and would fail a check aimed at browser uploads.
        if upload and hasattr(upload, "content_type"):
            validate_image_upload(upload, settings.CMS_IMAGE_MAX_MB)
        return upload


@admin.register(CmsImage)
class CmsImageAdmin(ContentEditorAdmin):
    """The image library: upload here, then insert from the toolbar above any body field.

    Replaces the old workflow of committing a file to the repo and hand-writing its path.
    """

    form = CmsImageAdminForm
    list_display = ("thumbnail", "__str__", "url_display", "uploaded_at", "uploaded_by")
    list_display_links = ("thumbnail", "__str__")
    search_fields = ("caption", "file")
    readonly_fields = ("uploaded_at", "uploaded_by", "usage")

    @admin.display(description="")
    def thumbnail(self, obj: CmsImage) -> str:
        if not obj.file:
            return ""
        return format_html('<img src="{}" alt="" style="height:40px;border-radius:4px">', obj.url)

    @admin.display(description="URL")
    def url_display(self, obj: CmsImage) -> str:
        # user-select:all so one click grabs the whole path. The toolbar is the normal route; this
        # stays the escape hatch for hand-written HTML.
        return format_html('<code style="user-select:all">{}</code>', obj.url)

    @admin.display(description="Bruges på")
    def usage(self, obj: CmsImage) -> str:
        """Where the image is referenced, so deleting it does not silently 404 a live page.

        Computed only on the change form (one object at a time) — running four scans per row in the
        list view would be a table scan per image for information nobody is reading there.
        """
        if not obj.file:
            return "—"
        used = [
            *(f"Side: {p.header}" for p in Page.objects.filter(body__icontains=obj.url)),
            *(f"Nyhed: {n.title}" for n in NewsItem.objects.filter(body__icontains=obj.url)),
            *(f"Begivenhed: {e.title}" for e in Event.objects.filter(description__icontains=obj.url)),
            *(f"Baggrund: {p.header}" for p in Page.objects.filter(background_image=obj.url)),
        ]
        return ", ".join(used) if used else "Ingen steder endnu"

    def save_model(self, request: HttpRequest, obj: CmsImage, form: forms.ModelForm, change: bool) -> None:
        if not change:
            obj.uploaded_by = current_resident(request)
        super().save_model(request, obj, form, change)

    def get_urls(self) -> list[URLPattern]:
        # What the toolbar talks to. Declared here so they sit in the admin URL namespace and reuse
        # this class's role check — the same gate as every other CMS write.
        return [
            path("toolbar/list", self.admin_site.admin_view(self.toolbar_list), name="cms_image_list"),
            path(
                "toolbar/upload",
                self.admin_site.admin_view(self.toolbar_upload),
                name="cms_image_upload",
            ),
            *super().get_urls(),
        ]

    def toolbar_list(self, request: HttpRequest) -> HttpResponse:
        if not self._may(request):
            return JsonResponse({"error": "forbidden"}, status=403)
        return JsonResponse(
            {"images": [{"url": i.url, "label": str(i), "alt": i.caption} for i in CmsImage.objects.all()]}
        )

    def toolbar_upload(self, request: HttpRequest) -> HttpResponse:
        if not self._may(request):
            return JsonResponse({"error": "forbidden"}, status=403)
        if request.method != "POST":
            return JsonResponse({"error": "Kun POST."}, status=405)
        upload = request.FILES.get("file")
        if not upload:
            return JsonResponse({"error": "Vælg en fil."}, status=400)
        try:
            validate_image_upload(upload, settings.CMS_IMAGE_MAX_MB)
        except ValidationError as exc:
            return JsonResponse({"error": " ".join(exc.messages)}, status=400)
        image = CmsImage.objects.create(
            file=upload,
            caption=(request.POST.get("caption") or "").strip(),
            uploaded_by=current_resident(request),
        )
        return JsonResponse({"url": image.url, "label": str(image), "alt": image.caption}, status=201)
