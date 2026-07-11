from django import template

register = template.Library()


@register.filter
def kr(ore: int | None) -> str:
    """Format integer øre as Danish kroner, e.g. 1250 -> '12,50 kr'."""
    if ore is None:
        return ""
    try:
        ore = int(ore)
    except (TypeError, ValueError):
        return ""
    return f"{ore / 100:.2f} kr".replace(".", ",")
