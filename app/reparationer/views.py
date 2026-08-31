"""Reparationer — a kanban board for tracking repairs on the kollegium.

Open to every logged-in resident for reporting, same openness as Opslagstavlen: reporting something
broken needs no role. Two crews then work the pipeline in sequence — see models.RepairTask for the
`responsible`/`status` split — and each has a different ceiling:

  * Viceværterne (MOVE_ROLES minus MANAGE_ROLES) triage: they may move a ticket to any status
    EXCEPT Færdig, and hand `responsible` from themselves to Reppergruppen once (Role.VICEVAERT
    only — see set_responsible).
  * Reppergruppen, Inspektionen and administrator (MANAGE_ROLES) have no ceiling: every status,
    including closing a ticket, plus delete.

set_status is one view for both crews rather than two, because the columns a Vicevært may use are a
strict subset of a manager's — splitting it would duplicate the "does this status exist" check for
no real separation of concerns.
"""

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.db.models import Count, Q
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from core import push
from residents.models import Role
from residents.permissions import current_resident, request_has_role, role_required

from . import services
from .forms import RepairCommentForm, RepairTaskForm
from .models import RepairComment, RepairTask

MANAGE_ROLES = (Role.REPPER, Role.INSPEKTION, Role.ADMINISTRATOR)
MOVE_ROLES = (*MANAGE_ROLES, Role.VICEVAERT)


def can_delete_comment(request: HttpRequest, comment: RepairComment) -> bool:
    """The comment's author, or a manager — mirrors opslagstavle.access.can_delete_comment."""
    if not request.user.is_authenticated:
        return False
    return comment.author_id == request.user.pk or request_has_role(request, *MANAGE_ROLES)


def _redirect_after(request: HttpRequest, task_pk: int) -> HttpResponseRedirect:
    """Board and detail both carry the move/handoff forms; each stamps a hidden `next` so a tap
    returns to whichever page it came from instead of always bouncing to the board."""
    if request.POST.get("next") == "detail":
        return redirect("reparationer:detail", pk=task_pk)
    return redirect("reparationer:board")


@login_required
def board(request: HttpRequest) -> HttpResponse:
    tasks = RepairTask.objects.select_related("reported_by").annotate(comment_count=Count("comments"))
    query = (request.GET.get("q") or "").strip()
    if query:
        # Title/location/description/reporter — everything a card actually shows, so a hit is
        # never a surprise ("why did this match?"). A plain icontains rather than a search index:
        # the whole table fits on a screen a few times over, so ranking would be over-engineering.
        tasks = tasks.filter(
            Q(title__icontains=query)
            | Q(location__icontains=query)
            | Q(description__icontains=query)
            | Q(reported_by__first_name__icontains=query)
            | Q(reported_by__last_name__icontains=query)
        )
    columns = [
        (status, label, [t for t in tasks if t.status == status])
        for status, label in RepairTask.Status.choices
    ]
    resident = current_resident(request)
    return render(
        request,
        "reparationer/board.html",
        {
            "columns": columns,
            "statuses": RepairTask.Status.choices,
            "query": query,
            "result_count": sum(len(items) for _, _, items in columns) if query else None,
            "can_manage": request_has_role(request, *MANAGE_ROLES),
            "can_move": request_has_role(request, *MOVE_ROLES),
            "can_handoff": request_has_role(request, Role.VICEVAERT),
            "push_configured": push.is_configured(),
            "vapid_public_key": push.vapid_public_key(),
            "push_subscribed": services.is_subscribed(resident),
        },
    )


@login_required
def create(request: HttpRequest) -> HttpResponse:
    form = RepairTaskForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        task = form.save(commit=False)
        task.reported_by = current_resident(request)
        task.save()
        services.notify_new_task(task)
        messages.success(request, "Reparationen er meldt ind.")
        return redirect("reparationer:board")
    return render(request, "reparationer/form.html", {"form": form})


@require_POST
@role_required(*MOVE_ROLES)
def set_status(request: HttpRequest, pk: int) -> HttpResponseRedirect:
    task = get_object_or_404(RepairTask, pk=pk)
    status = request.POST.get("status")
    if status == RepairTask.Status.FAERDIG and not request_has_role(request, *MANAGE_ROLES):
        # A Vicevært passed the view-level MOVE_ROLES gate but Færdig is manager-only — see the
        # module docstring. Silently ignored rather than 403: this is a button the page never
        # renders for them, so reaching here only happens via a replayed/crafted request, and the
        # safe response to that is exactly what an unknown status value already gets below.
        return _redirect_after(request, task.pk)
    if status in RepairTask.Status.values:
        task.status = status
        task.save(update_fields=["status", "updated_at"])
    return _redirect_after(request, task.pk)


@require_POST
@role_required(Role.VICEVAERT)
def set_responsible(request: HttpRequest, pk: int) -> HttpResponseRedirect:
    """The one handoff a Vicevært may make: themselves -> Reppergruppen. There is no view for the
    reverse — Reppergruppen picking a ticket back up is a conversation, not a button, and the
    MANAGE_ROLES crew can already do anything to a ticket regardless of who it says is responsible."""
    task = get_object_or_404(RepairTask, pk=pk)
    if task.responsible == RepairTask.Responsible.VICEVAERT:
        task.responsible = RepairTask.Responsible.REPPER
        task.save(update_fields=["responsible", "updated_at"])
        services.notify_handed_to_repper(task)
        messages.success(request, "Reparationen er overdraget til Repper.")
    return _redirect_after(request, task.pk)


@require_POST
@role_required(*MANAGE_ROLES)
def delete(request: HttpRequest, pk: int) -> HttpResponseRedirect:
    task = get_object_or_404(RepairTask, pk=pk)
    task.delete()
    messages.success(request, "Reparationen er slettet.")
    return redirect("reparationer:board")


@require_POST
@login_required
def save_subscription(request: HttpRequest) -> HttpResponse:
    """Store (or drop) this browser's opt-in to Reparationer push notifications. No role gate beyond
    login: every resident may open the board, mirrors opslagstavle.views.save_subscription."""
    return push.handle_subscription_request(request, services.TOPIC)


@login_required
def detail(request: HttpRequest, pk: int) -> HttpResponse:
    """One repair with its note thread — the stable page a "→ status" or comment link lands on."""
    task = get_object_or_404(RepairTask.objects.select_related("reported_by"), pk=pk)
    comments = list(task.comments.select_related("author"))
    for comment in comments:
        comment.can_delete = can_delete_comment(request, comment)  # type: ignore[attr-defined]
    return render(
        request,
        "reparationer/detail.html",
        {
            "task": task,
            "comments": comments,
            "comment_form": RepairCommentForm(),
            "statuses": RepairTask.Status.choices,
            "can_manage": request_has_role(request, *MANAGE_ROLES),
            "can_move": request_has_role(request, *MOVE_ROLES),
            "can_handoff": request_has_role(request, Role.VICEVAERT),
        },
    )


@require_POST
@login_required
def create_comment(request: HttpRequest, pk: int) -> HttpResponseRedirect:
    """Any resident may add a note — same openness as reporting. See can_delete_comment for removal."""
    task = get_object_or_404(RepairTask, pk=pk)
    form = RepairCommentForm(request.POST)
    if not form.is_valid():
        messages.error(request, "Skriv en note.")
        return redirect("reparationer:detail", pk=task.pk)
    comment = form.save(commit=False)
    comment.task = task
    comment.author = current_resident(request)
    comment.save()
    return redirect("reparationer:detail", pk=task.pk)


@require_POST
@login_required
def delete_comment(request: HttpRequest, pk: int) -> HttpResponseRedirect:
    comment = get_object_or_404(RepairComment, pk=pk)
    if not can_delete_comment(request, comment):
        raise PermissionDenied
    task_pk = comment.task_id
    comment.delete()
    messages.success(request, "Noten er slettet.")
    return redirect("reparationer:detail", pk=task_pk)
