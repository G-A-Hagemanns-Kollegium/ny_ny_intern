<?php

# Not a valid entry point, skip unless MEDIAWIKI is defined
if( !defined( 'MEDIAWIKI' ) ) {
  echo "ShowRealUsernames: This is an extension to the MediaWiki package and cannot be run standalone.\n";
  die( -1 );
}

/**
 * @brief Code for the @ref Extensions-ShowRealUsernames.
 *
 * @file
 *
 * @ingroup Extensions
 * @ingroup Extensions-ShowRealUsernames
 *
 * @author Paul Lustgarten
 * @author John Erling Blad
 * @author [RV1971](http://www.mediawiki.org/wiki/User:RV1971)
 */

/**
 * @brief Class implementing the @ref Extensions-ShowRealUsernames.
 *
 * @ingroup Extensions-ShowRealUsernames
 */

class ShowRealUsernames {
	/* public static methods */

	/// Get an instance of this class.
	public static function &singleton() {
		static $instance;

		if ( !isset( $instance ) ) {
			$instance = new static;
		}

		return $instance;
	}

	/**
	 * @brief Initialize this extension.
	 */

	public static function init() {
		global $wgHooks;

		$wgHooks['SpecialListusersQueryInfo'][] = self::singleton();

		$wgHooks['SpecialListusersFormatRow'][] = self::singleton();
	}

	/**
	 * @brief [SpecialListusersFormatRow]
	 * (http://www.mediawiki.org/wiki/Manual:Hooks/SpecialListusersFormatRow)
	 * hook.
	 *
	 * Augment the display of a row to include the user's real name.
	 *
	 * @param[in,out] &$item HTML to be returned. Will be wrapped in
	 * &lt;li&gt;&lt;/li&gt; after the hook finishes. We assume that $item is
	 * non-null and begins with an &lt;a&gt; element.
	 *
	 * @param $row Database row object.
	 *
	 * @return *bool* Always TRUE.
	 */

	public function onSpecialListusersFormatRow( &$item, $row ) {
		global $wgShowRealUsernamesFields;
		global $wgShowRealUsernamesInline;
		global $wgUser;

		if ( $row->user_real_name === ''
			|| !$wgUser->isAllowed( 'showrealname' ) ) {
			return true;
		}

		$values = array();
		foreach ( $wgShowRealUsernamesFields as $field ) {
			$values[] = htmlspecialchars( $row->$field );
		}

		$m = array();
		if ( preg_match( '/^(.*?<a\b[^>]*>)([^<]*)(<\/a\b[^>]*>)(.*)$/',
				$item, $m ) ) {
			if ( $wgShowRealUsernamesInline ) {
				$item = $m[1]
					. wfMessage( 'sru-realname-inline', $values )->text()
					. "{$m[3]}{$m[4]}";
			} else {
				$item = "{$m[1]}{$m[2]}{$m[3]}"
					. wfMessage( 'sru-realname-append', $values )->text()
					. $m[4];
			}
		}

		return true;
	}

	/**
	 * @brief [SpecialListusersQueryInfo]
	 * (http://www.mediawiki.org/wiki/Manual:Hooks/SpecialListusersQueryInfo)
	 * hook.
	 *
	 * Augment the DB query for each user to also fetch their real
	 * name and/or other fields.
	 *
	 * @param UsersPager $pager The UsersPager instance.
	 *
	 * @param[in,out] array &$query The query array to be returned.
	 *
	 * @return *bool* Always TRUE.
	 */

	public function onSpecialListusersQueryInfo( UsersPager $pager,
		array &$query ) {

		global $wgShowRealUsernamesFields;

		// Add extra fields, avoiding duplication.
		$query['fields'] += array_combine(
			$wgShowRealUsernamesFields, $wgShowRealUsernamesFields );

		return true;
	}
}
?>
