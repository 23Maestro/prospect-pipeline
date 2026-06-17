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
```

The first map is `client-messages-review.c4`, focused on Client Messages review follow-ups and the 10x Communications evidence receipt.
