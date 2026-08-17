"""Hard-delete expired Den Hurtige posts (and their comments, by cascade).

The feed view purges on every load, so this is only needed when nobody has opened the page for a
while — run it from a deploy/ops job if you want the table empty regardless of traffic. Repeatable.
"""

from django.core.management.base import BaseCommand

from den_hurtige.models import QuickPost


class Command(BaseCommand):
    help = "Permanently delete expired Den Hurtige posts."

    def handle(self, *args: object, **opts: object) -> None:
        removed = QuickPost.objects.purge_expired()
        self.stdout.write(self.style.SUCCESS(f"Den Hurtige: {removed} udløbne opslag slettet."))
