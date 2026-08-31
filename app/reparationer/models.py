"""Reparationer — a kanban board for tracking repairs on the kollegium.

Any resident may report something broken (views.create). Two crews then own the pipeline in
sequence, tracked separately from `status`:

  * `responsible` says WHO currently owns the ticket — Viceværterne by default (they triage), or
    Reppergruppen once a Vicevært hands it over (views.set_responsible). It exists apart from
    `status` because the two axes are independent: a ticket can sit "I gang" under either owner.
  * `status` says WHERE it is in the pipeline. Viceværterne may move a ticket through every column
    except the last — closing something as done is Reppergruppen/Inspektionen/administrator's call
    (views.MOVE_ROLES vs MANAGE_ROLES) — which is also why "Godkend af Repper" exists as its own
    column rather than folding into "Færdig": a Vicevært needs somewhere to leave a ticket they
    believe is finished without being able to actually close it.

Status.choices is the single source both the board and the per-card "move to…" buttons iterate
over, so column order here IS column order on the page.
"""

from django.db import models

from residents.models import Resident


class RepairTask(models.Model):
    class Status(models.TextChoices):
        NY = "ny", "Ny"
        I_GANG = "i_gang", "I gang"
        AFVENTER = "afventer", "Afventer"
        GODKENDT = "godkendt", "Godkend af Repper"
        FAERDIG = "faerdig", "Færdig"

    class Responsible(models.TextChoices):
        VICEVAERT = "vicevaert", "Vicevært"
        REPPER = "repper", "Repper"

    title = models.CharField("Titel", max_length=200)
    description = models.TextField("Beskrivelse", blank=True)
    location = models.CharField("Sted", max_length=200, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NY)
    responsible = models.CharField(
        "Ansvarlig", max_length=20, choices=Responsible.choices, default=Responsible.VICEVAERT
    )
    reported_by = models.ForeignKey(Resident, on_delete=models.CASCADE, related_name="reported_repairs")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title


class RepairComment(models.Model):
    """A note on a repair — progress updates from Reppergruppen, extra detail from whoever reported
    it. Open to any resident to add, like Opslagstavlen's comments; see views.can_delete_comment for
    who may remove one."""

    task = models.ForeignKey(RepairTask, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(Resident, on_delete=models.CASCADE, related_name="repair_comments")
    body = models.TextField("Note")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.author}: {self.body[:40]}"
