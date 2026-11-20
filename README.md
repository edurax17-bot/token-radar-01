# Token Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/edurax17-bot/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/edurax17-bot/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar: it ranks 197 protocols that record no token by their
implied value, and shows how to farm each one. The board is built from a
sealed DefiLlama snapshot, so every number on it can be traced back to that
snapshot — no hand-picked list of names, no outside data.

Try make.fun bounties yourself: https://make.fun/r/1c6jcmp6

## What it does

`main.ts` (Node 22, standard library only) reads the sealed snapshot at
`/input/snapshot.json` and writes, into the output directory:

- `board.json` — 197 ranked rows. Every row is a protocol that records no
  token: all 40 of the snapshot's watchlist, plus 157 eligible protocols
  below the watchlist floor. Each row carries its rank, its implied value in
  dollars, and a 7-step farm plan with concrete costs and durations.
- `data.js` + `dashboard/` — a static page that renders with no network:
  a sortable board, filters (search, category, chain, minimum TVL,
  watchlist only), a detail view for every protocol with a breakdown of its
  value, and a methodology panel. Protocols whose token already trades are
  kept out of the board and shown separately, as the live-token reference
  the value model is measured against.
- `dossier.json` — the judge's dossier, built with `buildDossier` from
  `vendor/makefun-board.ts`.

## The value model

The implied value is this entry's own claim, never make.fun's, and it is
computed from the snapshot's own figures at run time:

- **Base multiple** — the median market-cap-to-TVL ratio of the protocols in
  the snapshot whose token already trades, computed when the program runs
  (0.246x on this snapshot). A protocol's TVL times that multiple is the
  starting point for what its launch could be worth.
- **Growth** — the protocol's 7-day TVL change, clamped, moves the value up
  or down; a protocol with no reported change is treated as neutral.
- **Maturity** — how long the protocol has run since DefiLlama first listed
  it, with no token recorded: longer-running protocols score higher, up to a
  cap, and an unknown listing date counts as 180 days.
- **Breadth** — a small bonus per extra chain the protocol runs on, capped.

The page recomputes every row from those same factors and shows the same
number `board.json` carries, so the screenshots, the code, and the board
agree with each other.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ~/workspace/makefun/kits/token-radar-01-kit/input/snapshot.json
```

Run it twice and the outputs are byte-identical: the program is fully
deterministic. Open `out/dashboard/index.html` in a browser to use the
radar; the three screenshots in `screenshots/` are renders of that page
(the board, a protocol's detail view, and a filtered view).

## A note on wording

The snapshot is DefiLlama's record, not proof: a protocol on the board
records no token in that record, which is not the same as having none. This
entry says "records no token" throughout, and never claims a protocol has
no token.
