from django.apps import AppConfig
from django.core.checks import register


class DenHurtigeConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "den_hurtige"
    verbose_name = "Den Hurtige"

    def ready(self) -> None:
        # Only the channel registry is validated here. The VAPID key pair moved to core.apps with
        # the rest of the push stack — the keys are shared with opslagstavlen, so they are not this
        # feature's to check any more.
        from .checks import check_channels

        register(check_channels)
