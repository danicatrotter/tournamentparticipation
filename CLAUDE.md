# Tournament Participation Tracker

Baseball tournament tracker. The React form (Vite, deployed on Vercel) collects
the tournament setup and posts it to `api/create-sheet.js`, which forwards it to
a Google Apps Script web app (`APPS_SCRIPT_URL`). The Apps Script builds the
Google Sheet.

- `src/pages/tracker.jsx`: the whole web form (single component, inline styles).
- `api/create-sheet.js`: Vercel function, passes the payload through to Apps Script.
- `apps-script/Code.gs`: sheet builder (pitch counts, rest days, eligibility
  STATUS formulas, instructions tab). Deployed by pasting into the Apps Script
  editor; the repo copy is the source of truth.
- `apps-script/Ladder.gs`: Results tab, Ladder tab, both ladder rule sets,
  finals seeding, edit trigger. Ranking core is pure JS, tested by `npm test`.
- `apps-script/ExistingSheets.gs`: tools for already-created sheets (list teams,
  add players with full formulas, add a ladder to an old tracker).
- `src/pages/existing.jsx`: "Existing Tracker" screen; `src/pages/shared.js`:
  shared styles and helpers.

## Ladder rule sets (chosen per tournament, `cfg.ladderSystem`)

- **LL** (default for LL/IL/JL/SL): Little League pool play rules, below.
- **PCT** (default for AYC U16/U18, AWC, AYWC): rank on points % = points ÷
  (2 × games with an official result) × 100; ties by runs allowed per inning
  defended (lower), then TQB (higher), then coin toss. No head-to-head. Uses
  official-result runs and innings, entered per team; games not finished with
  full innings revert to the last completed inning; a run-cap half-inning rolls
  back to the last completed inning. Full text: `docs/points-percentage-ladder.md`.
- Both: a game ticked "No Result" (abandoned, no official result) is excluded.

Divisions: LL, IL, JL, SL (Little League rules, league age) and AYC U16, AYC U18,
AWC, AYWC (Australian / WBSC technical norms, actual age).

## Little League tournaments: ladder and tiebreakers (remember this)

Full rule text and our interpretations: `docs/little-league-pool-play-tiebreakers.md`.
Finals brackets: https://www.littleleague.org/downloads/double-elimination-tournament-brackets/

- Points: **Win 2, Draw 1, Loss 0**. Advancement is by best record in pool play;
  the tournament director sets how many teams advance before play starts.
- Tiebreak order (also used for finals seeding):
  1. **Head-to-head** among the tied teams. A team advances only if it beat every
     other tied team, in every pool game between them, and played each of them an
     equal number of times.
  2. **Runs-Allowed Ratio** = runs allowed in all pool games / defensive innings
     (6 per game for LL, 7 for IL/JL/SL, more for extra innings). Lowest advances.
     Once head-to-head fails, RA ratio decides all remaining places.
  3. Still level on RA ratio: head-to-head among those teams, else RA ratio from
     only the games between them. Advances ONE team, then revert to all-games RA.
  4. Still tied: Tournament Committee decides (playoff, blind draw or coin flip).
- Forfeits are usually recorded 6-0 (LL) or 7-0 (IL/JL/SL), only by Tournament
  Committee decree.

## Conventions

- Apps Script code is ES5-style (`var`, `function`), no build step.
- User-facing text: use hyphens, not em dashes.
