"""Monthly AK assessment (F-009): every current resident is charged −2 krydser at the start of the
month. Idempotent per period (tagged in `reason`). Schedule this monthly (cron / scheduled task)."""
from django.core.management.base import BaseCommand
from django.utils import timezone

from ak.models import AkEntry
from residents.models import Resident, active_period


class Command(BaseCommand):
    help = "Charge every current resident −2 AK krydser for the active month (idempotent)."

    def handle(self, *args, **opts):
        year, month = active_period()
        tag = f"Månedlig vurdering {year}-{month:02d}"
        residents = Resident.objects.filter(residencies__year=year, residencies__month=month).distinct()
        created = 0
        for r in residents:
            if not AkEntry.objects.filter(resident=r, kind=AkEntry.Kind.MONTHLY, reason=tag).exists():
                AkEntry.objects.create(resident=r, delta=-2, kind=AkEntry.Kind.MONTHLY,
                                       reason=tag, created_at=timezone.now())
                created += 1
        self.stdout.write(self.style.SUCCESS(
            f"AK monthly assessment {tag}: charged {created} residents -2 "
            f"(skipped {residents.count() - created} already done)."
        ))
