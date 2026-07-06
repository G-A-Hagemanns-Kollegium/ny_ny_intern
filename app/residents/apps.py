from django.apps import AppConfig


class ResidentsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "residents"

    def ready(self):
        from . import signals  # noqa: F401  (connect RoleAssignment → is_staff sync)
