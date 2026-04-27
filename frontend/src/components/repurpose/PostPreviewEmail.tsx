"use client";

import { useEffect, useRef } from "react";
import {
  Mail,
  Star,
  Reply,
  ReplyAll,
  Forward,
  Trash2,
  Archive,
  Copy,
  MoreHorizontal,
  Link as LinkIcon,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { RewriteControls } from "@/components/repurpose/RewriteControls";
import type { RewritePreset } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  email: { subject: string; body: string };
  sourceUrl: string;
  onSubjectEdit: (v: string) => void;
  onBodyEdit: (v: string) => void;
  onCopy: (text: string, label: string) => void;

  onRegenerate?: (preset: RewritePreset | null) => void;
  regenActive?: boolean;
  regenPreset?: RewritePreset | "fresh" | null;
  disableRegen?: boolean;
  freeRerollsRemaining?: number | null;

  senderName?: string;
  senderEmail?: string;
  recipient?: string;
}

/**
 * Editable inbox-style email preview. Subject above, body below, with real
 * email-client chrome (star, archive, reply row).
 */
export function PostPreviewEmail({
  email,
  sourceUrl,
  onSubjectEdit,
  onBodyEdit,
  onCopy,
  onRegenerate,
  regenActive,
  regenPreset,
  disableRegen,
  freeRerollsRemaining,
  senderName = "Your Name",
  senderEmail = "you@yourbrand.com",
  recipient = "subscriber@example.com",
}: Props) {
  const initials =
    senderName
      .split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "YN";

  const subjectLen = email.subject.length;
  const subjectOver = subjectLen > 70;

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Mail className="h-4 w-4 text-emerald-600" />
          Email
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto gap-1 h-7 px-2"
          onClick={() => onCopy(`Subject: ${email.subject}\n\n${email.body}`, "Email")}
        >
          <Copy className="h-3 w-3" />
          Copy
        </Button>
      </div>

      {/* Inbox mock */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden text-slate-900">
        {/* Action bar */}
        <div className="flex items-center gap-1 border-b px-2 py-1.5 text-slate-500">
          <button type="button" className="p-1 rounded hover:bg-slate-100" tabIndex={-1}>
            <Archive className="h-4 w-4" />
          </button>
          <button type="button" className="p-1 rounded hover:bg-slate-100" tabIndex={-1}>
            <Trash2 className="h-4 w-4" />
          </button>
          <span className="w-px h-4 bg-slate-200 mx-1" />
          <button type="button" className="p-1 rounded hover:bg-slate-100" tabIndex={-1}>
            <Reply className="h-4 w-4" />
          </button>
          <button type="button" className="p-1 rounded hover:bg-slate-100" tabIndex={-1}>
            <ReplyAll className="h-4 w-4" />
          </button>
          <button type="button" className="p-1 rounded hover:bg-slate-100" tabIndex={-1}>
            <Forward className="h-4 w-4" />
          </button>
          <MoreHorizontal className="ml-auto h-4 w-4" />
        </div>

        {/* Subject */}
        <div className="px-4 pt-3 pb-2 border-b">
          <div className="flex items-start gap-2">
            <EditableSubject
              value={email.subject}
              onChange={onSubjectEdit}
              disabled={regenActive}
            />
            <Star className="h-5 w-5 text-slate-300 shrink-0 mt-1" />
          </div>
          <p
            className={cn(
              "text-[10px] font-mono tabular-nums mt-0.5",
              subjectOver ? "text-red-600" : subjectLen > 60 ? "text-amber-600" : "text-slate-400",
            )}
          >
            {subjectLen}/70
          </p>
        </div>

        {/* Sender row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center font-semibold text-sm shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1 text-[13px] leading-tight">
            <p className="font-semibold truncate">
              {senderName}{" "}
              <span className="font-normal text-slate-500">&lt;{senderEmail}&gt;</span>
            </p>
            <p className="text-slate-500 truncate">
              to <span className="font-medium">{recipient}</span>
            </p>
          </div>
          <p className="text-[11px] text-slate-500 shrink-0">now</p>
        </div>

        {/* Body */}
        <EditableBody
          value={email.body}
          onChange={onBodyEdit}
          disabled={regenActive}
        />
      </div>

      <UrlFooter url={sourceUrl} present={email.body.includes(sourceUrl)} />

      {onRegenerate && (
        <RewriteControls
          onFreshRegen={() => onRegenerate(null)}
          onPreset={(p) => onRegenerate(p)}
          disabled={disableRegen}
          isRunning={regenActive}
          runningPreset={regenPreset}
          freeRerollsRemaining={freeRerollsRemaining}
        />
      )}
    </div>
  );
}

function EditableSubject({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      disabled={disabled}
      placeholder="Subject…"
      rows={1}
      className={cn(
        "w-full resize-none bg-transparent text-[17px] font-semibold leading-tight",
        "text-slate-900 outline-none",
        "focus:ring-2 focus:ring-purple-300 focus:rounded-md focus:px-1 focus:-mx-1",
        "placeholder:text-slate-400 disabled:opacity-60",
      )}
    />
  );
}

function EditableBody({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="px-4 py-3">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Your email body…"
        rows={1}
        className={cn(
          "w-full resize-none bg-transparent text-[14px] leading-[1.65]",
          "text-slate-900 whitespace-pre-wrap break-words outline-none",
          "focus:ring-2 focus:ring-purple-300 focus:rounded-md focus:px-1 focus:-mx-1",
          "placeholder:text-slate-400 disabled:opacity-60",
        )}
      />
    </div>
  );
}

function UrlFooter({ url, present }: { url: string; present: boolean }) {
  if (!url) {
    return (
      <p className="text-[10px] text-amber-600 flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        No source URL configured
      </p>
    );
  }
  return (
    <div
      className={`text-[10px] flex items-center gap-1 truncate ${
        present ? "text-emerald-600" : "text-amber-600"
      }`}
    >
      <LinkIcon className="h-3 w-3 shrink-0" />
      {present ? "Backlink present →" : "Backlink missing →"}
      <span className="truncate">{url}</span>
    </div>
  );
}
