import re

from django import template
from django.conf import settings
from django.templatetags.static import static

register = template.Library()


@register.filter
def legacy_img(path):
    """Map a stored legacy image path (/public/image/...) to its copied static asset URL."""
    if not path:
        return ""
    rel = path[len("/public/") :] if path.startswith("/public/") else path.lstrip("/")
    return static("legacy/" + rel)


@register.filter
def body_media(html):
    """Rewrite legacy /public/... asset URLs inside CMS body HTML to the copied static location."""
    if not html:
        return html
    prefix = settings.STATIC_URL.rstrip("/") + "/legacy/"
    return re.sub(r'((?:src|href)\s*=\s*["\'])/?public/', r"\1" + prefix, html, flags=re.I)
