"""The application clock, with a DEV-ONLY override.

Everything that decides "which month is it" (residents.active_period, and thus next_period /
prev_period / the room-lottery target) reads the current date through here rather than calling
timezone directly, so a developer can fast-forward time locally to test month rollover.

The override is honoured ONLY when settings.DEBUG. In production (DEBUG=False) these are thin
pass-throughs to django.utils.timezone and the DevClock row is never queried, so there is no
behavioural change and no way to shift prod's clock.
"""

import datetime

from django.conf import settings
from django.utils import timezone


def _override() -> datetime.date | None:
    if not settings.DEBUG:
        return None
    from .models import DevClock  # local import: avoids a models import at settings-load time

    return DevClock.get().simulated_date


def current_date() -> datetime.date:
    """Today's date, or the dev override when one is set under DEBUG."""
    return _override() or timezone.localdate()


def current_datetime() -> datetime.datetime:
    """Now, or midnight (local tz) of the dev override date when one is set under DEBUG."""
    override = _override()
    if override is None:
        return timezone.localtime()
    return timezone.make_aware(datetime.datetime.combine(override, datetime.time()))
