// ═══════════════════════════════════════════════════════════════════════
// Ladder + finals seeding. Two rule sets, chosen per tournament (cfg.ladderSystem):
//
// "LL"  - Little League pool play (docs/little-league-pool-play-tiebreakers.md)
//   Rank on points (Win 2 · Draw 1 · Loss 0). Ties:
//   1. Head-to-head: a tied team advances only if it beat EVERY other tied team,
//      in EVERY game between them, having played each of them an equal number
//      of times (at least once). The remaining tied teams restart at step 1.
//   2. Once head-to-head cannot be used, the Runs-Allowed Ratio decides ALL
//      remaining places: runs allowed / defensive innings in all pool games
//      (each game counts as 6 innings for LL, 7 otherwise, more if extra
//      innings). Lowest ratio advances.
//   3. Teams level on RA ratio: head-to-head among them, else RA ratio from only
//      games between them. Advances ONE team, then revert to all-games RA.
//   4. Still tied: Tournament Committee decides.
//
// "PCT" - Points percentage (docs/points-percentage-ladder.md)
//   Points % = points / (2 x pool games with an official result) x 100.
//   1. Points % (higher first)
//   2. Runs allowed per inning defended (lower first)
//   3. TQB = runs scored / innings batted - runs allowed / innings defended (higher first)
//   4. Coin toss
//   Head-to-head is not used. Innings are the innings that count in the
//   official result, entered per team, in baseball notation (5.2 = 5⅔).
//
// In both, a game marked "No result" (abandoned without an official result)
// is excluded entirely.
//
// The ranking core (computeLadder and helpers) is plain JavaScript with no
// Apps Script calls, so it is unit tested with Node: see Ladder.test.js.
// ═══════════════════════════════════════════════════════════════════════

var LADDER_SHEET      = "🏆 Ladder";
var RESULTS_SHEET     = "📝 Results";
var CONFIG_SHEET      = "__config__";
var RESULTS_FIRST_ROW = 4;
var RESULTS_COLS      = 10;
var LADDER_HANDLER    = "onLadderEdit";
var BRACKETS_URL      = "https://www.littleleague.org/downloads/double-elimination-tournament-brackets/";

var NOTE_H2H        = "Head-to-head";
var NOTE_RA         = "Runs-allowed ratio";
var NOTE_H2H_RA     = "Head-to-head (level on RA ratio)";
var NOTE_RA_AMONG   = "RA ratio (games between tied teams)";
var NOTE_UNRESOLVED = "⚠️ Unresolved: Tournament Committee decides";
var NOTE_NO_GAMES   = "No games played yet";
var NOTE_PCT_RA     = "Runs allowed per inning";
var NOTE_PCT_TQB    = "TQB";
var NOTE_COIN       = "⚠️ Coin toss";

var LADDER_SYSTEMS = {
  LL:  "Little League (head-to-head, runs-allowed ratio)",
  PCT: "Points % (runs allowed per inning, TQB, coin toss)",
};

function getRegulationInnings(division) {
  return division==="LL" ? 6 : 7;
}

function isLittleLeagueDivision(division) {
  return division==="LL"||division==="IL"||division==="JL"||division==="SL";
}

function getDefaultLadderSystem(division) {
  return isLittleLeagueDivision(division) ? "LL" : "PCT";
}

function getLadderSystem(cfg) {
  return LADDER_SYSTEMS[cfg.ladderSystem] ? cfg.ladderSystem : getDefaultLadderSystem(cfg.division);
}

// ── Ranking core (pure) ───────────────────────────────────────────────────────

// Innings in baseball notation -> outs. 5 = 15 outs, 5.1 = 16, 5.2 = 17.
// Blank or 0 means the game went the regulation distance.
function inningsToOuts(v, regInnings) {
  var n=Number(v);
  if(v===""||v===null||v===undefined||!isFinite(n)||n<=0) return regInnings*3;
  var whole=Math.floor(n), frac=Math.round((n-whole)*10);
  if(frac>2) frac=0;
  return whole*3+frac;
}

function outsToInnings(outs) {
  var whole=Math.floor(outs/3), rem=outs%3;
  return rem ? whole+"."+rem : String(whole);
}

// A fraction {n,d}. d === 0 means "no value yet"; it ranks below any real value.
function cmpLower(x, y) {   // negative if x ranks higher (lower value is better)
  if(x.d===0&&y.d===0) return 0;
  if(x.d===0) return 1;
  if(y.d===0) return -1;
  return x.n*y.d - y.n*x.d;
}
function cmpHigher(x, y) {  // negative if x ranks higher (higher value is better)
  if(x.d===0&&y.d===0) return 0;
  if(x.d===0) return 1;
  if(y.d===0) return -1;
  return y.n*x.d - x.n*y.d;
}

function pointsPct(s) { return {n:s.pts, d:2*s.gp}; }
function raPerInning(s) { return {n:s.ra*3, d:s.defOuts}; }        // runs per inning (outs/3)
function tqb(s) {
  // rs/ib - ra/id with ib, id in outs; the x3 cancels in comparisons but keeps display right
  if(s.batOuts===0||s.defOuts===0) return {n:0, d:0};
  return {n:3*(s.rs*s.defOuts - s.ra*s.batOuts), d:s.batOuts*s.defOuts};
}
function fracValue(f) { return f.d===0 ? null : f.n/f.d; }

// teamNames: array of unique names.
// games: [{home, away, hr, ar, homeInn, awayInn, noResult}]
//   homeInn / awayInn = innings BATTED by each team (blank = regulation).
// system: "LL" (default) or "PCT".
// Returns {rows:[...], counted, excluded}
function computeLadder(teamNames, games, regInnings, system) {
  system = system==="PCT" ? "PCT" : "LL";
  var stats={}, names=[];
  teamNames.forEach(function(n){
    if(stats[n]) return;
    stats[n]={team:n,gp:0,w:0,l:0,d:0,pts:0,rs:0,ra:0,defOuts:0,batOuts:0};
    names.push(n);
  });

  var valid=[], excluded=0;
  games.forEach(function(g){
    if(!stats[g.home]||!stats[g.away]||g.home===g.away) return;
    if(g.noResult){ excluded++; return; }
    var homeBat=inningsToOuts(g.homeInn, regInnings);
    var awayBat=inningsToOuts(g.awayInn, regInnings);
    var homeDef, awayDef;
    if(system==="LL"){
      // LL: every game counts as regulation innings, or more for extra innings
      var gameOuts=Math.max(regInnings*3, homeBat, awayBat);
      homeDef=awayDef=homeBat=awayBat=gameOuts;
    } else {
      homeDef=awayBat; awayDef=homeBat;
    }
    var game={home:g.home, away:g.away, hr:g.hr, ar:g.ar, homeDef:homeDef, awayDef:awayDef};
    valid.push(game);
    addResult(stats[g.home], game.hr, game.ar, homeDef, homeBat);
    addResult(stats[g.away], game.ar, game.hr, awayDef, awayBat);
  });

  var ordered = system==="PCT" ? rankByPercentage(names, stats) : rankLittleLeague(names, stats, valid);
  var rows=ordered.map(function(o,i){
    var s=stats[o.team];
    return {
      pos:i+1, team:s.team, gp:s.gp, w:s.w, l:s.l, d:s.d, pts:s.pts,
      rs:s.rs, ra:s.ra, defOuts:s.defOuts, batOuts:s.batOuts,
      pct: s.gp ? 100*s.pts/(2*s.gp) : null,
      raRate: fracValue(raPerInning(s)),
      tqb: fracValue(tqb(s)),
      note:o.note, unresolved:o.unresolved,
    };
  });
  return {rows:rows, counted:valid.length, excluded:excluded};
}

function addResult(s, scored, allowed, defOuts, batOuts) {
  s.gp++; s.rs+=scored; s.ra+=allowed; s.defOuts+=defOuts; s.batOuts+=batOuts;
  if(scored>allowed){ s.w++; s.pts+=2; }
  else if(scored<allowed){ s.l++; }
  else { s.d++; s.pts+=1; }
}

// ── Points % rule set ─────────────────────────────────────────────────────────

function rankByPercentage(names, stats) {
  var criteria=[
    function(a,b){ return cmpHigher(pointsPct(a), pointsPct(b)); },
    function(a,b){ return cmpLower(raPerInning(a), raPerInning(b)); },
    function(a,b){ return cmpHigher(tqb(a), tqb(b)); },
  ];
  var labels=["", NOTE_PCT_RA, NOTE_PCT_TQB];
  function firstDiff(a,b){
    for(var i=0;i<criteria.length;i++){ if(criteria[i](a,b)!==0) return i; }
    return criteria.length;
  }

  var sorted=names.slice().sort(function(x,y){
    var a=stats[x], b=stats[y];
    for(var i=0;i<criteria.length;i++){ var c=criteria[i](a,b); if(c!==0) return c; }
    return 0; // stable: entry order stands in for the coin toss until it is held
  });

  return sorted.map(function(t){
    var s=stats[t];
    if(s.gp===0) return {team:t, note:NOTE_NO_GAMES, unresolved:false};
    // The deepest criterion needed to separate t from any team level with it on points %
    var level=0;
    sorted.forEach(function(u){
      if(u===t) return;
      var d=firstDiff(s, stats[u]);
      if(d>0&&d>level) level=d;
    });
    if(level===criteria.length) return {team:t, note:NOTE_COIN, unresolved:true};
    return {team:t, note:labels[level], unresolved:false};
  });
}

// ── Little League rule set ────────────────────────────────────────────────────

function rankLittleLeague(names, stats, games) {
  var byPts={};
  names.forEach(function(n){
    var p=stats[n].pts;
    (byPts[p]=byPts[p]||[]).push(n);
  });
  var levels=Object.keys(byPts).map(Number).sort(function(a,b){return b-a;});
  var out=[];
  levels.forEach(function(p){
    var group=byPts[p];
    var ordered = group.length===1
      ? [{team:group[0],note:"",unresolved:false}]
      : orderTiedGroup(games, group);
    out=out.concat(ordered);
  });
  return out;
}

// Games played and won by t against u
function headToHead(games, t, u) {
  var played=0, won=0;
  games.forEach(function(g){
    if(g.home===t&&g.away===u){ played++; if(g.hr>g.ar) won++; }
    else if(g.home===u&&g.away===t){ played++; if(g.ar>g.hr) won++; }
  });
  return {played:played, won:won};
}

// The team that beat every other team in the group in every game between them,
// having played each of them the same number of times. null if none.
function findHeadToHeadWinner(games, group) {
  if(group.length<2) return null;
  for(var i=0;i<group.length;i++){
    var t=group[i], count=null, ok=true;
    for(var j=0;j<group.length&&ok;j++){
      if(i===j) continue;
      var r=headToHead(games, t, group[j]);
      if(r.played===0||r.won!==r.played||(count!==null&&r.played!==count)) ok=false;
      count=r.played;
    }
    if(ok) return t;
  }
  return null;
}

// Runs allowed and defensive outs for t. among = null for all pool games,
// or an array of teams to count only games against those teams.
function runsAllowed(games, t, among) {
  var ra=0, outs=0;
  games.forEach(function(g){
    var opp = g.home===t ? g.away : (g.away===t ? g.home : null);
    if(opp===null) return;
    if(among&&among.indexOf(opp)<0) return;
    ra  += g.home===t ? g.ar : g.hr;
    outs+= g.home===t ? g.homeDef : g.awayDef;
  });
  return {n:ra, d:outs};
}

// Teams sharing the lowest ratio
function lowestRatio(teams, ratioOf) {
  var best=[teams[0]], bestR=ratioOf(teams[0]);
  for(var i=1;i<teams.length;i++){
    var r=ratioOf(teams[i]), c=cmpLower(r,bestR);
    if(c<0){ best=[teams[i]]; bestR=r; }
    else if(c===0) best.push(teams[i]);
  }
  return {teams:best, ratio:bestR};
}

// Order a group of teams level on points. Returns [{team,note,unresolved}]
function orderTiedGroup(games, group) {
  var out=[], remaining=group.slice(), useH2H=true, lastNote=NOTE_RA;

  function take(team, note, unresolved) {
    out.push({team:team, note:note, unresolved:!!unresolved});
    remaining.splice(remaining.indexOf(team),1);
    if(!unresolved) lastNote=note;
  }

  while(remaining.length){
    // Last team standing is placed by whatever separated the team above it
    if(remaining.length===1){ take(remaining[0], lastNote); break; }

    if(useH2H){
      var w=findHeadToHeadWinner(games, remaining);
      if(w){ take(w, NOTE_H2H); continue; }
      useH2H=false; // from here on, RA ratio decides all remaining places
    }

    var level=lowestRatio(remaining, function(t){ return runsAllowed(games,t,null); });
    if(level.teams.length===1){ take(level.teams[0], NOTE_RA); continue; }

    if(level.ratio.d===0){
      // Nobody left has played: nothing to separate them on yet
      level.teams.forEach(function(t){ take(t, NOTE_NO_GAMES); });
      continue;
    }

    var w2=findHeadToHeadWinner(games, level.teams);
    if(w2){ take(w2, NOTE_H2H_RA); continue; }

    var inner=lowestRatio(level.teams, function(t){ return runsAllowed(games,t,level.teams); });
    if(inner.teams.length===1){ take(inner.teams[0], NOTE_RA_AMONG); continue; }

    inner.teams.forEach(function(t){ take(t, NOTE_UNRESOLVED, true); });
  }
  return out;
}

// ── Sheet I/O ─────────────────────────────────────────────────────────────────

function readConfig(ss) {
  var sh=ss.getSheetByName(CONFIG_SHEET);
  if(!sh) throw new Error("This is not a tournament tracker sheet (no "+CONFIG_SHEET+" tab).");
  return JSON.parse(sh.getRange(1,1).getValue());
}

function writeConfig(ss, cfg) {
  ss.getSheetByName(CONFIG_SHEET).getRange(1,1).setValue(JSON.stringify(cfg));
}

function toRuns(v) {
  if(v===""||v===null||v===undefined) return null;
  var n=Number(v);
  return (isFinite(n)&&n>=0) ? n : null;
}

// Complete rows only: both teams and both scores present (or marked No result)
function readResults(ss) {
  var sh=ss.getSheetByName(RESULTS_SHEET);
  var games=[];
  if(!sh) return games;
  var last=sh.getLastRow();
  if(last<RESULTS_FIRST_ROW) return games;
  var vals=sh.getRange(RESULTS_FIRST_ROW,1,last-RESULTS_FIRST_ROW+1,RESULTS_COLS).getValues();
  vals.forEach(function(r){
    var home=String(r[2]).trim(), away=String(r[4]).trim();
    var noResult=(r[8]===true);
    var hr=toRuns(r[3]), ar=toRuns(r[5]);
    if(!home||!away) return;
    if(!noResult&&(hr===null||ar===null)) return;
    games.push({home:home, away:away, hr:hr||0, ar:ar||0,
                homeInn:r[6], awayInn:r[7], noResult:noResult});
  });
  return games;
}

function expectedPoolGames(teams) {
  var total=0;
  teams.forEach(function(t){ (t.days||[]).forEach(function(d){ total+=Number(d.games)||0; }); });
  return Math.ceil(total/2);
}

function updateLadder(ss) {
  var cfg=readConfig(ss);
  var reg=getRegulationInnings(cfg.division);
  var system=getLadderSystem(cfg);
  var teamNames=(cfg.teams||[]).map(function(t){ return t.name; });
  var games=readResults(ss);
  var ladder=computeLadder(teamNames, games, reg, system);
  writeLadder(ss.getSheetByName(LADDER_SHEET), ladder, cfg, reg, system, games.length);
}

// ── Results sheet ─────────────────────────────────────────────────────────────

function resultsHelpText(system, reg) {
  var common="Enter POOL PLAY games only (not finals). The Ladder updates automatically. "+
    "No result: tick for a game abandoned without an official result - it is left out of the ladder entirely. ";
  if(system==="PCT"){
    return common+
      "Runs and innings: use the runs and innings that count in the official result. "+
      "Innings batted: leave blank if the team batted the full "+reg+" innings; otherwise enter the innings it batted "+
      "(e.g. "+(reg-1)+" if the home team did not bat in the last inning; 5.1 / 5.2 = 1 / 2 outs). "+
      "If a game was not finished with full innings, the score and innings revert to the last completed inning. "+
      "For a half-inning closed by the run cap, roll back to the last completed inning.";
  }
  return common+
    "Innings: leave blank unless the game went to extra innings - every game counts as "+reg+
    " innings for the runs-allowed ratio. Forfeit: enter the score the Tournament Committee awards (usually "+reg+"-0).";
}

function buildResultsSheet(sh, cfg) {
  var FONT="Open Sans", HB="#1a3a5c", H3="#4a90c4", WHITE="#ffffff", PALE="#f0f4f8";
  var teamNames=cfg.teams.map(function(t){ return t.name; });
  var reg=getRegulationInnings(cfg.division);
  var system=getLadderSystem(cfg);
  var days=(cfg.teams[0]&&cfg.teams[0].days)||[];
  var dayLabels=days.map(function(d,i){ return "Day "+(i+1)+" - "+d.label; });
  var numRows=Math.max(10, expectedPoolGames(cfg.teams)+5);
  var first=RESULTS_FIRST_ROW, C=RESULTS_COLS;
  var innHeader = system==="PCT" ? "Inn Batted" : "Inn (extra only)";

  sh.clear();

  sh.getRange(1,1,1,C).merge().setValue("📝 Pool Play Results - "+cfg.tournamentName+" ("+cfg.division+")")
    .setBackground(HB).setFontColor("#c8a84b").setFontFamily(FONT).setFontSize(12)
    .setFontWeight("bold").setVerticalAlignment("middle");
  sh.getRange(2,1,1,C).merge().setValue(resultsHelpText(system, reg))
    .setBackground(PALE).setFontColor(HB).setFontFamily(FONT).setFontSize(9)
    .setWrap(true).setVerticalAlignment("middle");
  sh.getRange(3,1,1,C).setValues([["Game","Day","Home Team","Runs","Away Team","Runs",
      "Home "+innHeader,"Away "+innHeader,"No Result","Check"]])
    .setBackground(H3).setFontColor(WHITE).setFontFamily(FONT).setFontSize(10)
    .setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);

  var nums=[], checks=[];
  for(var i=0;i<numRows;i++){
    var R=first+i;
    nums.push([i+1]);
    var badInn=function(col){ return 'AND('+col+R+'<>"",ROUND('+col+R+'*10)-10*INT('+col+R+')>2)'; };
    checks.push(['=IF(I'+R+'=TRUE,"⊘ No result",IF(COUNTA(C'+R+':F'+R+')=0,"",'+
      'IF(OR(C'+R+'="",D'+R+'="",E'+R+'="",F'+R+'=""),"⚠️ Incomplete",'+
      'IF(C'+R+'=E'+R+',"⚠️ Same team",'+
      'IF(OR('+badInn("G")+','+badInn("H")+'),"⚠️ Innings: use .1 / .2 for outs","✓")))))']);
  }
  var body=sh.getRange(first,1,numRows,C);
  body.setFontFamily(FONT).setFontSize(10).setHorizontalAlignment("center").setVerticalAlignment("middle");
  sh.getRange(first,1,numRows,1).setValues(nums).setFontColor("#888888");
  sh.getRange(first,C,numRows,1).setFormulas(checks);
  sh.getRange(first,3,numRows,1).setHorizontalAlignment("left");
  sh.getRange(first,5,numRows,1).setHorizontalAlignment("left");
  sh.getRange(first,9,numRows,1).insertCheckboxes();
  for(var j=0;j<numRows;j+=2) sh.getRange(first+j,1,1,C).setBackground("#f5f5f5");

  // Validation
  if(dayLabels.length){
    sh.getRange(first,2,numRows,1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(dayLabels,true).setAllowInvalid(true).build());
  }
  var teamRule=SpreadsheetApp.newDataValidation().requireValueInList(teamNames,true)
    .setAllowInvalid(false).setHelpText("Pick a team from the list.").build();
  sh.getRange(first,3,numRows,1).setDataValidation(teamRule);
  sh.getRange(first,5,numRows,1).setDataValidation(teamRule);
  var runsRule=SpreadsheetApp.newDataValidation().requireNumberBetween(0,99)
    .setAllowInvalid(false).setHelpText("Runs that count in the official result (0 or more).").build();
  sh.getRange(first,4,numRows,1).setDataValidation(runsRule);
  sh.getRange(first,6,numRows,1).setDataValidation(runsRule);
  var innRule = system==="PCT"
    ? SpreadsheetApp.newDataValidation().requireNumberBetween(0,30).setAllowInvalid(false)
        .setHelpText("Innings this team batted in the official result. Blank = full "+reg+". Use .1 / .2 for outs (5.2 = 5 innings and 2 outs).").build()
    : SpreadsheetApp.newDataValidation().requireNumberBetween(reg+1,30).setAllowInvalid(false)
        .setHelpText("Only for extra innings (more than "+reg+"). Leave blank for regulation or shortened games.").build();
  sh.getRange(first,7,numRows,2).setDataValidation(innRule);

  var checkRange=sh.getRange(first,C,numRows,1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith("⚠️")
      .setBackground("#ffcccc").setFontColor("#cc0000").setRanges([checkRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("✓")
      .setBackground("#c8f0c8").setFontColor("#1a7a1a").setRanges([checkRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith("⊘")
      .setBackground("#e8e8e8").setFontColor("#666666").setRanges([checkRange]).build(),
  ]);

  sh.getRange(3,1,numRows+1,C).setBorder(true,true,true,true,true,true,"#cccccc",SpreadsheetApp.BorderStyle.SOLID);
  [50,140,170,55,170,55,80,80,70,150].forEach(function(w,i){ sh.setColumnWidth(i+1,w); });
  sh.setRowHeight(1,32); sh.setRowHeight(2,system==="PCT"?70:44); sh.setRowHeight(3,40);
  sh.setFrozenRows(3);
}

// ── Ladder sheet ──────────────────────────────────────────────────────────────

function ladderColumns(system) {
  function n(v,dp){ return v===null ? "-" : v; }
  var cols=[
    {h:"Pos",  w:45,  v:function(r){ return r.pos; }},
    {h:"Team", w:180, v:function(r){ return r.team; }, left:true, bold:true},
    {h:"GP",   w:40,  v:function(r){ return r.gp; }},
    {h:"W",    w:40,  v:function(r){ return r.w; }},
    {h:"L",    w:40,  v:function(r){ return r.l; }},
    {h:"D",    w:40,  v:function(r){ return r.d; }},
    {h:"Pts",  w:45,  v:function(r){ return r.pts; }, bold:system==="LL"},
  ];
  if(system==="PCT"){
    cols.push({h:"Pts %",   w:60, v:function(r){ return n(r.pct); }, fmt:"0.0", bold:true});
    cols.push({h:"RS",      w:45, v:function(r){ return r.rs; }});
    cols.push({h:"RA",      w:45, v:function(r){ return r.ra; }});
    cols.push({h:"Inn Bat", w:60, v:function(r){ return outsToInnings(r.batOuts); }});
    cols.push({h:"Inn Def", w:60, v:function(r){ return outsToInnings(r.defOuts); }});
    cols.push({h:"RA / Inn",w:70, v:function(r){ return n(r.raRate); }, fmt:"0.0000"});
    cols.push({h:"TQB",     w:70, v:function(r){ return n(r.tqb); }, fmt:"0.0000"});
  } else {
    cols.push({h:"RS",       w:45, v:function(r){ return r.rs; }});
    cols.push({h:"RA",       w:45, v:function(r){ return r.ra; }});
    cols.push({h:"Def Inn",  w:60, v:function(r){ return outsToInnings(r.defOuts); }});
    cols.push({h:"RA Ratio", w:70, v:function(r){ return n(r.raRate); }, fmt:"0.0000"});
  }
  cols.push({h:"Tiebreak", w:250, v:function(r){ return r.note; }, left:true, note:true});
  return cols;
}

function ladderInfoText(system, reg) {
  if(system==="PCT"){
    return "Win 2 · Draw 1 · Loss 0   ·   Points % = points ÷ (2 × games with an official result)   ·   "+
      "Ties: runs allowed per inning defended, then TQB, then coin toss";
  }
  return "Win 2 · Draw 1 · Loss 0   ·   Ties: head-to-head, then RA ratio = runs allowed ÷ defensive innings ("+
    reg+" per game, more for extra innings)";
}

function writeLadder(sh, ladder, cfg, reg, system, entered) {
  var FONT="Open Sans", HB="#1a3a5c", H3="#4a90c4", WHITE="#ffffff", PALE="#f0f4f8";
  var QUAL="#fff4d6", GOLD="#c8a84b";
  var cols=ladderColumns(system), C=cols.length;
  var rows=ladder.rows;
  var finals=Math.max(0, Math.min(Number(cfg.finalsTeams)||0, rows.length));
  var expected=expectedPoolGames(cfg.teams||[]);

  var maxR=sh.getMaxRows(), maxC=sh.getMaxColumns();
  sh.getRange(1,1,maxR,maxC).breakApart();
  sh.clear();
  sh.setConditionalFormatRules([]);

  var stamp=Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "d MMM yyyy h:mm a");
  sh.getRange(1,1,1,C).merge().setValue("🏆 "+cfg.tournamentName+" ("+cfg.division+") - Pool Play Ladder")
    .setBackground(HB).setFontColor(GOLD).setFontFamily(FONT).setFontSize(13)
    .setFontWeight("bold").setVerticalAlignment("middle");
  var progress="Games entered: "+entered+" of "+expected+
    (ladder.excluded ? " ("+ladder.excluded+" with no result, excluded)" : "")+"   ·   Updated "+stamp;
  sh.getRange(2,1,1,C).merge().setValue(ladderInfoText(system, reg)+"\n"+progress)
    .setBackground(PALE).setFontColor(HB).setFontFamily(FONT).setFontSize(9)
    .setWrap(true).setVerticalAlignment("middle");

  sh.getRange(3,1,1,C).setValues([cols.map(function(c){ return c.h; })])
    .setBackground(H3).setFontColor(WHITE).setFontFamily(FONT).setFontSize(10)
    .setFontWeight("bold").setHorizontalAlignment("center");

  if(rows.length){
    var vals=rows.map(function(r){ return cols.map(function(c){ return c.v(r); }); });
    sh.getRange(4,1,rows.length,C).setValues(vals).setFontFamily(FONT).setFontSize(10)
      .setHorizontalAlignment("center").setVerticalAlignment("middle");
    cols.forEach(function(c,ci){
      var rng=sh.getRange(4,ci+1,rows.length,1);
      if(c.left) rng.setHorizontalAlignment("left");
      if(c.bold) rng.setFontWeight("bold");
      if(c.fmt)  rng.setNumberFormat(c.fmt);
      if(c.note) rng.setFontSize(9).setFontColor("#555555");
    });
    rows.forEach(function(r,i){
      var bg = i<finals ? QUAL : (i%2===0 ? WHITE : "#f5f5f5");
      sh.getRange(4+i,1,1,C).setBackground(bg);
      if(r.unresolved) sh.getRange(4+i,C).setFontColor("#cc0000").setFontWeight("bold");
    });
    if(finals>0&&finals<rows.length){
      sh.getRange(3+finals,1,1,C).setBorder(null,null,true,null,null,null,GOLD,SpreadsheetApp.BorderStyle.SOLID_THICK);
    }
    sh.getRange(3,1,rows.length+1,C).setBorder(true,true,true,true,null,null,HB,SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }

  // Finals seeding block
  var row=4+rows.length+1;
  sh.getRange(row,1,1,4).merge()
    .setValue(finals>0 ? "FINALS SEEDING - top "+finals+" advance" : "FINALS SEEDING - number of finals teams not set")
    .setBackground(HB).setFontColor(WHITE).setFontFamily(FONT).setFontSize(10).setFontWeight("bold");
  row++;
  for(var s=0;s<finals;s++){
    sh.getRange(row,1).setValue("Seed "+(s+1)).setFontWeight("bold");
    sh.getRange(row,2,1,3).merge().setValue(rows[s].team+(rows[s].unresolved?"  ⚠️":""));
    sh.getRange(row,1,1,4).setBackground(QUAL).setFontFamily(FONT).setFontSize(10);
    row++;
  }
  var unresolvedTop=rows.slice(0, Math.min(rows.length, finals+1)).some(function(r){ return r.unresolved; });
  if(unresolvedTop){
    sh.getRange(row,1,1,C).merge()
      .setValue(system==="PCT"
        ? "⚠️ Teams marked ⚠️ are level on every tiebreaker. Decide their order by coin toss."
        : "⚠️ Teams marked ⚠️ are still tied after every tiebreaker. Their order must be decided by the Tournament Committee (playoff, blind draw or coin flip).")
      .setFontColor("#cc0000").setFontFamily(FONT).setFontSize(9).setFontWeight("bold").setWrap(true);
    row++;
  }
  if(entered<expected){
    sh.getRange(row,1,1,C).merge()
      .setValue("Provisional: "+(expected-entered)+" pool game(s) still to be entered.")
      .setFontColor("#7a5000").setFontFamily(FONT).setFontSize(9).setFontStyle("italic");
    row++;
  }
  row++;
  sh.getRange(row,1,1,4).merge()
    .setFormula('=HYPERLINK("'+BRACKETS_URL+'","Little League double-elimination brackets ↗")')
    .setFontFamily(FONT).setFontSize(9);
  if(cfg.webAppUrl&&cfg.spreadsheetId){
    sh.getRange(row,5,1,4).merge()
      .setFormula('=HYPERLINK("'+cfg.webAppUrl+'?action=ladder&id='+cfg.spreadsheetId+'","🔄 Recalculate ladder")')
      .setFontFamily(FONT).setFontSize(9);
  }

  cols.forEach(function(c,i){ sh.setColumnWidth(i+1,c.w); });
  sh.setRowHeight(1,34); sh.setRowHeight(2,36); sh.setRowHeight(3,26);
  sh.setFrozenRows(3);
}

// ── Instructions section (appended to the Instructions tab) ───────────────────
// write(label, text, bold) / blank() / heading(text) are the Instructions tab helpers.
function writeLadderInstructions(write, blank, heading, division, system) {
  var reg=getRegulationInnings(division);
  heading("LADDER & FINALS SEEDING - "+LADDER_SYSTEMS[system].toUpperCase());
  write("Entering results","Open the 📝 Results tab and enter each POOL PLAY game: home team, runs, away team, runs. Do not enter finals games. The 🏆 Ladder tab updates automatically within a few seconds.",true);
  write("No result","Tick No Result for a game abandoned without an official result. It is left out of the ladder and the tiebreakers.",true);
  if(system==="PCT"){
    write("Points","Win 2 · Draw 1 · Loss 0.\nPoints % = points earned ÷ (2 × pool games with an official result) × 100.\nExample: a 4-1 record earns 8 of 10 possible points (80%). A 4-2 record earns 8 of 12 (66.7%).",true);
    write("1. Points %","Highest percentage ranks first.",true);
    write("2. Runs allowed per inning defended","If tied: total runs allowed ÷ total innings defended. The lower result ranks higher.",true);
    write("3. TQB (Team Quality Balance)","If still tied: runs scored ÷ innings batted, minus runs allowed ÷ innings defended. The higher result ranks higher.",true);
    write("4. Coin toss","If still tied, decide the order by coin toss. Marked ⚠️ on the Ladder.",true);
    write("Head-to-head","Not used, because some teams do not meet in pool play.",true);
    write("Runs and innings","Use the runs and innings that count in the official result. Enter innings batted for each team; leave blank for the full "+reg+" innings. Use .1 / .2 for outs (5.2 = 5 innings and 2 outs).\nIf the home team does not bat in the last inning, enter "+(reg-1)+" for the home team.\nIf a game is not finished with full innings, the score and innings revert to the last completed inning.\nFor a half-inning closed by the run cap, roll back to the last completed inning.",true);
  } else {
    write("Points","Win 2 · Draw 1 · Loss 0. Teams are ranked on points.",true);
    write("Tiebreaker 1 - Head-to-head","A tied team advances only if it beat EVERY other team in the tie, in EVERY pool game between them, AND played each of them an equal number of times. The remaining tied teams then go back to this step.",true);
    write("Tiebreaker 2 - Runs-allowed ratio","When head-to-head cannot separate the teams: total runs allowed in all pool games ÷ defensive innings ("+reg+" per game, or more for extra innings). Lowest ratio advances, and each next place is decided the same way.\nExample: 8 runs allowed in 4 games = 8 ÷ "+(reg*4)+" = "+(8/(reg*4)).toFixed(4)+".",true);
    write("Tiebreaker 3 - Still level on RA ratio","Head-to-head between those teams. If that cannot be used, the RA ratio is recalculated using only games between those teams. This advances ONE team, then the rest go back to the all-games RA ratio.",true);
    write("Still tied","Marked ⚠️ on the Ladder. The Tournament Committee decides (playoff, blind draw or coin flip).",true);
    write("Forfeits","Usually recorded as "+reg+"-0, but only the Tournament Committee can decree a forfeit.",true);
  }
  write("Finals","The top teams (as set for this tracker) are highlighted and listed as seeds.",true);
  write("Not updating?","Click 🔄 Recalculate ladder at the bottom of the Ladder tab.",true);
  blank();
}

// ── Auto-update trigger ───────────────────────────────────────────────────────
// The generated spreadsheet has no bound script, so this standalone script
// installs an edit trigger on it. Apps Script allows 20 triggers per user per
// script, so the oldest ladder trigger is removed when the limit is near.

function installLadderTrigger(ss) {
  var props=PropertiesService.getScriptProperties();
  var all=ScriptApp.getProjectTriggers();
  if(all.length>=19){
    var ladderTriggers=all.filter(function(t){ return t.getHandlerFunction()===LADDER_HANDLER; });
    ladderTriggers.sort(function(a,b){
      return Number(props.getProperty("ladderTrigger_"+a.getUniqueId())||0)
           - Number(props.getProperty("ladderTrigger_"+b.getUniqueId())||0);
    });
    var excess=all.length-18;
    ladderTriggers.slice(0,excess).forEach(function(t){
      props.deleteProperty("ladderTrigger_"+t.getUniqueId());
      ScriptApp.deleteTrigger(t);
    });
  }
  var trig=ScriptApp.newTrigger(LADDER_HANDLER).forSpreadsheet(ss).onEdit().create();
  props.setProperty("ladderTrigger_"+trig.getUniqueId(), String(Date.now()));
}

function onLadderEdit(e) {
  if(!e||!e.range) return;
  if(e.range.getSheet().getName()!==RESULTS_SHEET) return;
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(30000)) return;
  try { updateLadder(e.source); }
  finally { lock.releaseLock(); }
}

// Manual refresh via the "Recalculate ladder" link (doGet ?action=ladder&id=...)
function refreshLadderPage(id) {
  var msg;
  try {
    var ss=SpreadsheetApp.openById(id);
    if(!ss.getSheetByName(CONFIG_SHEET)||!ss.getSheetByName(LADDER_SHEET)) throw new Error("Not a tournament tracker.");
    var lock=LockService.getScriptLock();
    lock.waitLock(30000);
    try { updateLadder(ss); } finally { lock.releaseLock(); }
    msg="✅ Ladder updated. You can close this tab and return to your spreadsheet.";
  } catch(err) {
    msg="❌ Could not update the ladder: "+err.message;
  }
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Georgia,serif;padding:40px;text-align:center;font-size:18px">'+
    msg.replace(/</g,"&lt;")+'</div>').setTitle("Ladder");
}
