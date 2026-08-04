<?php

# Not a valid entry point, skip unless MEDIAWIKI is defined
if( !defined( 'MEDIAWIKI' ) ) {
  echo "ShowRealUsernames: This is an extension to the MediaWiki package and cannot be run standalone.\n";
  die( -1 );
}

/**
 * @brief %ShowRealUsernames extension for MediaWiki.
 *
 * @defgroup Extensions-ShowRealUsernames ShowRealUsernames extension
 *
 * @ingroup Extensions
 *
 * To activate this extension, put the source files into
 * `$IP/extensions/ShowRealUsernames` and add the following into your
 * `LocalSettings.php` file:
 *
 * @code
 * require_once("$IP/extensions/ShowRealUsernames/ShowRealUsernames.php");
 * @endcode
 *
 * You can customize @ref $wgGroupPermissions, @ref
 * $wgShowRealUsernamesInline, @ref $wgShowRealUsernamesFields and the
 * @ref ShowRealUsernames.i18n.php "messages".
 *
 * @version 1.3.0
 *
 * @copyright [GPL-3.0+](https://gnu.org/licenses/gpl-3.0-standalone.html)
 *
 * @author Paul Lustgarten
 * @author John Erling Blad
 * @author [RV1971](http://www.mediawiki.org/wiki/User:RV1971)
 *
 * @sa [User documentation]
 * (http://www.mediawiki.org/wiki/Extension:ShowRealUsernames)
 *
 * @sa [MediaWiki Manual](http://www.mediawiki.org/wiki/Manual:Contents):
 * - [Developing extensions]
 * (http://www.mediawiki.org/wiki/Manual:Developing_extensions)
 * - [Hooks](http://www.mediawiki.org/wiki/Manual:Hooks)
 * - [Messages API](http://www.mediawiki.org/wiki/Manual:Messages_API)
 *
 * @sa [Semantic Versioning](http://semver.org)
 *
 * @todo Also modify Special:UserRights and Special:ActiveUsers, if
 * possible.
 *
 * @todo For languages da, es, nb, add to sru-realname-desc the hint
 * that other data besides the user's real name can be added. Add the
 * message right-showrealname.
 */

/**
 * @brief Setup for the @ref Extensions-ShowRealUsernames.
 *
 * @file
 *
 * @ingroup Extensions
 * @ingroup Extensions-ShowRealUsernames
 *
 * @author [RV1971](http://www.mediawiki.org/wiki/User:RV1971)
 *
 */

/**
 * @brief Customizable permissions.
 *
 * Only users having the `showrealname` right do see the real
 * names. By default, this right is granted to all registered
 * users. To restrict it to a group add something like the following
 * lines to your `LocalSettings.php` *after* including the
 * ShowRealUsernames extension:
 *
 * @code
 * $wgGroupPermissions['user']['showrealname'] = false;
 * $wgGroupPermissions['bureaucrat']['showrealname'] = true;
 * @endcode
 */
$wgGroupPermissions['user']['showrealname'] = true;

/**
 * @brief Customizable flag telling whether to replace the wiki name
 * with the real name.
 *
 * By default, the user's real name is appended to the wiki name in
 * Special:ListUsers. You can replace the wiki name with the real name
 * by setting
 *
 * @code
 * $wgShowRealUsernamesInline = true;
 * @endcode
 *
 * in your `LocalSettings.php` *after* including the
 * ShowRealUsernames extension.
 *
 */
$wgShowRealUsernamesInline = false;

/**
 * @brief Customizable list of extra fields to get from the database.
 *
 * These fields are obtained from the table `user` and substituted for
 * $1, $2 etc. in messages. For compatibility with older versions, in
 * the default value, `user_real_name` is the first and `user_name`
 * the second field, even if the opposite might be considered more
 * intuitive.
 */
$wgShowRealUsernamesFields = array(
	'user_real_name',
	'user_name',
	'user_email'
);

/// [About](http://www.mediawiki.org/wiki/$wgExtensionCredits) this extension.
$wgExtensionCredits['other'][] = array(
	'path' => __FILE__,
	'name' => 'ShowRealUsernames',
	'descriptionmsg' => 'sru-realname-desc',
	'version' => '1.3.0',
	'author' => array('Paul Lustgarten','John Erling Blad',
		'[http://www.mediawiki.org/wiki/User:RV1971 RV1971]'),
	'url' => 'https://www.mediawiki.org/wiki/Extension:ShowRealUsernames'
);

/// [Autoloading](http://www.mediawiki.org/wiki/Manual:$wgAutoloadClasses)
$wgAutoloadClasses['ShowRealUsernames'] =
	__DIR__ . '/ShowRealUsernames.body.php';

/**
 * @brief [Defer initialization]
 * (https://www.mediawiki.org/wiki/Manual:$wgExtensionFunctions)
 */
$wgExtensionFunctions[] = 'ShowRealUsernames::init';

/**
 * @brief [Internationalisation]
 * (http://www.mediawiki.org/wiki/Internationalisation) file.
 */
$wgExtensionMessagesFiles['ShowRealUsernames'] =
	__DIR__ . '/ShowRealUsernames.i18n.php';

?>