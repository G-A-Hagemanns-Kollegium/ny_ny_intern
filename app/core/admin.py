from django.contrib import admin

from .models import Cleaning, PushSubscription, Room, Workgroup


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ("number", "legacy_index", "floor", "side", "note")
    ordering = ("number",)


@admin.register(Workgroup)
class WorkgroupAdmin(admin.ModelAdmin):
    list_display = ("name", "size", "legacy_id")
    list_editable = ("size",)  # required embedsgruppe size, editable per year
    ordering = ("name",)


@admin.register(Cleaning)
class CleaningAdmin(admin.ModelAdmin):
    list_display = ("name", "size", "legacy_id")
    list_editable = ("size",)  # required cleaning-group size, editable per year
    ordering = ("name",)


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    """Read-only apart from the topic flags: the rest of the row is written by the browser and is
    useless if hand-edited. Deleting one is the supported action — it just means that device stops
    getting notifications."""

    list_display = ("user", "wants_den_hurtige", "wants_opslagstavle", "user_agent", "created_at")
    list_filter = ("wants_den_hurtige", "wants_opslagstavle")
    search_fields = ("user__first_name", "user__last_name", "user__email")
    readonly_fields = ("user", "endpoint", "auth", "p256dh", "user_agent", "created_at")

    def has_add_permission(self, request: object) -> bool:
        return False
