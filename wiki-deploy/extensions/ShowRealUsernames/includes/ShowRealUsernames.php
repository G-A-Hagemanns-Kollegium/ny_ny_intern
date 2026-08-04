<?php

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
 * @author [RV1971](https://www.mediawiki.org/wiki/User:RV1971)
 */

/**
 * @brief Class implementing the @ref Extensions-ShowRealUsernames.
 *
 * @ingroup Extensions-ShowRealUsernames
 */

class ShowRealUsernames {

	/**
	 * @brief [SpecialListusersFormatRow]
	 * (https://www.mediawiki.org/wiki/Manual:Hooks/SpecialListusersFormatRow)
	 * hook.
	 *
	 * Augment the display of a row to include the user's real name.
	 *
	 * @param[in,out] &$item HTML to be returned. Will be wrapped in
	 * &lt;li&gt;&lt;/li&gt; after the hook finishes. We assume that $item is
	 * non-null and begins with an &lt;a&gt; element.
	 *
	 * @param stdClass $row Database row object.
	 *
	 * @return *bool* Always TRUE.
	 */

	public static function onSpecialListusersFormatRow( &$item, $row ) {
		global $wgShowRealUsernamesFields, $wgShowRealUsernamesInline;

		if ( $row->user_real_name === ''
			|| !RequestContext::getMain()->getUser()->isAllowed( 'showrealname' ) ) {
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
	 * (https://www.mediawiki.org/wiki/Manual:Hooks/SpecialListusersQueryInfo)
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

	public static function onSpecialListusersQueryInfo( UsersPager $pager,
		array &$query ) {

		global $wgShowRealUsernamesFields;

		// Add extra fields, avoiding duplication.
		$query['fields'] += array_combine(
			$wgShowRealUsernamesFields, $wgShowRealUsernamesFields );

		$query['options']['GROUP BY'] = array_merge(
			(array)$query['options']['GROUP BY'],
			array_diff(
				$wgShowRealUsernamesFields,
				(array)$query['options']['GROUP BY'] ) );

		return true;
	}
}
