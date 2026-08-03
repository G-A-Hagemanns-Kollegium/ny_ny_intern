"""Seed the two debt-warning e-mails (pk 1 = under 0 kr, pk 2 = under -100 kr) and the single-row
InterestPolicy. Idempotent get_or_create — safe whether or not the ETL already populated them."""

from django.db import migrations

WARNING_1 = """INFORMATION FRA ØL-KÆLDEREN:

OBS: Din saldo er under 0 kr.
Når din gæld overstiger 100 kr bliver der pålagt en rente på 5 % hver måned!

Indbetal venligst til Øl-Kælderens konto snarest:

       Reg.nr. 9070
       Konto nr. 1642635456

Din bruger og saldo:
Din bruger har en saldo, som du kan se på Gahk.dk/intern. Du har selv ansvaret for, at din saldo forbliver positiv. Øl-Kælderen tjekker alle alumners saldo jævnligt, men det kan ikke forventes, at det bliver registeret øjeblikkeligt.

Har du spørgsmål? Snak med en fra øl-kælderen!

VH Øl-Kælderen på GAHK"""

WARNING_2 = """INFORMATION FRA ØL-KÆLDEREN:

OBS: Din saldo er under minus 100 kr!!
Vi begynder nu at trække 5 % i rente hver måned! Så sørg for at indbetal din gæld hurtigst muligt, så du undgår renter.

Indbetaling til Øl-Kælderens konto gøres til:

       Reg.nr. 9070
       Konto nr. 1642635456

Din bruger og saldo:
Din bruger har en saldo, som du kan se på Gahk.dk/intern. Du har selv ansvaret for, at din saldo forbliver positiv. Øl-Kælderen tjekker alle alumners saldo jævnligt, men det kan ikke forventes, at det bliver registeret øjeblikkeligt.

Har du spørgsmål? Snak med en fra Øl-Kælderen!

VH Øl-Kælderen på GAHK"""


def seed(apps, schema_editor) -> None:  # noqa: ANN001
    Warning = apps.get_model("oelkaelder", "Warning")
    InterestPolicy = apps.get_model("oelkaelder", "InterestPolicy")
    Warning.objects.get_or_create(id=1, defaults={"message": WARNING_1, "threshold_ore": 0, "active": True})
    Warning.objects.get_or_create(
        id=2, defaults={"message": WARNING_2, "threshold_ore": -10000, "active": True}
    )
    InterestPolicy.objects.get_or_create(id=1)


def unseed(apps, schema_editor) -> None:  # noqa: ANN001
    # Leave real data alone on rollback; only drop the interest policy singleton.
    apps.get_model("oelkaelder", "InterestPolicy").objects.filter(id=1).delete()


class Migration(migrations.Migration):
    dependencies = [("oelkaelder", "0003_interestpolicy_adjustment")]

    operations = [migrations.RunPython(seed, unseed)]
