from django import forms

from .models import RepairComment, RepairTask


class RepairTaskForm(forms.ModelForm):
    class Meta:
        model = RepairTask
        fields = ["title", "location", "description"]
        labels = {"title": "Hvad er der galt?", "location": "Sted", "description": "Beskrivelse"}
        widgets = {
            "title": forms.TextInput(attrs={"placeholder": "F.eks. Utæt vandhane"}),
            "location": forms.TextInput(attrs={"placeholder": "F.eks. Værelse 214 / Fælleskøkkenet"}),
            "description": forms.Textarea(attrs={"rows": 5, "placeholder": "Beskriv problemet…"}),
        }

    def clean_title(self) -> str:
        title = (self.cleaned_data.get("title") or "").strip()
        if not title:
            raise forms.ValidationError("Skriv hvad der er galt.")
        return title


class RepairCommentForm(forms.ModelForm):
    class Meta:
        model = RepairComment
        fields = ["body"]
        labels = {"body": "Note"}
        widgets = {"body": forms.Textarea(attrs={"rows": 3, "placeholder": "Skriv en note…"})}

    def clean_body(self) -> str:
        body = (self.cleaned_data.get("body") or "").strip()
        if not body:
            raise forms.ValidationError("Skriv en note.")
        return body
