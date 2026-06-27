from django.urls import path

from . import views

app_name = "oelkaelder"

urlpatterns = [
    path("", views.shop, name="shop"),
    path("purchase", views.purchase, name="purchase"),
    path("min-saldo", views.my_balance, name="my"),
    path("admin", views.admin, name="admin"),
    path("deposit/<int:pk>", views.add_deposit, name="deposit"),
]
