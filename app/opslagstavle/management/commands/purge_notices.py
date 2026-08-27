"""Enforce opslagstavlen's ~2-year retention, and sweep uploads nobody ever posted.

Posts are kept about two years and then deleted, so the board does not become a permanent archive of
dorm life. Two jobs in one command because they are one policy:

  * **Posts** older than RETENTION_DAYS, **except pinned ones** — a pin is Inspektionen saying the
    kollegium keeps this, which makes it the retention override too. Comments, reactions and image
    rows follow by CASCADE; the image *files* follow via the post_delete receiver on NoticeImage.
  * **Unclaimed uploads** older than ORPHAN_IMAGE_GRACE: the composer was opened, pictures were
    added, the tab was closed. `notice_id IS NULL` makes that one exact indexed query rather than a
    scan of every post body.

Run nightly (DEPLOY.md §4b). Idempotent and repeatable; `--dry-run` prints without deleting.

**Deliberately NOT also purged lazily on page load**, unlike Den Hurtige. Its lazy guard is right
because its promise is "gone in 30 minutes" — a message that should have vanished is visibly wrong to
a reader within the hour, so cron failing silently has an immediate cost. Here the tolerance is
months: if this job is dead for a week, nothing is wrong for anybody, and putting a potentially large
DELETE on every board request to protect against that would be a bad trade. Do not "fix" the
inconsistency.

One subtlety worth keeping straight: a bulk queryset `.delete()` never calls `Model.delete()`, but it
*does* fire `post_delete`. That is exactly why NoticeImage cleans its file up in a receiver — and why
the files here actually go.
"""

import argparse
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from opslagstavle.models import (
    ORPHAN_IMAGE_GRACE,
    RETENTION_DAYS,
    Notice,
    NoticeImage,
)


class Command(BaseCommand):
    help = "Slet opslag ældre end ca. 2 år (fastgjorte undtaget) og ryd ubrugte billed-uploads."

    def add_arguments(self, parser: argparse.ArgumentParser) -> None:
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args: object, **opts: object) -> None:
        now = timezone.now()
        cutoff = now - timedelta(days=RETENTION_DAYS)

        expired = Notice.objects.expired(now)
        orphans = NoticeImage.objects.filter(notice__isnull=True, uploaded_at__lt=now - ORPHAN_IMAGE_GRACE)
        n_expired = expired.count()
        n_orphans = orphans.count()
        pinned_old = Notice.objects.filter(created_at__lt=cutoff, pinned_at__isnull=False).count()

        if opts["dry_run"]:
            self.stdout.write(
                f"[dry-run] would delete {n_expired} opslag from before {cutoff:%Y-%m-%d} "
                f"and {n_orphans} unused image upload(s)."
            )
            if pinned_old:
                self.stdout.write(f"[dry-run] {pinned_old} pinned opslag are exempt and kept.")
            return

        # Reported separately, and the *notice* count is what is printed — delete() also returns
        # cascaded comments, reactions and image rows, which is not what a reader of this line wants.
        expired.delete()
        orphans.delete()
        self.stdout.write(
            self.style.SUCCESS(
                f"Opslagstavlen: {n_expired} opslag fra før {cutoff:%Y-%m-%d} slettet, "
                f"{n_orphans} ubrugte billeder ryddet."
            )
        )
        if pinned_old:
            self.stdout.write(f"{pinned_old} fastgjorte opslag er undtaget og beholdt.")
