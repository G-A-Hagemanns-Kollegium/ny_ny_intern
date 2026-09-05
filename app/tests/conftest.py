import hashlib
from collections.abc import Callable

import pytest

from residents.models import Resident, RoleAssignment, active_period


@pytest.fixture(autouse=True)
def _never_touch_the_real_bucket(settings: object) -> None:
    """Force local filesystem storage for every test, whatever the environment says.

    config/settings.py picks STORAGES["default"] from the S3_BUCKET environment variable, and that
    module calls `load_dotenv(BASE_DIR / ".env")` — so the moment a developer puts real credentials
    in app/.env to try the bucket out, `task test` would run the whole suite against production
    object storage. Several tests upload files and several assert that deleting a row deletes the
    file, so that is not a read-only accident: it writes and then deletes real objects.

    Autouse and unconditional, because the failure is silent and irreversible and no individual test
    should have to remember. The many tests that redirect MEDIA_ROOT at a tmp_path depend on this
    too — pointing MEDIA_ROOT somewhere safe does nothing if the backend is not the filesystem.
    """
    settings.STORAGES = {  # type: ignore[attr-defined]
        **settings.STORAGES,  # type: ignore[attr-defined]
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    }


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
