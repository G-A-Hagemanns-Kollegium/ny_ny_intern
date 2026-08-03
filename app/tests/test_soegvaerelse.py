"""Room lottery (F-004): the target/offer month is always the subsequent month (next_period),
stored as an absolute index but shown human-readably. See rooms/views_soegvaerelse.py."""

from collections.abc import Callable
from datetime import date

import pytest
from django.test import Client
from django.urls import reverse

from core.models import Room
from residents.models import Residency, Resident, next_period
from rooms.kvotient import month_index, month_label
from rooms.models import KvotientApplication, KvotientPriority, RoomOffer
from rooms.views_soegvaerelse import allocate_round


def test_month_label_is_inverse_of_month_index() -> None:
    assert month_label(month_index(2026, 8)) == "August 2026"
    assert month_label(24319) == "August 2026"  # the raw int users used to see


@pytest.mark.django_db
def test_create_offer_targets_next_period(make_resident: Callable) -> None:
    ind = make_resident(email="ind@gahk.dk", roles=("indstilling",))
    Room.objects.create(legacy_index=1, number=3, floor="stuen", side="mod gaden")
    c = Client()
    c.force_login(ind)
    c.post(reverse("soegvaerelse:create_offer"), {"room": "3"})  # no year/month sent
    offer = RoomOffer.objects.get()
    assert offer.month == month_index(*next_period())  # auto: the upcoming month


@pytest.mark.django_db
def test_application_targets_next_period_without_month_input(make_resident: Callable) -> None:
    r = make_resident(email="r@gahk.dk", move_in_date=date(2024, 8, 1))
    room = Room.objects.create(legacy_index=2, number=101, floor="1. sal", side="mod gaden")
    RoomOffer.objects.create(room=room, month=month_index(*next_period()))
    c = Client()
    c.force_login(r)
    # Note: no target_year / target_month in the payload — the view fixes it to next_period.
    c.post(
        reverse("soegvaerelse:soeg"),
        {"done_year": "2028", "done_month": "6", "orlov_months": "0", "priority": [str(room.id)]},
    )
    app = KvotientApplication.objects.get()
    assert app.move_month == month_index(*next_period())


@pytest.mark.django_db
def test_apply_page_shows_fixed_month_and_drops_manual_input(make_resident: Callable) -> None:
    r = make_resident(email="r2@gahk.dk", move_in_date=date(2024, 8, 1))
    room = Room.objects.create(legacy_index=3, number=201, floor="2. sal", side="mod gaden")
    RoomOffer.objects.create(room=room, month=month_index(*next_period()))
    c = Client()
    c.force_login(r)
    html = c.get(reverse("soegvaerelse:soeg")).content.decode()
    assert month_label(month_index(*next_period())) in html  # human-readable month shown
    assert 'name="target_year"' not in html  # manual month input is gone
    assert 'name="target_month"' not in html
    # Study-end is month/year dropdowns (Danish names), not raw number spinners.
    assert 'name="done_month"' in html and '<option value="6">Juni</option>' in html
    assert 'name="done_year"' in html


def _application(resident: Resident, month: int, k: float) -> KvotientApplication:
    return KvotientApplication.objects.create(
        resident=resident, move_month=month, move_in_month=0, done_studying_month=month + 12, k=k
    )


@pytest.mark.django_db
def test_allocate_round_is_global_greedy(make_resident: Callable) -> None:
    """Higher-K applicant takes their 1st choice; that frees a lower choice for a lower-K applicant."""
    m = month_index(*next_period())
    a = Room.objects.create(legacy_index=10, number=10, floor="stuen", side="mod gaden")
    b = Room.objects.create(legacy_index=11, number=11, floor="stuen", side="mod gaden")
    RoomOffer.objects.create(room=a, month=m)
    RoomOffer.objects.create(room=b, month=m)
    hi = _application(make_resident(email="hi@gahk.dk"), m, k=9.0)
    lo = _application(make_resident(email="lo@gahk.dk"), m, k=5.0)
    for app in (hi, lo):  # both rank A first, then B
        KvotientPriority.objects.create(application=app, room=a, priority=1, month=m)
        KvotientPriority.objects.create(application=app, room=b, priority=2, month=m)

    winners = allocate_round(m)
    assert winners[a.id].id == hi.id  # highest K wins their 1st choice
    assert winners[b.id].id == lo.id  # A taken -> next applicant wins their 2nd choice


@pytest.mark.django_db
def test_end_round_assigns_winner_to_room_and_clears(make_resident: Callable) -> None:
    ind = make_resident(email="ind2@gahk.dk", roles=("indstilling",))
    winner = make_resident(email="win@gahk.dk")
    m = month_index(*next_period())
    ny, nm = next_period()
    room = Room.objects.create(legacy_index=20, number=20, floor="stuen", side="mod gaden")
    RoomOffer.objects.create(room=room, month=m)
    app = _application(winner, m, k=7.0)
    KvotientPriority.objects.create(application=app, room=room, priority=1, month=m)

    c = Client()
    c.force_login(ind)
    c.post(reverse("soegvaerelse:end_round"))

    assert Residency.objects.filter(resident=winner, room=room, year=ny, month=nm).exists()
    assert not RoomOffer.objects.exists()  # round cleared
    assert not KvotientApplication.objects.exists()


@pytest.mark.django_db
def test_end_round_carries_non_participants_forward(make_resident: Callable) -> None:
    """Regression: ending a round must carry residents who weren't part of it into the target month.

    Previously end_round wrote only the winners, so when the target month became active every other
    resident vanished from the list."""
    from residents.models import active_period

    cy, cm = active_period()  # empty DB -> current calendar month
    r1 = Room.objects.create(legacy_index=30, number=30, floor="stuen", side="mod gaden")
    r2 = Room.objects.create(legacy_index=31, number=31, floor="stuen", side="mod gaden")
    bystander = make_resident(email="bystander@gahk.dk")
    Residency.objects.create(resident=bystander, room=r1, year=cy, month=cm)
    Residency.objects.create(resident=make_resident(email="leaver@gahk.dk"), room=r2, year=cy, month=cm)

    ny, nm = next_period((cy, cm))
    m = month_index(ny, nm)
    winner = make_resident(email="win2@gahk.dk")
    app = _application(winner, m, k=9.0)
    KvotientPriority.objects.create(application=app, room=r2, priority=1, month=m)
    RoomOffer.objects.create(room=r2, month=m)

    ind = make_resident(email="ind3@gahk.dk", roles=("indstilling",))
    c = Client()
    c.force_login(ind)
    c.post(reverse("soegvaerelse:end_round"))

    # the bystander (not in the round) is carried forward — the bug was that they disappeared
    assert Residency.objects.filter(resident=bystander, room=r1, year=ny, month=nm).exists()
    # the winner is placed into the offered room on the target month
    assert Residency.objects.filter(resident=winner, room=r2, year=ny, month=nm).exists()


@pytest.mark.django_db
def test_end_round_winner_keeps_embedsgruppe_and_cleaning(make_resident: Callable) -> None:
    """Regression: a winner carried to next month keeps their embedsgruppe/rengøring (only the room
    changes) - they used to be wiped to blank."""
    from core.models import Cleaning, Workgroup
    from residents.models import active_period

    cy, cm = active_period()
    old = Room.objects.create(legacy_index=40, number=40, floor="stuen", side="mod gaden")
    won = Room.objects.create(legacy_index=41, number=41, floor="stuen", side="mod gaden")
    wg = Workgroup.objects.create(name="Haven")
    cl = Cleaning.objects.create(name="Trappe")
    winner = make_resident(email="w@gahk.dk")
    Residency.objects.create(resident=winner, room=old, workgroup=wg, cleaning=cl, year=cy, month=cm)

    ny, nm = next_period((cy, cm))
    m = month_index(ny, nm)
    app = _application(winner, m, k=9.0)
    KvotientPriority.objects.create(application=app, room=won, priority=1, month=m)
    RoomOffer.objects.create(room=won, month=m)

    ind = make_resident(email="ind4@gahk.dk", roles=("indstilling",))
    c = Client()
    c.force_login(ind)
    c.post(reverse("soegvaerelse:end_round"))

    res = Residency.objects.get(resident=winner, year=ny, month=nm)
    assert res.room_id == won.id  # moved into the won room
    assert res.workgroup_id == wg.id  # embedsgruppe preserved
    assert res.cleaning_id == cl.id  # rengøring preserved
