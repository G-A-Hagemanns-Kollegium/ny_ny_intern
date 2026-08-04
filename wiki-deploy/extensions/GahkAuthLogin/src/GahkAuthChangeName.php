<?php

// Original by Theis F. Hinz
// Last updated by Nicholas Swiatecki <nicholas@swiatecki.com>
//
// 2026-08-04 — same rewrite as GahkAuthLogin: the submitted username was interpolated straight into
// SQL and the shared `gahk_dk` password was hardcoded here too. Now reads the resident's real name
// from PostgreSQL via the parameterised ResidentDirectory. Behaviour is unchanged.

namespace Gahk;

use MediaWiki\Auth\AbstractSecondaryAuthenticationProvider;
use MediaWiki\Auth\AuthenticationResponse;

class GahkAuthChangeName extends AbstractSecondaryAuthenticationProvider
{
    // When a user logs in, optionally fill in preferences and such.
    function beginSecondaryAuthentication($user, $reqs)
    {
        /* This functions pulls the alumnes Real name from the resident directory, and inserts into
        the mediawiki DB */
        if (empty($reqs) || !isset($reqs[0]->username) || $reqs[0]->username === null) {
            return AuthenticationResponse::newAbstain();
        }

        $tmpEmail = $reqs[0]->username;
        $usernameLow = strtolower(str_replace(' ', '_', $tmpEmail));

        $resident = ResidentDirectory::find($usernameLow);
        if ($resident === null) {
            return AuthenticationResponse::newAbstain();
        }

        $user->setRealName(trim($resident['first_name'] . ' ' . $resident['last_name']));
        $user->setName(ucfirst($tmpEmail));
        $user->saveSettings();

        return AuthenticationResponse::newPass();
    }

    public function getAuthenticationRequests($action, array $options)
    {
        // TODO: Implement getAuthenticationRequests() method.
        return [];
    }

    public function beginSecondaryAccountCreation($user, $creator, array $reqs)
    {
        return AuthenticationResponse::newPass();
    }
}
