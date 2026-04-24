"use client";

import { ThumbsUp, MessageSquare, Repeat2, Send, MoreHorizontal, Globe2, LinkedinIcon } from "lucide-react";

/**
 * Visual-only LinkedIn feed card mock. Respects newlines in `content`.
 * No interactivity — purely "what your post will look like".
 */
export function PostPreviewLinkedIn({
  content,
  authorName = "Your Name",
  authorRole = "Founder",
}: {
  content: string;
  authorName?: string;
  authorRole?: string;
}) {
  const initials = authorName
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "YN";

  const lines = (content || "").split("\n");

  return (
    <div className="rounded-lg border bg-white shadow-sm max-w-full overflow-hidden text-slate-900">

        <div className="flex items-center gap-1 px-3 py-2">
          <LinkedinIcon className="h-4 w-4 text-[#0A66C2]" />
          <span className="text-sm font-medium text-slate-900">LinkedIn</span>
        </div>
  
      <div className="flex items-start gap-3 p-3">
        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-[#0A66C2] to-[#004182] text-white flex items-center justify-center font-semibold shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight truncate">{authorName}</p>
          <p className="text-xs text-slate-500 leading-tight truncate">{authorRole}</p>
          <p className="text-[11px] text-slate-500 leading-tight flex items-center gap-1 mt-0.5">
            now · <Globe2 className="h-3 w-3" />
          </p>
        </div>
        <MoreHorizontal className="h-5 w-5 text-slate-400 shrink-0" />
      </div>

      <div className="px-3 pb-2">
        <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
          {lines.map((line, i) => (
            <p key={i} className={line.trim() === "" ? "h-3" : ""}>
              {linkify(line)}
            </p>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-t px-3 py-1.5 text-slate-600">
        <button type="button" className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-slate-100">
          <ThumbsUp className="h-4 w-4" /> Like
        </button>
        <button type="button" className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-slate-100">
          <MessageSquare className="h-4 w-4" /> Comment
        </button>
        <button type="button" className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-slate-100">
          <Repeat2 className="h-4 w-4" /> Repost
        </button>
        <button type="button" className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-slate-100">
          <Send className="h-4 w-4" /> Send
        </button>
      </div>
    </div>
  );
}

function linkify(line: string) {
  // Very narrow: highlight http(s) URLs and hashtags. Not a full parser.
  const tokens = line.split(/(\s+)/);
  return tokens.map((tok, i) => {
    if (/^https?:\/\//.test(tok)) {
      return (
        <span key={i} className="text-[#0A66C2]">
          {tok}
        </span>
      );
    }
    if (/^#[A-Za-z0-9_]+/.test(tok)) {
      return (
        <span key={i} className="text-[#0A66C2] font-medium">
          {tok}
        </span>
      );
    }
    return <span key={i}>{tok}</span>;
  });
}
