// Unit tests for the ladder ranking core in Ladder.gs. Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "Ladder.gs"), "utf8"), ctx);
const { computeLadder, getRegulationInnings, inningsToOuts, getDefaultLadderSystem } = ctx;

// g("A 5-3 B") => home A scored 5, away B scored 3.
// Optional innings batted: "A 5-3 B 8" (both teams) or "A 5-3 B 5/6" (home 5, away 6).
// Suffix " NR" marks an abandoned game with no official result.
const g = (s) => {
  const m = s.match(/^(\S+) (\d+)-(\d+) (\S+)(?: ([\d.]+)(?:\/([\d.]+))?)?( NR)?$/);
  const homeInn = m[5] ? +m[5] : "";
  const awayInn = m[6] ? +m[6] : homeInn;
  return { home: m[1], hr: +m[2], ar: +m[3], away: m[4], homeInn, awayInn, noResult: !!m[7] };
};
// Results come from a vm context, so copy them into this realm before deepEqual
const plain = (v) => JSON.parse(JSON.stringify(v));
const order = (res) => plain(res.rows.map((r) => r.team));
const row = (res, t) => plain(res.rows.find((r) => r.team === t));

test("regulation innings: 6 for LL, 7 otherwise", () => {
  assert.equal(getRegulationInnings("LL"), 6);
  for (const d of ["IL", "JL", "SL", "AYC U16", "AYC U18", "AWC", "AYWC"])
    assert.equal(getRegulationInnings(d), 7);
});

test("points: win 2, draw 1, loss 0; stats accumulate", () => {
  const res = computeLadder(["A", "B", "C"], [g("A 5-3 B"), g("B 2-2 C"), g("C 1-4 A")], 6);
  // B and C level on 1 pt, drew with each other -> RA ratio: C allowed 6, B allowed 7
  assert.deepEqual(order(res), ["A", "C", "B"]);
  assert.deepEqual(
    row(res, "A"),
    { pos: 1, team: "A", gp: 2, w: 2, l: 0, d: 0, pts: 4, rs: 9, ra: 4, defOuts: 36, batOuts: 36,
      pct: 100, raRate: 4 / 12, tqb: 9 / 12 - 4 / 12, note: "", unresolved: false }
  );
  assert.equal(row(res, "B").pts, 1);
  assert.equal(row(res, "C").pts, 1);
});

test("rule book example: tied team that beat the others advances on head-to-head", () => {
  // A and C both 2-1; A beat C.
  const games = [g("A 3-1 B"), g("A 4-2 C"), g("D 5-0 A"), g("B 6-1 D"), g("C 2-1 D"), g("C 1-0 B")];
  const res = computeLadder(["A", "B", "C", "D"], games, 6);
  assert.equal(row(res, "A").pts, 4);
  assert.equal(row(res, "C").pts, 4);
  assert.deepEqual(order(res).slice(0, 2), ["A", "C"]);
  assert.equal(row(res, "A").note, "Head-to-head");
});

test("three-way tie, one team sweeps -> it advances, remaining two restart at head-to-head", () => {
  // A beat B and C; B beat C. D makes the records level: A, B, C all on 4 pts.
  const games = [
    g("A 2-1 B"), g("A 2-1 C"), g("B 2-1 C"),
    g("D 9-0 A"),                  // A: W W L = 4 pts
    g("B 1-0 D"),                  // B: L W W = 4 pts
    g("C 1-0 D"), g("C 3-0 D"),    // C: L L W W = 4 pts
  ];
  const res = computeLadder(["A", "B", "C", "D"], games, 6);
  const tied = order(res).filter((t) => ["A", "B", "C"].includes(t));
  assert.deepEqual(tied, ["A", "B", "C"]);
  assert.equal(row(res, "A").note, "Head-to-head");
  assert.equal(row(res, "B").note, "Head-to-head");
});

test("circular head-to-head -> runs-allowed ratio decides all places", () => {
  // A beat B, B beat C, C beat A. All 1-1.
  const games = [g("A 3-2 B"), g("B 5-1 C"), g("C 4-0 A")];
  // RA: A allowed 2+4=6, B allowed 3+1=4, C allowed 5+0=5 (12 inn each)
  const res = computeLadder(["A", "B", "C"], games, 6);
  assert.deepEqual(order(res), ["B", "C", "A"]);
  assert.ok(res.rows.every((r) => r.note === "Runs-allowed ratio"));
});

test("separate points levels are tiebroken independently", () => {
  // B, C on 4 pts (B beat C); A, D on 2 pts (D beat A)
  const games = [g("A 1-0 B"), g("B 1-0 C"), g("C 1-0 D"), g("D 1-0 A"), g("B 1-0 D"), g("C 10-0 A")];
  const res = computeLadder(["A", "B", "C", "D"], games, 6);
  assert.deepEqual(order(res), ["B", "C", "D", "A"]);
});

test("identical cycle with identical runs -> every team flagged unresolved", () => {
  const res = computeLadder(["X", "Y", "Z"], [g("X 2-1 Y"), g("Y 2-1 Z"), g("Z 2-1 X")], 6);
  assert.ok(res.rows.every((r) => r.unresolved));
});

test("head-to-head requires an equal number of games against each tied team", () => {
  // A beat B twice and C once (unequal) -> head-to-head cannot be used
  const games = [
    g("A 1-0 B"), g("A 1-0 B"), g("A 1-0 C"), g("D 9-0 A"), g("D 9-0 A"),
    g("B 3-0 D"), g("B 3-0 D"), g("B 3-0 E"),
    g("C 1-0 D"), g("C 1-0 E"), g("C 1-0 E"), g("E 1-0 C"),
  ];
  const res = computeLadder(["A", "B", "C", "D", "E"], games, 6);
  for (const t of ["A", "B", "C"]) assert.equal(row(res, t).pts, 6, t);
  assert.equal(row(res, "A").note, "Runs-allowed ratio");
});

test("a draw between tied teams blocks head-to-head", () => {
  // A and B both 1-0-1 (draw with each other, each beat C)
  const games = [g("A 2-2 B"), g("A 5-0 C"), g("B 1-0 C")];
  // A RA = 2+0 = 2, B RA = 2+0 = 2 -> level on RA; H2H among them: draw -> no; RA among: 2 vs 2 -> unresolved
  const res = computeLadder(["A", "B", "C"], games, 6);
  assert.ok(row(res, "A").unresolved);
  assert.ok(row(res, "B").unresolved);
  assert.equal(row(res, "C").pos, 3);
  assert.equal(row(res, "C").unresolved, false);
});

test("RA ratio uses 6 innings per LL game and more for extra innings (rule book: 8 runs / 24 = .3333)", () => {
  const games = [g("A 0-2 X"), g("A 0-2 Y"), g("A 0-2 Z"), g("A 0-2 W")];
  const res = computeLadder(["A", "X", "Y", "Z", "W"], games, 6);
  assert.equal(row(res, "A").ra, 8);
  assert.equal(row(res, "A").defOuts, 24 * 3);
  assert.equal(row(res, "A").raRate.toFixed(4), "0.3333");

  const extra = computeLadder(["A", "B"], [g("A 3-2 B 8")], 6);
  assert.equal(row(extra, "A").defOuts, 8 * 3);
  // Shortened games still count as regulation under LL
  const short = computeLadder(["A", "B"], [g("A 12-0 B 4")], 7);
  assert.equal(row(short, "A").defOuts, 7 * 3);
});

test("level on all-games RA -> head-to-head among those teams", () => {
  // A, B, C cycle; E beats all. A and B level on RA (8), C worse (12); A beat B.
  const games = [g("A 2-1 B"), g("B 2-1 C"), g("C 2-1 A"), g("E 5-0 A"), g("E 5-0 B"), g("E 9-0 C")];
  const res = computeLadder(["A", "B", "C", "E"], games, 6);
  assert.deepEqual(order(res), ["E", "A", "B", "C"]);
  assert.equal(row(res, "A").note, "Head-to-head (level on RA ratio)");
});

test("draw between teams level on RA, same games among them -> unresolved", () => {
  // A and B: 3 pts each, both allowed 7 runs in 18 innings, drew with each other 2-2
  const games = [g("A 2-2 B"), g("A 1-0 C"), g("B 4-3 C"), g("C 5-3 A"), g("C 2-1 B")];
  const res = computeLadder(["A", "B", "C"], games, 6);
  assert.ok(row(res, "A").unresolved && row(res, "B").unresolved);
});

test("level on RA with cyclic head-to-head -> RA among tied teams advances ONE, rest revert", () => {
  // A, B, C, D all on 3 pts. A, B, C allowed 5 runs (24 inn); D allowed 6 -> D last.
  // Among A, B, C head-to-head is a cycle. RA in games between them: A 5, B 1, C 3 -> B advances.
  // A and C revert to all-games RA (still level) -> C beat A head-to-head.
  const games = [
    g("A 1-0 B"), g("B 3-0 C"), g("C 5-0 A"),
    g("A 0-0 D"), g("B 4-4 D"), g("C 2-2 D"),
  ];
  const res = computeLadder(["A", "B", "C", "D"], games, 6);
  assert.deepEqual(order(res), ["B", "C", "A", "D"]);
  assert.equal(row(res, "B").note, "RA ratio (games between tied teams)");
  assert.equal(row(res, "C").note, "Head-to-head (level on RA ratio)");
  assert.equal(row(res, "D").note, "Runs-allowed ratio");
});

test("no games yet: entry order, no unresolved flags", () => {
  const res = computeLadder(["A", "B", "C"], [], 6);
  assert.deepEqual(order(res), ["A", "B", "C"]);
  assert.ok(res.rows.every((r) => !r.unresolved && r.note === "No games played yet"));
});

test("invalid rows are ignored: unknown team, same team", () => {
  const res = computeLadder(["A", "B"], [g("A 1-0 Z"), g("A 1-0 A"), g("A 1-0 B")], 6);
  assert.equal(res.counted, 1);
  assert.equal(row(res, "A").gp, 1);
});

test("LL: a game with no official result is excluded", () => {
  const res = computeLadder(["A", "B"], [g("A 5-0 B NR"), g("B 2-1 A")], 6);
  assert.equal(res.excluded, 1);
  assert.equal(row(res, "A").gp, 1);
  assert.equal(order(res)[0], "B");
});

// ── Points % rule set ────────────────────────────────────────────────────────

test("innings notation: 5.1 and 5.2 are thirds; blank is regulation", () => {
  assert.equal(inningsToOuts("", 7), 21);
  assert.equal(inningsToOuts(5, 7), 15);
  assert.equal(inningsToOuts(5.1, 7), 16);
  assert.equal(inningsToOuts(5.2, 7), 17);
});

test("default rule set: LL for Little League divisions, PCT for the others", () => {
  for (const d of ["LL", "IL", "JL", "SL"]) assert.equal(getDefaultLadderSystem(d), "LL");
  for (const d of ["AYC U16", "AYC U18", "AWC", "AYWC"]) assert.equal(getDefaultLadderSystem(d), "PCT");
});

test("PCT: rule examples - 4-1 = 80%, 4-2 = 66.7%; ranks on % not points", () => {
  const games = [
    g("A 1-0 X"), g("A 1-0 X"), g("A 1-0 X"), g("A 1-0 X"), g("A 0-1 X"),          // A 4-1
    g("B 1-0 X"), g("B 1-0 X"), g("B 1-0 X"), g("B 1-0 X"), g("B 0-1 X"), g("B 0-1 X"), // B 4-2
  ];
  const res = computeLadder(["B", "A", "X"], games, 7, "PCT");
  assert.equal(row(res, "A").pct, 80);
  assert.equal(row(res, "B").pct.toFixed(1), "66.7");
  assert.equal(row(res, "A").pts, row(res, "B").pts); // both 8 points
  assert.deepEqual(order(res).slice(0, 2), ["A", "B"]);
});

test("PCT: abandoned game without an official result is excluded from % and tiebreakers", () => {
  const res = computeLadder(["A", "B"], [g("A 1-0 B"), g("A 0-9 B 2 NR")], 7, "PCT");
  assert.equal(row(res, "A").gp, 1);
  assert.equal(row(res, "A").pct, 100);
  assert.equal(row(res, "A").ra, 0);
  assert.equal(res.excluded, 1);
});

test("PCT: tie on % -> lower runs allowed per inning defended", () => {
  // A and B both 1-1. A allowed 3 in 14 inn, B allowed 5 in 14 inn.
  const games = [g("A 2-1 C"), g("C 2-0 A"), g("B 6-4 C"), g("C 1-0 B")];
  const res = computeLadder(["B", "A", "C"], games, 7, "PCT");
  const ab = order(res).filter((t) => t !== "C");
  assert.deepEqual(ab, ["A", "B"]);
  assert.equal(row(res, "A").note, "Runs allowed per inning");
});

test("PCT: innings defended come from the opponent's innings batted", () => {
  // Home team A leads, does not bat in the 7th: A batted 6, B batted 7.
  // A defended 7 innings, B defended 6.
  const res = computeLadder(["A", "B"], [g("A 3-1 B 6/7")], 7, "PCT");
  assert.equal(row(res, "A").batOuts, 18);
  assert.equal(row(res, "A").defOuts, 21);
  assert.equal(row(res, "B").batOuts, 21);
  assert.equal(row(res, "B").defOuts, 18);
  assert.equal(row(res, "B").raRate, 3 / 6);
});

test("PCT: same % and same RA/inning -> higher TQB", () => {
  // A and B 1-1, both allowed 4 runs in 14 innings; A scored more.
  const games = [g("A 9-2 C"), g("C 2-0 A"), g("B 3-2 C"), g("C 2-1 B")];
  const res = computeLadder(["B", "A", "C"], games, 7, "PCT");
  assert.equal(row(res, "A").raRate, row(res, "B").raRate);
  assert.ok(row(res, "A").pos < row(res, "B").pos);
  assert.equal(row(res, "A").note, "TQB");
  assert.equal(row(res, "B").note, "TQB");
});

test("PCT: partial innings count exactly (walk-off with 1 out in the 7th)", () => {
  // Home B wins 4-3 in the bottom of the 7th with 1 out: B batted 6.1, C batted 7
  const res = computeLadder(["B", "C"], [g("B 4-3 C 6.1/7")], 7, "PCT");
  assert.equal(row(res, "B").batOuts, 19);
  assert.equal(row(res, "B").defOuts, 21);
  assert.equal(row(res, "C").defOuts, 19);
  // B TQB = 4 / (19/3) - 3 / 7
  assert.ok(Math.abs(row(res, "B").tqb - (12 / 19 - 3 / 7)) < 1e-12);
});

test("PCT: level on everything -> coin toss flagged", () => {
  const res = computeLadder(["A", "B"], [g("A 2-1 B"), g("B 2-1 A")], 7, "PCT");
  assert.ok(res.rows.every((r) => r.unresolved && r.note === "⚠️ Coin toss"));
});

test("PCT: head-to-head is ignored", () => {
  // All 1-1. A beat B head-to-head, but B allowed fewer runs per inning (1 v 9).
  // B and C level on RA/inn (1 each); C has the higher TQB.
  const games = [g("A 1-0 B"), g("C 9-0 A"), g("B 1-0 C")];
  const res = computeLadder(["A", "B", "C"], games, 7, "PCT");
  assert.deepEqual(order(res), ["C", "B", "A"]);
  assert.equal(row(res, "C").note, "TQB");
  assert.equal(row(res, "A").note, "Runs allowed per inning");
});

test("PCT: no games yet -> no coin toss flags", () => {
  const res = computeLadder(["A", "B"], [], 7, "PCT");
  assert.ok(res.rows.every((r) => !r.unresolved && r.note === "No games played yet"));
});
