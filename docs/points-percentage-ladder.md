# Points percentage ladder (reference)

Rule set "PCT" in `apps-script/Ladder.gs`, as supplied by the tournament director.
It is the default for AYC U16, AYC U18, AWC and AYWC, and can be chosen for any
division when the tracker is created.

## Calculate points percentage

- Win = 2 points · Tie = 1 point · Loss = 0 points
- **Points percentage = points earned ÷ (2 × pool games with an official result) × 100**
- An abandoned pool game without an official result is excluded from both the
  points percentage and the tiebreakers.
- A 4-1 record earns 8 of 10 possible points (80%). A 4-2 record earns 8 of 12 (66.7%).

## Rank teams and break ties

| Order | How teams are ranked |
|---|---|
| 1. Points percentage | Highest percentage ranks first. |
| 2. Runs allowed per inning defended | If tied, divide total runs allowed by total innings defended. The lower result ranks higher. |
| 3. Team Quality Balance (TQB) | If still tied, divide total runs scored by total innings batted, then subtract runs allowed per inning defended. The higher result ranks higher. |
| 4. Coin toss | If still tied, decide the order by coin toss. |

Head-to-head is excluded because some teams do not meet in pool play.

## Scoring treatment

- Use the runs and innings that count in the official result.
- If a game is not finished with full innings, the score and innings revert to
  the last completed inning.
- For a half-inning closed by the run cap, roll back to the last completed inning.

## How the tracker applies it

- **Results tab:** one row per game, with innings **batted** entered for each
  team. Blank = the full regulation distance (7 innings). Use baseball notation
  for outs: 5.1 = 5⅓, 5.2 = 5⅔.
- **Innings defended** for a team = the innings its opponent batted. For
  example, if the home team leads and does not bat in the 7th, enter 6 for the
  home team: the home team batted 6 and defended 7, and the away team batted 7
  and defended 6.
- **No Result** checkbox: tick it for an abandoned game without an official
  result. The game is excluded from everything.
- Runs and innings are compared as exact fractions, so rounding never decides
  a place.
- Teams level on all three measures are marked ⚠️ Coin toss on the Ladder.
  Until the toss is held they are listed in team entry order.
