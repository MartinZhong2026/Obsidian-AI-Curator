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

export interface Analysis {
  title: string;
  type: string;
  topic: string;
  tags: string[];
  tldr: string;
  summary: string;
  key_ideas: string[];
  how_to: string[];
  caveats: string[];
  actions: string[];
  relevance: string;
  mentions: Mention[];
  scores: Scores;
  verdict: Verdict;
  verdict_reason: string;
  completeness: Completeness;
  /** Computed locally from scores, 0-100. */
  score: number;
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
  skipReason?: 'empty' | 'duplicate';
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
}
