from django.contrib import admin

from .models import QuickComment, QuickPost


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
