from django import template
from django.templatetags.static import static

register = template.Library()


@register.filter
def legacy_img(path):
    """Map a stored legacy image path (/public/image/...) to its copied static asset URL."""
    if not path:
        return ""
    rel = path[len("/public/"):] if path.startswith("/public/") else path.lstrip("/")
    return static("legacy/" + rel)
