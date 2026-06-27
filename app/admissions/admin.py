from django.contrib import admin

from .models import Application


@admin.register(Application)
class ApplicationAdmin(admin.ModelAdmin):
    list_display = ("full_name", "type", "email", "submitted_at", "received_by")
    list_filter = ("type", "gender")
    search_fields = ("full_name", "email", "university")
    date_hierarchy = "submitted_at"
