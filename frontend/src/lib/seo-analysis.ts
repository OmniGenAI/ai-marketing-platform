"use client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DENSITY_OPTIMAL_MIN = 1;
const DENSITY_OPTIMAL_MAX = 3;
const LSI_UNIQUE_TERMS_TARGET = 200;
const PARA_WORD_LIMIT = 150;
const MIN_H2_COUNT = 2;
const TITLE_MIN = 10;
const TITLE_MAX = 60;
const DESC_MIN = 50;
const DESC_MAX = 155;

const SCORE_WEIGHTS = {
  keyword: 0.25,
  coverage: 0.20,
  readability: 0.15,
  structure: 0.15,
  links: 0.10,
  meta: 0.10,
  length: 0.05,
} as const;

const DENSITY_STATUS_SCORE: Record<string, number> = {
  optimal: 100,
  under: 50,
  over: 40,
  missing: 0,
};

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
  "by", "from", "is", "are", "was", "were", "be", "been", "have", "has", "had", "do",
  "does", "did", "will", "would", "could", "should", "may", "might", "can", "this",
  "that", "these", "those", "it", "its", "we", "you", "he", "she", "they", "i", "me",
  "my", "our", "your", "their", "what", "how", "when", "where", "who", "which", "not",
  "no", "so", "if", "as", "up", "out", "about", "into", "than", "then", "there", "also",
  "more", "all", "just", "get", "use", "make", "like", "very", "many", "some", "one",
  "two", "new", "good", "best", "well", "only", "such", "because", "much", "most",
  "other", "over", "while", "any", "each", "every", "after", "before", "between",
  "through", "under", "same", "own",
]);

const PASSIVE_RE = /\b(?:is|are|was|were|be|been|being)\s+\w+ed\b/i;

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
    count: number;
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

interface ParsedHtml {
  h1: string[];
  h2: string[];
  h3: string[];
  paragraphs: string[];
  linkCount: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function roundTo(value: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function splitSentences(text: string): string[] {
  return text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
}

// Improved Flesch syllable heuristic: drops silent -e / -es / -ed suffixes and
// counts vowel groups, with a floor of 1. Not perfect, but close to common
// implementations used by Yoast / readability-score libraries.
function countSyllables(word: string): number {
  const w = word.toLowerCase();
  if (w.length <= 3) return 1;
  const trimmed = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

// ---------------------------------------------------------------------------
// HTML parsing
// ---------------------------------------------------------------------------

// Block/flow-level tags whose boundaries must become whitespace when
// extracting plain text; otherwise DOMParser's textContent concatenates
// neighbouring blocks ("<p>A</p><p>B</p>" → "AB", one word instead of two),
// which under-counts words and makes the Content Length sub-score too low.
const _BLOCK_BOUNDARY_RE = /<\/(?:p|div|h[1-6]|li|tr|td|th|blockquote|section|article|header|footer|aside|nav|pre|figure|figcaption)>|<br\s*\/?>|<hr\s*\/?>/gi;

function stripHtml(html: string): string {
  const withBreaks = html.replace(_BLOCK_BOUNDARY_RE, (m) => m + " ");
  if (typeof window === "undefined") {
    return withBreaks.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const div = document.createElement("div");
  div.innerHTML = withBreaks;
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}

function parseHtml(html: string): ParsedHtml {
  if (typeof window === "undefined") {
    const get = (tag: string) =>
      Array.from(
        html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi")),
      ).map((m) => m[1].replace(/<[^>]+>/g, "").trim());
    const linkCount = (html.match(/<a\s[^>]*href=/gi) ?? []).length;
    return {
      h1: get("h1"),
      h2: get("h2"),
      h3: get("h3"),
      paragraphs: get("p"),
      linkCount,
    };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const textOf = (el: Element) => (el.textContent ?? "").trim();

  const anchors = Array.from(doc.querySelectorAll("a[href]"));
  const linkCount = anchors.filter((el) => {
    const raw = el.getAttribute("href")?.trim() ?? "";
    if (!raw) return false;
    if (raw.startsWith("#")) return false;
    if (/^(?:javascript|mailto|tel):/i.test(raw)) return false;
    return true;
  }).length;

  return {
    h1: Array.from(doc.querySelectorAll("h1")).map(textOf),
    h2: Array.from(doc.querySelectorAll("h2")).map(textOf),
    h3: Array.from(doc.querySelectorAll("h3")).map(textOf),
    paragraphs: Array.from(doc.querySelectorAll("p")).map(textOf),
    linkCount,
  };
}

// ---------------------------------------------------------------------------
// Analysis functions
// ---------------------------------------------------------------------------

function calcReadability(text: string) {
  const words = text.match(/\b[a-zA-Z]+\b/g) ?? [];
  const sentences = splitSentences(text);
  const wordCount = words.length;
  const sentenceCount = Math.max(1, sentences.length);

  if (wordCount === 0) {
    return { flesch: 0, grade: 0, sentenceCount: 0, wordCount: 0, avgWordsPerSentence: 0, status: "no_content" };
  }

  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const avgWordsPerSentence = wordCount / sentenceCount;
  const avgSyllablesPerWord = syllables / wordCount;

  const flesch = roundTo(
    clamp(206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord),
  );
  const grade = Math.max(
    0,
    roundTo(0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59),
  );
  const status = flesch >= 70 ? "easy" : flesch >= 50 ? "moderate" : "difficult";

  return {
    flesch,
    grade,
    sentenceCount,
    wordCount,
    avgWordsPerSentence: roundTo(avgWordsPerSentence),
    status,
  };
}

function calcKeywordDensity(plain: string, kw: string, wordCount: number) {
  if (!kw || wordCount === 0) {
    return { occurrences: 0, density: 0, status: "missing" };
  }
  const re = new RegExp(`\\b${escapeRegex(kw)}\\b`, "gi");
  const occurrences = (plain.match(re) ?? []).length;
  const density = roundTo((occurrences / wordCount) * 100);

  let status: string;
  if (occurrences === 0) status = "missing";
  else if (density < DENSITY_OPTIMAL_MIN) status = "under";
  else if (density > DENSITY_OPTIMAL_MAX) status = "over";
  else status = "optimal";

  return { occurrences, density, status };
}

function calcKeywordPlacement(
  h1: string[],
  h2: string[],
  paragraphs: string[],
  kw: string,
) {
  if (!kw) {
    return { in_h1: false, in_h2: false, in_first_paragraph: false, placement_score: 0 };
  }
  const contains = (s: string) => s.trim().toLowerCase().includes(kw);
  const in_h1 = h1.some(contains);
  const in_h2 = h2.some(contains);
  const in_first_paragraph = paragraphs.length > 0 ? contains(paragraphs[0]) : false;
  const placement_score =
    (in_h1 ? 40 : 0) + (in_h2 ? 35 : 0) + (in_first_paragraph ? 25 : 0);
  return { in_h1, in_h2, in_first_paragraph, placement_score };
}

function calcPassiveVoice(plain: string) {
  const sentences = splitSentences(plain);
  const total = sentences.length;
  if (total === 0) {
    return { passiveCount: 0, passivePct: 0, status: "good", score: 100 };
  }
  const passiveCount = sentences.filter((s) => PASSIVE_RE.test(s)).length;
  const passivePct = roundTo((passiveCount / total) * 100);
  const status = passivePct <= 10 ? "good" : passivePct <= 20 ? "moderate" : "high";
  const score = clamp(Math.round(100 - passivePct * 2));
  return { passiveCount, passivePct, status, score };
}

function calcStructure(
  h1: string[],
  h2: string[],
  h3: string[],
  paragraphs: string[],
) {
  const paraWordCounts = paragraphs.map((p) => countWords(p));
  const longParas = paraWordCounts.filter((c) => c > PARA_WORD_LIMIT).length;
  const avgParaWords = paraWordCounts.length
    ? roundTo(paraWordCounts.reduce((a, b) => a + b, 0) / paraWordCounts.length)
    : 0;

  const issues: string[] = [];
  if (h1.length === 0) issues.push("Missing H1 heading");
  if (h1.length > 1) issues.push(`Multiple H1 headings (${h1.length}) — use only one`);
  if (h2.length < MIN_H2_COUNT) issues.push(`Add at least ${MIN_H2_COUNT} H2 subheadings for structure`);
  if (longParas > 0) issues.push(`${longParas} paragraph(s) exceed ${PARA_WORD_LIMIT} words — break them up`);

  let score = 0;
  if (h1.length === 1) score += 30;
  else if (h1.length > 1) score += 10;
  score += Math.min(h2.length, 4) * 15;
  if (paragraphs.length > 0 && longParas === 0) score += 10;

  return {
    h1_count: h1.length,
    h2_count: h2.length,
    h3_count: h3.length,
    paragraph_count: paragraphs.length,
    avg_paragraph_words: avgParaWords,
    long_paragraphs: longParas,
    issues,
    score: clamp(score),
  };
}

function calcLinks(linkCount: number) {
  const score = linkCount === 0 ? 0 : clamp(40 + linkCount * 15);
  return { count: linkCount, score };
}

function calcLsi(plain: string, relatedKeywords: string, kw: string) {
  const related = relatedKeywords
    .split(/[\n,]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  const kwParts = new Set(kw.split(/\s+/).filter(Boolean));

  const tokens = ((plain + " " + related.join(" ")).toLowerCase().match(/\b[a-zA-Z]{4,}\b/g) ?? [])
    .filter((w) => !STOPWORDS.has(w) && !kwParts.has(w));

  const counts = tokens.reduce<Record<string, number>>((acc, w) => {
    acc[w] = (acc[w] ?? 0) + 1;
    return acc;
  }, {});

  const uniqueTerms = Object.keys(counts).length;
  const topTerms = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([term, count]) => ({ term, count }));

  const coverageScore = clamp(Math.round((uniqueTerms / LSI_UNIQUE_TERMS_TARGET) * 100));
  return { top_terms: topTerms, unique_terms: uniqueTerms, coverage_score: coverageScore };
}

function calcMeta(title: string, description: string, kw: string) {
  const titleLower = title.toLowerCase();
  const descLower = description.toLowerCase();
  const titleLen = title.length;
  const descLen = description.length;

  const keyword_in_title = kw ? titleLower.includes(kw) : false;
  const keyword_in_description = kw ? descLower.includes(kw) : false;
  const title_ok = titleLen >= TITLE_MIN && titleLen <= TITLE_MAX;
  const description_ok = descLen >= DESC_MIN && descLen <= DESC_MAX;

  let score = 0;
  if (titleLen > 0) score += 20;
  if (keyword_in_title) score += 30;
  if (descLen > 0) score += 20;
  if (keyword_in_description) score += 20;
  if (title_ok && description_ok) score += 10;
  else if (title_ok || description_ok) score += 5;

  return {
    keyword_in_title,
    keyword_in_description,
    title_length: titleLen,
    title_ok,
    description_length: descLen,
    description_ok,
    score,
  };
}

// Content-length band thresholds (percentage of target word count).
// Status transitions happen at these points, and the UI progress bar uses
// the same numbers so the colors match the status label one-to-one.
export const CONTENT_LENGTH_BANDS = {
  OPTIMAL: 100,   // at or over target
  NEAR: 80,       // close — small push needed
  UNDER: 50,      // noticeably short
} as const;

export type ContentLengthStatus = "short" | "under" | "near" | "optimal";

export function contentLengthStatus(percentage: number): ContentLengthStatus {
  if (percentage >= CONTENT_LENGTH_BANDS.OPTIMAL) return "optimal";
  if (percentage >= CONTENT_LENGTH_BANDS.NEAR) return "near";
  if (percentage >= CONTENT_LENGTH_BANDS.UNDER) return "under";
  return "short";
}

function calcContentLength(wordCount: number, target: number) {
  const safeTarget = target > 0 ? target : 1500;
  const safeWords = Math.max(0, wordCount);
  const percentage = clamp(Math.round((safeWords / safeTarget) * 100));
  const score = percentage;
  const status = contentLengthStatus(percentage);
  return { word_count: safeWords, target: safeTarget, percentage, score, status };
}

// ---------------------------------------------------------------------------
// Public entrypoint
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
  const parsed = parseHtml(html);
  const wordCount = countWords(plain);

  const readability = calcReadability(plain);
  const density = calcKeywordDensity(plain, kw, wordCount);
  const placement = calcKeywordPlacement(parsed.h1, parsed.h2, parsed.paragraphs, kw);
  const passive = calcPassiveVoice(plain);
  const structure = calcStructure(parsed.h1, parsed.h2, parsed.h3, parsed.paragraphs);
  const linkData = calcLinks(parsed.linkCount);
  const lsi = calcLsi(plain, relatedKeywords, kw);
  const meta = calcMeta(title, description, kw);
  const contentLength = calcContentLength(wordCount, targetWordCount);

  const densityScore = DENSITY_STATUS_SCORE[density.status] ?? 0;
  const keyword_score = Math.round(densityScore * 0.5 + placement.placement_score * 0.5);
  const readability_score = Math.round(readability.flesch * 0.7 + passive.score * 0.3);

  const overall = Math.round(
    keyword_score * SCORE_WEIGHTS.keyword +
    lsi.coverage_score * SCORE_WEIGHTS.coverage +
    readability_score * SCORE_WEIGHTS.readability +
    structure.score * SCORE_WEIGHTS.structure +
    linkData.score * SCORE_WEIGHTS.links +
    meta.score * SCORE_WEIGHTS.meta +
    contentLength.score * SCORE_WEIGHTS.length,
  );

  return {
    overall,
    keyword_score,
    coverage_score: lsi.coverage_score,
    readability_score,
    structure_score: structure.score,
    links_score: linkData.score,
    meta_score: meta.score,
    length_score: contentLength.score,
    meta_detail: meta,
    readability: {
      flesch_score: readability.flesch,
      grade_level: readability.grade,
      word_count: wordCount,
      sentence_count: readability.sentenceCount,
      avg_words_per_sentence: readability.avgWordsPerSentence,
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
      total_sentences: readability.sentenceCount,
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
      issues: structure.issues,
    },
  };
}
