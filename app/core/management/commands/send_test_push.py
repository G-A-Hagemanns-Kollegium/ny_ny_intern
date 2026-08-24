"""Send a test push notification to one resident, reporting exactly what happened.

Diagnostic counterpart to the normal flow. `core.push._dispatch` deliberately swallows per-device
failures so one dead phone cannot cost the dorm its notification — which is right in production and
useless when you are trying to find out why nothing arrives. This command does the opposite: it
prints the configuration state, every endpoint it tries, and the full push-service response.

    manage.py send_test_push anton@gahk.dk
    manage.py send_test_push anton@gahk.dk --topic opslagstavle

Lives in core, with the transport it exercises: it tests the keys, the subscription and the service
worker, none of which belong to a single feature. `--topic` selects which consent column has to be
set, so "I turned notifications on but nothing arrives" can be traced to the right one.

It separates the two halves of "no notification": if this delivers, the keys, the subscription and
the service worker are all fine and the problem is in the posting flow; if it fails, the reason is
on screen instead of in a swallowed log line.
"""

import json

from django.core.management.base import BaseCommand, CommandError, CommandParser
from pywebpush import WebPushException

from core import push
from core.models import TOPIC_FIELDS, PushSubscription
from residents.models import Resident


class Command(BaseCommand):
    help = "Send a test push notification to one resident's subscribed devices."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("email", help="Email of the resident to notify.")
        parser.add_argument(
            "--topic",
            default="den_hurtige",
            choices=sorted(TOPIC_FIELDS),
            help="Which notification topic to test (default: den_hurtige).",
        )

    def handle(self, *args: object, **opts: object) -> None:
        email = str(opts["email"])
        topic = str(opts["topic"])

        if not push.is_configured():
            raise CommandError(
                "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not both set — push is disabled. "
                "See app/.env.example."
            )

        try:
            resident = Resident.objects.get(email__iexact=email)
        except Resident.DoesNotExist as exc:
            raise CommandError(f"No resident with email {email!r}.") from exc

        # Scoped to the topic, so "no devices" distinguishes "never subscribed at all" from
        # "subscribed to the other feature only" — the failure this split introduced.
        subscriptions = list(push.subscribers(topic).filter(user=resident))
        total = push.subscribers(topic).count()
        self.stdout.write(
            f"{resident.full_name}: {len(subscriptions)} device(s) on {topic!r} — {total} in total."
        )
        if not subscriptions:
            any_device = PushSubscription.objects.filter(user=resident).count()
            extra = f" They do have {any_device} device(s) subscribed to another topic." if any_device else ""
            raise CommandError(
                f"This resident has no devices subscribed to {topic!r}.{extra} Open the feature's "
                "page as them and press 'Slå notifikationer til' first."
            )

        # Deep-links somewhere real for the topic under test: this is a delivery test, and a
        # notification that opens nothing when tapped only half-tests it. Imported here rather than
        # at module scope so core keeps no import-time dependency on the features it serves.
        from den_hurtige import channels
        from opslagstavle.services import BOARD_URL

        topic_urls = {"den_hurtige": channels.DEFAULT.url, "opslagstavle": BOARD_URL}
        payload = push._payload(
            "Test fra GAHK",
            "Hvis du kan se denne, virker push.",
            topic_urls.get(topic, "/nyintern/"),
        )
        body = json.dumps(payload)

        failures = 0
        for subscription in subscriptions:
            # Deliberately NOT going through _dispatch: its whole job is to hide these errors.
            self.stdout.write(f"  → {subscription.endpoint[:72]}…")
            try:
                push._send(subscription, body)
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
