# Realnames

_Updated instructions and releases available at:_ https://www.mediawiki.org/wiki/Extension:Realnames

This mediawiki extension attempts to add _realname_ to all _username_ links.

Modifies a page's html content right before display to keep the approach generic and simple. This means it works for most links and does not need special consideration with new hooks. Compatibility with other extensions should be very strong.

This means it works on:
* Special:ListUsers
* Special:RecentChanges (new and old)
* Special:Search of the User: space
* History of page
* Revisions list of page
* Revision view of page
* Revision Compare
* Page header + html title (limited)
* and any page where user links are found

While the focus is on realname display, it can customized to change the display of username links to anything desired (add an image? another class?). This can be incredibly powerful.

It was developed mainly for Enterprise/Corporate users of MediaWiki where realnames are much more important, and often make much more sense than the usual algorithmically chosen usernames.

The default configuration prioritises realnames first with the username in parenthesis. Since usernames are still needed for wiki links, wiki actions, and realnames can sometimes collide; displaying both is recommended. This is optional, see the configuration options bellow.

There is currently no way to preserve User: prefixes on links or text.

## Updates

The extension is considered in a usable state and feature complete. Issues are mostly possible testing or performance enhancements.

This extension is used in corporate applications. As such, the authors are unlikely to update it on a regular basis, but instead when the corporate applications that use it run into problems. You should expect updates in the 5-10yr range.

Issues and PRs will be monitored, and we will continue to work with the community to provide updates as they are contributed.

## Download instructions
You can download the extension directly from github [releases](https://github.com/ofbeaton/mediawiki-realnames/releases).

Consult the [CHANGELOG](CHANGELOG) and [HISTORY](HISTORY) for release history.

## Installation
To install this extension, add the following to `LocalSettings.php`:
```php
wfLoadExtension( 'Realnames' );
#add optional configuration parameters here
```

or before mediawiki 1.25 instead do:
```php
include_once("$IP/extensions/Realnames/Realnames.php");
#add optional configuration parameters here
```

## Configuration parameters
See [AdvancedConfiguration.md](AdvancedConfiguration.md) for finer control, including custom styles.

### $wgRealnamesLinkStyle [>=0.1]
| Values          | Example                                    | Description                                                      |
|-----------------|--------------------------------------------|------------------------------------------------------------------|
| "standard"      | [mw305](User:mw305)                        | Provided for convenience, this is the default MediaWiki behavior |
| "replace"       | [Martha Stewart](User:mw305)               |                                                                  |
| "append"        | [mw305 \[Martha Stewart\]](User:mw305)     |                                                                  |
| "reverse"       | [Martha Stewart \[mw305\]](User:mw305)     |                                                                  |
| "dash"          | [mw305 &ndash; Martha Stewart](User:mw305) |                                                                  |
| "dash-reverse"  | [Martha Stewart &ndash; mw305](User:mw305) |                                                                  |
| "paren-append"  | [mw305 (Martha Stewart)](User:mw305)       |                                                                  |
| "paren-reverse" | [Martha Stewart (mw305)](User:mw305)       | Default extension behaviour                                      |

## Testing
* MediaWiki 1.32.0, 1.31.1 (LTS), 1.18.0, 1.17.1, 1.16.5, 1.15.5,

## See also
* [Extension:LDAP_Authentication](https://www.mediawiki.org/wiki/Extension:LDAP_Authentication) &mdash; popular import username/realnames from LDAP/AD
* [Extension:Windows_NTLM_LDAP_Auto_Auth](https://www.mediawiki.org/wiki/Extension:Windows_NTLM_LDAP_Auto_Auth) &mdash; import username/realnames from LDAP/AD

## Alternative extensions
* [Extension:ShowRealUsernames](https://www.mediawiki.org/wiki/Extension:ShowRealUsernames)
