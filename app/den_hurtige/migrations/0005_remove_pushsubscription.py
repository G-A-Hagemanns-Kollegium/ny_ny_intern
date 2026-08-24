"""Drop den_hurtige's ownership of PushSubscription. State only — core/0005 moved the real table.

Depends on core/0005 so the CreateModel there always runs first: with two migrations describing the
same table, the order is the difference between a clean state move and Django trying to create a
table that already exists.
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("den_hurtige", "0004_remove_quickreaction_uniq_reaction_per_author_and_more"),
        ("core", "0005_pushsubscription"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[migrations.DeleteModel(name="PushSubscription")],
            database_operations=[],
        ),
    ]
