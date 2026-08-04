# GAHK wiki — MediaWiki 1.35 on the official image, plus the parts that are actually ours.
#
# Why not ship legacy_site/wiki/ wholesale: that tree has been upgraded in place since at least 1.22.
# RELEASE-NOTES-1.22 is still there; so is includes/AuthPlugin.php, which MediaWiki removed in 1.33;
# so is includes/installer/Installer.i18n.php, which is absent from the official 1.35 image entirely.
# Publishing that tree would publish every dead file with it. The official image gives patched 1.35.x
# core, and only these 8 directories plus LocalSettings.php are genuinely ours — verified with
# `comm` against the image's own extension/skin lists (CUTOVER.md Phase 5A step 3).
#
#     docker build -t gahk-wiki:1.35 .
#
# 1.35 is the last MediaWiki supporting PHP 7.4, so this is pinned there. The GahkAuthLogin sources
# are PHP 8.1-clean, so they carry through the eventual 1.43 upgrade unchanged.

FROM mediawiki:1.35

# pdo_pgsql: GahkAuthLogin authenticates against the Django app's PostgreSQL (residents_resident)
# instead of a frozen copy of the retired intern_alumne table, so a password reset in the app takes
# effect on the wiki immediately rather than leaving the old hashes valid here forever.
#
# Do NOT `apt-get purge --auto-remove libpq-dev` afterwards: libpq5 is pulled in as its dependency,
# auto-remove takes libpq5 with it, and pdo_pgsql.so is then unloadable. PHP skips an extension it
# cannot load *silently*, so the build still succeeds and the breakage only appears as a confusing
# failure at the first login. Keeping libpq-dev costs a few MB. The assertion below is what actually
# guarantees it — never trust the build exiting 0.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends libpq-dev; \
    docker-php-ext-install -j"$(nproc)" pdo_pgsql; \
    rm -rf /var/lib/apt/lists/*; \
    php -m | grep -qx 'pdo_pgsql' || { echo 'FATAL: pdo_pgsql did not load'; exit 1; }; \
    php -m | grep -qx 'mysqli'    || { echo 'FATAL: mysqli missing (MediaWiki core needs it)'; exit 1; }

# Extensions and skins NOT bundled with the 1.35 tarball. Everything else your old tree carried is
# bundled, and the image's copies are newer — do not add bundled ones here or you undo its patches.
COPY extensions/ /var/www/html/extensions/
COPY skins/      /var/www/html/skins/

COPY LocalSettings.php /var/www/html/LocalSettings.php

# User uploads (396 rows in wikiimage). Must be a mounted volume or they vanish on every redeploy.
VOLUME /var/www/html/images
