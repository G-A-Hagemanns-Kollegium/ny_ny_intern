"""Send a Den Hurtige test notification to one resident, reporting exactly what happened.

Diagnostic counterpart to the normal flow. `services._dispatch` deliberately swallows per-device
failures so one dead phone cannot cost the dorm its notification — which is right in production and
useless when you are trying to find out why nothing arrives. This command does the opposite: it
prints the configuration state, every endpoint it tries, and the full push-service response.

    manage.py send_test_push anton@gahk.dk

It separates the two halves of "no notification": if this delivers, the keys, the subscription and
the service worker are all fine and the problem is in the posting flow; if it fails, the reason is
on screen instead of in a swallowed log line.
"""

import json

from django.core.management.base import BaseCommand, CommandError, CommandParser
from pywebpush import WebPushException

from den_hurtige import channels, services
from den_hurtige.models import PushSubscription
from residents.models import Resident


class Command(BaseCommand):
    help = "Send a test push notification to one resident's subscribed devices."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("email", help="Email of the resident to notify.")

    def handle(self, *args: object, **opts: object) -> None:
        email = str(opts["email"])

        if not services.is_configured():
            raise CommandError(
                "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not both set — push is disabled. "
                "See app/.env.example."
            )

        try:
            resident = Resident.objects.get(email__iexact=email)
        except Resident.DoesNotExist as exc:
            raise CommandError(f"No resident with email {email!r}.") from exc

        subscriptions = list(PushSubscription.objects.filter(user=resident))
        total = PushSubscription.objects.count()
        self.stdout.write(f"{resident.full_name}: {len(subscriptions)} device(s) — {total} in total.")
        if not subscriptions:
            raise CommandError(
                "This resident has no subscribed devices. Open /intern/den-hurtige/ as them and "
                "press 'Slå notifikationer til' first."
            )

        # Deep-links to the default channel: this is a delivery test, and the notification should
        # land somewhere real when tapped.
        payload = services._payload(
            "Test fra Den Hurtige",
            "Hvis du kan se denne, virker push.",
            channels.DEFAULT.url,
        )
        body = json.dumps(payload)

        failures = 0
        for subscription in subscriptions:
            # Deliberately NOT going through _dispatch: its whole job is to hide these errors.
            self.stdout.write(f"  → {subscription.endpoint[:72]}…")
            try:
                services._send(subscription, body)
            except WebPushException as exc:
                failures += 1
                status = getattr(exc.response, "status_code", None)
                detail = getattr(exc.response, "text", "") or str(exc)
                self.stdout.write(self.style.ERROR(f"    FAILED ({status}): {detail.strip()[:400]}"))
            except Exception as exc:
                failures += 1
                self.stdout.write(self.style.ERROR(f"    FAILED ({type(exc).__name__}): {exc}"))
            else:
                self.stdout.write(self.style.SUCCESS("    accepted by the push service"))

        if failures:
            raise CommandError(f"{failures} of {len(subscriptions)} device(s) failed.")
        self.stdout.write(
            self.style.SUCCESS(
                "All devices accepted. If no notification appears, the push service took it but the "
                "browser did not show it — check OS notification settings / Do Not Disturb, and that "
                "the service worker at /sw.js is the running one."
            )
        )
