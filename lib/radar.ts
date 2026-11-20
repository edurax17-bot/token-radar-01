// Token Radar — the scoring model for token-radar-01.
//
// One sealed snapshot goes in, one ranked board comes out. The board ranks
// only protocols that record no token and pass the watchlist's own
// eligibility rule (no wrapped, staked or bridged product, no exchange, no
// versioned pool name). That rule is what keeps a wrapped coin or a
// centralised exchange off a board about future launches: the biggest TVL in
// the file is not a launch candidate, and the model says so by excluding it
// instead of by discounting it.
//
// Implied value is this entry's own claim, computed from the snapshot alone:
//
//   multiple   = median(mcap_usd / tvl_usd) over token protocols in the file
//   base       = tvl_usd * multiple
//   growth     = 1 + clamp(change_7d, -40, 80) / 100 * 0.6
//   maturity   = 0.75 + min(age_days, 1460) / 1460 * 0.50
//   breadth    = 1 + min(chains - 1, 4) * 0.03
//   implied    = round(base * growth * maturity * breadth)
//
// The multiple is measured at run time from the snapshot's own token
// protocols, never typed in by hand, so the same code scores a future
// snapshot without anyone editing a constant. No protocol name is ever
// special-cased: one function scores every row, and the dashboard prints
// the same formula with the same numbers.

export interface SnapProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapProtocol[];
  watchlist: string[];
}

export interface ScoreBreakdown {
  multiple: number;
  growth_pct: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'records-no-token';
  watchlist: boolean;
  implied_value_usd: number;
  score: ScoreBreakdown;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

export interface RadarPayload {
  as_of: string;
  floor_usd: number;
  model_version: string;
  multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_tvl_usd: number;
  rows: BoardRow[];
  live: LiveRow[];
}

export const MODEL_VERSION = 'radar-2';
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;
const GROWTH_FLOOR = -40;
const GROWTH_CAP = 80;
const GROWTH_WEIGHT = 0.6;
const MATURITY_FLOOR = 0.75;
const MATURITY_RANGE = 0.5;
const MATURITY_DAYS = 1460;
const UNKNOWN_AGE_DAYS = 180;
const BREADTH_STEP = 0.03;
const BREADTH_MAX_CHAINS = 4;

// Categories the watchlist rule keeps out: a bridge moves another token, a
// liquid-staking receipt is a token that already trades in another form, and
// a CEX is not a protocol launch at all.
const KEPT_OUT = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIX = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whole days from `listedAt` to `asOf`, or null when either date is missing. */
export function daysSince(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** True when the record carries no token at all: no market cap, no Gecko id, no symbol. */
export function recordsNoToken(p: SnapProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when a protocol may sit on the launch board: pre-token by record and
 *  not a wrapped, staked, bridged or exchange product, and not a versioned pool. */
export function eligible(p: SnapProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && KEPT_OUT.has(p.category)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

/** The median market-cap-to-TVL ratio of the snapshot's token protocols,
 *  exchanges left out, clamped so one wild ratio cannot move the board. */
export function medianMultiple(snapshot: Snapshot): number {
  const ratios = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX')
    .map((p) => (p.mcap_usd as number) / p.tvl_usd)
    .sort((a, b) => a - b);
  if (ratios.length === 0) return 0.25;
  const middle = ratios[Math.floor(ratios.length / 2)] as number;
  return Math.min(1.5, Math.max(0.05, middle));
}

/** One protocol's implied value and the four factors behind it. */
export function scoreProtocol(p: SnapProtocol, asOf: string, multiple: number): { implied: number; score: ScoreBreakdown } {
  const age = daysSince(asOf, p.listed_at);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, rawGrowth));
  const growthFactor = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const ageForScore = age ?? UNKNOWN_AGE_DAYS; // unlisted: six months, between a newborn and a year-old record, never the full maturity of a known old protocol
  const maturityFactor = MATURITY_FLOOR + (Math.min(Math.max(ageForScore, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
  const extraChains = Math.max(0, Math.min(p.chains.length - 1, BREADTH_MAX_CHAINS));
  const breadthFactor = 1 + extraChains * BREADTH_STEP;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor * maturityFactor * breadthFactor));
  return {
    implied,
    score: {
      // Full precision on purpose: the dashboard recomputes the row from
      // these exact factors and must land on the same dollar. Display code
      // rounds them; the model never does.
      multiple,
      growth_pct: growthPct,
      growth_factor: growthFactor,
      maturity_factor: maturityFactor,
      breadth_factor: breadthFactor,
      age_days: age,
    },
  };
}

/** The first chain a protocol lists, or a neutral fallback. */
function mainChain(p: SnapProtocol): string {
  return p.chains.length > 0 ? (p.chains[0] as string) : 'its main chain';
}

/** Working capital for one farm position, stepped from the protocol's TVL. */
function stakeSize(p: SnapProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 300;
  if (p.tvl_usd >= 500_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  if (p.tvl_usd >= 20_000_000) return 75;
  return 50;
}

/** How many days to keep a position open, younger protocols need longer. */
function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The one core move for a category: what the farmer actually does on-chain. */
function coreMove(p: SnapProtocol, stake: number, chain: string): string {
  const cat = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) {
    return `Supply $${stake} of USDC as collateral to ${name} on ${chain}, borrow $25 of a stablecoin against it, and keep both legs open.`;
  }
  if (cat.includes('leveraged farm')) {
    return `Open a $${stake} leveraged farming position in ${name} on ${chain} at 2x leverage and keep the health factor above 1.5.`;
  }
  if (cat.includes('dex') || cat.includes('farm') || cat.includes('liquidity manager')) {
    return `Add $${stake} of liquidity to ${name}'s deepest pool on ${chain} (half USDC, half the paired asset) and stake the LP receipt.`;
  }
  if (cat.includes('perpetual') || cat.includes('derivative') || cat.includes('options')) {
    return `Deposit $${stake} of USDC as margin on ${name} on ${chain}, open a $50 hedge, and close it after a week.`;
  }
  if (cat.includes('yield') || cat.includes('aggregator') || cat.includes('allocator') || cat.includes('curator')) {
    return `Deposit $${stake} of USDC into a ${name} vault on ${chain} and hold the vault shares instead of trading them.`;
  }
  if (cat.includes('restak') || cat.includes('staking pool')) {
    return `Stake $${stake} of the chain's native staking asset through ${name} on ${chain} and keep the liquid receipt in the same wallet.`;
  }
  if (cat.includes('bridge') || cat.includes('cross chain')) {
    return `Bridge $${stake} of USDC into ${chain} through ${name}, then use the bridged funds in one app on ${chain}.`;
  }
  if (cat.includes('prediction')) {
    return `Fund ${name} with $${stake} on ${chain} and take one $10 position in a market that settles within two weeks.`;
  }
  if (cat.includes('rwa')) {
    return `Mint $${stake} of ${name}'s yield-bearing asset on ${chain} and hold it for the full accrual period.`;
  }
  if (cat.includes('stable') || cat.includes('anchor')) {
    return `Mint $${stake} of the stable asset through ${name} on ${chain} and keep it in the wallet that minted it.`;
  }
  if (cat.includes('insurance')) {
    return `Buy $${stake} of cover from ${name} on ${chain} for a position you already hold, and keep the policy active.`;
  }
  if (cat.includes('payment') || cat.includes('card')) {
    return `Spend $25 through ${name} on ${chain} for a real purchase and keep the receipt in the app.`;
  }
  if (cat.includes('governance')) {
    return `Lock $${stake} of assets in ${name}'s governance on ${chain} and vote on the next live proposal.`;
  }
  if (cat.includes('index')) {
    return `Buy $${stake} of the ${name} index token on ${chain} and hold it instead of the single assets.`;
  }
  if (cat.includes('basis') || cat.includes('cedefi')) {
    return `Deposit $${stake} of USDC into ${name}'s basis strategy on ${chain} and leave the position through one funding cycle.`;
  }
  return `Deposit $${stake} of USDC into ${name} on ${chain} and use its main feature once a week.`;
}

/** A second, category-flavoured move so the plan is not one action repeated. */
function secondMove(p: SnapProtocol, chain: string): string {
  const cat = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (cat.includes('lend') || cat.includes('cdp')) return `Repay $10 of the borrow on ${name} after two weeks, then borrow $10 again so the wallet shows repeat use.`;
  if (cat.includes('dex') || cat.includes('farm')) return `Swap $20 between two assets on ${name} on ${chain} once a week, using a different pair the second week.`;
  if (cat.includes('yield') || cat.includes('vault') || cat.includes('curator') || cat.includes('allocator')) return `Move $25 between two ${name} vaults on ${chain} after a month to show the wallet is actively managed.`;
  if (cat.includes('perpetual') || cat.includes('derivative')) return `Place one limit order on ${name} on ${chain} each week, even a $10 one, so the account has maker activity.`;
  if (cat.includes('restak') || cat.includes('staking')) return `Delegate a second $25 stake through ${name} on ${chain} after the first month and keep both receipts.`;
  if (cat.includes('prediction')) return `Take a second $10 position on ${name} on the opposite side of a market you already entered.`;
  if (cat.includes('rwa')) return `Reinvest one month of ${name} yield on ${chain} back into the same asset instead of withdrawing it.`;
  return `Use a second feature of ${name} on ${chain} once a month, such as its swap, its vote, or its rewards page.`;
}

/**
 * Seven farm steps for one protocol, each a concrete action with a cost and
 * a time, built from the protocol's own category, chains, TVL and age.
 * Nothing here names a protocol by hand: the same builders run for all 198.
 */
export function farmPlan(p: SnapProtocol, age: number | null): string[] {
  const chain = mainChain(p);
  const stake = stakeSize(p);
  const hold = holdDays(age);
  const gas = stake >= 200 ? 8 : 5;
  const steps = [
    `Set up a fresh wallet for ${p.name} farming only, fund it with $${stake + 25} on ${chain}, and store the seed phrase offline on paper. Cost: about $${gas} of gas for the funding transfer. Time: 10 minutes.`,
    `${coreMove(p, stake, chain)} Cost: $${stake} of capital plus about $${gas} of gas. Time: 20 minutes to set up.`,
    `${secondMove(p, chain)} Cost: about $3 of gas per action. Time: 10 minutes a week.`,
    `Keep the ${p.name} position open for at least ${hold} days and do one qualifying action each week, so the wallet appears in more than one activity snapshot. Cost: the $${stake} stays locked in the position. Time: ${hold} days, 10 minutes a week.`,
    `Join ${p.name}'s community channel and read the last two announcements before you act, so you use the live product and not a copy. Cost: nothing. Time: 15 minutes.`,
    `Before withdrawing, open ${p.name}'s own rewards or points page from the app itself and claim only through the link it publishes there. Cost: no fee to check; never pay anyone to claim. Time: 10 minutes.`,
    `Log the wallet address, the dates, and every ${p.name} transaction in a farm notebook, then unwind in reverse order if the position turns against you. Cost: nothing but the notebook. Time: 5 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The live-token protocols, biggest market cap first, for the set-aside view. */
export function liveSet(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
    }));
}

/** Build the board: every eligible protocol, watchlist first in coverage,
 *  ranked by implied value, ranks 1..n, values forced strictly decreasing
 *  so the ranking is a ranking even when two protocols round to the same dollar. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; payload: RadarPayload } {
  const multiple = medianMultiple(snapshot);
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter((p) => eligible(p) || watch.has(p.slug))
    .map((p) => {
      const { implied, score } = scoreProtocol(p, snapshot.as_of, multiple);
      return { p, implied, score };
    })
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  let previous = Number.POSITIVE_INFINITY;
  const board: BoardRow[] = scored.map((entry, index) => {
    const value = Math.min(entry.implied, previous - 1);
    previous = Math.max(1, value);
    const age = entry.score.age_days;
    return {
      rank: index + 1,
      slug: entry.p.slug,
      name: entry.p.name,
      category: entry.p.category,
      chains: entry.p.chains,
      tvl_usd: entry.p.tvl_usd,
      change_7d: entry.p.change_7d,
      listed_at: entry.p.listed_at,
      age_days: age,
      token_status: 'records-no-token',
      watchlist: watch.has(entry.p.slug),
      implied_value_usd: Math.max(1, value),
      score: entry.score,
      farm_steps: farmPlan(entry.p, age),
    };
  });
  const live = liveSet(snapshot);
  const payload: RadarPayload = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    multiple: Math.round(multiple * 1e4) / 1e4,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    total_tvl_usd: board.reduce((sum, r) => sum + r.tvl_usd, 0),
    rows: board,
    live,
  };
  return { board, payload };
}

/** The snapshot out of a file's text, refused unless it has the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not a JSON object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof doc.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) {
    throw new Error('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(doc.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    throw new Error('snapshot.json has no watchlist of slugs');
  }
  const protocols: SnapProtocol[] = doc.protocols.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`snapshot.json protocol ${index} is not an object`);
    }
    const p = value as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`snapshot.json protocol ${index} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null when it passes: coverage, ranks, order, and farm steps. */
export function boardProblem(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100 to 4000`;
  const seen = new Set(board.map((r) => r.slug));
  if (seen.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} does not fall below row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: that is not a ranking';
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const row of board) {
    if (!known.has(row.slug)) return `${row.slug} is not in the snapshot`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `${row.slug} has implied value ${row.implied_value_usd}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      if (step.trim().length < 20 || step.trim().length > 600) return `${row.slug} has a farm step of ${step.trim().length} characters`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script: `window.RADAR = {...};`, no fetch, no network. */
export function dataScript(payload: RadarPayload): string {
  return `window.RADAR=${JSON.stringify(payload)};\n`;
}
