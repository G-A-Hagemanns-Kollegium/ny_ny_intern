"""Reset Postgres sequences to max(pk)+1 for all GAHK models.

The ETL preserves legacy integer PKs (bulk_create / explicit id), which does NOT advance Postgres
sequences — so the first ORM-created row collides at id=1. Run this once after the ETL (02-schema-etl §8).
"""
from django.apps import apps
from django.core.management.base import BaseCommand
from django.core.management.color import no_style
from django.db import connection

GAHK_APPS = ["core", "residents", "admissions", "cms", "ak", "rooms", "oelkaelder", "stats"]


class Command(BaseCommand):
    help = "Reset DB sequences to max(pk)+1 after preserved-PK ETL imports."

    def handle(self, *args, **opts):
        models = [m for app in GAHK_APPS for m in apps.get_app_config(app).get_models()]
        statements = connection.ops.sequence_reset_sql(no_style(), models)
        with connection.cursor() as cur:
            for stmt in statements:
                cur.execute(stmt)
        self.stdout.write(self.style.SUCCESS(
            f"Reset sequences for {len(models)} models ({len(statements)} statements)."
        ))
