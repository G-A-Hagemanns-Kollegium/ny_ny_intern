"""Public-site admin (F-002) — administrator-gated. The legacy privilege-escalation and open
mass-mailer are structurally gone; this provides the legitimate admin screens, chiefly assigning the
monthly embedsgruppe roles."""
from django.shortcuts import redirect, render

from .models import Resident, Role, RoleAssignment, active_period
from .permissions import role_required


@role_required("administrator")
def home(request):
    return render(request, "siteadmin/home.html")


@role_required("administrator")
def roles(request):
    year, month = active_period()
    if request.method == "POST":
        rid = request.POST.get("resident")
        role = request.POST.get("role")
        action = request.POST.get("action")
        if rid and role in Role.values:
            if action == "add":
                RoleAssignment.objects.get_or_create(resident_id=rid, role=role, year=year, month=month)
                Resident.objects.filter(id=rid).update(is_staff=True)
            elif action == "remove":
                RoleAssignment.objects.filter(resident_id=rid, role=role, year=year, month=month).delete()
        return redirect("siteadmin:roles")

    residents = (Resident.objects.filter(residencies__year=year, residencies__month=month)
                 .distinct().order_by("first_name", "last_name"))
    role_map = {}
    for ra in RoleAssignment.objects.filter(year=year, month=month):
        role_map.setdefault(ra.resident_id, []).append(ra.role)
    rows = [(r, role_map.get(r.id, [])) for r in residents]
    return render(request, "siteadmin/roles.html",
                  {"rows": rows, "all_roles": Role.choices, "period": f"{year}-{month:02d}"})
