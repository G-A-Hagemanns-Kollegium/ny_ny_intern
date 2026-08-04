<?php
 
// PageHistoryRealnames MediaWiki extension.
// Adds real names to history list.
 
// Copyright (C) 2009 - John Erling Blad.
//
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 2 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 
# Not a valid entry point, skip unless MEDIAWIKI is defined
if( !defined( 'MEDIAWIKI' ) ) {
	echo "PageHistoryRealnames: This is an extension to the MediaWiki package and cannot be run standalone.\n";
	die( -1 );
}
 
#----------------------------------------------------------------------------
#    Extension initialization
#----------------------------------------------------------------------------
 
$wgPageHistoryRealnamesVersion = '0.3';
$wgExtensionCredits['parserhook'][] = array(
	'name'=>'PageHistoryRealnames',
	'version'=>$wgPageHistoryRealnamesVersion,
	'author'=>'John Erling Blad',
	'url'=>'http://www.mediawiki.org/wiki/Extension:PageHistoryRealnames',
	'description' => 'Adds real names to history list'
    );
 
$dir = dirname(__FILE__) . '/';
$wgExtensionFunctions[] = 'wfPageHistoryRealnamesSetup';
$wgHooks['PageHistoryPager::getQueryInfo'][] = 'wfPageHistoryRealnamesQuery';
$wgHooks['PageHistoryLineEnding'][] = 'wfPageHistoryRealnamesLineEnding';
$wgExtensionMessagesFiles['PageHistoryRealnames'] = $dir . 'PageHistoryRealnames.i18n.php';
 
# Setup the message catalog
function wfPageHistoryRealnamesSetup() {
	global $wgParser;
	#wfLoadExtensionMessages('PageHistoryRealnames');
	return true;
}
 
function wfPageHistoryRealnamesQuery( &$pager, &$query ) {
	$query['tables'] = array( 'r' => 'revision', 'u' => 'user');
	$query['join_conds']['u'] = array( 'LEFT JOIN', 'r.rev_user=u.user_id' );
	$query['fields'][] = 'u.user_real_name';
	return true;
}
 
# Change the row
function wfPageHistoryRealnamesLineEnding($hist, $row, &$s) {
	global $wgPageHistoryRealnamesInline;
	$realName = htmlspecialchars( trim( $row->user_real_name ) );
	if ( $realName == "" )
		return true;	# nothing to do
	$m = array();
	if(preg_match('/^(.*mw\-userlink[^>]*>)([^<]*)(<\/a\b[^>]*>)(.*)$/',$s,$m)) {
		if ($wgPageHistoryRealnamesInline)
			$s = $m[1] . wfMsg( 'phr-realname-inline', $realName ) . $m[3] . $m[4];
		else
			$s = $m[1] . $m[2] . $m[3] . wfMsg( 'phr-realname-append', $realName ) . $m[4];
	}
	return true;
}


?>