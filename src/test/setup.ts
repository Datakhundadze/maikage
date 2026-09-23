import "@testing-library/jest-dom";

// A suite that opts into `// @vitest-environment node` (the meta-webhook
// handler tests need Node's WebCrypto and Request) has no window; the
// matchMedia shim is only for jsdom suites.
if (typeof window !== "undefined") Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
