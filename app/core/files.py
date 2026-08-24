"""Deleting uploaded files along with the rows that reference them.

Django stopped deleting FileField files on row delete in 1.3, so without this the database row goes
and the upload stays on disk forever — invisible, because nothing lists orphaned files and nothing
else ever cleans them up. For a feature built on the promise that content is deleted (Den Hurtige's
30 minutes, opslagstavlen's two years) that is the *opposite* of what the feature promises: the text
expires on schedule while the photograph does not.

Callers register this as a `post_delete` receiver rather than overriding `Model.delete()`, and both
halves of that matter:

  * a bulk queryset delete (a retention purge) never calls `Model.delete()`, and
  * cascaded children are removed by the database, never deleted directly,

so an override would silently miss exactly the paths that delete the most. The trade-off is that a
post_delete receiver disables Django's fast-delete optimisation, so a purge fetches rows before
removing them — irrelevant at this kollegium's volume, and the price of the files actually going.

Fields are discovered from the model rather than named, so one implementation covers
QuickPost.image, QuickComment.image, CmsImage.file, RoomConditionScore.photo and NoticeImage.file.
"""

from django.db import models


def delete_attached_files(instance: models.Model) -> None:
    """Delete every FileField file on `instance` from storage. Safe to call twice."""
    # _meta is Django's documented model-introspection API despite the underscore.
    for field in instance._meta.get_fields():
        if not isinstance(field, models.FileField):
            continue
        file = getattr(instance, field.name, None)
        if file:
            # save=False: the row is already gone, so writing the cleared field back would either
            # resurrect it or raise.
            file.delete(save=False)
