// React 18.3 runtime does not recognize the camelCase `fetchPriority` prop —
// it logs "React does not recognize the `fetchPriority` prop on a DOM element"
// and silently drops the attribute, so the browser never gets the load-priority
// hint. React 19 supports the camelCase spelling; on 18 the DOM attribute must
// be all-lowercase `fetchpriority`, which @types/react 18 does not declare.
//
// Augmenting the interface here lets the JSX use the lowercase spelling that
// actually reaches the DOM without a cast at every call site. Drop this file
// (and revert the call sites to `fetchPriority`) when React is upgraded to 19.
import "react";

declare module "react" {
  interface ImgHTMLAttributes<T> {
    fetchpriority?: "high" | "low" | "auto";
  }
}
