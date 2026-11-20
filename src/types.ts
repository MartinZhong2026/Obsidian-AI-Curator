export type Verdict = 'read' | 'skim' | 'reference' | 'skip';
export type Completeness = 'full' | 'partial' | 'teaser';
export type ItemState = 'pending' | 'analyzing' | 'done' | 'skipped' | 'error';
export type ReadingStatus = 'unread' | 'read' | 'archived';

export interface Scores {
  relevance: number;
  depth: number;
  evidence: number;
  actionability: number;
  originality: number;
}

export interface Mention {
  name: string;
  kind: string;
  url: string;
}

/** What kind of content this is; decides what gets extracted and how the score is weighted. */
export type Form = 'tutorial' | 'explainer' | 'tool' | 'prompt' | 'code' | 'research' | 'analysis' | 'case-study'
  | 'resource-list' | 'news' | 'discussion' | 'other';

export type SkipReason = 'none' | 'off-topic' | 'hype' | 'no-substance' | 'outdated';
export type Basis = 'stated' | 'inferred';
export type Confidence = 'high' | 'medium' | 'low';

/** One unit of knowledge worth keeping: a concept, method, decision rule, finding, pitfall... */
export interface KnowledgeItem {
  kind: string;
  point: string;
  detail: string;
  /** Said by the author, or the model's own synthesis. */
  basis: Basis;
  /** Short verbatim excerpt supporting a stated point. */
  quote: string;
  /** The quote was found in the saved text (checked locally, not by the model). */
  quoteOk?: boolean;
}

/** Reusable material: a prompt, code, command, template, repository, tool, resource... */
export interface Asset {
  kind: string;
  name: string;
  purpose: string;
  url: string;
  usage: string;
  content: string;
  /** content is an exact copy of the saved text (located locally from the model's anchors). */
  verbatim: boolean;
}

export interface Evidence {
  claim: string;
  support: 'data' | 'example' | 'citation' | 'assertion';
  quote: string;
  quoteOk?: boolean;
}

export interface Argument {
  thesis: string;
  evidence: Evidence[];
  limitations: string[];
  /** Alternative readings or objections: always the model's own view. */
  counterpoints: string[];
}

/** Facts about a linked repository, fetched from the GitHub API (not from the model). */
export interface RepoFacts {
  url: string;
  name: string;
  description: string;
  stars: number;
  forks: number;
  language: string;
  license: string;
  pushedAt: string;
  archived: boolean;
  topics: string[];
  homepage: string;
  fetchedAt: string;
}

export interface Analysis {
  /** 2 = form-aware analysis (1.1+). Missing on analyses written by 1.0. */
  v?: number;
  title: string;
  form: Form;
  /** Legacy alias of form, kept so 1.0 notes, Bases views and filters keep working. */
  type: string;
  topic: string;
  tags: string[];
  tldr: string;
  summary: string;
  /** What the reader gets out of it, in one line. */
  payoff: string;
  knowledge: KnowledgeItem[];
  steps: string[];
  assets: Asset[];
  argument: Argument;
  applicability: string[];
  caveats: string[];
  open_questions: string[];
  actions: string[];
  relevance: string;
  mentions: Mention[];
  scores: Scores;
  verdict: Verdict;
  verdict_reason: string;
  skip_reason: SkipReason;
  completeness: Completeness;
  /** What is missing from the saved text ("" when complete). */
  missing: string;
  confidence: Confidence;
  /** Computed locally from scores and form, 0-100. */
  score: number;
  /** 1.0 fields, kept readable for old analyses. */
  key_ideas?: string[];
  how_to?: string[];
}

export interface Item {
  path: string;
  /** Hash of the cleaned body; used to detect meaningful changes. */
  hash: string;
  mtime: number;
  state: ItemState;
  addedAt: number;
  /** Discovered during a folder's first scan; waits for the user to approve backlog processing. */
  held?: boolean;
  status: ReadingStatus;
  title: string;
  url?: string;
  author?: string;
  published?: string;
  /** Meaningful character count of the note's own text. */
  chars: number;
  analysis?: Analysis;
  analyzedAt?: number;
  model?: string;
  error?: string;
  skipReason?: 'empty' | 'duplicate' | 'generated';
  attempts: number;
  /** Earliest time (ms) the next retry may run. */
  nextAttemptAt?: number;
  /** The source note changed meaningfully after it was analyzed. */
  stale?: boolean;
  /** Canonical source URL used for de-duplication. */
  canonical?: string;
  /** The file changed on disk; re-read it to see whether the text really changed. */
  needsCheck?: boolean;
  /** Added by the user from outside the watched folders. */
  manual?: boolean;
  /** Analyze even if it looks like a duplicate (user asked explicitly). */
  force?: boolean;
  notePath?: string;
  /** Where full text came from when the note itself was a teaser. */
  fullTextFrom?: string;
  /** Linked repositories, enriched from the GitHub API when fetching is allowed. */
  repos?: RepoFacts[];
  /** The full text is probably available but needs a setting: 'x' = turn on X expansion. */
  recoverable?: 'x' | 'web';
  dedupeOf?: string;
  tokens?: { input: number; output: number };
  cost?: number;
}

export interface Usage {
  month: string;
  items: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  /** False once any call was made with a model whose price is unknown. */
  costComplete: boolean;
  day: string;
  dayItems: number;
}

export interface IndexData {
  version: 1;
  items: Record<string, Item>;
  usage: Usage;
  /** Source folders that have completed their first scan (existing notes there are held as backlog). */
  seededFolders: string[];
  /** 2 = migrated to 1.1 (program-written notes detected, analyses upgraded). */
  libraryVersion?: number;
}
