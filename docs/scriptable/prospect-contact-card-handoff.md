# Prospect Contact Card Scriptable Handoff

Use this when Prospect Mobile needs to hand off a contact card from iPhone without relying on Mac/Raycast contact-card paths.

## Preset iPhone Location

Put vetted `.vcf` files here:

```text
iCloud Drive/Scriptable/ProspectIDContactCards/
```

The script scans every `.vcf` in that folder. The file names do not need to match a hardcoded repo convention as long as the vCard `FN:` value or file name contains the scout name.

Cards visible in the current phone folder:

```text
Logan Lord
Jerami Singleton
Jeffrey Stein
James Holcomb
Luther Winfield III
Ryan Lietz
```

## Script

Install this Scriptable script on the phone:

```text
scripts/scriptable/share-prospect-contact-card.js
```

Suggested Scriptable script name:

```text
Share Prospect Contact Card
```

## Mobile URL Calls

Share a real `.vcf` file through the iOS share sheet:

```text
https://open.scriptable.app/run/Share%20Prospect%20Contact%20Card?scout=Ryan%20Lietz
```

Copy the raw vCard text to the clipboard:

```text
https://open.scriptable.app/run/Share%20Prospect%20Contact%20Card?scout=Ryan%20Lietz&mode=copyText
```

Open a preview:

```text
https://open.scriptable.app/run/Share%20Prospect%20Contact%20Card?scout=Ryan%20Lietz&mode=preview
```

Supported shorthand values:

```text
jeffrey
jerami
luther
me
ryan
james
logan
```

The website can also pass the full matched scout name as `scout=James%20Holcomb`. That is preferred because one Scriptable script can serve every scout in the folder.

## Important Limit

Scriptable's documented pasteboard API copies strings and images. It does not expose a documented file-attachment clipboard API for `.vcf` files. For a real contact-card attachment, use the default `share` mode. Use `copyText` only when copying the vCard text itself is acceptable.
