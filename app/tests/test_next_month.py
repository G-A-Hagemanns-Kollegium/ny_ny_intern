"""Indstilling's monthly task: prepare next month's alumneliste (F-010).

Flow mirrors the legacy list management: copy the current list forward, edit each resident's room /
embedsgruppe (workgroup) / cleaning, and add or remove people. A privileged embedsgruppe grants the
matching role for next month; `administrator` is carried forward. Only the NEXT month is affected; the
active month is untouched. Gated to indstilling (+ admin/superuser).
"""

from collections.abc import Callable

import pytest
from django.core import mail
from django.test import Client

from core.models import Cleaning, Room, Workgroup
from residents.models import Residency, Resident, Role, RoleAssignment, active_period, next_period

URL = "/nyintern/alumneliste/naeste-maaned"


@pytest.fixture
def groups(db: None) -> dict[str, Room | Workgroup | Cleaning]:
    return {
        "r1": Room.objects.create(legacy_index=1, number=1, floor="stuen", side="mod gaden"),
        "r2": Room.objects.create(legacy_index=2, number=2, floor="stuen", side="mod gaden"),
        "r3": Room.objects.create(legacy_index=3, number=3, floor="stuen", side="mod gaden"),
        "priv": Workgroup.objects.create(name="Indstillingen"),  # -> role indstilling
        "ak": Workgroup.objects.create(name="AK-gruppen"),  # -> role ak
        "plain": Workgroup.objects.create(name="Festgruppen"),  # no privilege
        "clean": Cleaning.objects.create(name="Køkken uge 1"),
    }


def _login(user: Resident) -> Client:
    c = Client()
    c.force_login(user=user)
    return c


def _setup(
    make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]
) -> tuple[Client, Resident, Resident]:
    """An indstilling editor + a plain target, both in the active list; returns (client, ind, target)."""
    ind = make_resident(email="ind@gahk.dk", roles=[Role.INDSTILLING])
    target = make_resident(email="t@gahk.dk")
    cy, cm = active_period()
    Residency.objects.create(resident=ind, room=groups["r1"], workgroup=groups["priv"], year=cy, month=cm)
    Residency.objects.create(resident=target, room=groups["r2"], workgroup=groups["plain"], year=cy, month=cm)
    return _login(ind), ind, target


@pytest.mark.django_db
def test_access_is_indstilling_only(
    make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]
) -> None:
    ind = make_resident(email="ind@gahk.dk", roles=[Role.INDSTILLING])
    plain = make_resident(email="p@gahk.dk")
    assert _login(ind).get(URL).status_code == 200
    assert _login(plain).get(URL).status_code == 403


@pytest.mark.django_db
def test_copy_seeds_next_month_and_syncs_roles(
    make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]
) -> None:
    c, ind, target = _setup(make_resident, groups)
    cy, cm = active_period()
    ny, nm = next_period((cy, cm))

    c.post(URL, {"action": "copy"})

    # both carried forward with same room + workgroup
    assert Residency.objects.filter(resident=ind, room=groups["r1"], year=ny, month=nm).exists()
    assert Residency.objects.filter(resident=target, room=groups["r2"], year=ny, month=nm).exists()
    # privileged workgroup -> role next month; plain workgroup -> no role
    assert RoleAssignment.objects.filter(resident=ind, role=Role.INDSTILLING, year=ny, month=nm).exists()
    assert not RoleAssignment.objects.filter(resident=target, year=ny, month=nm).exists()


@pytest.mark.django_db
def test_save_edits_room_workgroup_cleaning_and_resyncs_role(
    make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]
) -> None:
    c, ind, target = _setup(make_resident, groups)
    cy, cm = active_period()
    ny, nm = next_period((cy, cm))
    c.post(URL, {"action": "copy"})

    # move target to room 3, give them AK-gruppen (privileged) + a cleaning duty
    c.post(
        URL,
        {
            "action": "save",
            f"room_{ind.id}": groups["r1"].id,
            f"workgroup_{ind.id}": groups["priv"].id,
            f"room_{target.id}": groups["r3"].id,
            f"workgroup_{target.id}": groups["ak"].id,
            f"cleaning_{target.id}": groups["clean"].id,
        },
    )
    tr = Residency.objects.get(resident=target, year=ny, month=nm)
    assert (tr.room_id, tr.workgroup_id, tr.cleaning_id) == (
        groups["r3"].id,
        groups["ak"].id,
        groups["clean"].id,
    )
    assert RoleAssignment.objects.filter(resident=target, role=Role.AK, year=ny, month=nm).exists()

    # switch target back to a non-privileged workgroup -> role removed
    c.post(
        URL,
        {
            "action": "save",
            f"room_{target.id}": groups["r3"].id,
            f"workgroup_{target.id}": groups["plain"].id,
        },
    )
    assert not RoleAssignment.objects.filter(resident=target, year=ny, month=nm).exists()


@pytest.mark.django_db
def test_remove_person(make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]) -> None:
    c, ind, target = _setup(make_resident, groups)
    cy, cm = active_period()
    ny, nm = next_period((cy, cm))
    c.post(URL, {"action": "copy"})

    c.post(URL, {"action": "save", f"room_{target.id}": groups["r2"].id, f"remove_{target.id}": "1"})
    assert not Residency.objects.filter(resident=target, year=ny, month=nm).exists()
    assert not RoleAssignment.objects.filter(resident=target, year=ny, month=nm).exists()
    # the editor themselves remain
    assert Residency.objects.filter(resident=ind, year=ny, month=nm).exists()


@pytest.mark.django_db
def test_add_existing_resident(
    make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]
) -> None:
    c, _ind, _target = _setup(make_resident, groups)
    cy, cm = active_period()
    ny, nm = next_period((cy, cm))
    c.post(URL, {"action": "copy"})
    newcomer = make_resident(email="new@gahk.dk")  # exists but not in next-month list

    c.post(
        URL,
        {
            "action": "add_existing",
            "resident": newcomer.id,
            "room": groups["r3"].id,
            "workgroup": groups["ak"].id,
        },
    )
    assert Residency.objects.filter(resident=newcomer, room=groups["r3"], year=ny, month=nm).exists()
    assert RoleAssignment.objects.filter(resident=newcomer, role=Role.AK, year=ny, month=nm).exists()


@pytest.mark.django_db
def test_add_new_resident(make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]) -> None:
    c, _ind, _target = _setup(make_resident, groups)
    cy, cm = active_period()
    ny, nm = next_period((cy, cm))
    c.post(URL, {"action": "copy"})

    c.post(
        URL,
        {
            "action": "add_new",
            "first_name": "Nina",
            "last_name": "Ny",
            "email": "nina@gahk.dk",
            "room": groups["r3"].id,
            "workgroup": groups["priv"].id,
        },
    )
    r = Resident.objects.get(email="nina@gahk.dk")
    assert not r.has_usable_password()
    assert Residency.objects.filter(resident=r, room=groups["r3"], year=ny, month=nm).exists()
    assert RoleAssignment.objects.filter(resident=r, role=Role.INDSTILLING, year=ny, month=nm).exists()
    # a welcome email is sent to the new resident
    assert any(m.to == ["nina@gahk.dk"] for m in mail.outbox)


@pytest.mark.django_db
def test_save_rejects_duplicate_room(
    make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]
) -> None:
    c, ind, target = _setup(make_resident, groups)
    cy, cm = active_period()
    ny, nm = next_period((cy, cm))
    c.post(URL, {"action": "copy"})  # ind -> r1, target -> r2
    # try to move target into ind's room (r1) -> rejected, nothing changes
    c.post(
        URL,
        {
            "action": "save",
            f"room_{ind.id}": groups["r1"].id,
            f"room_{target.id}": groups["r1"].id,
        },
    )
    assert Residency.objects.get(resident=target, year=ny, month=nm).room_id == groups["r2"].id


@pytest.mark.django_db
def test_add_existing_rejects_occupied_room(
    make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]
) -> None:
    c, _ind, _target = _setup(make_resident, groups)
    cy, cm = active_period()
    ny, nm = next_period((cy, cm))
    c.post(URL, {"action": "copy"})  # r1 occupied by ind
    newcomer = make_resident(email="new@gahk.dk")
    c.post(URL, {"action": "add_existing", "resident": newcomer.id, "room": groups["r1"].id})
    assert not Residency.objects.filter(resident=newcomer, year=ny, month=nm).exists()


@pytest.mark.django_db
def test_add_new_rejects_occupied_room(
    make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]
) -> None:
    c, _ind, _target = _setup(make_resident, groups)
    c.post(URL, {"action": "copy"})  # r1 occupied by ind
    c.post(
        URL,
        {
            "action": "add_new",
            "first_name": "X",
            "last_name": "Y",
            "email": "x@gahk.dk",
            "room": groups["r1"].id,
        },
    )
    assert not Resident.objects.filter(email="x@gahk.dk").exists()


@pytest.mark.django_db
def test_future_list_does_not_change_active_period(
    make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]
) -> None:
    """A list prepared for next month must not become the active period until that month arrives."""
    c, _ind, _target = _setup(make_resident, groups)
    before = active_period()
    c.post(URL, {"action": "copy"})
    assert active_period() == before  # unchanged despite the next-month rows existing


@pytest.mark.django_db
def test_directory_history_shows_selected_month(
    make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]
) -> None:
    viewer = make_resident(email="v@gahk.dk")
    cy, cm = active_period()
    cur = make_resident(email="cur@gahk.dk", first_name="Current", last_name="Person")
    Residency.objects.create(resident=cur, room=groups["r1"], year=cy, month=cm)
    py, pm = (cy - 1, 12) if cm == 1 else (cy, cm - 1)
    past = make_resident(email="past@gahk.dk", first_name="Past", last_name="Person")
    Residency.objects.create(resident=past, room=groups["r2"], year=py, month=pm)

    c = _login(viewer)
    now = c.get("/nyintern/alumneliste/").content.decode()
    assert "Current Person" in now and "Past Person" not in now
    assert f"{py}-{pm}" in now  # the picker offers the past month

    hist = c.get(f"/nyintern/alumneliste/?period={py}-{pm}").content.decode()
    assert "Past Person" in hist and "Current Person" not in hist


@pytest.mark.django_db
def test_alumneliste_shows_fylgje_and_cleaning(
    make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]
) -> None:
    viewer = make_resident(email="v@gahk.dk")
    sponsor = make_resident(email="spon@gahk.dk", first_name="Elder", last_name="Sponsor")
    junior = make_resident(email="jr@gahk.dk", first_name="Junior", last_name="Newbie", sponsor=sponsor)
    cy, cm = active_period()
    Residency.objects.create(
        resident=junior,
        room=groups["r1"],
        workgroup=groups["plain"],
        cleaning=groups["clean"],
        year=cy,
        month=cm,
    )
    h = _login(viewer).get("/nyintern/alumneliste/").content.decode()
    assert "Fylgje" in h and "Rengøring" in h  # column headers
    assert "Fødselsdag" in h and "Indflyttet" in h  # new columns
    assert "Elder Sponsor" in h  # resolved fylgje
    assert "Køkken uge 1" in h  # cleaning duty


@pytest.mark.django_db
def test_alumneliste_export_csv_and_xlsx(
    make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]
) -> None:
    from datetime import date

    viewer = make_resident(email="v@gahk.dk")
    r = make_resident(
        email="ex@gahk.dk",
        first_name="Eks",
        last_name="Port",
        study="Fysik",
        phone="12345678",
        birthday=date(1999, 3, 4),
        move_in_date=date(2020, 8, 1),
    )
    cy, cm = active_period()
    Residency.objects.create(
        resident=r, room=groups["r1"], workgroup=groups["plain"], cleaning=groups["clean"], year=cy, month=cm
    )
    c = _login(viewer)

    csv_resp = c.get(f"/nyintern/alumneliste/eksport?format=csv&period={cy}-{cm}")
    assert csv_resp.status_code == 200
    assert "text/csv" in csv_resp["Content-Type"]
    assert ".csv" in csv_resp["Content-Disposition"]
    body = csv_resp.content.decode("utf-8-sig")
    assert (
        body.splitlines()[0]
        == "Navn,Værelse,Embedsgruppe,Rengøring,Fylgje,Fødselsdag,Indflyttet,Studie,Telefon,Email"
    )
    assert "Eks Port" in body and "Fysik" in body and "1999-03-04" in body and "2020-08-01" in body

    xlsx_resp = c.get(f"/nyintern/alumneliste/eksport?format=xlsx&period={cy}-{cm}")
    assert xlsx_resp.status_code == 200
    assert "spreadsheetml" in xlsx_resp["Content-Type"]
    assert ".xlsx" in xlsx_resp["Content-Disposition"]
    assert xlsx_resp.content[:2] == b"PK"  # .xlsx is a zip container


@pytest.mark.django_db
def test_stamtree_shows_lineage(
    make_resident: Callable, groups: dict[str, Room | Workgroup | Cleaning]
) -> None:
    from datetime import date

    viewer = make_resident(email="v@gahk.dk")
    elder = make_resident(
        email="e@gahk.dk", first_name="Elder", last_name="Root", move_in_date=date(2019, 8, 1)
    )
    make_resident(
        email="c@gahk.dk", first_name="Young", last_name="Leaf", sponsor=elder, move_in_date=date(2021, 8, 1)
    )
    h = _login(viewer).get("/nyintern/stamtree/").content.decode()
    assert "Hagemanns Ånd" in h
    assert "Elder Root" in h and "Young Leaf" in h
    # the child appears nested under its sponsor (sponsor's name comes first in the document)
    assert h.index("Elder Root") < h.index("Young Leaf")
