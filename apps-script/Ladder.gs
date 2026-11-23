// ═══════════════════════════════════════════════════════════════════════
// Ladder + finals seeding
//
// Points: Win 2 · Draw 1 · Loss 0. Teams are ranked on points.
//
// Tied teams are separated with the Little League pool play tiebreaker
// procedure (see docs/little-league-pool-play-tiebreakers.md):
//   1. Head-to-head. A tied team advances only if it beat EVERY other team in
//      the tie, in EVERY pool game between them, AND played each of them an
//      equal number of times (at least once). The remaining tied teams then
//      start again at step 1.
//   2. Once head-to-head cannot be used, the Runs-Allowed Ratio decides ALL
//      remaining places: runs allowed / defensive innings across all pool
//      games (each game counts as 6 innings for LL, 7 for other divisions,
//      or more if it went to extra innings). Lowest ratio advances.
//   3. Teams level on RA ratio: head-to-head among those teams; failing that,
//      RA ratio recomputed using only games between those teams. This
//      advances ONE team, then the rest revert to the all-games RA ratio.
//   4. Still tied: flagged for the Tournament Committee (playoff, blind draw
//      or coin flip).
//
// The ranking core (computeLadder and helpers) is plain JavaScript with no
// Apps Script calls, so it is unit tested with Node: see Ladder.test.js.
// ═══════════════════════════════════════════════════════════════════════

var LADDER_SHEET      = "🏆 Ladder";
var RESULTS_SHEET     = "📝 Results";
var CONFIG_SHEET      = "__config__";
var RESULTS_FIRST_ROW = 4;
var RESULTS_COLS      = 8;
var LADDER_HANDLER    = "onLadderEdit";
var BRACKETS_URL      = "https://www.littleleague.org/downloads/double-elimination-tournament-brackets/";

var NOTE_H2H        = "Head-to-head";
var NOTE_RA         = "Runs-allowed ratio";
var NOTE_H2H_RA     = "Head-to-head (level on RA ratio)";
var NOTE_RA_AMONG   = "RA ratio (games between tied teams)";
var NOTE_UNRESOLVED = "⚠️ Unresolved: Tournament Committee decides";
var NOTE_NO_GAMES   = "No games played yet";

function getRegulationInnings(division) {
  return division==="LL" ? 6 : 7;
}

// ── Ranking core (pure) ───────────────────────────────────────────────────────

// teamNames: array of unique names. games: [{home,away,hr,ar,innings}]
// Returns {rows:[{pos,team,gp,w,l,d,pts,rs,ra,inn,note,unresolved}], counted}
function computeLadder(teamNames, games, regInnings) {
  var stats={}, names=[];
  teamNames.forEach(function(n){
    if(stats[n]) return;
    stats[n]={team:n,gp:0,w:0,l:0,d:0,pts:0,rs:0,ra:0,inn:0};
    names.push(n);
  });

  var valid=[];
  games.forEach(function(g){
    if(!stats[g.home]||!stats[g.away]||g.home===g.away) return;
    var inn=Math.max(regInnings, Number(g.innings)||0);
    var game={home:g.home,away:g.away,hr:g.hr,ar:g.ar,inn:inn};
    valid.push(game);
    addResult(stats[g.home], game.hr, game.ar, inn);
    addResult(stats[g.away], game.ar, game.hr, inn);
  });

  // Group by points (descending), keeping entry order inside each group
  var byPts={};
  names.forEach(function(n){
    var p=stats[n].pts;
    (byPts[p]=byPts[p]||[]).push(n);
  });
  var ptsLevels=Object.keys(byPts).map(Number).sort(function(a,b){return b-a;});

  var rows=[];
  ptsLevels.forEach(function(p){
    var group=byPts[p];
    var ordered = group.length===1
      ? [{team:group[0],note:"",unresolved:false}]
      : orderTiedGroup(valid, group);
    ordered.forEach(function(o){
      var s=stats[o.team];
      rows.push({
        pos:rows.length+1, team:s.team, gp:s.gp, w:s.w, l:s.l, d:s.d, pts:s.pts,
        rs:s.rs, ra:s.ra, inn:s.inn, note:o.note, unresolved:o.unresolved,
      });
    });
  });
  return {rows:rows, counted:valid.length};
}

function addResult(s, scored, allowed, inn) {
  s.gp++; s.rs+=scored; s.ra+=allowed; s.inn+=inn;
  if(scored>allowed){ s.w++; s.pts+=2; }
  else if(scored<allowed){ s.l++; }
  else { s.d++; s.pts+=1; }
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

// Runs allowed and defensive innings for t. among = null for all pool games,
// or an array of teams to count only games against those teams.
function runsAllowed(games, t, among) {
  var ra=0, inn=0;
  games.forEach(function(g){
    var opp = g.home===t ? g.away : (g.away===t ? g.home : null);
    if(opp===null) return;
    if(among&&among.indexOf(opp)<0) return;
    ra += g.home===t ? g.ar : g.hr;
    inn+= g.inn;
  });
  return {ra:ra, inn:inn};
}

// Exact ratio comparison (no floating point). Negative = a is better (lower).
// A team with no innings has no ratio and ranks below any team that has one.
function compareRatio(a, b) {
  if(a.inn===0&&b.inn===0) return 0;
  if(a.inn===0) return 1;
  if(b.inn===0) return -1;
  return a.ra*b.inn - b.ra*a.inn;
}

// Teams sharing the lowest ratio
function lowestRatio(teams, ratioOf) {
  var best=[teams[0]], bestR=ratioOf(teams[0]);
  for(var i=1;i<teams.length;i++){
    var r=ratioOf(teams[i]), c=compareRatio(r,bestR);
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

    if(level.ratio.inn===0){
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
  if(!sh) throw new Error("Missing "+CONFIG_SHEET+" sheet");
  return JSON.parse(sh.getRange(1,1).getValue());
}

function toRuns(v) {
  if(v===""||v===null||v===undefined) return null;
  var n=Number(v);
  return (isFinite(n)&&n>=0) ? n : null;
}

// Complete rows only: both teams and both scores present
function readResults(ss) {
  var sh=ss.getSheetByName(RESULTS_SHEET);
  var games=[];
  if(!sh) return games;
  var last=sh.getLastRow();
  if(last<RESULTS_FIRST_ROW) return games;
  var vals=sh.getRange(RESULTS_FIRST_ROW,1,last-RESULTS_FIRST_ROW+1,RESULTS_COLS).getValues();
  vals.forEach(function(r){
    var home=String(r[2]).trim(), away=String(r[4]).trim();
    var hr=toRuns(r[3]), ar=toRuns(r[5]);
    if(!home||!away||hr===null||ar===null) return;
    games.push({home:home, away:away, hr:hr, ar:ar, innings:toRuns(r[6])||0});
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
  var teamNames=(cfg.teams||[]).map(function(t){ return t.name; });
  var games=readResults(ss);
  var ladder=computeLadder(teamNames, games, reg);
  writeLadder(ss.getSheetByName(LADDER_SHEET), ladder, cfg, reg, games.length);
}

// ── Results sheet ─────────────────────────────────────────────────────────────

function buildResultsSheet(sh, cfg) {
  var FONT="Open Sans", HB="#1a3a5c", H3="#4a90c4", WHITE="#ffffff", PALE="#f0f4f8";
  var teamNames=cfg.teams.map(function(t){ return t.name; });
  var reg=getRegulationInnings(cfg.division);
  var days=(cfg.teams[0]&&cfg.teams[0].days)||[];
  var dayLabels=days.map(function(d,i){ return "Day "+(i+1)+" - "+d.label; });
  var numRows=Math.max(10, expectedPoolGames(cfg.teams)+5);
  var first=RESULTS_FIRST_ROW, C=RESULTS_COLS;

  sh.clear();

  sh.getRange(1,1,1,C).merge().setValue("📝 Pool Play Results - "+cfg.tournamentName+" ("+cfg.division+")")
    .setBackground(HB).setFontColor("#c8a84b").setFontFamily(FONT).setFontSize(12)
    .setFontWeight("bold").setVerticalAlignment("middle");
  sh.getRange(2,1,1,C).merge().setValue(
      "Enter POOL PLAY games only (not finals). The Ladder updates automatically. "+
      "Innings: leave blank unless the game went to extra innings - every game counts as "+reg+
      " innings for the runs-allowed ratio. Forfeit: enter the score the Tournament Committee awards (usually "+reg+"-0).")
    .setBackground(PALE).setFontColor(HB).setFontFamily(FONT).setFontSize(9)
    .setWrap(true).setVerticalAlignment("middle");
  sh.getRange(3,1,1,C).setValues([["Game","Day","Home Team","Runs","Away Team","Runs","Innings (extra only)","Check"]])
    .setBackground(H3).setFontColor(WHITE).setFontFamily(FONT).setFontSize(10)
    .setFontWeight("bold").setHorizontalAlignment("center").setWrap(true);

  var nums=[], checks=[];
  for(var i=0;i<numRows;i++){
    var R=first+i;
    nums.push([i+1]);
    checks.push(['=IF(COUNTA(C'+R+':F'+R+')=0,"",IF(OR(C'+R+'="",D'+R+'="",E'+R+'="",F'+R+'=""),"⚠️ Incomplete",IF(C'+R+'=E'+R+',"⚠️ Same team","✓")))']);
  }
  var body=sh.getRange(first,1,numRows,C);
  body.setFontFamily(FONT).setFontSize(10).setHorizontalAlignment("center").setVerticalAlignment("middle");
  sh.getRange(first,1,numRows,1).setValues(nums).setFontColor("#888888");
  sh.getRange(first,C,numRows,1).setFormulas(checks);
  sh.getRange(first,3,numRows,1).setHorizontalAlignment("left");
  sh.getRange(first,5,numRows,1).setHorizontalAlignment("left");
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
    .setAllowInvalid(false).setHelpText("Runs scored (0 or more).").build();
  sh.getRange(first,4,numRows,1).setDataValidation(runsRule);
  sh.getRange(first,6,numRows,1).setDataValidation(runsRule);
  sh.getRange(first,7,numRows,1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireNumberBetween(reg+1,30).setAllowInvalid(false)
    .setHelpText("Only for extra innings (more than "+reg+"). Leave blank for regulation or shortened games.").build());

  var checkRange=sh.getRange(first,C,numRows,1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith("⚠️")
      .setBackground("#ffcccc").setFontColor("#cc0000").setRanges([checkRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("✓")
      .setBackground("#c8f0c8").setFontColor("#1a7a1a").setRanges([checkRange]).build(),
  ]);

  sh.getRange(3,1,numRows+1,C).setBorder(true,true,true,true,true,true,"#cccccc",SpreadsheetApp.BorderStyle.SOLID);
  [50,140,170,55,170,55,90,110].forEach(function(w,i){ sh.setColumnWidth(i+1,w); });
  sh.setRowHeight(1,32); sh.setRowHeight(2,44); sh.setRowHeight(3,36);
  sh.setFrozenRows(3);
}

// ── Ladder sheet ──────────────────────────────────────────────────────────────

function writeLadder(sh, ladder, cfg, reg, entered) {
  var FONT="Open Sans", HB="#1a3a5c", H3="#4a90c4", WHITE="#ffffff", PALE="#f0f4f8";
  var QUAL="#fff4d6", GOLD="#c8a84b";
  var C=12;
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
  sh.getRange(2,1,1,C).merge().setValue(
      "Win 2 · Draw 1 · Loss 0   ·   RA ratio = runs allowed ÷ defensive innings ("+reg+
      " per game, more for extra innings)   ·   Games entered: "+entered+" of "+expected+
      "   ·   Updated "+stamp)
    .setBackground(PALE).setFontColor(HB).setFontFamily(FONT).setFontSize(9).setVerticalAlignment("middle");

  var header=["Pos","Team","GP","W","L","D","Pts","RS","RA","Def Inn","RA Ratio","Tiebreak"];
  sh.getRange(3,1,1,C).setValues([header])
    .setBackground(H3).setFontColor(WHITE).setFontFamily(FONT).setFontSize(10)
    .setFontWeight("bold").setHorizontalAlignment("center");

  if(rows.length){
    var vals=rows.map(function(r){
      return [r.pos, r.team, r.gp, r.w, r.l, r.d, r.pts, r.rs, r.ra, r.inn,
              r.inn>0 ? r.ra/r.inn : "-", r.note];
    });
    var body=sh.getRange(4,1,rows.length,C);
    body.setValues(vals).setFontFamily(FONT).setFontSize(10)
      .setHorizontalAlignment("center").setVerticalAlignment("middle");
    sh.getRange(4,2,rows.length,1).setHorizontalAlignment("left").setFontWeight("bold");
    sh.getRange(4,7,rows.length,1).setFontWeight("bold");
    sh.getRange(4,11,rows.length,1).setNumberFormat("0.0000");
    sh.getRange(4,12,rows.length,1).setHorizontalAlignment("left").setFontSize(9).setFontColor("#555555");
    rows.forEach(function(r,i){
      var bg = i<finals ? QUAL : (i%2===0 ? WHITE : "#f5f5f5");
      sh.getRange(4+i,1,1,C).setBackground(bg);
      if(r.unresolved) sh.getRange(4+i,12).setFontColor("#cc0000").setFontWeight("bold");
    });
    if(finals>0&&finals<rows.length){
      sh.getRange(3+finals,1,1,C).setBorder(null,null,true,null,null,null,GOLD,SpreadsheetApp.BorderStyle.SOLID_THICK);
    }
    sh.getRange(3,1,rows.length+1,C).setBorder(true,true,true,true,null,null,HB,SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }

  // Finals seeding block
  var row=4+rows.length+1;
  sh.getRange(row,1,1,4).merge()
    .setValue(finals>0 ? "FINALS SEEDING - top "+finals+" advance" : "FINALS SEEDING - set the number of finals teams when creating the tracker")
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
      .setValue("⚠️ Teams marked ⚠️ are still tied after every tiebreaker. Their order must be decided by the Tournament Committee (playoff, blind draw or coin flip).")
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

  [45,180,40,40,40,40,45,45,45,60,70,250].forEach(function(w,i){ sh.setColumnWidth(i+1,w); });
  sh.setRowHeight(1,34); sh.setRowHeight(2,24); sh.setRowHeight(3,26);
  sh.setFrozenRows(3);
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
