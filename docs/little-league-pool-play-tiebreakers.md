# Little League pool play tiebreakers (reference)

Source: Little League International Tournament Rules, pool play tiebreaker
procedures, as supplied by the tournament director. Finals brackets:
https://www.littleleague.org/downloads/double-elimination-tournament-brackets/

**Ladder points used by this tracker:** Win 2 · Draw 1 · Loss 0.

---

## Section III - Tiebreaker procedures

**A.** In all cases, the team(s) advancing past Segment 1 must be the team(s) with the best won-lost record(s) during pool play. The tournament director will decide the number of teams that will advance beyond pool play, and such determination must be made available to the leagues/teams involved before the tournament begins.

**B.** When records are tied, however, the following procedures must be applied in order, so that the tie can be broken. These procedures also apply to determining the seeding for Segment 2 (the playoff round), if seeding for Segment 2 is based on results of pool play.

1. The first tiebreaker is the result of the head-to-head match-up(s) during pool play (Segment 1) of the teams that are involved in the tie.
   - a. If one of the teams involved in the tie has accomplished EVERY ONE of the following, then that team will advance:
     - i. Defeated all of the other teams involved in the tie at least once; AND,
     - ii. Defeated all of the other teams involved in the tie in every one of the pool play games it played against those teams; AND,
     - iii. Played each of the teams involved in the tie an equal number of times.

     *Example:* Three teams are tied with identical records for first place at the end of pool play, and one team is to advance to Segment 2. Teams A, B and C played against each other once in pool play. Team A won all of its games against Team B and Team C during pool play. Result - Team A advances, while Team B and Team C are eliminated.
2. If the results of the head-to-head match-up(s) during pool play of the teams that are involved in the tie cannot break the tie (because no team defeated each of the other teams in the tie each time they played, or because no team has defeated all of the other teams involved in the tie in every one of the pool play games played between those teams, or because the teams involved in the tie did not play one another an equal number of times during pool play), then the tie is broken using the Runs-Allowed Ratio (see Section IV).

**C.** In all cases, if the tie-breaking principles herein are correctly applied and fail to break the tie, or if these guidelines are not applied correctly (in the judgment of the Tournament Committee in Williamsport), then the matter will be referred to the Tournament Committee, which will be the final arbiter in deciding the issue. If a tie cannot be broken through the proper application of these guidelines (in the opinion of the Tournament Committee), then a playoff, blind draw or coin flip will determine which team(s) will advance. This is a decision of the Tournament Committee.

## Section IV - Runs-Allowed Ratio

**A.** For each team involved in a tie in which head-to-head results cannot be used (for the reasons in III.B.2), the tournament director will calculate: the total number of runs given up in all pool play games played by that team, divided by 6 innings or more for extra innings for Little League and below [7 innings or more for extra innings for Intermediate (50-70) Division/Junior/Senior League]. This provides the Runs-Allowed Ratio.

1. *Example:* The Hometown Little League (Major) team has given up eight (8) runs in all four (4) of its pool play games. 8 divided by 24 equals .3333.
2. The Runs-Allowed Ratio for Hometown Little League (.3333 in the example above) is compared to the same calculation for each of the teams involved in the tie.

**B.** The Runs-Allowed Ratio is used to advance ALL teams after it is determined that head-to-head cannot be used.

**C.** If, after computing the Runs-Allowed Ratio using results of all pool play games played by the teams involved in the tie:

1. one team has the lowest Runs-Allowed Ratio, that team advances. After one team has advanced using the Runs-Allowed Ratio, each subsequent team needed to advance is determined by the Runs-Allowed Ratio until all teams are determined and seeded.
2. two or more teams remain tied with the same Runs-Allowed Ratio, and the methods detailed in Section III cannot be used (for the reasons in III.B.2), then the Runs-Allowed Ratio must be recomputed using statistics only from the pool play games played between the teams involved in the tie. The results are used to advance ONE team, and any other ties must revert to the Runs-Allowed Ratio using all remaining teams.

**D.** If a game is forfeited, in most cases the score of the game will be recorded as 6-0 (for Little League Divisions and below) or 7-0 [for Intermediate (50-70) Division/Junior/Senior League]. However, only the Tournament Committee in Williamsport can decree a forfeit, and the Tournament Committee reserves the right to disregard the results of the game, to assign the score as noted above, or to allow the score to stand (if any part of the game was played).

**E.** In the event a team (defined for this purpose as a minimum of nine players) fails to attend a scheduled game, and it is determined by the Tournament Committee in Williamsport that the failure to attend was designed to cause a forfeit or delay the tournament for any reason, the Tournament Committee reserves the right to remove the team from further play in the International Tournament and/or remove those adults it deems responsible from the team and/or local league.

---

## How this tracker interprets the rules

These are judgment calls where the rule text is silent. Change them in
`apps-script/Ladder.gs` (`orderTiedGroup`) if the tournament director rules otherwise.

- **After a team advances on head-to-head**, the remaining tied teams start
  again at head-to-head (e.g. 3-way tie, A sweeps, then B v C on their own
  head-to-head).
- **Once head-to-head fails**, RA ratio decides every remaining place in that
  tie (IV.B). Teams level on RA ratio get the III head-to-head check among
  themselves first, then the RA ratio among tied teams (IV.C.2).
- **A draw** between tied teams means neither "defeated" the other, so
  head-to-head cannot be used.
- **Defensive innings:** each game counts as 6 (LL) or 7 (IL, JL, SL and the
  AYC/AWC/AYWC divisions), or the actual innings if extra innings were played.
  Shortened games still count as full regulation innings.
- **Ranking on points (2/1/0)** matches LL's won-lost record when every team
  plays the same number of pool games. If schedules are uneven, points and
  win percentage can disagree.
