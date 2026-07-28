# Next.js 16 / Tailwind CSS 4 build fix

Changes included:

- Uses `@tailwindcss/postcss` instead of the removed `tailwindcss` PostCSS plugin.
- Replaces legacy Tailwind directives with `@import "tailwindcss"`.
- Removes obsolete `swcMinify` from `next.config.mjs`.
- Removes a CSS import from the `/api/livekit` server route.
- Loads LiveKit's global stylesheet once in the root layout.

After replacing the files, run from `apps/web`:

```powershell
npm install
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
```
