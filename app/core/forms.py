"""Validation for the untrusted push-subscription payload.

The body is `frontend/src/push.ts`'s serialisation of the browser's own PushSubscription, plus the
topic the button belongs to:

    {"status_type": "subscribe",
     "topic": "opslagstavle",
     "subscription": {"endpoint": "...", "keys": {"auth": "...", "p256dh": "..."}},
     "user_agent": "..."}

It is untrusted input on a login-gated endpoint, so every field is length-checked before it reaches
the database — the columns are narrow and a crafted endpoint would otherwise raise DataError.
"""

from typing import Any

from django import forms

from .models import TOPIC_FIELDS


class PushSubscriptionForm(forms.Form):
    status_type = forms.ChoiceField(choices=[("subscribe", "subscribe"), ("unsubscribe", "unsubscribe")])
    # Validated against the declared topics, so an unknown one is a 400 rather than a KeyError deep
    # inside the fan-out. Not required: a payload from a cached copy of the old single-topic push.ts
    # has no `topic`, and defaulting it to Den Hurtige is what that build meant.
    topic = forms.ChoiceField(choices=[(t, t) for t in TOPIC_FIELDS], required=False)
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
                "topic": data.get("topic") or "den_hurtige",
                "endpoint": subscription.get("endpoint"),
                "auth": keys.get("auth"),
                "p256dh": keys.get("p256dh"),
                "user_agent": data.get("user_agent") or "",
            }
        )

    def clean_topic(self) -> str:
        """Empty means the caller is an old bundle that predates topics: treat it as Den Hurtige,
        which is the only thing that build could have been subscribing to."""
        return self.cleaned_data.get("topic") or "den_hurtige"
