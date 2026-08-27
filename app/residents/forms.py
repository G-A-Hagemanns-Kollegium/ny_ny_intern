from django import forms
from django.contrib.auth.forms import AuthenticationForm
from django.core.files.uploadedfile import UploadedFile

from core.uploads import check_image_upload

from .models import Resident


class EmailAuthenticationForm(AuthenticationForm):
    """Login form relabelled for email (the resident USERNAME_FIELD is `email`)."""

    def __init__(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        super().__init__(*args, **kwargs)
        self.fields["username"].label = "E-mail"
        self.fields["username"].widget.attrs.update({"autofocus": True, "autocomplete": "email"})


class ResidentEditForm(forms.ModelForm):
    """Indstilling edits a resident's core data (everything in the alumneliste that is not per-month:
    room/embedsgruppe/rengøring live on the monthly Residency and are edited on the next-month list)."""

    class Meta:
        model = Resident
        fields = [
            "first_name",
            "last_name",
            "email",
            "phone",
            "birthday",
            "study",
            "move_in_date",
            "move_out_date",
            "sponsor",
            "fylgje_raw",
        ]
        labels = {
            "first_name": "Fornavn",
            "last_name": "Efternavn",
            "email": "E-mail",
            "phone": "Telefon",
            "birthday": "Fødselsdag",
            "study": "Studie",
            "move_in_date": "Indflyttet",
            "move_out_date": "Fraflyttet",
            "sponsor": "Fylgje (fadder)",
            "fylgje_raw": "Fylgje (fritekst, hvis ukendt)",
        }
        widgets = {
            "birthday": forms.DateInput(attrs={"type": "date"}),
            "move_in_date": forms.DateInput(attrs={"type": "date"}),
            "move_out_date": forms.DateInput(attrs={"type": "date"}),
        }

    def __init__(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        super().__init__(*args, **kwargs)
        # Fylgje picker: any other resident, by name; not required.
        sponsor = self.fields["sponsor"]
        if isinstance(sponsor, forms.ModelChoiceField):
            sponsor.queryset = Resident.objects.exclude(pk=self.instance.pk).order_by(
                "first_name", "last_name"
            )
        sponsor.required = False


class ProfileEditForm(forms.ModelForm):
    """A resident edits their own public profile (picture, bio, social links)."""

    class Meta:
        model = Resident
        fields = ["profile_picture", "bio", "facebook_link", "instagram_handle"]
        labels = {
            "profile_picture": "Profilbillede",
            "bio": "Kort bio",
            "facebook_link": "Facebook-link",
            "instagram_handle": "Instagram-brugernavn",
        }
        widgets = {
            "profile_picture": forms.ClearableFileInput(),
            "bio": forms.Textarea(attrs={"rows": 4, "maxlength": 500}),
            "facebook_link": forms.TextInput(attrs={"placeholder": "https://www.facebook.com/..."}),
            "instagram_handle": forms.TextInput(attrs={"placeholder": "@brugernavn"}),
        }
        help_texts = {
            "bio": "Maks. 500 tegn.",
            "facebook_link": "Fuld URL til din Facebook-profil.",
            "instagram_handle": "Dit Instagram-brugernavn (med eller uden @).",
        }

    def clean_profile_picture(self) -> object:
        upload = self.cleaned_data.get("profile_picture")
        if isinstance(upload, UploadedFile):
            error = check_image_upload(upload, max_mb=5)
            if error:
                raise forms.ValidationError(error)
        return upload
