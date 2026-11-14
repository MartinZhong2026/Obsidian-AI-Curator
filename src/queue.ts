// Pure scheduling and budget policy. No Obsidian imports: unit-tested in Node.
import type { IndexData, Item, Usage } from './types.ts';

export const MAX_ATTEMPTS = 4;
export const OUTPUT_TOKENS = 4000;

function pad(n: number) { return String(n).padStart(2, '0'); }

/** Local calendar keys: budgets follow the user's own day and month. */
export function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function monthKey(now: number): string { return dayKey(now).slice(0, 7); }

export function emptyUsage(now: number): Usage {
  return { month: monthKey(now), items: 0, inputTokens: 0, outputTokens: 0, cost: 0, costComplete: true, day: dayKey(now), dayItems: 0 };
}

export function emptyIndex(now: number): IndexData {
  return { version: 1, items: {}, usage: emptyUsage(now), seededFolders: [] };
}

export function rollUsage(usage: Usage | undefined, now: number): Usage {
  if (!usage) return emptyUsage(now);
  let u = usage;
  if (u.month !== monthKey(now)) u = emptyUsage(now);
  if (u.day !== dayKey(now)) u = { ...u, day: dayKey(now), dayItems: 0 };
  return u;
}

export function recordUsage(usage: Usage, now: number, input: number, output: number, cost: number | null): Usage {
  const u = rollUsage(usage, now);
  return {
    ...u,
    items: u.items + 1,
    dayItems: u.dayItems + 1,
    inputTokens: u.inputTokens + input,
    outputTokens: u.outputTokens + output,
    cost: u.cost + (cost ?? 0),
    costComplete: u.costComplete && cost !== null,
  };
}

export interface Limits { monthlyBudget: number; dailyLimit: number }

export type BudgetBlock = { blocked: false } | { blocked: true; reason: 'daily' | 'monthly' };

/**
 * Checked before every paid call. `nextCost` is a conservative estimate for the next item
 * so that a single call cannot jump far past the monthly cap.
 */
export function budgetCheck(usage: Usage, now: number, limits: Limits, nextCost: number | null): BudgetBlock {
  const u = rollUsage(usage, now);
  if (u.dayItems >= limits.dailyLimit) return { blocked: true, reason: 'daily' };
  if (limits.monthlyBudget > 0 && (u.cost >= limits.monthlyBudget || u.cost + (nextCost ?? 0) > limits.monthlyBudget)) return { blocked: true, reason: 'monthly' };
  return { blocked: false };
}

export function backoffMs(attempts: number): number {
  return Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

/** Items ready for analysis, newest saves first: what you just saved is what you want triaged. */
export function readyItems(items: Iterable<Item>, now: number): Item[] {
  const out: Item[] = [];
  for (const item of items) {
    if (item.state !== 'pending' || item.held) continue;
    if ((item.nextAttemptAt ?? 0) > now) continue;
    out.push(item);
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export interface QueueCounts {
  total: number; done: number; pending: number; held: number; errors: number; skipped: number; analyzing: number;
  read: number; skim: number; reference: number; skip: number; unread: number; stale: number;
}

export function counts(items: Iterable<Item>): QueueCounts {
  const c: QueueCounts = { total: 0, done: 0, pending: 0, held: 0, errors: 0, skipped: 0, analyzing: 0, read: 0, skim: 0, reference: 0, skip: 0, unread: 0, stale: 0 };
  for (const i of items) {
    c.total++;
    if (i.state === 'pending') { if (i.held) c.held++; else c.pending++; }
    else if (i.state === 'analyzing') c.analyzing++;
    else if (i.state === 'error') c.errors++;
    else if (i.state === 'skipped') c.skipped++;
    else if (i.state === 'done') {
      c.done++;
      if (i.analysis) c[i.analysis.verdict]++;
      if (i.status === 'unread' && i.analysis && i.analysis.verdict !== 'skip') c.unread++;
      if (i.stale) c.stale++;
    }
  }
  return c;
}

/** Rough cost of analyzing `chars` characters, for the backlog estimate shown before the user approves it. */
export function estimateItemCost(inputTokens: number, price: { input: number; output: number } | null, outputTokens = OUTPUT_TOKENS): number | null {
  if (!price) return null;
  const promptOverhead = 1500;
  return ((inputTokens + promptOverhead) * price.input + outputTokens * price.output) / 1_000_000;
}

/** Sort for the reading list: unread "read" picks first, then by score. */
export function readingOrder(a: Item, b: Item): number {
  const rank = (i: Item) => {
    const v = i.analysis?.verdict;
    return (i.status === 'unread' ? 0 : 10) + (v === 'read' ? 0 : v === 'reference' ? 1 : v === 'skim' ? 2 : 3);
  };
  return rank(a) - rank(b) || (b.analysis?.score ?? 0) - (a.analysis?.score ?? 0) || (b.analyzedAt ?? 0) - (a.analyzedAt ?? 0);
}
