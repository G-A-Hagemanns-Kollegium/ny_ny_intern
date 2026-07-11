from django.urls import path

from . import views

app_name = "oelkaelder"

urlpatterns = [
    path("", views.shop, name="shop"),
    path("purchase", views.purchase, name="purchase"),
    path("min-saldo", views.my_balance, name="my"),
    path("admin", views.admin, name="admin"),
    path("deposit/<int:pk>", views.add_deposit, name="deposit"),
    path("deposit/<int:pk>/annuller", views.void_deposit, name="void_deposit"),
    path("admin/produkter", views.products, name="products"),
    path("admin/produkter/opret", views.product_create, name="product_create"),
    path("admin/produkter/<int:pk>", views.product_update, name="product_update"),
]
