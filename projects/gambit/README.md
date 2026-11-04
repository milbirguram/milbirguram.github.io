# Gambit

## What it is for

Play Crazyhouse chess against a small local engine or another person on the same device. Captures become reserves: on your turn, move normally or place one reserve piece on an empty square. The board and reserves lead the interface; rules, computer analysis and FEN tools are optional disclosures.

## Rules and implementation

The game follows the Lichess Crazyhouse rules: pawn drops are allowed only on ranks 2–7; drops may block check or give mate; captured promoted pieces return as pawns. Normal movement, promotion, castling and en passant remain. Stalemate and automatic threefold repetition draw. Fifty-move and conventional insufficient-material draws are disabled, matching the reference variant. Dropped rooks do not restore castling rights. This is local play without clocks or online matchmaking.

`model.js` is original, buildless JavaScript shared with a dedicated Web Worker. The 0x88 board now tracks both players’ reserves and promoted squares. Crazyhouse FEN uses brackets for reserves and `~` for promoted pieces; repetition keys and undo include both. SAN/UCI drops use `N@f7` (also `@e4` for a pawn). Ordinary FEN still supports standard chess internally, so the original legal-move tests remain useful; the interface loads it into Crazyhouse with empty reserves.

The engine uses iterative deepening, negamax alpha–beta, capture ordering, killer moves and bounded quiescence with checking drops. Evaluation includes board material, reserve material and piece placement. If the budget expires before depth one completes, the best completed root result is retained and labelled partial; a legal fallback is used if no root finishes. This is a casual opponent with no measured playing rating. Search runs in a worker and is cancelled on restart, undo, mode changes or page hiding.

## Validation

Run both with Node 18 or newer:

```
node projects/gambit/tests/run-all.js
node projects/gambit/tests/crazyhouse.test.js
```

The original suite verifies published standard-chess perft counts, castling, en passant, promotions, draw rules, ten independently checked mating puzzles and legal search replies across 1,000 seeded positions. The Crazyhouse suite adds 11 groups: exact drop counts, reserve captures and undo, sliding/knight/double checks, drop mate, reserve-aware stalemate, promoted-piece reversion, en passant, dropped-pawn double moves, castling rights, repetition identity, invalid positions, mating search, and 120 seeded positions with constant piece counts and FEN round-trips.

`tests/browser.html` runs the actual worker on a reserve position and measures main-thread responsiveness. `tests/browser-results.json` records the current run. Browser checks also exercise capture, drop, undo, computer replies, and the two-player selector. The gallery uses legal captured/drop positions in `preview.js`, pauses when inactive, respects reduced motion and starts no worker.

SVG pieces are original simple silhouettes. Fonts are self-hosted Libre Baskerville and Inconsolata, under SIL OFL; pinned source metadata and licences are in `fonts/`. Standalone project repositories expect the shared `../kit.css` and `../kit.js` supplied by the portfolio; to preview one alone, place it under a `projects/` folder alongside those files.

## Sources

- [Lichess Crazyhouse rules](https://lichess.org/variant/crazyhouse) and [variant reference implementation](https://github.com/lichess-org/scalachess/blob/master/core/src/main/scala/variant/Crazyhouse.scala).
- [Chess.com Crazyhouse](https://support.chess.com/en/articles/8614995-what-is-crazyhouse) — established variant and drop rules.

- [Chess Programming Wiki: Perft Results](https://www.chessprogramming.org/Perft_Results) — exact legal-move counts and FENs.
- [FIDE Laws of Chess](https://handbook.fide.com/chapter/E012023) — legal moves, checkmate and draw rules.
- [Alpha–beta](https://www.chessprogramming.org/Alpha-Beta), [Quiescence Search](https://www.chessprogramming.org/Quiescence_Search), [MVV-LVA](https://www.chessprogramming.org/MVV-LVA), [Killer Heuristic](https://www.chessprogramming.org/Killer_Heuristic) — algorithm descriptions.
- [Simplified Evaluation Function](https://www.chessprogramming.org/Simplified_Evaluation_Function) — background on material and placement; no source code or tables copied.
