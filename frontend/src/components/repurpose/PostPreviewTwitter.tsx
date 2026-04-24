"use client";

import { MessageCircle, Repeat2, Heart, BarChart2, Share, MoreHorizontal } from "lucide-react";

/**
 * Visual-only X/Twitter thread mock. Renders each tweet as its own card, chained.
 */
export function PostPreviewTwitter({
  tweets,
  handle = "yourhandle",
  displayName = "Your Name",
}: {
  tweets: string[];
  handle?: string;
  displayName?: string;
}) {
  const initials = displayName
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "YN";

  return (
    <div className="rounded-lg border bg-white shadow-sm max-w-full overflow-hidden text-slate-900">
      {tweets.map((tweet, i) => (
        <div
          key={i}
          className={`flex gap-3 p-3 ${i < tweets.length - 1 ? "border-b" : ""}`}
        >
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-slate-800 to-slate-600 text-white flex items-center justify-center font-semibold text-sm">
              {initials}
            </div>
            {i < tweets.length - 1 && <span className="flex-1 w-0.5 bg-slate-200" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[13px] leading-tight">
              <span className="font-semibold truncate">{displayName}</span>
              <span className="text-slate-500 truncate">@{handle}</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-500">now</span>
              <MoreHorizontal className="h-4 w-4 text-slate-400 ml-auto" />
            </div>
            <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap break-words">
              {linkify(tweet)}
            </p>
            <div className="flex items-center justify-between mt-2 text-slate-500 max-w-sm">
              <IconBtn icon={MessageCircle} />
              <IconBtn icon={Repeat2} />
              <IconBtn icon={Heart} />
              <IconBtn icon={BarChart2} />
              <IconBtn icon={Share} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function IconBtn({ icon: Icon }: { icon: React.ElementType }) {
  return (
    <button type="button" className="p-1 rounded-full hover:bg-slate-100">
      <Icon className="h-4 w-4" />
    </button>
  );
}

function linkify(tweet: string) {
  const tokens = tweet.split(/(\s+)/);
  return tokens.map((tok, i) => {
    if (/^https?:\/\//.test(tok)) {
      return (
        <span key={i} className="text-sky-600">
          {tok}
        </span>
      );
    }
    if (/^#[A-Za-z0-9_]+/.test(tok) || /^@[A-Za-z0-9_]+/.test(tok)) {
      return (
        <span key={i} className="text-sky-600">
          {tok}
        </span>
      );
    }
    return <span key={i}>{tok}</span>;
  });
}
