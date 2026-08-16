from django.urls import path

from . import views

app_name = "den_hurtige"

urlpatterns = [
    path("", views.feed, name="feed"),
    path("opslag", views.feed_items, name="feed_items"),  # htmx poll target (partial, not a page)
    path("opret", views.create_post, name="create_post"),
    path("<int:pk>/kommentar", views.create_comment, name="create_comment"),
    path("<int:pk>/slet", views.delete_post, name="delete_post"),
    # Where frontend/src/push.ts registers/removes a device (login-gated, CSRF-protected).
    path("abonner", views.save_subscription, name="save_subscription"),
]
