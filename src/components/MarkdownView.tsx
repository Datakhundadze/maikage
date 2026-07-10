import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { transformedDisplayUrl } from "@/lib/imageTransform";

// Shared markdown renderer for blog posts (public article page + admin live
// preview, so both always match).
//
// ⚠️ XSS guarantee: NO rehype-raw and NO dangerouslySetInnerHTML anywhere —
// react-markdown never renders raw HTML by default, so an article body can
// only produce the whitelisted React elements below. Keep it that way.
//
// YouTube embeds: a paragraph whose ONLY content is a YouTube URL (bare or
// autolinked by remark-gfm) renders as a responsive <iframe> embed instead
// of a link. Authors just paste the video URL on its own line.

const YT_RE =
  /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})(?:[?&][^\s]*)?$/;

// Minimal structural view of a hast node — enough to detect the
// "paragraph containing only a YouTube link/URL" shape without any-casts.
interface HastLite {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: { href?: unknown };
  children?: HastLite[];
}

function youTubeIdFromParagraph(node: unknown): string | null {
  const kids = ((node as HastLite)?.children ?? []).filter(
    (c) => !(c.type === "text" && (c.value ?? "").trim() === ""),
  );
  if (kids.length !== 1) return null;
  const k = kids[0];
  const candidate =
    k.type === "element" && k.tagName === "a"
      ? String(k.properties?.href ?? "")
      : k.type === "text"
        ? (k.value ?? "")
        : "";
  const m = candidate.trim().match(YT_RE);
  return m ? m[1] : null;
}

function YouTubeEmbed({ id }: { id: string }) {
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-border my-4" style={{ paddingBottom: "56.25%" }}>
      <iframe
        className="absolute inset-0 h-full w-full"
        src={`https://www.youtube.com/embed/${id}`}
        title="YouTube video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
      />
    </div>
  );
}

export default function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <div className="text-[15px] leading-relaxed text-foreground break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-2xl font-bold mt-6 mb-3">{children}</h1>,
          h2: ({ children }) => <h2 className="text-xl font-bold mt-6 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-lg font-semibold mt-5 mb-2">{children}</h3>,
          p: ({ node, children }) => {
            const ytId = youTubeIdFromParagraph(node);
            if (ytId) return <YouTubeEmbed id={ytId} />;
            return <p className="my-3">{children}</p>;
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="list-disc pl-6 my-3 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-6 my-3 space-y-1">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-primary/40 pl-4 my-4 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-6 border-border" />,
          code: ({ children }) => (
            <code className="rounded bg-muted px-1.5 py-0.5 text-[13px] font-mono">{children}</code>
          ),
          img: ({ src, alt }) => (
            // Inline article images — display-only downscale via the shared
            // transform helper (non-Supabase URLs pass through unchanged).
            <img
              src={transformedDisplayUrl(String(src ?? ""), { width: 800 })}
              alt={alt ?? ""}
              loading="lazy"
              className="rounded-xl border border-border max-w-full h-auto my-4"
            />
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
