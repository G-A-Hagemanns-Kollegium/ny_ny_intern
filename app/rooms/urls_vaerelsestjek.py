from django.urls import path

from . import views

app_name = "vaerelsestjek"

urlpatterns = [
    path("", views.overview, name="overview"),
    path("akoverview", views.akoverview, name="akoverview"),
    path("se/<int:room_id>", views.room, name="room"),
    path("besvar/<int:room_id>", views.besvar, name="besvar"),
]
