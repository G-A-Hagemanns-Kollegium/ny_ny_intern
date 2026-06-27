"""Residents, residency (per-month membership) and monthly role assignments.

Consolidates the legacy `intern_alumne` (directory + login principal) and `gahk_admin_user`
(role flags) into one user model with **time-bound** roles (decided 2026-06): a resident's active
privileges come from the *current month's* assignments, not a static table — see
02-schema-etl.md §5 / 99-index.md F-010. Network-closed / MAC fields are dropped (feature retired).
"""
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    INDSTILLING = "indstilling", "Indstillingen"
    INSPEKTION = "inspektion", "Inspektionen"
    KOKKENGRUPPE = "kokkengruppe", "Køkkengruppen"
    AK = "ak", "AK"
    OELKAELDER = "oelkaelder", "Ølkælderen"
    ADMINISTRATOR = "administrator", "Administrator"
    # NOTE: legacy `editpage` is intentionally omitted — there is no runtime CMS editing (F-006/F-007).


class ResidentManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("Residents must have an email address")
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("is_active", True)
        return self.create_user(email, password, **extra)


class Resident(AbstractBaseUser, PermissionsMixin):
    # identity / login (legacy intern_alumne.email becomes the unique login id)
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    phone = models.CharField(max_length=40, blank=True)
    # residency facts
    birthday = models.DateField(null=True, blank=True)
    move_in_date = models.DateField(null=True, blank=True)
    move_out_date = models.DateField(null=True, blank=True)
    study = models.CharField(max_length=255, blank=True)
    # lineage: fylgje = fadder/sponsor (an older resident who introduces a newcomer) — F-011
    sponsor = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="proteges"
    )
    fylgje_raw = models.CharField(max_length=255, blank=True)  # original free-text, kept if unresolved
    # django auth
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)  # = holds any role in the active period (set by ETL/signals)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = ResidentManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["first_name", "last_name"]

    class Meta:
        ordering = ["first_name", "last_name"]

    def __str__(self):
        return f"{self.full_name} <{self.email}>"

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    def has_role(self, role, period=None):
        year, month = period or active_period()
        return self.role_assignments.filter(role=role, year=year, month=month).exists()


class Residency(models.Model):
    """One row per resident per month (legacy intern_alumne_liste): which room + chore groups."""
    resident = models.ForeignKey(Resident, on_delete=models.CASCADE, related_name="residencies")
    room = models.ForeignKey("core.Room", on_delete=models.PROTECT, related_name="residencies")
    workgroup = models.ForeignKey("core.Workgroup", null=True, blank=True, on_delete=models.SET_NULL)
    cleaning = models.ForeignKey("core.Cleaning", null=True, blank=True, on_delete=models.SET_NULL)
    year = models.PositiveSmallIntegerField()
    month = models.PositiveSmallIntegerField()  # 1..12 (decoded from legacy monthNumber = 12*y+m)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["resident", "year", "month"], name="uniq_resident_month")
        ]
        indexes = [models.Index(fields=["year", "month"])]
        verbose_name_plural = "residencies"

    def __str__(self):
        return f"{self.resident.full_name} — {self.year}-{self.month:02d}"


class RoleAssignment(models.Model):
    """A privilege/embedsgruppe role held by a resident **for a specific month** (decided 2026-06)."""
    resident = models.ForeignKey(Resident, on_delete=models.CASCADE, related_name="role_assignments")
    role = models.CharField(max_length=20, choices=Role.choices)
    year = models.PositiveSmallIntegerField()
    month = models.PositiveSmallIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["resident", "role", "year", "month"], name="uniq_role_assignment"
            )
        ]
        indexes = [models.Index(fields=["role", "year", "month"])]

    def __str__(self):
        return f"{self.resident.full_name} = {self.get_role_display()} ({self.year}-{self.month:02d})"


def active_period():
    """The (year, month) of the most recently published residency list — what is 'in effect'.

    Per F-010: the newest monthly list governs; if none exists yet, fall back to the calendar month.
    """
    latest = Residency.objects.order_by("-year", "-month").values("year", "month").first()
    if latest:
        return latest["year"], latest["month"]
    now = timezone.localtime()
    return now.year, now.month
