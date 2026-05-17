# Prospect Contact Card Scriptable Handoff

Use this when Prospect Mobile needs to hand off a contact card from iPhone without relying on Mac/Raycast contact-card paths.

## Preset iPhone Location

Put vetted `.vcf` files here:

```text
iCloud Drive/Scriptable/ProspectContactCards/
```

Expected file names:

```text
JeffreyStein-contact-card.vcf
JeramiSingleton-contact-card.vcf
LutherWinfield-contact-card.vcf
RyanLietz-contact-card.vcf
JamesHolcomb-contact-card.vcf
Logan-contact-card.vcf
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
https://open.scriptable.app/run/Share%20Prospect%20Contact%20Card?card=ryan
```

Copy the raw vCard text to the clipboard:

```text
https://open.scriptable.app/run/Share%20Prospect%20Contact%20Card?card=ryan&mode=copyText
```

Open a preview:

```text
https://open.scriptable.app/run/Share%20Prospect%20Contact%20Card?card=ryan&mode=preview
```

Supported `card` values:

```text
jeffrey
jerami
luther
me
ryan
james
logan
```

## Important Limit

Scriptable's documented pasteboard API copies strings and images. It does not expose a documented file-attachment clipboard API for `.vcf` files. For a real contact-card attachment, use the default `share` mode. Use `copyText` only when copying the vCard text itself is acceptable.
