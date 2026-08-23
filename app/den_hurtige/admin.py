from django.contrib import admin

from .models import ChannelMute, PushSubscription, QuickComment, QuickPost


class QuickCommentInline(admin.TabularInline):
    model = QuickComment
    extra = 0
    readonly_fields = ("author", "created_at")


@admin.register(QuickPost)
class QuickPostAdmin(admin.ModelAdmin):
    list_display = ("author", "channel", "created_at", "expires_at", "is_expired")
    # `channel` is a free CharField (the registry lives in code, not this table), so the filter
    # lists the slugs actually in use rather than the ones currently defined — which is the more
    # useful question in the admin anyway: it shows leftovers from a retired channel.
    list_filter = ("channel", "created_at")
    search_fields = ("content", "author__first_name", "author__last_name", "author__email")
    readonly_fields = ("created_at",)
    inlines = [QuickCommentInline]


@admin.register(QuickComment)
class QuickCommentAdmin(admin.ModelAdmin):
    list_display = ("author", "post", "created_at", "notify_everyone")
    readonly_fields = ("created_at",)


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    """Read-only: rows are written by the browser and are useless if hand-edited. Deleting one is
    the supported action — it just means that device stops getting notifications."""

    list_display = ("user", "user_agent", "created_at")
    search_fields = ("user__first_name", "user__last_name", "user__email")
    readonly_fields = ("user", "endpoint", "auth", "p256dh", "user_agent", "created_at")

    def has_add_permission(self, request: object) -> bool:
        return False


@admin.register(ChannelMute)
class ChannelMuteAdmin(admin.ModelAdmin):
    """Mostly a support tool: "why am I not getting notifications from i-byen?" is answered here."""

    list_display = ("resident", "channel", "created_at")
    list_filter = ("channel",)
    search_fields = ("resident__first_name", "resident__last_name", "resident__email")
    readonly_fields = ("created_at",)
