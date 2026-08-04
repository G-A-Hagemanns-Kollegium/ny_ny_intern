Back to [README.md](README.md)...

## Control

### $wgRealnamesNamespaces [>=0.2]
Allows you to add more namespaces for it to search for. Use this only if the article name is the username in a given namespace. Do not include the :, and keep in mind this is a regular expression string, you can use regexp modifiers, but as well may need to escape some characters.

Value:

_array_

Example:

```php
$wgRealnamesNamespaces[] = 'CustomUserBasedNamespace';
```

### $wgRealnamesReplacements [>=0.1]
Allows you to turn off replacement in specific sections.

Value:

_array_

Example:

```php
$wgRealnamesReplacements['title'] = TRUE;
$wgRealnamesReplacements['subtitle'] = TRUE;
$wgRealnamesReplacements['personnal'] = TRUE;
$wgRealnamesReplacements['body'] = TRUE;
```

### $wgRealnamesSmart [>=0.3]
Allows you to turn off specific smart features

Value:

_array_

Example:

| Key                                 | Description                                        |
|-------------------------------------|----------------------------------------------------|
| `$wgRealnamesSmart['same'] = TRUE;` | same &mdash; does not replace if username=realname |

## Styles

### $wgRealnamesBareStyle [>=0.1]
| Values          | Example                      | Description                                                                  |
|-----------------|------------------------------|------------------------------------------------------------------------------|
| false           | N/A                          | Uses same style name as $wgRealnamesLinkStyle<br>Default extension behaviour |
| "standard"      | mw305                        | Provided for convenience, this is the standard MediaWiki behavior            |
| "replace"       | Martha Stewart               |                                                                              |
| "append"        | mw305 \[Martha Stewart\]     |                                                                              |
| "reverse"       | Martha Stewart \[mw305\]     |                                                                              |
| "dash"          | mw305 &ndash; Martha Stewart |                                                                              |
| "dash-reverse"  | Martha Stewart &ndash; mw305 |                                                                              |
| "paren-append"  | mw305 (Martha Stewart)       |                                                                              |
| "paren-reverse" | Martha Stewart (mw305)       |                                                                              |

### $wgRealnamesBlank [>=0.1]
Do you want to show blank real names? This can make sense for _append_ style but looks silly in _reverse_. The default _false_ which shows a _standard_ link instead.

Values:
* TRUE
* FALSE (default)

Output:
* mw305 []
* mw305

### $wgRealnamesLinkStyleBlankName [>0.6]
The style to use on links when realname is blank, as long as `$wgRealnamesBlank === FALSE`. Default is `standard`.

Same value options as described for `$wgRealnamesLinkStyle`.

### $wgRealnamesBareStyleBlankName [>0.6]
The style to use on text when username=realname, as long as `$wgRealnamesBlank === FALSE`. Default is `false`.

Same value options as described for `$wgRealnamesBareStyle`.

### $wgRealnamesLinkStyleSameName [>0.6]
The style to use on links when username=realname, as long as `$wgRealnamesSmart['same'] === TRUE`. Default is `standard`.

Same value options as described for `$wgRealnamesLinkStyle`.

### $wgRealnamesBareStyleSameName [>0.6]
The style to use on text when username=realname, as long as `$wgRealnamesSmart['same'] === TRUE`. Default is `false`.

Same value options as described for `$wgRealnamesBareStyle`.

### $wgRealnamesStyles [>=0.1]
Allows for the custom creation of style types that can then be assigned for ''link'' and ''bare'' styles. Usually to add custom text. You get 4 variables in your style:<br>
* `$1` link start<br>
* `$2`  username<br>
* `$3`  real name<br>
* `$4`  link end<br>
Ensure to use `'` quotes around your style string instead of `"` quotes, so that the `$x` do not get evaluated.

Value:

_array_

Example:

`$wgRealnamesStyles['mystyle'] = '&lt;span class="custom"&gt;$1$3$4&lt;/span&gt;';`

> Note: HTML does not work in Bare style.

Back to [README.md](README.md)...
