from django.contrib import admin

from .models import OelkaelderOffer


@admin.register(OelkaelderOffer)
class OelkaelderOfferAdmin(admin.ModelAdmin):
    list_display = ("title", "price_text", "is_active", "priority", "starts_at", "ends_at")
    list_filter = ("is_active",)
    search_fields = ("title", "description", "price_text")
    ordering = ("priority", "starts_at", "-created_at")
