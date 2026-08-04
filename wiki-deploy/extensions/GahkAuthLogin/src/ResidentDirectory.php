<?php

// Read-only lookup of residents in the Django app's PostgreSQL database.
//
// Replaces the old mysqli connection to `intern_alumne` on the legacy MySQL box. That table no longer
// exists after the 2026-08 cutover, and the alternative — freezing a copy of it into the wiki's own
// database — would have kept the pre-breach SHA-256 hashes valid on the wiki forever, defeating the
// forced password reset. Reading the live Postgres row means a resident's current password is the one
// that works, and a reset takes effect on the wiki immediately.
//
// Credentials come from the environment; nothing is hardcoded. Use a dedicated read-only Postgres
// role, not the application's own `gahk` user:
//
//   CREATE ROLE wiki_ro LOGIN PASSWORD '...';
//   GRANT CONNECT ON DATABASE gahk TO wiki_ro;
//   GRANT USAGE ON SCHEMA public TO wiki_ro;
//   GRANT SELECT (id, email, password, first_name, last_name, is_active)
//     ON residents_resident TO wiki_ro;
//
// Environment: GAHK_PG_HOST, GAHK_PG_PORT, GAHK_PG_DB, GAHK_PG_USER, GAHK_PG_PASSWORD
// Requires the pdo_pgsql PHP extension.

namespace Gahk;

use PDO;
use PDOException;

class ResidentDirectory
{
    /** @var PDO|null */
    private static $pdo = null;

    /**
     * @return PDO|null null when the database is unreachable or unconfigured
     */
    private static function connect()
    {
        if (self::$pdo !== null) {
            return self::$pdo;
        }

        $host = getenv('GAHK_PG_HOST');
        $db = getenv('GAHK_PG_DB');
        $user = getenv('GAHK_PG_USER');
        $password = getenv('GAHK_PG_PASSWORD');
        $port = getenv('GAHK_PG_PORT') ?: '5432';

        if (!$host || !$db || !$user) {
            wfLogWarning('GahkAuthLogin: GAHK_PG_* environment is not configured; cannot authenticate.');
            return null;
        }

        try {
            self::$pdo = new PDO(
                sprintf('pgsql:host=%s;port=%s;dbname=%s', $host, $port, $db),
                $user,
                $password !== false ? $password : '',
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_TIMEOUT => 5,
                ]
            );
        } catch (PDOException $e) {
            // Never surface connection details to the visitor.
            wfLogWarning('GahkAuthLogin: cannot reach the resident database: ' . $e->getMessage());
            return null;
        }

        return self::$pdo;
    }

    /**
     * Look a resident up by e-mail, or by numeric id (the legacy provider accepted either).
     *
     * @param string $identifier
     * @return array|null  ['password', 'first_name', 'last_name'] for an active resident, else null
     */
    public static function find($identifier)
    {
        $pdo = self::connect();
        if ($pdo === null) {
            return null;
        }

        // Parameterised — the submitted value is never concatenated into SQL. This is the injection
        // that the original extension shipped with.
        $sql = 'SELECT id, email, password, first_name, last_name
                  FROM residents_resident
                 WHERE is_active AND lower(email) = lower(:ident)';
        $params = [':ident' => $identifier];

        if (ctype_digit((string)$identifier)) {
            $sql .= ' OR (is_active AND id = :ident_id)';
            $params[':ident_id'] = (int)$identifier;
        }
        $sql .= ' LIMIT 1';

        try {
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            $row = $stmt->fetch();
        } catch (PDOException $e) {
            wfLogWarning('GahkAuthLogin: resident lookup failed: ' . $e->getMessage());
            return null;
        }

        return $row !== false ? $row : null;
    }
}
