/**
 * Visible long-form description of a catalog design (catalog_designs.description_ka),
 * shown under the H1 on /design/:slug. The static prerender
 * (scripts/prerender.mjs designRoot) writes the same text as a <p> under the
 * H1, so the rendered DOM Google sees matches the prerendered HTML.
 *
 * Plain text only — rendered as a React text node (escaped), never as HTML.
 * Renders nothing when the text is null / empty / whitespace.
 */
interface DesignDescriptionProps {
  text: string | null | undefined;
}

export default function DesignDescription({ text }: DesignDescriptionProps) {
  const body = text?.trim();
  if (!body) return null;
  return (
    <p
      data-testid="design-description"
      className="mt-3 text-sm sm:text-base leading-relaxed text-muted-foreground whitespace-pre-line break-words"
    >
      {body}
    </p>
  );
}
