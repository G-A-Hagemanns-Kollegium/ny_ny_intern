"""Shared lookups (02-schema-etl.md §4).

Room is seeded from the hard-coded room map in legacy `intern/delt.php` (there is no rooms table);
Workgroup/Cleaning come from `intern_alumne_workgroup` / `intern_alumne_cleaning`.
"""
from django.db import models


class Room(models.Model):
    # Both legacy identifiers coexist in the old code: the 0..61 index ("vaerelse_id", used by the
    # kvotient lottery) and the human room number ("003", "101", … stored as int).
    legacy_index = models.PositiveSmallIntegerField(unique=True)
    number = models.PositiveSmallIntegerField(unique=True)
    floor = models.CharField(max_length=20)             # "stuen", "1. sal", …
    side = models.CharField(max_length=20)              # "mod gaden" / "mod gården"
    note = models.CharField(max_length=40, blank=True)  # "(røvhullet)", "(fængslet)", …

    class Meta:
        ordering = ["number"]

    def __str__(self):
        return f"Værelse {self.number:03d}"


class Workgroup(models.Model):  # intern_alumne_workgroup (the monthly chore/embedsgruppe label)
    legacy_id = models.PositiveIntegerField(unique=True, null=True, blank=True)
    name = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.name


class Cleaning(models.Model):  # intern_alumne_cleaning
    legacy_id = models.PositiveIntegerField(unique=True, null=True, blank=True)
    name = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.name
