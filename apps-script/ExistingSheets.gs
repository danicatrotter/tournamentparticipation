// ═══════════════════════════════════════════════════════════════════════
// Tools for sheets that have already been created (called from doPost):
//   listTeams  - read a tracker's teams so the web form can offer them
//   addPlayers - add players to a team tab with full STATUS formulas,
//                colour rules and borders, as if they had been there from the start
//   addLadder  - add the Results + Ladder tabs to a tracker created before
//                the ladder existed
// ═══════════════════════════════════════════════════════════════════════

var TEAM_FIRST_ROW   = 4;
var TEAM_ROSTER_COLS = 3;

// Accepts a full Google Sheets link or a bare spreadsheet ID
function openTracker(sheetUrl) {
  var s=String(sheetUrl||"").trim();
  var m=s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  var id=m ? m[1] : s;
  if(!/^[a-zA-Z0-9_-]{20,}$/.test(id)) throw new Error("That doesn't look like a Google Sheets link.");
  var ss;
  try { ss=SpreadsheetApp.openById(id); }
  catch(e){ throw new Error("Could not open that sheet. Use the link of the ORIGINAL tracker (not a copy)."); }
  if(!ss.getSheetByName(CONFIG_SHEET)) throw new Error("That sheet is not a Tournament Participation Tracker.");
  return ss;
}

// Players on a team tab = rows from row 4 down to the last row with a name or number
function countRosterRows(sh) {
  var last=sh.getLastRow();
  if(last<TEAM_FIRST_ROW) return 0;
  var vals=sh.getRange(TEAM_FIRST_ROW,1,last-TEAM_FIRST_ROW+1,TEAM_ROSTER_COLS).getValues();
  for(var i=vals.length-1;i>=0;i--){
    if(vals[i].some(function(v){ return String(v).trim()!==""; })) return i+1;
  }
  return 0;
}

function findTeam(cfg, name) {
  for(var i=0;i<(cfg.teams||[]).length;i++){ if(cfg.teams[i].name===name) return cfg.teams[i]; }
  return null;
}

// ── listTeams ─────────────────────────────────────────────────────────────────
function listTrackerTeams(data) {
  var ss=openTracker(data.sheetUrl);
  var cfg=readConfig(ss);
  return {
    tournamentName: cfg.tournamentName,
    division:       cfg.division,
    maxPlayers:     getMaxPlayers(cfg.division),
    hasLadder:      !!ss.getSheetByName(LADDER_SHEET),
    ladderSystem:   getLadderSystem(cfg),
    teams: (cfg.teams||[]).map(function(t){
      var sh=ss.getSheetByName(t.name);
      return { name:t.name, players: sh ? countRosterRows(sh) : null };
    }),
  };
}

// ── addPlayers ────────────────────────────────────────────────────────────────
function addPlayersToSheet(data) {
  var ss=openTracker(data.sheetUrl);
  var lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var cfg=readConfig(ss);
    var division=cfg.division;
    var team=findTeam(cfg, data.teamName);
    if(!team) throw new Error('Team "'+data.teamName+'" is not in this tracker.');
    var sh=ss.getSheetByName(team.name);
    if(!sh) throw new Error('The "'+team.name+'" tab is missing. If it was renamed, change the name back and try again.');

    var players=(data.players||[]).map(function(p){
      return { surname:String(p.surname||"").trim(), firstName:String(p.firstName||"").trim(),
               number:String(p.number||"").trim(), dob:String(p.dob||"").trim() };
    }).filter(function(p){ return p.surname||p.firstName; });
    if(!players.length) throw new Error("Enter at least one player's name.");
    players.forEach(function(p){
      if(p.dob&&!/^\d{4}-\d{2}-\d{2}$/.test(p.dob)) throw new Error("Date of birth for "+p.firstName+" "+p.surname+" must be a valid date.");
    });

    var existing=countRosterRows(sh);
    var max=getMaxPlayers(division);
    if(existing+players.length>max){
      throw new Error(team.name+" has "+existing+" players. Adding "+players.length+
        " would exceed the "+division+" maximum of "+max+".");
    }

    var cols=getGameColumns(division);
    var GAME_COLS=cols.length;
    var games=buildGameList(team.days||[]);
    var totalCols=TEAM_ROSTER_COLS+games.length*GAME_COLS;
    var startRow=TEAM_FIRST_ROW+existing;
    var n=players.length, total=existing+n;
    var iStat=colIdx(cols,"STATUS");

    sh.insertRowsAfter(startRow-1, n);

    // Values + formatting for the new rows (matches buildTeamSheet)
    var values=[], bgs=[], has=[], fws=[];
    players.forEach(function(p,i){
      var bg=(existing+i)%2===0 ? "#ffffff" : "#f5f5f5";
      var v=[],b=[],h=[],w=[];
      for(var c=0;c<totalCols;c++){ v.push(""); b.push(bg); h.push("center"); w.push("normal"); }
      v[0]=p.surname; v[1]=p.firstName; v[2]=p.number;
      h[0]="left"; h[1]="left";
      if(iStat>=0) games.forEach(function(g,gi){ w[TEAM_ROSTER_COLS+gi*GAME_COLS+iStat]="bold"; });
      values.push(v); bgs.push(b); has.push(h); fws.push(w);
    });
    var rng=sh.getRange(startRow,1,n,totalCols);
    rng.clearContent().clearNote().setBorder(false,false,false,false,false,false);
    rng.setValues(values).setBackgrounds(bgs).setHorizontalAlignments(has).setFontWeights(fws)
       .setFontFamily("Open Sans").setFontSize(11).setFontColor("#1a1a1a").setFontStyle("normal");
    players.forEach(function(p,i){
      if(p.dob) sh.getRange(startRow+i,1).setNote("DOB:"+p.dob);
      sh.setRowHeight(startRow+i,22);
    });
    SpreadsheetApp.flush();

    // STATUS formulas for the new rows only; existing rows are untouched
    applyStatusFormulas(sh,players,games,cols,division,cfg.startDate,getDivisionTiers(division),
      TEAM_ROSTER_COLS,GAME_COLS,startRow,n);

    // Redraw borders and colour rules over the whole, larger roster
    sh.getRange(TEAM_FIRST_ROW,1,total,totalCols).setBorder(false,false,false,false,false,false);
    applyTeamBorders(sh,games,cols,TEAM_ROSTER_COLS,GAME_COLS,total,totalCols);
    applyConditionalFormatting(sh,games,cols,TEAM_ROSTER_COLS,GAME_COLS,TEAM_FIRST_ROW,total,division);
    SpreadsheetApp.flush();

    team.players=(team.players||[]).concat(players);
    writeConfig(ss,cfg);

    return { added:n, team:team.name, players:total, max:max, url:ss.getUrl() };
  } finally {
    lock.releaseLock();
  }
}

// ── addLadder ─────────────────────────────────────────────────────────────────
function addLadderToSheet(data) {
  var ss=openTracker(data.sheetUrl);
  if(ss.getSheetByName(LADDER_SHEET)) throw new Error("This tracker already has a Ladder.");
  var lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var cfg=readConfig(ss);
    cfg.finalsTeams=Math.max(0,Math.min(Number(data.finalsTeams)||0,(cfg.teams||[]).length));
    cfg.ladderSystem=getLadderSystem({division:cfg.division, ladderSystem:data.ladderSystem});
    cfg.spreadsheetId=ss.getId();
    try{ cfg.webAppUrl=ScriptApp.getService().getUrl()||""; }catch(e){ cfg.webAppUrl=""; }
    writeConfig(ss,cfg);

    var ladderSheet=ss.insertSheet(LADDER_SHEET);
    var resultsSheet=ss.insertSheet(RESULTS_SHEET);
    buildResultsSheet(resultsSheet,cfg);
    SpreadsheetApp.flush();
    updateLadder(ss);

    // Rebuild the Instructions tab so it includes the ladder section
    var instr=null;
    ss.getSheets().forEach(function(sh){ if(sh.getName().indexOf("📋 Instructions")===0) instr=sh; });
    if(instr){
      instr.getRange(1,1,instr.getMaxRows(),instr.getMaxColumns()).breakApart();
      buildInstructionsSheet(instr,cfg.division,cfg.tournamentName,cfg.ladderSystem);
      var pos=instr.getIndex();
      ss.setActiveSheet(ladderSheet);  ss.moveActiveSheet(pos+1);
      ss.setActiveSheet(resultsSheet); ss.moveActiveSheet(pos+2);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  var triggerOk=true;
  try{ installLadderTrigger(ss); }
  catch(e){ triggerOk=false; Logger.log("Ladder trigger not installed: "+e.message); }
  return { url:ss.getUrl(), autoUpdate:triggerOk, ladderSystem:cfg.ladderSystem };
}
