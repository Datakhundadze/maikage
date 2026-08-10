import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Markdown renderer for ASSISTANT output only. The model writes markdown
// (**bold**, "- " bullets), which used to print with literal asterisks.
//
// ⚠️ Deliberately NOT MarkdownView: that renderer is safe (no rehype-raw, no
// dangerouslySetInnerHTML) but carries blog behaviour that is wrong for model
// output — a bare YouTube URL becomes a third-party <iframe>, and `img` loads
// arbitrary remote images. Model text must never be able to embed either.
//
// ⚠️ XSS: react-markdown renders NO raw HTML without rehype-raw (not a
// dependency here), so model output can only produce the whitelisted elements
// below. Never add rehype-raw or dangerouslySetInnerHTML to this component.
// Media is dropped outright; links are forced to open safely.
export default function ChatMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Chat-scale blocks: tight margins, no article-sized headings.
        p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline underline-offset-2 hover:opacity-80"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded bg-background/40 px-1 py-0.5 text-[13px] font-mono">{children}</code>
        ),
        // Headings collapse to emphasised text — a chat bubble is not an article.
        h1: ({ children }) => <p className="font-semibold my-1.5 first:mt-0">{children}</p>,
        h2: ({ children }) => <p className="font-semibold my-1.5 first:mt-0">{children}</p>,
        h3: ({ children }) => <p className="font-semibold my-1.5 first:mt-0">{children}</p>,
        // Media is NOT rendered from model output.
        img: () => null,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
