"""Keep `Resident.is_staff` in sync with holding any embedsgruppe role.

`is_staff` gates entry to /django-admin/. It should be True exactly when a resident holds at least one
RoleAssignment (any period), so assigning/removing a role — including directly in the DB or the site
admin — keeps admin access correct. Superusers are left untouched (they must stay staff regardless).
"""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import Resident, RoleAssignment


def _sync_is_staff(resident_id: int) -> None:
    has_any = RoleAssignment.objects.filter(resident_id=resident_id).exists()
    (
        Resident.objects.filter(id=resident_id)
        .exclude(is_superuser=True)
        .exclude(is_staff=has_any)
        .update(is_staff=has_any)
    )


@receiver(post_save, sender=RoleAssignment)
def role_added(sender: type[RoleAssignment], instance: RoleAssignment, **kwargs) -> None:  # noqa: ANN003
    _sync_is_staff(instance.resident_id)


@receiver(post_delete, sender=RoleAssignment)
def role_removed(sender: type[RoleAssignment], instance: RoleAssignment, **kwargs) -> None:  # noqa: ANN003
    _sync_is_staff(instance.resident_id)
