#!/usr/bin/env python
"""Generate a Mermaid erDiagram from Django models and write it to docs/erd.md.

Exit codes: 0 = no change, 1 = diagram was updated (stage docs/erd.md and recommit).
"""

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
APP_DIR = REPO_ROOT / "app"
OUTPUT = REPO_ROOT / "docs" / "erd.md"

sys.path.insert(0, str(APP_DIR))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.apps import apps  # noqa: E402
from django.db import models as m  # noqa: E402

PROJECT_APPS = frozenset(
    [
        "admissions",
        "ak",
        "cms",
        "core",
        "den_hurtige",
        "oelkaelder",
        "residents",
        "rooms",
        "stats",
    ]
)

FIELD_TYPES: dict[str, str] = {
    "AutoField": "int",
    "BigAutoField": "int",
    "SmallAutoField": "int",
    "IntegerField": "int",
    "PositiveIntegerField": "int",
    "PositiveSmallIntegerField": "int",
    "SmallIntegerField": "int",
    "BigIntegerField": "int",
    "FloatField": "float",
    "DecimalField": "decimal",
    "BooleanField": "bool",
    "CharField": "string",
    "TextField": "text",
    "EmailField": "string",
    "SlugField": "string",
    "URLField": "string",
    "UUIDField": "string",
    "FileField": "string",
    "ImageField": "string",
    "DateField": "date",
    "DateTimeField": "datetime",
    "TimeField": "time",
    "JSONField": "json",
    "ForeignKey": "int",
    "OneToOneField": "int",
}


def entity_name(model: type) -> str:
    return f"{model._meta.app_label}_{model.__name__}"


def mermaid_type(field: m.Field) -> str:
    return FIELD_TYPES.get(field.get_internal_type(), "string")


def generate() -> str:
    project_models = [
        model
        for app in apps.get_app_configs()
        if app.label in PROJECT_APPS
        for model in app.get_models()
    ]
    model_set = set(project_models)

    entities: list[str] = []
    relations: list[str] = []

    for model in project_models:
        name = entity_name(model)
        field_lines: list[str] = []

        for field in model._meta.get_fields():
            if not field.concrete:
                continue  # skip reverse accessors
            if isinstance(field, m.ManyToManyField):
                related = field.related_model
                if related in model_set:
                    rel_name = entity_name(related)
                    relations.append(f'    {name} }}o--o{{ {rel_name} : "{field.name}"')
                continue  # no column on this table
            if isinstance(field, (m.ForeignKey, m.OneToOneField)):
                related = field.related_model
                if related in model_set:
                    rel_name = entity_name(related)
                    right = "|o" if field.null else "||"
                    left = "||" if isinstance(field, m.OneToOneField) else "}o"
                    relations.append(
                        f'    {name} {left}--{right} {rel_name} : "{field.name}"'
                    )
                col_type = "int"
                col_name = field.attname  # e.g. resident_id
                suffix = " FK"
            else:
                col_type = mermaid_type(field)
                col_name = field.name
                suffix = " PK" if field.primary_key else ""
            field_lines.append(f"        {col_type} {col_name}{suffix}")

        entities.append(f"    {name} {{")
        entities.extend(field_lines)
        entities.append("    }")

    lines = ["```mermaid", "erDiagram"]
    lines += entities
    lines += relations
    lines.append("```")
    return "\n".join(lines)


def main() -> None:
    OUTPUT.parent.mkdir(exist_ok=True)
    diagram = generate()
    header = (
        "# Entity Relationship Diagram\n\n"
        "> Auto-generated — do not edit by hand. "
        "Re-run `uv run python scripts/generate_erd.py` to refresh.\n\n"
    )
    content = header + diagram + "\n"

    if OUTPUT.exists() and OUTPUT.read_text(encoding="utf-8") == content:
        sys.exit(0)

    OUTPUT.write_text(content, encoding="utf-8")
    print(f"ERD updated: {OUTPUT.relative_to(REPO_ROOT)}")
    print("Stage docs/erd.md and recommit.")
    sys.exit(1)


if __name__ == "__main__":
    main()
