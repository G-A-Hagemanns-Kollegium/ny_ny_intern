"""Legacy password hasher.

The old site stored passwords as a *salt-less* SHA-256 hex digest in `intern_alumne.password`
(01-infrastructure.md A4). The ETL imports them as ``gahk_sha256$$<hexdigest>``. This hasher lets
Django verify those on login; because ``must_update`` returns True, Django immediately re-hashes the
password with the default (strong) hasher on the next successful login — the upgrade-on-login path
(scope §5). No forced global reset.
"""

import hashlib

from django.contrib.auth.hashers import BasePasswordHasher
from django.utils.crypto import constant_time_compare


class GahkLegacySHA256PasswordHasher(BasePasswordHasher):
    algorithm = "gahk_sha256"

    def salt(self):
        return ""  # legacy hashes were unsalted

    def encode(self, password, salt=""):
        digest = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return f"{self.algorithm}$${digest}"

    def verify(self, password, encoded):
        return constant_time_compare(self.encode(password), encoded)

    def safe_summary(self, encoded):
        algorithm, _, digest = encoded.partition("$$")
        return {"algorithm": algorithm, "hash": digest[:6] + "…"}

    def must_update(self, encoded):
        return True  # always upgrade legacy hashes to the default hasher on next login

    def harden_runtime(self, password, encoded):
        return
