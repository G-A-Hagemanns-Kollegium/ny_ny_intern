from django.apps import AppConfig
from django.core.checks import register


class DenHurtigeConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "den_hurtige"
    verbose_name = "Den Hurtige"

    def ready(self) -> None:
        from .checks import check_vapid_public_key

        register(check_vapid_public_key)
