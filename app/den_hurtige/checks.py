"""Startup validation of things with no runtime symptom: the VAPID key pair, and the channel
registry.

A wrong VAPID key pair has no server-side symptom whatsoever: Django starts, the feed renders, the
subscribe button appears, and the only evidence is the browser refusing to subscribe — as a generic
`AbortError` from the push service, which is indistinguishable from being offline. Every mistake
that is cheap to detect is therefore detected here, so `manage.py check` (which `runserver` and the
deploy both run) reports it in one line instead.

Checked, in order of how easy each is to get wrong:
  E001  not base64url                     — e.g. a PEM header/newlines pasted in
  E002  wrong length or missing 0x04 tag  — e.g. the SPKI DER body instead of the raw point
  E003  public set, private missing
  E004  65 bytes and 0x04, but not a point on P-256 — passes a shape check, still rejected by FCM
  E005  private key is not a raw 32-byte scalar
  E006  the two keys are not each other's halves — the classic result of regenerating the pair
        and updating only one of the two environment variables

The channel registry (den_hurtige.channels) is a tuple in code rather than table rows, so it has no
unique constraint, no FK and no `choices=` behind it. These checks are what replaces them:

  E007  two channels share a slug           — the later one is unreachable; BY_SLUG silently keeps one
  E008  a slug collides with a URL segment  — urls.py matches the fixed path first, so the channel
        never resolves and nothing anywhere reports it
  E009  default_duration is not offered by the composer's picker — the <select> would render with
        nothing selected and quietly post something else
  E010  channels.DEFAULT disagrees with QuickPost.channel's field default — every row written before
        the channel field existed would sit in a channel no tab links to
"""

import base64
import binascii
from collections.abc import Sequence

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.apps.config import AppConfig
from django.conf import settings
from django.core.checks import CheckMessage, Error

# An uncompressed P-256 point: the 0x04 tag byte followed by the 32-byte X and Y coordinates. This
# is what the browser wants as `applicationServerKey` - NOT the SPKI PEM openssl writes by default.
VAPID_KEY_BYTES = 65
UNCOMPRESSED_POINT_TAG = 0x04
VAPID_PRIVATE_KEY_BYTES = 32

CONVERT_HINT = (
    "Both keys must be raw base64url, not .pem file contents or paths. "
    "app/.env.example has the one-liner that converts a PEM to the two values this app expects."
)


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _uncompressed_point(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def check_vapid_public_key(app_configs: Sequence[AppConfig] | None, **kwargs: object) -> list[CheckMessage]:
    """Validate the VAPID key pair when push is configured at all."""
    public_b64 = getattr(settings, "VAPID_PUBLIC_KEY", "")
    private_b64 = getattr(settings, "VAPID_PRIVATE_KEY", "")
    if not public_b64:
        return []  # push deliberately disabled (the normal dev default); the UI reports it in-page

    try:
        public_raw = _b64url_decode(public_b64)
    except (binascii.Error, ValueError):
        return [Error("VAPID_PUBLIC_KEY is not valid base64url.", hint=CONVERT_HINT, id="den_hurtige.E001")]

    if len(public_raw) != VAPID_KEY_BYTES or public_raw[0] != UNCOMPRESSED_POINT_TAG:
        leading = f"0x{public_raw[0]:02x}" if public_raw else "nothing"
        return [
            Error(
                f"VAPID_PUBLIC_KEY decodes to {len(public_raw)} bytes starting with {leading}; "
                f"expected {VAPID_KEY_BYTES} bytes starting with 0x04.",
                hint=CONVERT_HINT,
                id="den_hurtige.E002",
            )
        ]

    if not private_b64:
        return [
            Error(
                "VAPID_PUBLIC_KEY is set but VAPID_PRIVATE_KEY is empty — browsers could subscribe "
                "but the server could not sign a single push.",
                hint="Set both, or neither to disable push.",
                id="den_hurtige.E003",
            )
        ]

    try:
        public_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public_raw)
    except ValueError:
        return [
            Error(
                "VAPID_PUBLIC_KEY is the right length but is not a point on the P-256 curve. The "
                "browser's push service rejects it, which surfaces as a generic subscribe failure.",
                hint=CONVERT_HINT,
                id="den_hurtige.E004",
            )
        ]

    try:
        private_raw = _b64url_decode(private_b64)
        if len(private_raw) != VAPID_PRIVATE_KEY_BYTES:
            raise ValueError(f"expected {VAPID_PRIVATE_KEY_BYTES} bytes, got {len(private_raw)}")
        private_key = ec.derive_private_key(int.from_bytes(private_raw, "big"), ec.SECP256R1())
    except (binascii.Error, ValueError) as exc:
        return [
            Error(
                f"VAPID_PRIVATE_KEY is not a raw base64url P-256 scalar ({exc}).",
                hint=CONVERT_HINT,
                id="den_hurtige.E005",
            )
        ]

    if _uncompressed_point(private_key.public_key()) != _uncompressed_point(public_key):
        return [
            Error(
                "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not halves of the same key pair. "
                "Browsers subscribe against the public key and the server signs with the private "
                "one, so no push can ever be delivered.",
                hint=(
                    "Re-derive BOTH values from one .pem — updating only one of them after "
                    "regenerating the pair is the usual cause. See app/.env.example."
                ),
                id="den_hurtige.E006",
            )
        ]

    return []


def check_channels(app_configs: Sequence[AppConfig] | None, **kwargs: object) -> list[CheckMessage]:
    """Validate the channel registry — the constraints a DB table would have enforced for free."""
    from . import channels
    from .models import DEFAULT_CHANNEL_SLUG

    errors: list[CheckMessage] = []

    seen: set[str] = set()
    for channel in channels.CHANNELS:
        if channel.slug in seen:
            errors.append(
                Error(
                    f"Two channels share the slug {channel.slug!r}.",
                    hint="Slugs are the URL and the value stored on every post; they must be unique.",
                    id="den_hurtige.E007",
                )
            )
        seen.add(channel.slug)

        if channel.slug in channels.RESERVED_SLUGS:
            errors.append(
                Error(
                    f"Channel slug {channel.slug!r} collides with a fixed URL segment.",
                    hint=(
                        "den_hurtige/urls.py matches that path before <slug:channel>/, so the "
                        f"channel would never open. Reserved: {sorted(channels.RESERVED_SLUGS)}."
                    ),
                    id="den_hurtige.E008",
                )
            )

        if channel.default_duration not in channels.VALID_DURATIONS:
            errors.append(
                Error(
                    f"Channel {channel.slug!r} defaults to {channel.default_duration} minutes, "
                    "which the composer does not offer.",
                    hint=f"Pick one of {sorted(channels.VALID_DURATIONS)} (models.DURATION_CHOICES).",
                    id="den_hurtige.E009",
                )
            )

    if channels.DEFAULT.slug != DEFAULT_CHANNEL_SLUG:
        errors.append(
            Error(
                f"channels.DEFAULT is {channels.DEFAULT.slug!r} but QuickPost.channel defaults to "
                f"{DEFAULT_CHANNEL_SLUG!r}.",
                hint=(
                    "Every post written before the channel field existed carries the model default. "
                    "If the two disagree, those posts sit in a channel no tab links to."
                ),
                id="den_hurtige.E010",
            )
        )

    return errors
