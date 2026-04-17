"use client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DENSITY_OPTIMAL_MIN = 1;
const DENSITY_OPTIMAL_MAX = 3;
const LSI_UNIQUE_TERMS_TARGET = 200;
const PARA_WORD_LIMIT = 150;
const MIN_H2_COUNT = 2;
const SCORE_WEIGHTS = {
  keyword: 0.25,
  coverage: 0.20,
  readability: 0.15,
  structure: 0.15,
  links: 0.10,
  meta: 0.10,
  length: 0.05,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SEOAnalysisResult {
  overall: number;
  keyword_score: number;
  coverage_score: number;
  readability_score: number;
  structure_score: number;
  links_score: number;
  meta_score: number;
  length_score: number;
  meta_detail: {
    keyword_in_title: boolean;
    keyword_in_description: boolean;
    title_length: number;
    title_ok: boolean;
    description_length: number;
    description_ok: boolean;
    score: number;
  };
  readability: {
    flesch_score: number;
    grade_level: number;
    word_count: number;
    sentence_count: number;
    avg_words_per_sentence: number;
    status: string;
  };
  keyword_density: {
    density: number;
    occurrences: number;
    word_count: number;
    status: string;
  };
  keyword_placement: {
    in_h1: boolean;
    in_h2: boolean;
    in_first_paragraph: boolean;
    placement_score: number;
  };
  lsi: {
    top_terms: { term: string; count: number }[];
    unique_terms: number;
    coverage_score: number;
  };
  passive_voice: {
    passive_count: number;
    passive_percentage: number;
    total_sentences: number;
    status: string;
    score: number;
  };
  links: {
    internal_count: number;
    external_count: number;
    total_links: number;
    score: number;
  };
  content_length: {
    word_count: number;
    target: number;
    percentage: number;
    score: number;
    status: string;
  };
  structure: {
    h1_count: number;
    h2_count: number;
    h3_count: number;
    paragraph_count: number;
    avg_paragraph_words: number;
    long_paragraphs: number;
    issues: string[];
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with",
  "by","from","is","are","was","were","be","been","have","has","had","do",
  "does","did","will","would","could","should","may","might","can","this",
  "that","these","those","it","its","we","you","he","she","they","i","me",
  "my","our","your","their","what","how","when","where","who","which","not",
  "no","so","if","as","up","out","about","into","than","then","there","also",
  "more","all","just","get","use","make","like",
]);

const PASSIVE_RE = /\b(is|are|was|were|be|been|being)\s+\w+ed\b/i;

// ---------------------------------------------------------------------------
// HTML Utilities
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  if (typeof window === "undefined") return html.replace(/<[^>]+>/g, " ");
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? div.innerText ?? "";
}

function parseHtml(html: string) {
  if (typeof window === "undefined") {
    const get = (tag: string) =>
      Array.from(html.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "gis"))).map(
        (m) => m[1].replace(/<[^>]+>/g, "").trim(),
      );
    return { h1: get("h1"), h2: get("h2"), h3: get("h3"), paragraphs: get("p"), links: [] as { href: string }[] };
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return {
    h1: Array.from(doc.querySelectorAll("h1")).map((el) => el.textContent ?? ""),
    h2: Array.from(doc.querySelectorAll("h2")).map((el) => el.textContent ?? ""),
    h3: Array.from(doc.querySelectorAll("h3")).map((el) => el.textContent ?? ""),
    paragraphs: Array.from(doc.querySelectorAll("p")).map((el) => el.textContent ?? ""),
    links: Array.from(doc.querySelectorAll("a[href]")).map((el) => ({ href: (el as HTMLAnchorElement).href })),
  };
}

// ---------------------------------------------------------------------------
// Individual analysis functions (Single Responsibility)
// ---------------------------------------------------------------------------

function calcReadability(text: string) {
  const words = text.match(/\b[a-zA-Z]+\b/g) ?? [];
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim());
  const sc = sentences.length || 1;
  const wc = words.length;
  if (wc === 0) return { flesch: 0, grade: 0, sc, wc, aws: 0, status: "no_content" };
  const syllables = words.reduce((sum, w) => {
    const n = Math.max(1, (w.toLowerCase().match(/[aeiou]/g) ?? []).length - (w.toLowerCase().endsWith("e") ? 1 : 0));
    return sum + n;
  }, 0);
  const aws = wc / sc;
  const asw = syllables / wc;
  const flesch = Math.max(0, Math.min(100, Math.round((206.835 - 1.015 * aws - 84.6 * asw) * 10) / 10));
  const grade = Math.max(0, Math.round((0.39 * aws + 11.8 * asw - 15.59) * 10) / 10);
  const status = flesch >= 70 ? "easy" : flesch >= 50 ? "moderate" : "difficult";
  return { flesch, grade, sc, wc, aws: Math.round(aws * 10) / 10, status };
}

function calcKeywordDensity(plain: string, kw: string, wordCount: number) {
  if (!kw || wordCount === 0) return { occurrences: 0, density: 0, status: "missing" };
  const plainLower = plain.toLowerCase();
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const occurrences = kw.split(/\s+/).length === 1
    ? (plainLower.match(new RegExp(`\\b${escaped}\\b`, "g")) ?? []).length
    : plainLower.split(kw).length - 1;
  const density = Math.round((occurrences / wordCount) * 1000) / 10;
  const status = density >= DENSITY_OPTIMAL_MIN && density <= DENSITY_OPTIMAL_MAX ? "optimal" : density < DENSITY_OPTIMAL_MIN ? "under" : "over";
  return { occurrences, density, status };
}

function calcKeywordPlacement(h1: string[], h2: string[], paragraphs: string[], kw: string) {
  if (!kw) return { in_h1: false, in_h2: false, in_first_paragraph: false, placement_score: 0 };
  const in_h1 = h1.some((t) => t.toLowerCase().includes(kw));
  const in_h2 = h2.some((t) => t.toLowerCase().includes(kw));
  const in_first = (paragraphs[0]?.toLowerCase() ?? "").includes(kw);
  const placement_score = (in_h1 ? 40 : 0) + (in_h2 ? 35 : 0) + (in_first ? 25 : 0);
  return { in_h1, in_h2, in_first_paragraph: in_first, placement_score };
}

function calcPassiveVoice(plain: string, sentenceCount: number) {
  const sentenceList = plain.split(/[.!?]+/).filter((s) => s.trim());
  const passiveCount = sentenceList.filter((s) => PASSIVE_RE.test(s)).length;
  const passivePct = Math.round((passiveCount / sentenceCount) * 100 * 10) / 10;
  const status = passivePct <= 10 ? "good" : passivePct <= 20 ? "moderate" : "high";
  return { passiveCount, passivePct, status, score: Math.max(0, Math.round(100 - passivePct * 3)) };
}

function calcStructure(h1: string[], h2: string[], h3: string[], paragraphs: string[]) {
  const paraWordCounts = paragraphs.map((p) => p.trim().split(/\s+/).filter(Boolean).length);
  const longParas = paraWordCounts.filter((c) => c > PARA_WORD_LIMIT).length;
  const avgParaWords = paraWordCounts.length
    ? Math.round((paraWordCounts.reduce((a, b) => a + b, 0) / paraWordCounts.length) * 10) / 10
    : 0;
  const issues: string[] = [];
  if (h1.length === 0) issues.push("Missing H1 heading");
  if (h1.length > 1) issues.push(`Multiple H1 headings (${h1.length}) — use only one`);
  if (h2.length < MIN_H2_COUNT) issues.push("Add at least 2 H2 subheadings for structure");
  if (longParas > 0) issues.push(`${longParas} paragraph(s) exceed 150 words — break them up`);
  const score = Math.min(100, Math.max(0, (h1.length === 1 ? 30 : 0) + Math.min(h2.length, 4) * 15 - issues.length * 10));
  return { h1_count: h1.length, h2_count: h2.length, h3_count: h3.length, paragraph_count: paragraphs.length, avg_paragraph_words: avgParaWords, long_paragraphs: longParas, issues, score };
}

function calcLinks(links: { href: string }[]) {
  const externalLinks = links.filter((l) => /^https?:\/\//i.test(l.href)).length;
  const internalLinks = links.length - externalLinks;
  return { internal_count: internalLinks, external_count: externalLinks, total_links: links.length, score: Math.min(100, internalLinks * 20 + externalLinks * 15) };
}

function calcLsi(plain: string, relatedKeywords: string, kw: string) {
  const relatedKws = relatedKeywords.split(/[\n,]/).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const kwParts = new Set(kw.split(/\s+/).filter(Boolean));
  const lsiWords = ((plain + " " + relatedKws.join(" ")).toLowerCase().match(/\b[a-zA-Z]{4,}\b/g) ?? [])
    .filter((w) => !STOPWORDS.has(w) && !kwParts.has(w));
  const counts = lsiWords.reduce<Record<string, number>>((acc, w) => { acc[w] = (acc[w] ?? 0) + 1; return acc; }, {});
  const uniqueTerms = Object.keys(counts).length;
  const topTerms = Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 10).map(([term, count]) => ({ term, count }));
  return { top_terms: topTerms, unique_terms: uniqueTerms, coverage_score: Math.min(100, Math.round((uniqueTerms / LSI_UNIQUE_TERMS_TARGET) * 100)) };
}

function calcMeta(title: string, description: string, kw: string) {
  const titleLen = title.length;
  const descLen = description.length;
  const kwInTitle = kw ? (kw.split(/\s+/).every((w) => title.toLowerCase().includes(w)) || title.toLowerCase().includes(kw)) : false;
  const kwInDesc = kw ? description.toLowerCase().includes(kw) : false;
  const titleOk = titleLen >= 10 && titleLen <= 60;
  const descOk = descLen >= 50 && descLen <= 155;
  const score = (titleLen > 0 ? 20 : 0) + (kwInTitle ? 30 : 0) + (descLen > 0 ? 20 : 0) + (kwInDesc ? 20 : 0) + (titleOk && descOk ? 10 : titleOk || descOk ? 5 : 0);
  return { keyword_in_title: kwInTitle, keyword_in_description: kwInDesc, title_length: titleLen, title_ok: titleOk, description_length: descLen, description_ok: descOk, score };
}

function calcContentLength(wordCount: number, targetWordCount: number) {
  const percentage = Math.min(100, Math.round((wordCount / targetWordCount) * 100));
  const score = percentage >= 100 ? 100 : percentage >= 70 ? 70 : Math.round(percentage * 0.7);
  return { word_count: wordCount, target: targetWordCount, percentage, score, status: percentage >= 100 ? "optimal" : percentage >= 70 ? "under" : "short" };
}

// ---------------------------------------------------------------------------
// Main export — composes individual analysis functions
// ---------------------------------------------------------------------------

export function analyzeContent(
  html: string,
  keyword: string,
  title: string,
  description: string,
  relatedKeywords: string,
  targetWordCount: number,
): SEOAnalysisResult {
  const kw = keyword.trim().toLowerCase();
  const plain = stripHtml(html);
  const { h1, h2, h3, paragraphs, links } = parseHtml(html);
  const wordCount = plain.trim() ? plain.trim().split(/\s+/).length : 0;

  const readability = calcReadability(plain);
  const density = calcKeywordDensity(plain, kw, wordCount);
  const placement = calcKeywordPlacement(h1, h2, paragraphs, kw);
  const passive = calcPassiveVoice(plain, readability.sc);
  const structure = calcStructure(h1, h2, h3, paragraphs);
  const linkData = calcLinks(links);
  const lsi = calcLsi(plain, relatedKeywords, kw);
  const meta = calcMeta(title, description, kw);
  const contentLength = calcContentLength(wordCount, targetWordCount);

  const densityScoreMap: Record<string, number> = { optimal: 100, under: 50, over: 40, missing: 0 };
  const kwScore = Math.round((densityScoreMap[density.status] ?? 0) * 0.5 + placement.placement_score * 0.5);
  const readabilityScore = Math.max(0, Math.round(readability.flesch - passive.passivePct * 2));

  const overall = Math.round(
    kwScore * SCORE_WEIGHTS.keyword +
    lsi.coverage_score * SCORE_WEIGHTS.coverage +
    readabilityScore * SCORE_WEIGHTS.readability +
    structure.score * SCORE_WEIGHTS.structure +
    linkData.score * SCORE_WEIGHTS.links +
    meta.score * SCORE_WEIGHTS.meta +
    contentLength.score * SCORE_WEIGHTS.length,
  );

  return {
    overall,
    keyword_score: kwScore,
    coverage_score: lsi.coverage_score,
    readability_score: readabilityScore,
    structure_score: structure.score,
    links_score: linkData.score,
    meta_score: meta.score,
    length_score: contentLength.score,
    meta_detail: meta,
    readability: {
      flesch_score: readability.flesch,
      grade_level: readability.grade,
      word_count: wordCount,
      sentence_count: readability.sc,
      avg_words_per_sentence: readability.aws,
      status: readability.status,
    },
    keyword_density: {
      density: density.density,
      occurrences: density.occurrences,
      word_count: wordCount,
      status: density.status,
    },
    keyword_placement: {
      in_h1: placement.in_h1,
      in_h2: placement.in_h2,
      in_first_paragraph: placement.in_first_paragraph,
      placement_score: placement.placement_score,
    },
    lsi,
    passive_voice: {
      passive_count: passive.passiveCount,
      passive_percentage: passive.passivePct,
      total_sentences: readability.sc,
      status: passive.status,
      score: passive.score,
    },
    links: linkData,

    content_length: contentLength,
    structure: {
      h1_count: structure.h1_count,
      h2_count: structure.h2_count,
      h3_count: structure.h3_count,
      paragraph_count: structure.paragraph_count,
      avg_paragraph_words: structure.avg_paragraph_words,
      long_paragraphs: structure.long_paragraphs,
      issues: structure.issues,    },
  };
}