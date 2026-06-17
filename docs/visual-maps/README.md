# Visual Maps

This folder is for durable workflow maps that help explain how Prospect Pipeline flows are shaped.

Use LikeC4 here when the question is about the stable system shape:

- which command owns an operator surface
- which domain owns business meaning
- which adapters read source systems
- which proposed mutations are allowed to appear downstream

Use the Prospect Web evidence receipt when the question is about one live run:

- what the Messages SQL query saw
- what the classifier inferred
- what operator action was proposed
- which approval/preflight gates must happen first

Commands:

```bash
npm run visual-maps
npm run visual-maps:validate
npm run visual-maps:build
npm run visual-maps:webcomponent
```

The first map is `client-messages-review.c4`, focused on Client Messages review follow-ups and the 10x Communications evidence receipt.

For Pending Clients outcome maps, keep node titles natural-language and put the working
details in LikeC4 `description` fields so the Properties panel explains the current
filter, stage valve, contingency template, and operator approval rule. Avoid raw code
labels such as `offer_reschedule_slots` in visible titles unless the node is explicitly
documenting an API payload.

## Portable Links

Run `npm run visual-maps:webcomponent` before deploying Prospect Web when the LikeC4 source changes.

After deployment, use these links from mobile, iPad, or Notion embeds:

- `https://prospect-web.vercel.app/visual-maps/`
- `https://prospect-web.vercel.app/visual-maps/supabase-status.html`
- `https://prospect-web.vercel.app/visual-maps/pending-clients-action-grammar.html`
- `https://prospect-web.vercel.app/visual-maps/client-messages-decision-receipt.html`
- `https://prospect-web.vercel.app/visual-maps/client-messages-review-flow.html`

For a Notion API embed block, use the page URL as the external embed URL. Keep the source of truth in this folder; do not edit generated `likec4-views.js` by hand.
