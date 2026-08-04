<?php

namespace MediaWiki\Extension\Realnames;

/*
	Copyright 2011-2019 Finlay Beaton. All rights reserved.

	Redistribution and use in source and binary forms, with or without modification, are
	permitted provided that the following conditions are met:

		1. Redistributions of source code must retain the above copyright notice, this list of
			conditions and the following disclaimer.

		2. Redistributions in binary form must reproduce the above copyright notice, this list
			of conditions and the following disclaimer in the documentation and/or other materials
			provided with the distribution.

	THIS SOFTWARE IS PROVIDED BY Finlay Beaton ''AS IS'' AND ANY EXPRESS OR IMPLIED
	WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
	FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL Finlay Beaton OR
	CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
	CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
	SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
	ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
	NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
	ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

use MediaWiki\MediaWikiServices;
use OutputPage;
use Skin;
use Title;
use User;

/**
 * >= 0.1
 */
class Realnames {

	/**
	 * A cache of realnames for given users.
	 *
	 * @var \array
	 * @since 2011-09-16, 0.1
	 */
	protected static $realnames = [];

	/**
	 * namespace regex option string.
	 *
	 * @var string|null
	 * @since 2011-09-16, 0.2
	 */
	protected static $namespacePrefixes = null;

	/**
	 * namespace regex option string urlencoded.
	 *
	 * @var string|null
	 * @since 2019-03-10, 0.6
	 */
	protected static $namespacePrefixesEncoded = null;

	/**
	 * checks a data set to see if we should proceed with the replacement.
	 *
	 * @param \array $matches keyed with regex matches
	 *
	 * @return \string text to replace the match with
	 *
	 * @since 2011-09-16, 0.1
	 * @see   lookForBare() for regex
	 */
	protected static function checkBare( $matches ) {
		// matches come from self::lookForBare()'s regular expression
		$m = [
			'all' => $matches[0],
			'username' => $matches[1],
		];

		self::debug( __METHOD__, print_r( $m, true ) );

		// we do not currently do any checks on Bare replacements, a User: find is
		// always valid but we could add one in the future, and the debug
		// information is still convenient and keeps things consistent with checkLink
		return self::replace( $m );
	}

	/**
	 * checks a data set to see if we should proceed with the replacement.
	 *
	 * @param \array $matches keyed with regex matches
	 *
	 * @return \string text to replace the match with
	 *
	 * @since 2011-09-16, 0.1
	 * @see   lookForBare() for regex
	 */
	protected static function checkLink( $matches ) {
		// matches come from self::lookForLinks()'s regular expression
		$m = [
			'all' => $matches[0],
			'linkstart' => $matches[1],
			'linkuser' => $matches[2],
			'username' => $matches[3],
			'linkend' => $matches[4],
		];

		self::debug( __METHOD__, print_r( $m, true ) );

		// some links point to user pages but do not display the username,
		// we can safely ignore those
		// we need to urldecode the link for accents and special characters,
		// and ensure our username has underscores instead of spaces to match our link
		// before being able to do the comparison.
		if ( urldecode( $m['linkuser'] ) !== str_replace( ' ', '_', $m['username'] ) ) {
			return $m['all'];
		}

		return self::replace( $m );
	}

	/**
	 * Outputs to the debug channel.
	 *
	 * @param string $method method name, usually __METHOD__
	 * @param string $text text to log
	 *
	 * @return void
	 *
	 * @since 2019-01-24, 0.3.2
	 */
	protected static function debug( $method, $text ) {
		wfDebugLog( 'realnames', $method . ': ' . $text );
	}

	/**
	 * formats the final string in the configured style to display the real name.
	 *
	 * @param \array $m keyed with strings called
	 *    \li<em>linkstart</em>
	 *    \li<em>username</em>
	 *    \li<em>realname</em>
	 *    \li<em>linkend</em>
	 *
	 * @return \string formatted text to replace the match with
	 *
	 * @since 2011-09-16, 0.1
	 * @see   $wgRealnamesLinkStyle
	 * @see   $wgRealnamesBareStyle
	 * @see   $wgRealnamesStyles
	 * @see   $wgRealnamesBlank
	 */
	protected static function display( $m ) {
		// what kind of formatting will we do?
		$style = $GLOBALS['wgRealnamesLinkStyle'];
		$styleBlankName = $GLOBALS['wgRealnamesLinkStyleBlankName'];
		$styleSameName = $GLOBALS['wgRealnamesLinkStyleSameName'];
		if ( empty( $m['linkstart'] ) === true ) {
			if ( $GLOBALS['wgRealnamesBareStyle'] !== false ) {
				$style = $GLOBALS['wgRealnamesBareStyle'];
			}
			if ( $GLOBALS['wgRealnamesBareStyleBlankName'] !== false ) {
				$styleBlankName = $GLOBALS['wgRealnamesBareStyleBlankName'];
			}
			if ( $GLOBALS['wgRealnamesBareStyleSameName'] !== false ) {
				$styleSameName = $GLOBALS['wgRealnamesBareStyleSameName'];
			}
			$m['linkstart'] = '';
			$m['linkend'] = '';
		}

		if ( empty( $style ) === true ) {
			// error
			self::debug( __METHOD__, 'error, blank style configuration' );
			return $m['all'];
		}

		// get the formatting code
		$format = $GLOBALS['wgRealnamesStyles'][$style];

		if ( empty( $style ) === true ) {
			// error
			self::debug( __METHOD__, 'error, blank format configuration' );
			return $m['all'];
		}

		// we have a blank realname, and the admin doesn't want to see them,
		// or his chosen format will not display a username at all
		if ( empty( $m['realname'] ) === true && (
			$GLOBALS['wgRealnamesBlank'] === false || strpos( $format, '$2' ) === false
		) ) {
			$format = $GLOBALS['wgRealnamesStyles'][$styleBlankName];
		}

		if ( $GLOBALS['wgRealnamesSmart'] !== false
			&& $GLOBALS['wgRealnamesSmart']['same'] === true
			&& $m['username'] === $m['realname']
			&& strpos( $format, '$2' ) !== false
			&& strpos( $format, '$3' ) !== false
		) {
			// we only do this if both username and realname will be displayed in
			// the user's format
			self::debug( __METHOD__, 'smart dupe detected' );

			// we're going to display: John - John
			// this is silly. The smart thing to do
			// is infact nothing (in the name)
			$format = $GLOBALS['wgRealnamesStyles'][$styleSameName];
		}

		// plug in our values to the format desired
		// redo to ensure order
		$text = wfMsgReplaceArgs( $format, [
			$m['linkstart'],
			str_replace( '_', ' ', $m['username'] ),
			str_replace( '_', ' ', $m['realname'] ),
			$m['linkend'],
		] );

		self::debug( __METHOD__, 'replacing with ' . print_r( $text, true ) );

		return $text;
	}

	/**
	 * gather list of namespace prefixes in the wiki's language.
	 * this is a regex string.
	 *
	 * @param bool $encode
	 * @return \string regex namespace options
	 *
	 * @since 2011-09-22, 0.2
	 */
	public static function getNamespacePrefixes( $encode = false ) {
		if ( $encode === true ) {
			$prefixes = self::$namespacePrefixesEncoded;
		} else {
			$prefixes = self::$namespacePrefixes;
		}

		// if we already figured it all out, just use that again
		if ( $prefixes !== null ) {
			return $prefixes;
		}

		// always catch this one
		$namespaces = [
			'User',
			'User_talk',
			'User talk',
		];

		// add in user specified ones
		$namespaces = array_merge( $namespaces, array_values( $GLOBALS['wgRealnamesNamespaces'] ) );

		// try to figure out the wiki language
		// ! get language from the context somehow? (2011-09-26, ofb)
		// Eric Richter, 20210626, $GLOBALS['wgContLang'] is no longer available
		// This solution is copied from the ReplaceText extension
		$lang = MediaWikiServices::getInstance()->getContentLanguage();

		// user namespace's primary name in the wiki lang
		$namespaces[] = $lang->getNsText( NS_USER );
		$namespaces[] = $lang->getNsText( NS_USER_TALK );

		// namespace aliases and gendered namespaces (1.18+) in the wiki's lang
		// fallback for pre 1.16
		if ( method_exists( $lang, 'getNamespaceAliases' ) === true ) {
			$nss = $lang->getNamespaceAliases();
		} else {
			$nss = $GLOBALS['wgNamespaceAliases'];
		}

		foreach ( $nss as $name => $space ) {
			if ( in_array( $space, [ NS_USER, NS_USER_TALK ] ) === true ) {
				$namespaces[] = $name;
			}
		}

		// clean up
		$namespaces = array_unique( $namespaces );

		if ( $encode === true ) {
			$namespaces = array_map( 'urlencode', $namespaces );
		}

		// Escape namespaces for use in regex delimited with '/'.
		// Shouldn't do much for most namespaces.
		$namespaces = array_map(
			static function ( $namespace ) {
				return preg_quote( $namespace, '/' );
			},
			$namespaces
		);

		$prefixes = '(?:(?:' . implode( '|', $namespaces ) . '):)';

		self::debug( __METHOD__, 'namespace prefixes: ' . $prefixes );

		if ( $encode === true ) {
			self::$namespacePrefixesEncoded = $prefixes;
		} else {
			self::$namespacePrefixes = $prefixes;
		}

		return $prefixes;
	}

	/**
	 * >= 0.1, change all usernames to realnames.
	 *
	 * @param OutputPage &$out The OutputPage object.
	 * @param Skin &$skin object that will be used to generate the page, added in 1.13.
	 *
	 * @return \bool true, continue hook processing
	 *
	 * @since 2011-09-16, 0.1
	 * @note  OutputPageBeforeHTML does not work for Special pages like RecentChanges or ActiveUsers
	 * @note  requires MediaWiki 1.7.0
	 * @see   hook documentation http://www.mediawiki.org/wiki/Manual:Hooks/BeforePageDisplay
	 */
	public static function hookBeforePageDisplay( &$out, &$skin = false ) {
		// pre 1.16 no getTitle()
		if ( method_exists( $out, 'getTitle' ) === true ) {
			$title = $out->getTitle();
		} else {
			$title = $GLOBALS['wgTitle'];
		}

		if ( $GLOBALS['wgRealnamesReplacements']['title'] === true ) {
			// article title
			self::debug( __METHOD__, 'searching article title...' );

			// special user page handling
			// User:
			if ( in_array( $title->getNamespace(), [ NS_USER, NS_USER_TALK ] ) === true ) {
				// swap out the specific username from title
				// this overcomes the problem lookForBare has with spaces and underscores in names
				$reg = '/'
					. self::getNamespacePrefixes()
					. '\s*('
					. preg_quote( $title->getText(), '/' )
					. ')(?:\/.+)?/';
				$bare = self::lookForBare(
					$out->getPageTitle(),
					$reg
				);
				$out->setPagetitle( $bare );
			}

			// this should also affect the html head title
			$out->setPageTitle( self::lookForBare( $out->getPageTitle() ) );
		}

		if ( $GLOBALS['wgRealnamesReplacements']['subtitle'] === true ) {
			// subtitle (say, on revision pages)
			self::debug( __METHOD__, 'searching article subtitle...' );
			$out->setSubtitle( self::lookForLinks( $out->getSubtitle() ) );
		}

		if ( $GLOBALS['wgRealnamesReplacements']['body'] === true ) {
			// article html text
			self::debug( __METHOD__, 'searching article body...' );
			$out->mBodytext = self::lookForLinks( $out->getHTML() );
		}

		return true;
	}

	/**
	 * >= 0.2, change all usernames to realnames in url bar.
	 * change all usernames to realnames in skin top right links bar
	 *
	 * @param \array &$personal_urls the array of URLs set up so far
	 * @param Title $title the Title object of the current article
	 * @param \SkinTemplate $skin
	 *
	 * @return \bool true, continue hook processing
	 *
	 * @since 2011-09-22, 0.2
	 * @see   hook documentation http://www.mediawiki.org/wiki/Manual:Hooks/PersonalUrls
	 * @note  does nothing for Timeless skin
	 */
	public static function hookPersonalUrls( &$personal_urls, $title, $skin ) {
		if ( $GLOBALS['wgRealnamesReplacements']['personnal'] === true ) {
			self::debug( __METHOD__, 'searching personnal urls...' );

			// replace the name of the logged in user
			if ( isset( $personal_urls['userpage'] ) === true
				&& isset( $personal_urls['userpage']['text'] ) === true ) {
				// fake the match, we know it's there
				$m = [
					'all' => $personal_urls['userpage']['text'],
					'username' => $personal_urls['userpage']['text'],
					'realname' => $skin->getUser()->getRealname(),
				];
				$personal_urls['userpage']['text'] = self::replace( $m );
			}
		}

		return true;
	}

	/**
	 * scan and replace plain usernames of the form User:username into real names.
	 *
	 * @param \string $text to scan
	 * @param \string $pattern to match, \bool false for default
	 *
	 * @return \string with realnames replaced in
	 *
	 * @since 2011-09-16, 0.1
	 * @note  bug: we have problems with users with underscores (they become spaces) or spaces,
	 *    we tend to just strip the User: and leave the username, but we only modify the
	 *    first word so some weird style might screw it up (2011-09-17, ofb)
	 */
	protected static function lookForBare( $text, $pattern = false ) {
		if ( empty( $pattern ) === true ) {
			// considered doing [^<]+ here to catch names with spaces or underscores,
			// which works for most titles but is not universal
			$pattern = '/' . self::getNamespacePrefixes() . '([^ \t]+)(\/.+)?/';
		}

		self::debug( __METHOD__, 'pattern: ' . $pattern );
		// create_function is slow
		$ret = preg_replace_callback(
			$pattern,
			[
				__CLASS__,
				'checkBare',
			],
			$text
		);

		return $ret;
	}

	/**
	 * scan and replace username links into realname links.
	 *
	 * @param \string $text to scan
	 * @param \string $pattern to match, \bool false for default
	 *
	 * @return \string with realnames replaced in
	 *
	 * @since 2011-09-16, 0.1
	 */
	protected static function lookForLinks( $text, $pattern = false ) {
		self::debug( __METHOD__, 'before: ' . self::getNamespacePrefixes( false ) );
		self::debug( __METHOD__, 'after: ' . self::getNamespacePrefixes( true ) );
		if ( empty( $pattern ) === true ) {
			$pattern = '/(<a\b[^">]+href="[^">]+'
				. self::getNamespacePrefixes( true )
				. '([^"\\?\\&>]+)[^>]+>(?:<bdi>)?)'
				. self::getNamespacePrefixes()
				. '?([^>]+)((?:<\\/bdi>)?<\\/a>)/';
		}

		// create_function is slow
		$preg = preg_replace_callback(
			$pattern,
			[
				__CLASS__,
				'checkLink',
			],
			$text
		);
		return $preg;
	}

	/**
	 * obtains user information based on a match for future replacement.
	 *
	 * @param \array $m keyed with strings called
	 *    \li<em>linkstart</em> (optional)
	 *    \li<em>username</em>
	 *    \li<em>realname</em> (optional)
	 *    \li<em>linkend</em> (optional)
	 *
	 * @return \string formatted text to replace the match with
	 *
	 * @since 2011-09-16, 0.1
	 */
	protected static function replace( $m ) {
		$debug_msg = 'matched '
			. ( ( isset( $m['username'] ) === true ) ? $m['username'] : print_r( $m, true ) );
		self::debug( __METHOD__, $debug_msg );

		if ( isset( self::$realnames[$m['username']] ) === false ) {
			// we don't have it cached
			$realname = null;

			if ( isset( $m['realname'] ) === true ) {
				// we got it elsewhere
				$realname = $m['realname'];
			} else {
				// time to do a lookup
				$user = User::newFromName( $m['username'] );

				if ( is_object( $user ) === false ) {
					self::debug( __METHOD__, 'skipped, invalid user: ' . $m['username'] );
					return $m['all'];
				}

				$realname = $user->getRealname();
			}

			self::$realnames[$m['username']] = htmlspecialchars( trim( $realname ) );
		}

		// this may be blank
		$m['realname'] = self::$realnames[$m['username']];

		return self::display( $m );
	}
}
