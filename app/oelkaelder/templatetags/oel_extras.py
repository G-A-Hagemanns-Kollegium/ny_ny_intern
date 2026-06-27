from django import template

register = template.Library()


@register.filter
def kr(ore):
    """Format integer øre as Danish kroner, e.g. 1250 -> '12,50 kr'."""
    try:
        ore = int(ore)
    except (TypeError, ValueError):
        return ""
    return f"{ore / 100:.2f} kr".replace(".", ",")
