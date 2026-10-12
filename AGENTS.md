# Project Rules

- All code-split imports must use `lazyWithRetry` from `src/lib/lazyWithRetry.tsx` instead of React's bare `lazy()`, and the router tree must stay wrapped in `ChunkErrorBoundary`. A chunk that fails to fetch (stale build after a deploy, or a momentary network/edge failure) otherwise throws an uncaught error and blanks the whole screen; the wrapper retries, reloads once to pick up the new build, and falls back to a visible reload message.
