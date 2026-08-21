import * as React from "react";

import { cn } from "@/lib/utils";

// forwardRef so callers can observe the placeholder itself. The catalog grid
// needs it: a card watches its own skeleton with an IntersectionObserver and
// only starts compositing when it nears the viewport. The rendered element is
// unchanged — same tag, same classes, same props spread.
const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />
  ),
);
Skeleton.displayName = "Skeleton";

export { Skeleton };
