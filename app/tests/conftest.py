import hashlib
from collections.abc import Callable

import pytest

from residents.models import Resident, RoleAssignment, active_period


@pytest.fixture
def make_resident(db: None) -> Callable[[str, str, bool, tuple], Resident]:
    def _make(
        email: str = "r@gahk.dk",
        password: str = "hemmelig",
        legacy: bool = False,
        roles: tuple = (),
        **extra: object,
    ) -> Resident:
        r = Resident(
            email=email,
            first_name=extra.pop("first_name", "Test"),
            last_name=extra.pop("last_name", "Beboer"),
            **extra,
        )
        if legacy:
            r.password = "gahk_sha256$$" + hashlib.sha256(password.encode()).hexdigest()
        else:
            r.set_password(password)
        r.save()
        year, month = active_period()
        for role in roles:
            RoleAssignment.objects.create(resident=r, role=role, year=year, month=month)
        if roles:
            Resident.objects.filter(id=r.id).update(is_staff=True)
        return r

    return _make
