"""Copy referenced legacy image files into MEDIA_ROOT so Django/WhiteNoise can serve them.

The ETL preserved legacy image *paths* (Product.image, RoomConditionScore.image) but not the files.
This copies the actual files from legacy_site/public/<...> into MEDIA_ROOT/<same path> so the stored
references resolve under MEDIA_URL. Idempotent; skips URLs and already-copied files.
"""

import shutil
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from oelkaelder.models import Product
from rooms.models import RoomConditionScore


class Command(BaseCommand):
    help = "Copy referenced legacy image files into MEDIA_ROOT."

    def handle(self, *args, **opts) -> None:  # noqa: ANN002, ANN003
        legacy_public = Path(settings.BASE_DIR).parent / "legacy_site" / "public"
        media = Path(settings.MEDIA_ROOT)
        stats = {"copied": 0, "missing": 0, "skipped": 0}

        def relocate(name: str | None) -> None:
            name = (name or "").strip()
            if not name or name.startswith(("http://", "https://")):
                stats["skipped"] += 1
                return
            rel = name.removeprefix("public/")
            src = legacy_public / rel
            dst = media / name
            if src.is_file():
                dst.parent.mkdir(parents=True, exist_ok=True)
                if not dst.exists():
                    shutil.copy2(src, dst)
                stats["copied"] += 1
            else:
                stats["missing"] += 1

        for p in Product.objects.exclude(image=""):
            relocate(p.image.name)
        for s in RoomConditionScore.objects.exclude(image=""):
            relocate(s.image)

        self.stdout.write(
            self.style.SUCCESS(
                f"Media relocate: copied {stats['copied']}, missing {stats['missing']}, skipped {stats['skipped']}."
            )
        )
