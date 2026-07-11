from django.contrib import admin

from .models import Cleaning, Room, Workgroup


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
