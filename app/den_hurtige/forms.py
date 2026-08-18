"""Validation for the untrusted payloads Den Hurtige accepts: push subscriptions and reactions.

The body is `frontend/src/push.ts`'s serialisation of the browser's own PushSubscription:

    {"status_type": "subscribe",
     "subscription": {"endpoint": "...", "keys": {"auth": "...", "p256dh": "..."}},
     "user_agent": "..."}

It is untrusted input on a login-gated endpoint, so every field is length-checked before it reaches
the database — the columns are narrow and a crafted endpoint would otherwise raise DataError.
"""

import unicodedata
from typing import Any

from django import forms


class PushSubscriptionForm(forms.Form):
    status_type = forms.ChoiceField(choices=[("subscribe", "subscribe"), ("unsubscribe", "unsubscribe")])
    # assume_scheme silences Django 6.0's URLField deprecation; push endpoints are always https.
    endpoint = forms.URLField(max_length=500, assume_scheme="https")
    auth = forms.CharField(max_length=100)
    p256dh = forms.CharField(max_length=100)
    user_agent = forms.CharField(max_length=500, required=False)

    @classmethod
    def from_payload(cls, data: dict[str, Any]) -> "PushSubscriptionForm":
        """Flatten the nested browser payload into this form's flat fields. Missing or wrongly typed
        branches collapse to empty dicts so the form reports them as validation errors rather than
        raising AttributeError on malformed input."""
        subscription = data.get("subscription")
        subscription = subscription if isinstance(subscription, dict) else {}
        keys = subscription.get("keys")
        keys = keys if isinstance(keys, dict) else {}
        return cls(
            {
                "status_type": data.get("status_type"),
                "endpoint": subscription.get("endpoint"),
                "auth": keys.get("auth"),
                "p256dh": keys.get("p256dh"),
                "user_agent": data.get("user_agent") or "",
            }
        )


class ReactionForm(forms.Form):
    """Validates that the reaction is exactly ONE emoji.

    Two separate problems live here. Allowing any emoji means arbitrary text reaches the database,
    so "LOL" and markup have to be rejected. And an emoji is not one character: 👍 is one code
    point, ❤️ is two, 👨‍👩‍👧‍👦 is seven, and a flag is two — so a naive length check either
    rejects real emoji or lets someone paste 👍🎉🔥 and land three of them in one reaction bubble.

    There is no stdlib grapheme splitter, so this parses one emoji cluster and insists nothing is
    left over:

        flag          two regional indicators
        keycap        digit / # / * + U+FE0F + U+20E3
        everything    base symbol, optional U+FE0F, optional skin tone,
        else          then any number of ZWJ-joined repeats of the same

    Known limit: bare ❤ (U+2764) and ❤️ (U+2764 U+FE0F) are distinct reactions. Every mobile
    keyboard emits the U+FE0F form and QUICK_EMOJI matches it, so it does not arise in practice.
    """

    ZWJ = 0x200D
    VS16 = 0xFE0F
    KEYCAP = 0x20E3
    SKIN_TONES = (0x1F3FB, 0x1F3FF)
    REGIONAL = (0x1F1E6, 0x1F1FF)
    KEYCAP_BASES = frozenset("0123456789#*")

    emoji = forms.CharField(max_length=32)

    @classmethod
    def _in(cls, code: int, span: tuple[int, int]) -> bool:
        return span[0] <= code <= span[1]

    @classmethod
    def _base_at(cls, value: str, i: int) -> int:
        """Consume one base symbol plus its presentation/skin-tone modifiers; return the next index,
        or -1 if there is no base symbol at `i`."""
        if i >= len(value) or unicodedata.category(value[i]) != "So":
            return -1
        i += 1
        if i < len(value) and ord(value[i]) == cls.VS16:
            i += 1
        if i < len(value) and cls._in(ord(value[i]), cls.SKIN_TONES):
            i += 1
        return i

    @classmethod
    def _consume_one(cls, value: str) -> int:
        """Length in code points of the first emoji cluster, or -1 if it does not start with one."""
        codes = [ord(c) for c in value]

        # Flag: exactly two regional indicators.
        if len(codes) >= 2 and all(cls._in(c, cls.REGIONAL) for c in codes[:2]):
            return 2

        # Keycap: 1️⃣ — the only case where a digit is legitimate.
        if (
            len(codes) >= 3
            and value[0] in cls.KEYCAP_BASES
            and codes[1] == cls.VS16
            and codes[2] == cls.KEYCAP
        ):
            return 3

        i = cls._base_at(value, 0)
        if i < 0:
            return -1
        while i < len(value) and ord(value[i]) == cls.ZWJ:
            nxt = cls._base_at(value, i + 1)
            if nxt < 0:  # a trailing joiner with nothing after it
                return -1
            i = nxt
        return i

    def clean_emoji(self) -> str:
        value = unicodedata.normalize("NFC", self.cleaned_data["emoji"]).strip()
        if not value:
            raise forms.ValidationError("Vælg en emoji.")

        consumed = self._consume_one(value)
        if consumed < 0:
            raise forms.ValidationError("Kun emoji kan bruges som reaktion.")
        if consumed != len(value):
            # Anything left over is a second emoji (or trailing text) pasted into the field.
            raise forms.ValidationError("Vælg kun én emoji.")
        return value
