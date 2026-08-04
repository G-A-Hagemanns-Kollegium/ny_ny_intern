<?php
/**
 * Cologne Blue: A nicer-looking alternative to Standard.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
 * http://www.gnu.org/copyleft/gpl.html
 *
 * @file
 */

/**
 * @ingroup Skins
 */
class CologneBlueTemplate extends BaseTemplate {

	/**
	 * Run the skin and build html
	 */
	public function execute() {
		// Suppress warnings to prevent notices about missing indexes in $this->data
		Wikimedia\suppressWarnings();
		$this->html( 'headelement' );
		echo $this->beforeContent();
		$this->html( 'bodytext' );
		echo "\n";
		echo $this->afterContent();
		$this->html( 'dataAfterContent' );
		$this->printTrail();
		echo "\n</body></html>";
		Wikimedia\restoreWarnings();
	}

	/**
	 * Language/charset variant links for classic-style skins
	 * @return string
	 */
	private function variantLinks() {
		$s = [];

		$variants = $this->data['content_navigation']['variants'];

		foreach ( $variants as $key => $link ) {
			$s[] = $this->makeListItem( $key, $link, [ 'tag' => 'span' ] );
		}

		return $this->getSkin()->getLanguage()->pipeList( $s );
	}

	/**
	 * Generate interwiki language links
	 *
	 * @return string
	 */
	private function otherLanguages() {
		$html = '';

		// We override SkinTemplate->formatLanguageName() in SkinCologneBlue
		// not to capitalize the language names.
		// We check getAfterPortlet to make sure the language box is shown
		// when languages are empty but something has been injected in the portal. (T252841)
		$languages = $this->data['sidebar']['LANGUAGES'];
		$afterPortlet = $this->getAfterPortlet( 'lang' );
		if ( $languages !== [] || $afterPortlet !== '' ) {
			$s = [];
			foreach ( $languages as $key => $data ) {
				$s[] = $this->makeListItem( $key, $data, [ 'tag' => 'span' ] );
			}

			$html = $this->getMsg( 'otherlanguages' )->escaped()
				. $this->getMsg( 'colon-separator' )->escaped()
				. $this->getSkin()->getLanguage()->pipeList( $s );
			$html .= $afterPortlet;
		}

		return $html;
	}

	/**
	 * @param string $name
	 * @return string
	 */
	protected function getAfterPortlet( $name ) {
		$content = $this->getSkin()->getAfterPortlet( $name );

		return $content !== '' ? "<div class='after-portlet after-portlet-$name'>$content</div>" : '';
	}

	/**
	 * @return string
	 */
	private function pageTitleLinks() {
		$s = [];
		$footlinks = $this->getFooterLinks();

		foreach ( $footlinks['places'] as $item ) {
			$s[] = $this->data[$item];
		}

		return $this->getSkin()->getLanguage()->pipeList( $s );
	}

	/**
	 * Used in bottomLinks() to eliminate repetitive code.
	 *
	 * @param string $key Key to be passed to makeListItem()
	 * @param array $navlink Navlink suitable for processNavlinkForDocument()
	 * @param string|null $message Key of the message to use in place of standard text
	 *
	 * @return string|null
	 */
	private function processBottomLink( $key, $navlink, $message = null ) {
		if ( !$navlink ) {
			// Empty navlinks might be passed.
			return null;
		}

		if ( $message ) {
			$navlink['text'] = $this->getMsg( $message )->escaped();
		}

		return $this->makeListItem(
			$key,
			$this->processNavlinkForDocument( $navlink ),
			[ 'tag' => 'span' ]
		);
	}

	/**
	 * @return string
	 */
	private function bottomLinks() {
		$lines = [];

		if ( $this->getSkin()->getOutput()->isArticleRelated() ) {
			$toolbox = $this->data['sidebar']['TOOLBOX'];
			$content_nav = $this->data['content_navigation'];

			// First row. Regular actions.
			$element = [];

			$editLinkMessage = $this->getSkin()->getTitle()->exists() ? 'editthispage' : 'create-this-page';

			$keys = [
				'edit' => [ 'views', $editLinkMessage ],
				'viewsource' => [ 'views', 'viewsource' ],
				'watch' => [ 'actions', 'watchthispage' ],
				'unwatch' => [ 'actions', 'unwatchthispage' ],
				'history' => [ 'views', 'history' ]
			];

			foreach ( $keys as $key => $value ) {
				$element[] = $this->processBottomLink(
					$key,
					$content_nav[ $value[0] ][$key],
					$value[1]
				);
			}

			// Insert talk page link.
			// This needs to be in-between the fourth and fifth elements above
			array_splice( $element, -1, 0, $this->talkLink() );

			$keys = [ 'info', 'whatlinkshere', 'recentchangeslinked', 'contributions' ];

			if ( isset( $toolbox['emailuser'] ) ) {
				$keys[] = 'emailuser';
			}

			foreach ( $keys as $key ) {
				$element[] = $this->processBottomLink(
					$key,
					$toolbox[$key]
				);
			}

			$lines[] = $this->getSkin()->getLanguage()->pipeList( array_filter( $element ) );

			// Second row. Privileged actions.
			$element = [];

			$keys = [ 'delete', 'undelete', 'protect', 'unprotect', 'move' ];

			foreach ( $keys as $key ) {
				if ( isset( $content_nav['actions'][$key] ) ) {
					$element[] = $this->processBottomLink(
						$key,
						$content_nav['actions'][$key],
						$key . 'thispage'
					);
				}
			}

			$lines[] = $this->getSkin()->getLanguage()->pipeList( array_filter( $element ) );

			// Third row. Language links.
			$lines[] = $this->otherLanguages();
		}

		return implode( "<br />\n", array_filter( $lines ) ) . "<br />\n";
	}

	/**
	 * @return string
	 */
	private function talkLink() {
		$title = $this->getSkin()->getTitle();

		if ( !$title->canHaveTalkPage() ) {
			// No discussion link if talk page cannot exist
			return "";
		}

		$companionTitle = $title->isTalkPage() ? $title->getSubjectPage() : $title->getTalkPage();
		$companionNamespace = $companionTitle->getNamespace();

		// TODO these messages are only be used by CologneBlue,
		// kill and replace with something more sensibly named?
		$nsToMessage = [
			NS_MAIN => 'articlepage',
			NS_USER => 'userpage',
			NS_PROJECT => 'projectpage',
			NS_FILE => 'imagepage',
			NS_MEDIAWIKI => 'mediawikipage',
			NS_TEMPLATE => 'templatepage',
			NS_HELP => 'viewhelppage',
			NS_CATEGORY => 'categorypage',
			NS_FILE => 'imagepage',
		];

		// Find out the message to use for link text. Use either the array above or,
		// for non-talk pages, a generic "discuss this" message.
		// Default is the same as for main namespace.
		if ( isset( $nsToMessage[$companionNamespace] ) ) {
			$message = $nsToMessage[$companionNamespace];
		} else {
			$message = $companionTitle->isTalkPage() ? 'talkpage' : 'articlepage';
		}

		// Obviously this can't be reasonable and just return the key for talk
		// namespace, only for content ones. Thus we have to mangle it in
		// exactly the same way SkinTemplate does. (bug 40805)
		$key = $companionTitle->getNamespaceKey( '' );
		if ( $companionTitle->isTalkPage() ) {
			$key = ( $key == 'main' ? 'talk' : $key . "_talk" );
		}

		// Use the regular navigational link, but replace its text. Everything else stays unmodified.
		$namespacesLinks = $this->data['content_navigation']['namespaces'];

		return $this->processBottomLink( $message, $namespacesLinks[$key], $message );
	}

	/**
	 * Takes a navigational link generated by SkinTemplate in whichever way
	 * and mangles attributes unsuitable for repeated use. In particular, this
	 * modifies the ids and removes the accesskeys. This is necessary to be
	 * able to use the same navlink twice, e.g. in sidebar and in footer.
	 *
	 * @param array $navlink Navigational link generated by SkinTemplate
	 * @param mixed $idPrefix Prefix to add to id of this navlink. If false, id
	 *   is removed entirely. Default is 'cb-'.
	 * @return array
	 */
	private function processNavlinkForDocument( $navlink, $idPrefix = 'cb-' ) {
		if ( $navlink['id'] ) {
			$navlink['single-id'] = $navlink['id']; // to allow for tooltip generation
			$navlink['tooltiponly'] = true; // but no accesskeys

			// mangle or remove the id
			if ( $idPrefix === false ) {
				unset( $navlink['id'] );
			} else {
				$navlink['id'] = $idPrefix . $navlink['id'];
			}
		}

		return $navlink;
	}

	/**
	 * @return string
	 */
	private function beforeContent() {
		ob_start();
		?>
		<div id="content">
		<div id="topbar">
			<p id="sitetitle" role="banner">
				<a href="<?php echo htmlspecialchars( $this->data['nav_urls']['mainpage']['href'] ) ?>">
					<?php echo $this->getMsg( 'sitetitle' )->escaped() ?>
				</a>
			</p>

			<p id="sitesub"><?php echo $this->getMsg( 'sitesubtitle' )->escaped() ?></p>

			<div id="linkcollection" role="navigation">

				<div id="langlinks"><?php echo str_replace( '<br />', '', $this->otherLanguages() ) ?></div>
				<?php echo $this->getSkin()->getCategories() ?>
				<div id="titlelinks"><?php echo $this->pageTitleLinks() ?></div>
				<?php
				if ( $this->data['newtalk'] ) {
					?>
					<div class="usermessage"><strong><?php echo $this->data['newtalk'] ?></strong></div>
				<?php
				}
				?>
			</div>
		</div>
		<div id="article" class="mw-body" role="main">
		<?php
		if ( $this->getSkin()->getSiteNotice() ) {
			?>
			<div id="siteNotice"><?php echo $this->getSkin()->getSiteNotice() ?></div>
		<?php
		}
		?>
		<?php echo $this->getIndicators(); ?>
		<h1 id="firstHeading" lang="<?php
		$this->data['pageLanguage'] = $this->getSkin()->getTitle()->getPageViewLanguage()->getHtmlCode();
		$this->text( 'pageLanguage' );
		?>"><?php echo $this->data['title'] ?></h1>
		<?php
		if ( $this->getMsg( 'tagline' )->text() ) {
			?>
			<p class="tagline"><?php
				echo htmlspecialchars( $this->getMsg( 'tagline' )->text() )
				?></p>
		<?php
		}
		?>
		<?php
		if ( $this->getSkin()->getOutput()->getSubtitle() ) {
			?>
			<p class="subtitle"><?php echo $this->getSkin()->getOutput()->getSubtitle() ?></p>
		<?php
		}
		?>
		<?php
		if ( $this->getSkin()->subPageSubtitle() ) {
			?>
			<p class="subpages"><?php echo $this->getSkin()->subPageSubtitle() ?></p>
		<?php
		}
		?>
		<?php
		$s = ob_get_contents();
		ob_end_clean();

		return $s;
	}

	/**
	 * @return string
	 */
	private function afterContent() {
		ob_start();
		?>
		</div>
		<div id="footer">
			<div id="footer-navigation" role="navigation">
				<?php
				// Page-related links
				echo $this->bottomLinks();
				echo "\n<br />";

				// Footer and second searchbox
				echo $this->getSkin()->getLanguage()->pipeList( [
					$this->getSkin()->mainPageLink(),
					$this->getSkin()->aboutLink(),
					$this->searchForm( 'footer' )
				] );
				?>
			</div>
			<div id="footer-info" role="contentinfo">
				<?php
				// Standard footer info
				$footlinks = $this->getFooterLinks();
				if ( $footlinks['info'] ) {
					foreach ( $footlinks['info'] as $item ) {
						echo $this->data[$item] . ' ';
					}
				}
				?>
			</div>
		</div>
		</div>
		<div id="mw-navigation">
			<h2><?php echo $this->getMsg( 'navigation-heading' )->escaped() ?></h2>

			<div id="toplinks" role="navigation">
				<p id="syslinks"><?php echo $this->sysLinks() ?></p>

				<p id="variantlinks"><?php echo $this->variantLinks() ?></p>
			</div>
			<?php echo $this->quickBar() ?>
		</div>
		<?php
		$s = ob_get_contents();
		ob_end_clean();

		return $s;
	}

	/**
	 * @return string
	 */
	private function sysLinks() {
		$s = [
			$this->getSkin()->mainPageLink(),
			Linker::linkKnown(
				Title::newFromText( $this->getMsg( 'aboutpage' )->inContentLanguage()->text() ),
				$this->getMsg( 'about' )->escaped()
			),
			Linker::makeExternalLink(
				Skin::makeInternalOrExternalUrl( $this->getMsg( 'helppage' )->inContentLanguage()->text() ),
				$this->getMsg( 'help' )->text()
			),
			Linker::linkKnown(
				Title::newFromText( $this->getMsg( 'faqpage' )->inContentLanguage()->text() ),
				$this->getMsg( 'faq' )->escaped()
			),
		];

		$personalUrls = $this->getPersonalTools();
		foreach ( [ 'logout', 'createaccount', 'login' ] as $key ) {
			if ( isset( $personalUrls[$key] ) ) {
				$s[] = $this->makeListItem( $key, $personalUrls[$key], [ 'tag' => 'span' ] );
			}
		}

		return $this->getSkin()->getLanguage()->pipeList( $s );
	}

	/**
	 * Adds CologneBlue-specific items to the sidebar: qbedit, qbpageoptions and qbmyoptions menus.
	 *
	 * @param array $bar Sidebar data
	 * @return array Modified sidebar data
	 * @suppress PhanTypeMismatchDimAssignment,PhanTypeInvalidDimOffset Complex array
	 */
	private function sidebarAdditions( $bar ) {
		// "This page" and "Edit" menus
		// We need to do some massaging here... we reuse all of the items,
		// except for $...['views']['view'], as $...['namespaces']['main'] and
		// $...['namespaces']['talk'] together serve the same purpose. We also
		// don't use $...['variants'], these are displayed in the top menu.
		$content_navigation = $this->data['content_navigation'];
		$qbpageoptions = array_merge(
			$content_navigation['namespaces'],
			[
				'history' => $content_navigation['views']['history'],
				'watch' => $content_navigation['actions']['watch'],
				'unwatch' => $content_navigation['actions']['unwatch'],
			]
		);
		$content_navigation['actions']['watch'] = null;
		$content_navigation['actions']['unwatch'] = null;
		$qbEditLinks = [ 'edit' => $content_navigation['views']['edit'] ];
		if ( isset( $content_navigation['views']['addsection'] ) ) {
			$qbEditLinks['addsection'] = $content_navigation['views']['addsection'];
		}
		$qbedit = array_merge(
			$qbEditLinks,
			$content_navigation['actions']
		);

		// Personal tools ("My pages")
		$qbmyoptions = $this->getPersonalTools();
		foreach ( [ 'logout', 'createaccount', 'login' ] as $key ) {
			$qbmyoptions[$key] = null;
		}

		// Use the closest reasonable name
		$bar['cactions'] = $qbedit;
		$bar['pageoptions'] = $qbpageoptions; // this is a non-standard portlet name, but nothing fits
		$bar['personal'] = $qbmyoptions;

		return $bar;
	}

	/**
	 * Compute the sidebar
	 * @private
	 * @suppress SecurityCheck-DoubleEscaped phan-taint-check can't distinguish
	 *  between different array keys/values that have different taints.
	 * @return-taint onlysafefor_html
	 *
	 * @return string
	 */
	private function quickBar() {
		// Massage the sidebar. We want to:
		// * place SEARCH at the beginning
		// * add new portlets before TOOLBOX (or at the end, if it's missing)
		// * remove LANGUAGES (langlinks are displayed elsewhere)
		$orig_bar = $this->data['sidebar'];
		$bar = [];
		$hasToolbox = false;

		// Always display search first
		$bar['SEARCH'] = true;
		// Copy everything except for langlinks, inserting new items before toolbox
		foreach ( $orig_bar as $heading => $data ) {
			if ( $heading == 'TOOLBOX' ) {
				// Insert the stuff
				$bar = $this->sidebarAdditions( $bar );
				$hasToolbox = true;
			}

			if ( $heading != 'LANGUAGES' ) {
				$bar[$heading] = $data;
			}
		}
		// If toolbox is missing, add our items at the end
		if ( !$hasToolbox ) {
			$bar = $this->sidebarAdditions( $bar );
		}

		// Fill out special sidebar items with content
		$orig_bar = $bar;
		$bar = [];
		foreach ( $orig_bar as $heading => $data ) {
			if ( $heading == 'SEARCH' ) {
				$bar['search'] = $this->searchForm( 'sidebar' );
			} elseif ( $heading == 'TOOLBOX' ) {
				$bar['tb'] = $data;
			} else {
				$bar[$heading] = $data;
			}
		}

		// Output the sidebar
		// CologneBlue uses custom messages for some portlets, but we should keep the ids for consistency
		$idToMessage = [
			'search' => 'qbfind',
			'navigation' => 'qbbrowse',
			'tb' => 'toolbox',
			'cactions' => 'qbedit',
			'personal' => 'qbmyoptions',
			'pageoptions' => 'qbpageoptions',
		];

		$s = "<div id='quickbar'>\n";

		foreach ( $bar as $heading => $data ) {
			// Numeric strings gets an integer when set as key, cast back - T73639
			$heading = (string)$heading;

			$portletId = Sanitizer::escapeIdForAttribute( "p-$heading" );
			$headingMsg = $this->getMsg( $idToMessage[$heading] ?: $heading );
			if ( $headingMsg->exists() ) {
				$headingHTML = $headingMsg->escaped();
			} else {
				$headingHTML = htmlspecialchars( $heading );
			}
			$headingHTML = "<h3>{$headingHTML}</h3>";
			$listHTML = "";

			if ( is_array( $data ) ) {
				// $data is an array of links
				foreach ( $data as $key => $link ) {
					// Can be empty due to how the sidebar additions are done
					if ( $link ) {
						$listHTML .= $this->makeListItem( $key, $link );
					}
				}
				if ( $listHTML ) {
					$listHTML = "<ul>$listHTML</ul>";
				}
			} else {
				// $data is a HTML <ul>-list string
				$listHTML = $data;
			}

			if ( $listHTML ) {
				$role = ( $heading == 'search' ) ? 'search' : 'navigation';
				$s .= Html::rawElement( 'div', [
					'class' => 'portlet',
					'id' => $portletId,
					'role' => $role,
				], "$headingHTML\n$listHTML" );
			}

			$s .= $this->getAfterPortlet( $heading );
		}

		$s .= "</div>\n";

		return $s;
	}

	/**
	 * @param string $which
	 * @return string
	 */
	private function searchForm( $which ) {
		$search = $this->getSkin()->getRequest()->getText( 'search' );
		$action = htmlspecialchars( $this->data['searchaction'] );
		$s = "<form id=\"searchform-" . htmlspecialchars( $which )
			. "\" method=\"get\" class=\"inline\" action=\"$action\">";
		if ( $which == 'footer' ) {
			$s .= $this->getMsg( 'qbfind' )->escaped() . ": ";
		}

		$s .= $this->makeSearchInput( [
			'class' => 'mw-searchInput',
			'type' => 'text',
			'size' => '14'
		] );
		$s .= ( $which == 'footer' ? " " : "<br />" );
		$s .= $this->makeSearchButton( 'go', [ 'class' => 'searchButton' ] );

		if ( $this->config->get( 'UseTwoButtonsSearchForm' ) ) {
			$s .= $this->makeSearchButton( 'fulltext', [ 'class' => 'searchButton' ] );
		} else {
			$s .= '<div><a href="' . $action . '" rel="search">'
				. $this->getMsg( 'powersearch-legend' )->escaped() . "</a></div>\n";
		}

		$s .= '</form>';

		return $s;
	}
}
