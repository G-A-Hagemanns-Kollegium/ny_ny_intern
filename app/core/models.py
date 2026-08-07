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
    floor = models.CharField(max_length=20)  # "stuen", "1. sal", …
    side = models.CharField(max_length=20)  # "mod gaden" / "mod gården"
    note = models.CharField(max_length=40, blank=True)  # "(røvhullet)", "(fængslet)", …

    class Meta:
        ordering = ["number"]

    def __str__(self) -> str:
        return f"Værelse {self.number:03d}"

    @property
    def plan_image(self) -> str:
        """Static path of this floor's plan drawing, for the værelsestjek room picker (F-005).

        The five legacy PNGs were copied to app/static/legacy/image/intern/ and renamed to drop the
        spaces in "1. sal.png" — a filename with a space under CompressedManifestStaticFilesStorage
        is a hard 500 on a missing manifest entry, not a broken image.
        """
        stem = "stuen" if self.floor == "stuen" else f"sal{self.floor[0]}"
        return f"legacy/image/intern/{stem}.png"


class Workgroup(models.Model):  # intern_alumne_workgroup (the monthly chore/embedsgruppe label)
    legacy_id = models.PositiveIntegerField(unique=True, null=True, blank=True)
    name = models.CharField(max_length=100, unique=True)
    # Exact number of members a next-month list must give this group (legacy `w_amount`); 0 = no limit.
    size = models.PositiveSmallIntegerField(default=0)

    def __str__(self) -> str:
        return self.name


class Cleaning(models.Model):  # intern_alumne_cleaning
    legacy_id = models.PositiveIntegerField(unique=True, null=True, blank=True)
    name = models.CharField(max_length=100, unique=True)
    # Exact number of members a next-month list must give this group (legacy `c_amount`); 0 = no limit.
    size = models.PositiveSmallIntegerField(default=0)

    def __str__(self) -> str:
        return self.name
