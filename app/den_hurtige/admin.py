from django.contrib import admin

from .models import PushSubscription, QuickComment, QuickPost


class QuickCommentInline(admin.TabularInline):
    model = QuickComment
    extra = 0
    readonly_fields = ("author", "created_at")


@admin.register(QuickPost)
class QuickPostAdmin(admin.ModelAdmin):
    list_display = ("author", "created_at", "expires_at", "is_expired")
    list_filter = ("created_at",)
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
