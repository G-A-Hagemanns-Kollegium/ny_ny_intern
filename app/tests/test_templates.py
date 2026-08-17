"""Static checks over every template file.

These are deliberately *static* rather than render-based. The project already had two render-based
guards against leaking template syntax (test_soegvaerelse, test_features), and the bug still reached
production twice more — because a render test only covers the one page it renders, so each new
template is unprotected until someone remembers to add it to a list. Walking the files catches every
template, including ones no test ever visits.
"""

from pathlib import Path

from django.conf import settings

TEMPLATE_DIR = Path(settings.BASE_DIR) / "templates"


def template_files() -> list[Path]:
    files = [p for p in sorted(TEMPLATE_DIR.rglob("*")) if p.is_file()]
    assert files, f"no templates found under {TEMPLATE_DIR} — this check would pass vacuously"
    return files


def test_no_multiline_short_comments() -> None:
    """Django's `{# … #}` is single-line only. Spread it over two lines and the closing `#}` never
    matches, so the whole comment renders verbatim onto the page — which is exactly how a note about
    PurchasePolicy ended up visible to residents on the live ølkælder till.

    Multi-line commentary must use `{% comment %} … {% endcomment %}`.
    """
    offenders = []
    for path in template_files():
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "{#" in line and "#}" not in line.split("{#", 1)[1]:
                rel = path.relative_to(TEMPLATE_DIR).as_posix()
                offenders.append(f"{rel}:{number}: {line.strip()[:80]}")

    assert not offenders, "unterminated {# … #} — use {% comment %} for multi-line:\n" + "\n".join(offenders)


def test_comment_blocks_are_closed() -> None:
    """An unclosed `{% comment %}` swallows the rest of the template silently — the page renders
    truncated rather than erroring, which is easy to miss in review."""
    offenders = []
    for path in template_files():
        text = path.read_text(encoding="utf-8")
        opened, closed = text.count("{% comment %}"), text.count("{% endcomment %}")
        if opened != closed:
            rel = path.relative_to(TEMPLATE_DIR).as_posix()
            offenders.append(f"{rel}: {opened} × comment, {closed} × endcomment")

    assert not offenders, "unbalanced comment blocks:\n" + "\n".join(offenders)
