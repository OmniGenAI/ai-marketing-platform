"use client";

import { useEffect, useState, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Code from "@tiptap/extension-code";
import Placeholder from "@tiptap/extension-placeholder";
import Youtube from "@tiptap/extension-youtube";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code2,
  List, ListOrdered, Quote, Minus, AlignLeft, AlignCenter,
  AlignRight, AlignJustify, Palette, Highlighter,
  Link as LinkIcon, Image as ImageIcon, Play,
  Table as TableIcon, Plus, Undo2, Redo2, X, Trash2,
  ChevronDown,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEXT_COLORS = [
  "#000000", "#e03131", "#2f9e44", "#1971c2",
  "#f08c00", "#ae3ec9", "#868e96", "#ffffff",
];

const HIGHLIGHT_COLORS = [
  "#ffec99", "#b2f2bb", "#a5d8ff",
  "#ffc9c9", "#d0bfff", "#ffd8a8",
];

// ---------------------------------------------------------------------------
// Toolbar button
// ---------------------------------------------------------------------------

function Btn({
  onClick, active = false, title, disabled = false, children, className = "",
}: {
  onClick: () => void;
  active?: boolean;
  title?: string;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={[
        "inline-flex items-center justify-center rounded px-1.5 py-1 text-sm transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        "disabled:opacity-40 disabled:pointer-events-none",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-border shrink-0" />;
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const toolbarRef = useRef<HTMLDivElement>(null);

  const toggle = (name: string) => setOpen((p) => (p === name ? null : name));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!editor) return null;

  const headingLabel = () => {
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive("heading", { level: i })) return `H${i}`;
    }
    return "¶";
  };

  const applyLink = () => {
    if (!linkUrl) return;
    const url = linkUrl.startsWith("http") ? linkUrl : `https://${linkUrl}`;
    if (linkText.trim()) {
      editor.chain().focus().insertContent({
        type: "text", text: linkText.trim(),
        marks: [{ type: "link", attrs: { href: url } }],
      }).run();
    } else {
      editor.chain().focus().setLink({ href: url }).run();
    }
    setOpen(null); setLinkText(""); setLinkUrl("");
  };

  const applyImage = () => {
    if (!imageUrl.trim()) return;
    editor.chain().focus().setImage({ src: imageUrl }).run();
    setOpen(null); setImageUrl("");
  };

  const applyYoutube = () => {
    if (!youtubeUrl.trim()) return;
    editor.chain().focus().setYoutubeVideo({ src: youtubeUrl }).run();
    setOpen(null); setYoutubeUrl("");
  };

  // Check if cursor is inside a YouTube node
  const isInYoutube = () => editor.isActive("youtube");

  const cycleAlign = () => {
    if (isInYoutube()) {
      // For YouTube: directly update the wrapper div's text-align style via node attrs
      const aligns = ["left", "center", "right"] as const;
      const { state } = editor;
      const { $from } = state.selection;
      for (let d = $from.depth; d >= 0; d--) {
        const node = $from.node(d);
        if (node.type.name === "youtube") {
          const pos = $from.before(d);
          const curStyle: string = node.attrs.style || "";
          const curAlign = aligns.find((a) => curStyle.includes(`text-align: ${a}`)) ?? "left";
          const next = aligns[(aligns.indexOf(curAlign) + 1) % aligns.length];
          const newStyle = curStyle
            .replace(/text-align:\s*\w+;?\s*/g, "")
            .trim();
          editor.view.dispatch(
            state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              style: `${newStyle} text-align: ${next};`.trim(),
            })
          );
          return;
        }
      }
      return;
    }
    const aligns = ["left", "center", "right", "justify"] as const;
    const cur = aligns.find((a) => editor.isActive({ textAlign: a })) ?? "left";
    const next = aligns[(aligns.indexOf(cur) + 1) % aligns.length];
    editor.chain().focus().setTextAlign(next).run();
  };

  const getYoutubeAlign = (): string => {
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      if (node.type.name === "youtube") {
        const style: string = node.attrs.style || "";
        if (style.includes("text-align: center")) return "center";
        if (style.includes("text-align: right")) return "right";
        return "left";
      }
    }
    return "left";
  };

  const alignIcon = () => {
    const align = isInYoutube() ? getYoutubeAlign() : (["left","center","right","justify"] as const).find((a) => editor.isActive({ textAlign: a })) ?? "left";
    if (align === "center") return <AlignCenter size={15} />;
    if (align === "right") return <AlignRight size={15} />;
    if (align === "justify") return <AlignJustify size={15} />;
    return <AlignLeft size={15} />;
  };

  // Dropdown panel wrapper
  const Panel = ({ children }: { children: React.ReactNode }) => (
    <div className="absolute top-full left-0 z-50 mt-1 min-w-36 rounded-md border bg-popover shadow-md p-1">
      {children}
    </div>
  );

  const PanelItem = ({ label, onClick: click, danger = false, disabled = false }: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) => (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); if (!disabled) { click(); setOpen(null); } }}
      className={[
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors",
        danger ? "text-red-500 hover:text-red-500" : "text-foreground",
        disabled ? "opacity-40 pointer-events-none" : "",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={toolbarRef}
      className="flex flex-wrap items-center justify-center gap-0.5 px-2 py-1.5 border-b sticky top-0 bg-background z-10"
    >
      {/* Text style */}
      <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold"><Bold size={15} /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic"><Italic size={15} /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline"><UnderlineIcon size={15} /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strikethrough"><Strikethrough size={15} /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="Inline Code"><Code2 size={15} /></Btn>

      <Divider />

      {/* Headings */}
      <div className="relative">
        <Btn onClick={() => toggle("heading")} active={open === "heading"} title="Paragraph style" className="gap-1 text-xs font-medium w-10">
          {headingLabel()} <ChevronDown size={11} />
        </Btn>
        {open === "heading" && (
          <Panel>
            <PanelItem label="Paragraph" onClick={() => editor.chain().focus().setParagraph().run()} />
            {([1, 2, 3, 4, 5, 6] as const).map((l) => (
              <PanelItem key={l} label={`Heading ${l}`} onClick={() => editor.chain().focus().toggleHeading({ level: l }).run()} />
            ))}
          </Panel>
        )}
      </div>

      <Divider />

      {/* Lists */}
      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list"><List size={15} /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Ordered list"><ListOrdered size={15} /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Blockquote"><Quote size={15} /></Btn>
      <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule"><Minus size={15} /></Btn>

      <Divider />

      {/* Alignment */}
      <Btn onClick={cycleAlign} title="Cycle alignment">{alignIcon()}</Btn>

      <Divider />

      {/* Text color */}
      <div className="relative">
        <Btn onClick={() => toggle("textColor")} title="Text color"><Palette size={15} /></Btn>
        {open === "textColor" && (
          <div className="absolute top-full left-0 z-50 mt-1 flex gap-1 p-2 rounded-md border bg-popover shadow-md">
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setColor(c).run(); setOpen(null); }}
                className="h-5 w-5 rounded-full border border-border/60 transition-transform hover:scale-110"
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        )}
      </div>

      {/* Highlight */}
      <div className="relative">
        <Btn onClick={() => toggle("highlight")} title="Highlight"><Highlighter size={15} /></Btn>
        {open === "highlight" && (
          <div className="absolute top-full left-0 z-50 mt-1 flex gap-1 p-2 rounded-md border bg-popover shadow-md">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHighlight({ color: c }).run(); setOpen(null); }}
                className="h-5 w-5 rounded-full border border-border/60 transition-transform hover:scale-110"
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        )}
      </div>

      <Divider />

      {/* Link */}
      <div className="relative">
        <Btn onClick={() => toggle("link")} active={editor.isActive("link")} title="Insert link"><LinkIcon size={15} /></Btn>
        {open === "link" && (
          <div className="absolute top-full left-0 z-50 mt-1 w-64 rounded-md border bg-popover shadow-md p-3 space-y-2">
            <input
              autoFocus
              placeholder="Link text (optional)"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              placeholder="URL (https://…)"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyLink()}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-2">
              <button type="button" onClick={applyLink} className="flex-1 rounded bg-primary text-primary-foreground text-xs py-1 hover:opacity-90">Apply</button>
              <button type="button" onClick={() => { setOpen(null); setLinkText(""); setLinkUrl(""); }} className="flex-1 rounded border text-xs py-1 hover:bg-accent">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Image */}
      <div className="relative">
        <Btn onClick={() => toggle("image")} title="Insert image"><ImageIcon size={15} /></Btn>
        {open === "image" && (
          <div className="absolute top-full left-0 z-50 mt-1 w-64 rounded-md border bg-popover shadow-md p-3 space-y-2">
            <input
              autoFocus
              placeholder="Image URL (https://…)"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyImage()}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-2">
              <button type="button" onClick={applyImage} className="flex-1 rounded bg-primary text-primary-foreground text-xs py-1 hover:opacity-90">Insert</button>
              <button type="button" onClick={() => { setOpen(null); setImageUrl(""); }} className="flex-1 rounded border text-xs py-1 hover:bg-accent">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* YouTube */}
      <div className="relative">
        <Btn onClick={() => toggle("youtube")} title="Insert YouTube video"><Play size={15} /></Btn>
        {open === "youtube" && (
          <div className="absolute top-full left-0 z-50 mt-1 w-72 rounded-md border bg-popover shadow-md p-3 space-y-2">
            <input
              autoFocus
              placeholder="YouTube URL (https://youtube.com/watch?v=…)"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyYoutube()}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-2">
              <button type="button" onClick={applyYoutube} className="flex-1 rounded bg-primary text-primary-foreground text-xs py-1 hover:opacity-90">Insert</button>
              <button type="button" onClick={() => { setOpen(null); setYoutubeUrl(""); }} className="flex-1 rounded border text-xs py-1 hover:bg-accent">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="relative">
        <Btn onClick={() => toggle("table")} active={open === "table"} title="Table tools"><TableIcon size={15} /></Btn>
        {open === "table" && (
          <Panel>
            <PanelItem label="Insert Table" onClick={() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }} />
            <div className="my-1 h-px bg-border" />
            <PanelItem label="Add Row Below" onClick={() => editor.chain().focus().addRowAfter().run()} disabled={!editor.isActive("table")} />
            <PanelItem label="Delete Row" onClick={() => editor.chain().focus().deleteRow().run()} danger disabled={!editor.isActive("table")} />
            <div className="my-1 h-px bg-border" />
            <PanelItem label="Add Column Right" onClick={() => editor.chain().focus().addColumnAfter().run()} disabled={!editor.isActive("table")} />
            <PanelItem label="Delete Column" onClick={() => editor.chain().focus().deleteColumn().run()} danger disabled={!editor.isActive("table")} />
            <div className="my-1 h-px bg-border" />
            <PanelItem label="Delete Table" onClick={() => editor.chain().focus().deleteTable().run()} danger disabled={!editor.isActive("table")} />
          </Panel>
        )}
      </div>

      <Divider />

      {/* Undo / Redo / Clear */}
      <Btn onClick={() => editor.chain().focus().undo().run()} title="Undo"><Undo2 size={15} /></Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} title="Redo"><Redo2 size={15} /></Btn>
      <Btn onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} title="Clear formatting"><X size={15} /></Btn>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor prose styles injected once via a <style> tag
// ---------------------------------------------------------------------------

const PROSE_CSS = `
.rich-editor-content .ProseMirror {
  outline: none;
  padding: 20mm 25mm;
  min-height: 297mm;
  font-size: 0.95rem;
  line-height: 1.75;
  color: inherit;
}
.rich-editor-content .ProseMirror h1 { font-size: 1.75rem; font-weight: 700; margin: 1.25rem 0 .5rem; }
.rich-editor-content .ProseMirror h2 { font-size: 1.4rem;  font-weight: 700; margin: 1.1rem 0 .4rem; }
.rich-editor-content .ProseMirror h3 { font-size: 1.2rem;  font-weight: 600; margin: 1rem 0 .35rem; }
.rich-editor-content .ProseMirror h4 { font-size: 1rem;    font-weight: 600; margin: .9rem 0 .3rem; }
.rich-editor-content .ProseMirror h5, .rich-editor-content .ProseMirror h6 { font-size: .9rem; font-weight: 600; margin: .8rem 0 .25rem; }
.rich-editor-content .ProseMirror p { margin: .4rem 0; }
.rich-editor-content .ProseMirror ul { list-style: disc;    padding-left: 1.5rem; margin: .4rem 0; }
.rich-editor-content .ProseMirror ol { list-style: decimal; padding-left: 1.5rem; margin: .4rem 0; }
.rich-editor-content .ProseMirror li { margin: .2rem 0; }
.rich-editor-content .ProseMirror blockquote { border-left: 3px solid hsl(var(--border)); padding-left: 1rem; color: hsl(var(--muted-foreground)); margin: .5rem 0; }
.rich-editor-content .ProseMirror hr { border: none; border-top: 1px solid hsl(var(--border)); margin: 1rem 0; }
.rich-editor-content .ProseMirror code { background: hsl(var(--muted)); border-radius: 3px; padding: .1em .35em; font-size: .85em; font-family: ui-monospace, monospace; }
.rich-editor-content .ProseMirror a { color: #2563eb; text-decoration: underline; text-decoration-color: #2563eb; text-underline-offset: 3px; text-decoration-thickness: 1px; cursor: pointer; }
.rich-editor-content .ProseMirror img { max-width: 100%; border-radius: 6px; margin: .4rem 0; cursor: default; display: block; }
.rich-editor-content .ProseMirror img[style*="text-align: center"], .rich-editor-content .ProseMirror [data-text-align="center"] img { margin-left: auto; margin-right: auto; }
.rich-editor-content .ProseMirror img[style*="text-align: right"], .rich-editor-content .ProseMirror [data-text-align="right"] img { margin-left: auto; margin-right: 0; }
.rich-editor-content .ProseMirror img[style*="text-align: left"], .rich-editor-content .ProseMirror [data-text-align="left"] img { margin-left: 0; margin-right: auto; }
.rich-editor-content .ProseMirror div[data-youtube-video] { display: block; margin: .5rem 0; }
.rich-editor-content .ProseMirror div[data-youtube-video] iframe { border-radius: 8px; display: block; }
.rich-editor-content .ProseMirror div[data-youtube-video][style*="text-align: center"] iframe { margin-left: auto; margin-right: auto; }
.rich-editor-content .ProseMirror div[data-youtube-video][style*="text-align: right"] iframe { margin-left: auto; margin-right: 0; }
.rich-editor-content .ProseMirror div[data-youtube-video][style*="text-align: left"] iframe { margin-left: 0; margin-right: auto; }
.rich-editor-content .ProseMirror img.re-selected { outline: 2px solid #6366f1; outline-offset: 2px; }
.re-img-delete:hover { background: #b91c1c !important; }
.rich-editor-content .ProseMirror table { border-collapse: collapse; width: 100%; margin: .5rem 0; border: 1px solid #94a3b8; }
.rich-editor-content .ProseMirror td, .rich-editor-content .ProseMirror th { border: 1px solid #94a3b8; padding: .4rem .6rem; min-width: 60px; position: relative; }
.rich-editor-content .ProseMirror th { background: hsl(var(--muted)); font-weight: 600; }
.rich-editor-content .ProseMirror .selectedCell::after { content: ""; position: absolute; inset: 0; background: rgba(99,102,241,0.15); pointer-events: none; }
.rich-editor-content .ProseMirror .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: 0; width: 4px; background: #6366f1; cursor: col-resize; pointer-events: all; }
.rich-editor-content .ProseMirror .tableWrapper { overflow-x: auto; }
.rich-editor-content .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: hsl(var(--muted-foreground)); pointer-events: none; float: left; height: 0; }
`;

let proseStyleInjected = false;
function injectProseStyle() {
  if (proseStyleInjected || typeof document === "undefined") return;
  const el = document.createElement("style");
  el.textContent = PROSE_CSS;
  document.head.appendChild(el);
  proseStyleInjected = true;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

interface MetaFields {
  title: string;
  description: string;
  focusKeyword?: string;
  relatedKeywords?: string;
}

interface RichEditorProps {
  value?: string;
  onChange?: (html: string, text: string) => void;
  placeholder?: string;
  minHeight?: string;
  maxHeight?: string;
  readOnly?: boolean;
  className?: string;
  meta?: MetaFields;
  onMetaChange?: (meta: MetaFields) => void;
}

export function RichEditor({
  value = "",
  onChange,
  placeholder = "Start typing…",
  minHeight = "300px",
  maxHeight = "none",
  readOnly = false,
  className = "",
  meta,
  onMetaChange,
}: RichEditorProps) {
  const [metaOpen, setMetaOpen] = useState(true);
  injectProseStyle();

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, code: false }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph", "image"] }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Link.extend({ inclusive: false }).configure({ openOnClick: false }),
      Image.configure({ inline: false, allowBase64: true, HTMLAttributes: { style: null } }),
      Youtube.configure({ controls: true }),
      Code,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    editable: !readOnly,
    onUpdate({ editor }) {
      if (onChange) onChange(editor.getHTML(), editor.getText());
    },
  });

  // Sync external value
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value || "");
    }
  }, [value, editor]);

  // Image resize + delete
  useEffect(() => {
    if (!editor) return;
    const HANDLE = 12;

    const enableImageResize = () => {
      const images = document.querySelectorAll<HTMLImageElement>(".rich-editor-content img");
      images.forEach((img) => {
        if (img.dataset.resizable) return; // already initialised
        img.dataset.resizable = "1";

        let isResizing = false;
        let dir: string | null = null;
        let startX = 0, startY = 0, startW = 0, startH = 0, aspect = 1;

        const getDir = (e: MouseEvent, rect: DOMRect) => {
          const x = e.clientX - rect.left, y = e.clientY - rect.top;
          const w = rect.width, h = rect.height;
          if (x < HANDLE && y < HANDLE) return "nw";
          if (x > w - HANDLE && y < HANDLE) return "ne";
          if (x < HANDLE && y > h - HANDLE) return "sw";
          if (x > w - HANDLE && y > h - HANDLE) return "se";
          return null;
        };

        img.addEventListener("mousemove", (e) => {
          const d = getDir(e, img.getBoundingClientRect());
          img.style.cursor = d ? ({ nw: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", se: "nwse-resize" } as Record<string, string>)[d] : "default";
        });
        img.addEventListener("mouseleave", () => { img.style.cursor = "default"; });

        img.addEventListener("click", (e) => {
          e.stopPropagation();
          document.querySelectorAll(".rich-editor-content img.re-selected").forEach((i) => i.classList.remove("re-selected"));
          document.querySelectorAll(".re-img-delete").forEach((b) => b.remove());

          img.classList.add("re-selected");

          const btn = document.createElement("button");
          btn.className = "re-img-delete";
          btn.type = "button";
          btn.title = "Delete image";
          btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
          Object.assign(btn.style, { position: "fixed", zIndex: "9999", background: "#ef4444", color: "#fff", border: "none", borderRadius: "4px", padding: "2px 4px", cursor: "pointer" });

          const pos = () => {
            const r = img.getBoundingClientRect();
            btn.style.top = (r.top - 24) + "px";
            btn.style.left = (r.right - 28) + "px";
          };
          pos();
          const ro = new ResizeObserver(pos);
          ro.observe(img);

          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            ro.disconnect();
            img.remove();
            btn.remove();
            editor.chain().focus().run();
          });
          document.body.appendChild(btn);
        });

        img.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          dir = getDir(e, img.getBoundingClientRect());
          if (!dir) return;
          isResizing = true;
          startX = e.clientX; startY = e.clientY;
          startW = img.offsetWidth; startH = img.offsetHeight;
          aspect = startW / startH;
          e.preventDefault();
        });

        const onMove = (e: MouseEvent) => {
          if (!isResizing || !dir) return;
          const dx = e.clientX - startX;
          let nw = Math.max(50, dir === "sw" || dir === "nw" ? startW - dx : startW + dx);
          img.style.width = nw + "px";
          img.style.height = (nw / aspect) + "px";
        };
        const onUp = () => {
          if (isResizing) {
            // Persist the new size into TipTap node attrs so alignment changes
            // don't revert the image to its original size on re-render.
            try {
              const view = editor.view;
              const domPos = view.posAtDOM(img, 0);
              const $pos = view.state.doc.resolve(domPos);
              // Walk up to find the actual node position
              for (let depth = $pos.depth; depth >= 0; depth--) {
                const nodePos = depth === 0 ? 0 : $pos.before(depth);
                const node = view.state.doc.nodeAt(nodePos);
                if (node && node.type.name === "image") {
                  view.dispatch(
                    view.state.tr.setNodeMarkup(nodePos, undefined, {
                      ...node.attrs,
                      width: img.offsetWidth,
                      height: img.offsetHeight,
                    })
                  );
                  break;
                }
              }
            } catch { /* ignore — resize style already applied */ }
          }
          isResizing = false;
          dir = null;
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    };

    setTimeout(enableImageResize, 100);
    editor.on("update", enableImageResize);

    const clickHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== "IMG" && !target.closest(".re-img-delete")) {
        document.querySelectorAll(".rich-editor-content img.re-selected").forEach((i) => i.classList.remove("re-selected"));
        document.querySelectorAll(".re-img-delete").forEach((b) => b.remove());
      }
    };
    const wrap = document.querySelector(".rich-editor-content");
    wrap?.addEventListener("click", clickHandler);

    return () => {
      editor.off("update", enableImageResize);
      wrap?.removeEventListener("click", clickHandler);
    };
  }, [editor]);

  return (
    <div
      className={["flex flex-col overflow-hidden", className].join(" ")}
      style={{ "--re-min-height": minHeight } as React.CSSProperties}
    >
      {!readOnly && editor && <Toolbar editor={editor} />}
      <div className="rich-editor-content flex-1 overflow-y-auto min-h-0 bg-muted/30">
        <div className="mx-auto bg-background shadow-sm" style={{ width: "210mm", minHeight: "297mm" }}>

          {/* Meta panel — collapsible, pinned at top of A4 canvas */}
          {meta && onMetaChange && (
            <div className="border-b bg-muted/5" style={{ padding: "8mm 25mm 0" }}>
              {metaOpen && (
                <div className="space-y-4 pb-4 animate-in fade-in slide-in-from-top-2 duration-200">
                  {/* Title */}
                  <div className="group rounded-md border bg-background/50 p-2.5 transition-all hover:border-primary/30 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
                    <div className="flex items-center justify-between mb-1.5 px-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-widest font-bold  text-muted-foreground/70">SEO Title</span>
                        <button
                          type="button"
                          title="Copy title"
                          onClick={() => navigator.clipboard.writeText(meta.title)}
                          className="text-muted-foreground/60 hover:text-primary transition-colors h-4 w-4 flex items-center justify-center rounded hover:bg-muted"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-1 w-24 bg-muted rounded-full overflow-hidden hidden sm:block">
                          <div 
                            className={`h-full transition-all duration-300 ${
                              meta.title.length > 70 ? "bg-red-500" : meta.title.length >= 50 ? "bg-emerald-500" : "bg-blue-500"
                            }`}
                            style={{ width: `${Math.min(100, (meta.title.length / 70) * 100)}%` }}
                          />
                        </div>
                        <span className={`text-[10px] font-mono font-medium ${
                          meta.title.length > 70 ? "text-red-500" : meta.title.length >= 50 ? "text-emerald-500" : "text-muted-foreground"
                        }`}>{meta.title.length}/70</span>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={meta.title}
                      onChange={(e) => onMetaChange({ ...meta, title: e.target.value })}
                      placeholder="Enter a compelling title for search engines..."
                      className="w-full bg-transparent text-[15px] font-medium focus:outline-none placeholder:text-muted-foreground/40 leading-tight"
                    />
                  </div>
                  {/* Description */}
                  <div className="group rounded-md border bg-background/50 p-2.5 transition-all hover:border-primary/30 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
                    <div className="flex items-center justify-between mb-1.5 px-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/70">Meta Description</span>
                        <button
                          type="button"
                          title="Copy description"
                          onClick={() => navigator.clipboard.writeText(meta.description)}
                          className="text-muted-foreground/60 hover:text-primary transition-colors h-4 w-4 flex items-center justify-center rounded hover:bg-muted"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-1 w-24 bg-muted rounded-full overflow-hidden hidden sm:block">
                          <div 
                            className={`h-full transition-all duration-300 ${
                              meta.description.length > 156 ? "bg-red-500" : meta.description.length >= 120 ? "bg-emerald-500" : "bg-blue-500"
                            }`}
                            style={{ width: `${Math.min(100, (meta.description.length / 156) * 100)}%` }}
                          />
                        </div>
                        <span className={`text-[10px] font-mono font-medium ${
                          meta.description.length > 156 ? "text-red-500" : meta.description.length >= 120 ? "text-emerald-500" : "text-muted-foreground"
                        }`}>{meta.description.length}/156</span>
                      </div>
                    </div>
                    <textarea
                      rows={2}
                      value={meta.description}
                      onChange={(e) => onMetaChange({ ...meta, description: e.target.value })}
                      placeholder="Write a brief summary to encourage clicks..."
                      className="w-full bg-transparent text-[14px] leading-relaxed resize-none focus:outline-none placeholder:text-muted-foreground/40"
                    />
                  </div>

                  {/* Keywords Row */}
                  <div className="flex flex-col sm:flex-row gap-4">
                    {/* Primary Keyword */}
                    <div className="flex-1 group rounded-md border bg-background/50 p-2.5 transition-all hover:border-primary/30 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
                      <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
                        <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/70">Primary Keyword</span>
                        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                      </div>
                      <input
                        type="text"
                        value={meta.focusKeyword || ""}
                        onChange={(e) => onMetaChange({ ...meta, focusKeyword: e.target.value })}
                        placeholder="Main focus keyword..."
                        className="w-full bg-transparent text-[13px] font-semibold focus:outline-none placeholder:text-muted-foreground/40"
                      />
                    </div>

                    {/* Secondary Keywords */}
                    <div className="flex-[2.5] group rounded-md border bg-background/50 p-2.5 transition-all hover:border-primary/30 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
                      <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
                        <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/70">Secondary Keywords</span>
                      </div>
                      <input
                        type="text"
                        value={meta.relatedKeywords || ""}
                        onChange={(e) => onMetaChange({ ...meta, relatedKeywords: e.target.value })}
                        placeholder="Comma separated keywords..."
                        className="w-full bg-transparent text-[13px] focus:outline-none placeholder:text-muted-foreground/40"
                      />
                    </div>
                  </div>
                </div>
              )}
              {/* Toggle row */}
              <button
                type="button"
                onClick={() => setMetaOpen((v) => !v)}
                className="flex items-center gap-2 w-full justify-center py-2 text-[10px] uppercase tracking-widest font-bold text-muted-foreground/60 hover:text-primary transition-all group"
              >
                <div className="h-px flex-1 bg-border/50 group-hover:bg-primary/20 transition-colors" />
                <span className="flex items-center gap-1.5 px-2">
                  {metaOpen ? "Hide SEO Details" : "Show SEO Details"}
                  <svg
                    width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                    className={`transition-transform duration-300 ${metaOpen ? "rotate-0" : "rotate-180"}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
                <div className="h-px flex-1 bg-border/50 group-hover:bg-primary/20 transition-colors" />
              </button>
            </div>
          )}

          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
