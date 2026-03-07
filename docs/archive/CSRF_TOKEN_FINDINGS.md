# Laravel CSRF Token Extraction - Stack Overflow Findings

## Problem
TypeScript client getting "No CSRF token found in page" when searching for `<input name="_token">`.

## Root Cause
Laravel provides CSRF tokens in **two locations**:

1. **Meta tag** (for AJAX): `<meta name="csrf-token" content="...">`
2. **Form input** (for form submissions): `<input type="hidden" name="_token" value="...">`

## Solutions from Stack Overflow

### Solution 1: Extract from Meta Tag (RECOMMENDED)
```typescript
private async getFreshCSRFToken(): Promise<string> {
  const headers = getAuthHeaders();
  const resp = await fetch(`${this.baseUrl}/rulestemplates/template/videoteammessagelist`, { headers });
  const html = await resp.text();

  // Try meta tag first (Laravel standard for AJAX)
  const metaMatch = html.match(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/);
  if (metaMatch) return metaMatch[1];

  // Fallback to form input
  const inputMatch = html.match(/<input[^>]*name="_token"[^>]*value="([^"]+)"/);
  if (inputMatch) return inputMatch[1];

  throw new Error('No CSRF token found (checked meta tag and input)');
}
```

### Solution 2: Use X-CSRF-TOKEN Header
Instead of sending `_token` in POST body, send via header:

```typescript
const response = await fetch(url, {
  method: 'POST',
  headers: {
    ...headers,
    'X-CSRF-TOKEN': csrfToken,  // Use header instead
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Requested-With': 'XMLHttpRequest',
  },
  body: new URLSearchParams({
    // Remove _token from body
    first_name: firstName,
    last_name: lastName,
    // ... other fields
  }).toString(),
});
```

Laravel's `ValidateCsrfToken` middleware accepts EITHER:
- `_token` in POST body
- `X-CSRF-TOKEN` in request header

### Solution 3: Check Python Reference
```python
# npid_api_client.py line 71-87
def _get_csrf_token_from_page(self, url: str) -> str:
    resp = self.session.get(url)
    soup = BeautifulSoup(resp.text, 'html.parser')
    token_input = soup.find('input', {'name': '_token'})
    if token_input and token_input.get('value'):
        return token_input['value']
```

Python uses BeautifulSoup to find `<input name="_token">`, which means:
- The page DOES have the input field
- Regex pattern might be wrong
- Or page structure differs when accessed from TypeScript

## Key Requirements for Laravel AJAX (Confirmed)

1. **Headers** (all required):
   - `Content-Type: application/x-www-form-urlencoded`
   - `X-Requested-With: XMLHttpRequest`
   - `Accept: application/json, text/plain, */*`

2. **CSRF Token** (either):
   - Header: `X-CSRF-TOKEN: <token>`
   - Body: `_token=<token>`

3. **Cookie Authentication**:
   - Session cookies from `.npid_session.pkl`

## Next Steps

1. **Verify page contains token**:
   ```bash
   curl -H "Cookie: ..." https://dashboard.nationalpid.com/rulestemplates/template/videoteammessagelist \
     | grep -E '(csrf-token|_token)'
   ```

2. **Try meta tag extraction** first (Laravel standard)

3. **Add debug logging** to see actual HTML response

4. **Consider X-CSRF-TOKEN header** approach instead of POST body

## References
- https://stackoverflow.com/questions/32738763/laravel-csrf-token-mismatch-for-ajax-post-request
- https://laravel.com/docs/12.x/csrf
- https://stackoverflow.com/questions/33326078/laravel-5-1-xmlhttprequest-ajax-post-tokenmismatchexception
