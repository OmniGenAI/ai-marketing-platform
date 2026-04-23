import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

// Tags/attrs we allow in rendered markdown. Matches what the Tiptap editor
// can round-trip, so "Open in Editor" doesn't silently drop structure.
const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr",
  "strong", "em", "u", "s", "code", "pre",
  "ul", "ol", "li",
  "a", "img",
  "blockquote",
  "table", "thead", "tbody", "tr", "th", "td",
];
const ALLOWED_ATTR = ["href", "target", "rel", "src", "alt", "title"];

marked.setOptions({ gfm: true, breaks: false });

/**
 * Convert a markdown string to sanitized HTML safe to pass to
 * `dangerouslySetInnerHTML` or to seed a Tiptap editor.
 */
export function markdownToSafeHtml(markdown: string): string {
  if (!markdown) return "";
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS, ALLOWED_ATTR });
}

/** Sanitize HTML that may have come from an LLM without re-parsing it. */
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}
