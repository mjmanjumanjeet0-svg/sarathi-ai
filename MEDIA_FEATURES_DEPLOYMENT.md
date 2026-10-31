# Sarathi AI feature deployment

## New media and project features

- Media Studio: local photo filters, poster text overlays, JPG export.
- AI image generation: authenticated `POST /api/media/image` endpoint using Cloudflare Workers AI Flux Schnell.
- Video tools: browser-based trimming, playback speed, filter, title overlay and WebM export. Browser codec support varies.
- Project workspace: local project/file manager in browser storage; files can be exported individually. This is not cloud collaboration or an IDE.

## Cloudflare Worker deployment

The repository includes `.github/workflows/deploy-worker.yml`. Add these repository Actions secrets before deployment:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with permission to edit/deploy Workers for this account.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID that owns the Worker.

The Worker already declares the `AI` binding in `wrangler.toml`. Deploy from GitHub Actions after adding both secrets, or run `npx wrangler deploy` from the repository root after authenticating Wrangler locally.

The existing Worker secrets `GROQ_API_KEY`, `SARATHI_LOGIN_PASSWORD`, and any configured search-provider keys remain Cloudflare Worker secrets. Do not put them in browser JavaScript or commit them to Git.

## Limitations

- AI image generation requires Workers AI to be enabled for the Cloudflare account and the selected model to be available to that account.
- Photo editing currently provides client-side filters and text composition; instruction-based image transformation requires a separate image-edit model/API.
- Video export is browser-dependent and currently provides trim/filter/speed/title processing, not generative AI video effects.
- Project files are stored in this browser's local storage. They are not synced to GitHub or another device.
- Android APK builds run through the repository's GitHub Actions workflow. A successful workflow artifact is required before calling an APK ready.
