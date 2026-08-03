"""Create the "Regnskab" embedsgruppe so indstilling can assign it (and thereby grant the new
`regnskab` role via WORKGROUP_ROLE). Idempotent — safe whether or not the group already exists."""

from django.db import migrations


def create_regnskab(apps, schema_editor) -> None:  # noqa: ANN001
    Workgroup = apps.get_model("core", "Workgroup")
    Workgroup.objects.get_or_create(name="Regnskabsgruppen")


def remove_regnskab(apps, schema_editor) -> None:  # noqa: ANN001
    # Only remove it if no one is assigned to it, to avoid clobbering real data on a rollback.
    Workgroup = apps.get_model("core", "Workgroup")
    Workgroup.objects.filter(name="Regnskabsgruppen", residencies__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [("core", "0002_cleaning_size_workgroup_size")]

    operations = [migrations.RunPython(create_regnskab, remove_regnskab)]
