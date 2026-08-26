"""Forms for opslagstavlen.

Real ModelForms here, unlike Den Hurtige's hand-rolled `request.POST` reading. That feature has one
textarea and a duration whitelist; this one has a category that must be validated against a choice
set, a long body with a length cap, and an edit view that has to round-trip the same fields —
which is exactly what the project's form convention (explicit `Meta.fields`, Danish labels, manual
field-by-field rendering in the template) exists for.
"""

from django import forms

from core.emoji import is_emoji, is_only_one_emoji, normalize_emoji

from .models import MAX_BODY_CHARS, Notice, NoticeComment


class NoticeForm(forms.ModelForm):
    class Meta:
        model = Notice
        # Explicit, which kills mass-assignment: pinned_at/pinned_by/author/edited_at are set by the
        # views that are allowed to set them, never by whatever arrives in the POST body.
        fields = ["category", "body"]
        labels = {"category": "Kategori", "body": "Indhold"}
        widgets = {
            "body": forms.Textarea(
                attrs={
                    "rows": 16,
                    "maxlength": MAX_BODY_CHARS,
                    "placeholder": "Skriv med Markdown. Brug knapperne ovenfor, eller skriv **fed**.",
                }
            ),
        }

    def clean_body(self) -> str:
        """Cap the body server-side as well as via maxlength.

        Not tidiness: the list page renders every post's Markdown, so an enormous body would slow
        down (or break) the whole board rather than one post — a crafted POST must not be able to do
        that.
        """
        body = (self.cleaned_data.get("body") or "").strip()
        if not body:
            raise forms.ValidationError("Skriv et indhold.")
        if len(body) > MAX_BODY_CHARS:
            raise forms.ValidationError(f"Opslaget må højst fylde {MAX_BODY_CHARS} tegn.")
        return body


class NoticeCommentForm(forms.ModelForm):
    class Meta:
        model = NoticeComment
        fields = ["body"]
        labels = {"body": "Kommentar"}
        widgets = {
            "body": forms.Textarea(attrs={"rows": 3, "placeholder": "Skriv en kommentar…"}),
        }

    def clean_body(self) -> str:
        body = (self.cleaned_data.get("body") or "").strip()
        if not body:
            raise forms.ValidationError("Skriv en kommentar.")
        return body


class ReactionForm(forms.Form):
    """Exactly one emoji. The grammar is shared with Den Hurtige (core.emoji); what lives here is the
    Danish wording, and the split between "not an emoji at all" and "several emoji", which need
    different messages because the fix differs."""

    emoji = forms.CharField(max_length=32)

    def clean_emoji(self) -> str:
        # Imported by name rather than as a module: the field above is also called `emoji`, and
        # `emoji.normalize_emoji(...)` in here would read like the field even though it resolves to
        # the module.
        value = normalize_emoji(self.cleaned_data["emoji"])
        if not value:
            raise forms.ValidationError("Vælg en emoji.")
        if not is_only_one_emoji(value):
            raise forms.ValidationError("Kun emoji kan bruges som reaktion.")
        if not is_emoji(value):
            raise forms.ValidationError("Vælg kun én emoji.")
        return value
