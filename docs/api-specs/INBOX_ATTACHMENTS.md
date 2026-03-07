# Inbox Attachments - Implementation Fix (2025-12-09)

## ✅ Problem Identified

Inbox messages showed attachment indicators ("The attachments in this email are available") but **no clickable download URLs**.

## 🔍 Root Cause

**The html2text library was stripping ALL links:**

```python
# legacy.py:661 (BEFORE FIX)
h = html2text.HTML2Text()
h.ignore_links = True  # ❌ Removed attachment download URLs!
```

This setting was added to clean signature links (Facebook, Twitter icons) but **also removed attachment download URLs** from the message body.

## ✅ Solution Implemented

**Extract attachments BEFORE html2text cleaning:**

```python
# legacy.py:parse_message_detail_response() (AFTER FIX)
# 1. Extract attachments from raw HTML (preserves URLs)
if raw_message_html:
    soup = BeautifulSoup(raw_message_html, 'html.parser')
    attachment_links = soup.select('a[href*="download"], a[href*=".mp4"], a[href*=".mov"]')
    for link in attachment_links:
        href = link.get('href', '')
        if href and ('download' in href.lower() or any(ext in href.lower() for ext in ['.mp4', '.mov', '.avi', '.pdf', '.zip'])):
            attachments.append({
                "fileName": filename,
                "url": href if href.startswith('http') else f"https://dashboard.nationalpid.com{href}",
                "downloadable": True
            })

# 2. THEN clean content (strips links safely)
content = LegacyTranslator._parse_email_content(raw_content, strip_template=True)

# 3. Return both
return {
    "content": content,  # Clean text
    "attachments": attachments,  # Preserved URLs
}
```

## 📋 UI Changes

**Before:** Attachments in Actions panel (broken - no URLs)

**After:** Attachments in Detail.Metadata sidepanel (bottom right):

```tsx
{detailAttachments.length > 0 && (
  <>
    <Detail.Metadata.Separator />
    <Detail.Metadata.Label title="Attachments" text={`${detailAttachments.length} file(s)`} />
    {detailAttachments.map((att, idx) => (
      <Detail.Metadata.Link
        key={idx}
        title={` `}
        text={att.fileName}
        target={att.url}  // ✅ Now has actual download URL
      />
    ))}
  </>
)}
```

## 📁 Files Changed

1. **Backend:** `npid-api-layer/app/translators/legacy.py:710-768`
   - Extract attachments before html2text
   - Return `attachments` array in response

2. **Adapter:** `src/lib/npid-mcp-adapter.ts:37-66`
   - Updated `fetchMessageDetail` return type to include attachments

3. **UI:** `src/read-videoteam-inbox.tsx:41,59-60,122-136`
   - Added `detailAttachments` state
   - Display attachments in metadata panel (only if present)

## ✅ Testing

1. Open inbox message with attachment (e.g., Ethan Beretervide)
2. Click message → Opens detail view
3. Scroll to bottom-right metadata panel
4. Verify: "Attachments: 1 file(s)"
5. Click filename link → Download starts

## 📝 Notes

- **Email attachments** (this fix): Files athletes attach to inbox emails
- **Video attachments** (`/video/attachments`): Videos uploaded via dashboard (separate endpoint)
- Attachments only shown when present (no empty section)
- URLs are absolute (`https://dashboard.nationalpid.com/...`)
