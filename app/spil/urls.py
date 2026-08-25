from django.urls import path

from . import views

app_name = "spil"

urlpatterns = [
    path("", views.play, name="play"),
]
