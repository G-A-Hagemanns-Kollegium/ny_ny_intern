"""Validation for the push-subscription payload the browser POSTs.

The body is `frontend/src/push.ts`'s serialisation of the browser's own PushSubscription:

    {"status_type": "subscribe",
     "subscription": {"endpoint": "...", "keys": {"auth": "...", "p256dh": "..."}},
     "user_agent": "..."}

It is untrusted input on a login-gated endpoint, so every field is length-checked before it reaches
the database — the columns are narrow and a crafted endpoint would otherwise raise DataError.
"""

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
