"""Copy legacy /public/image files referenced by CMS content (Page bodies + bgpics, News bodies,
Event descriptions) into static/legacy/.

The `body_media`/`legacy_img` template filters rewrite the stored `/public/...` URLs to `/static/legacy/...`;
this copies the actual files so they resolve. Repeatable; run after the etl_* commands.
"""

import re
import shutil
import urllib.parse
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from cms.models import Event, NewsItem, Page

REF = re.compile(r"/?public/(image/[^\s\"'()>]+)", re.I)


class Command(BaseCommand):
    help = "Copy legacy /public/image files referenced by CMS content into static/legacy/."

    def handle(self, *args, **opts):
        legacy = Path(settings.BASE_DIR).parent / "legacy_site" / "public"
        dest = Path(settings.BASE_DIR) / "static" / "legacy"
        refs = set()
        for p in Page.objects.all():
            refs.update(m.group(1) for m in REF.finditer(f"{p.body or ''} {p.background_image or ''}"))
        for n in NewsItem.objects.all():
            refs.update(m.group(1) for m in REF.finditer(n.body or ""))
        for e in Event.objects.all():
            refs.update(m.group(1) for m in REF.finditer(e.description or ""))

        copied = missing = 0
        for rel in sorted(refs):
            rel = urllib.parse.unquote(rel)  # e.g. %281%29 -> (1)
            src, dst = legacy / rel, dest / rel
            if src.is_file():
                dst.parent.mkdir(parents=True, exist_ok=True)
                if not dst.exists():
                    shutil.copy2(src, dst)
                copied += 1
            else:
                missing += 1
        self.stdout.write(
            self.style.SUCCESS(
                f"CMS media: {copied} copied, {missing} missing of {len(refs)} referenced files."
            )
        )
