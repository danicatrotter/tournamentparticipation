// ═══════════════════════════════════════════════════════════════════════
// Tournament Participation Tracker — Google Apps Script Web App
// Deploy as Web App: Execute as Me, Anyone can access
// Formatting: formulas + conditional formatting, works for any user
// ═══════════════════════════════════════════════════════════════════════

function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  try {
    var data = JSON.parse(e.postData.contents);
    var url  = createTournamentSheet(data);
    output.setContent(JSON.stringify({ ok:true, url:url }));
  } catch(err) {
    output.setContent(JSON.stringify({ ok:false, error:err.message }));
  }
  return output;
}

function doGet(e) {
  if(e&&e.parameter&&e.parameter.action==="ladder"&&e.parameter.id){
    return refreshLadderPage(e.parameter.id); // see Ladder.gs
  }
  return ContentService.createTextOutput(
    JSON.stringify({ ok:true, status:"Tournament Participation Tracker running" })
  ).setMimeType(ContentService.MimeType.JSON);
}

// ── Column schema ─────────────────────────────────────────────────────────────
function getGameColumns(division) {
  var hasDO = (division==="LL"||division==="IL"||division==="JL");
  var cols = [];
  if (hasDO) cols.push({ key:"DO",    label:"DO",    width:44  }); // fits "YES"
  cols.push(   { key:"Start", label:"Start", width:42  }); // fits 3 digits
  cols.push(   { key:"P",     label:"P",     width:38  }); // fits 3 digits
  cols.push(   { key:"STATUS",label:"STATUS",width:110 }); // fits "⛔ Ineligible"
  cols.push(   { key:"C",     label:"C",     width:38  }); // fits 3 digits
  return cols;
}

function colIdx(cols, key) {
  for (var i=0; i<cols.length; i++) { if (cols[i].key===key) return i; }
  return -1;
}

// ── Pitch tiers per division ──────────────────────────────────────────────────
function getDivisionTiers(division) {
  if (division==="AYC U18") {
    return [{max:30,rest:0},{max:45,rest:1},{max:60,rest:2},{max:80,rest:3},{max:9999,rest:4}];
  }
  if (division==="SL"||division==="AYC U16"||division==="AWC"||division==="AYWC") {
    return [{max:30,rest:0},{max:45,rest:1},{max:60,rest:2},{max:75,rest:3},{max:9999,rest:4}];
  }
  // LL, IL, JL
  return [{max:20,rest:0},{max:35,rest:1},{max:50,rest:2},{max:65,rest:3},{max:9999,rest:4}];
}

// Build a nested IF rest-days formula for a single cell reference.
// Returns a number 0-4 or "" if blank.
function restDaysFormula(cellRef, tiers) {
  // Build inside-out
  var inner = String(tiers[tiers.length-1].rest);
  for (var i=tiers.length-2; i>=0; i--) {
    inner = "IF("+cellRef+"<="+tiers[i].max+","+tiers[i].rest+","+inner+")";
  }
  return "IF(OR(ISBLANK("+cellRef+"),"+cellRef+"=0),0,"+inner+")";
}

// Convert a rest-days number formula to a text label
function restDaysLabel(daysFormula) {
  return 'IF(('+daysFormula+')=0,"Nil",IF(('+daysFormula+')=1,"1 Day",IF(('+daysFormula+')=2,"2 Days",IF(('+daysFormula+')=3,"3 Days","4 Days"))))';
}

// Column letter from 1-based number
function colLetter(n) {
  var s="";
  while(n>0){var r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}
  return s;
}

// ── Game list ─────────────────────────────────────────────────────────────────
function buildGameList(days) {
  var games=[];
  days.forEach(function(d,di){
    for(var g=1;g<=d.games;g++) games.push({dayIdx:di,gameNum:g,dayLabel:d.label});
  });
  return games;
}

// ── Age calculation ───────────────────────────────────────────────────────────
function calcLeagueAge(dobStr,startDateStr) {
  if(!dobStr) return null;
  try {
    var dob=new Date(dobStr);
    var yr=new Date(startDateStr||new Date()).getFullYear();
    var cutoff=new Date(yr,7,31);
    var age=yr-dob.getFullYear();
    if(new Date(yr,dob.getMonth(),dob.getDate())>cutoff) age--;
    return age;
  } catch(e){return null;}
}

function calcActualAge(dobStr,startDateStr) {
  if(!dobStr) return null;
  try {
    var dob=new Date(dobStr),ref=new Date(startDateStr||new Date());
    var age=ref.getFullYear()-dob.getFullYear();
    var m=ref.getMonth()-dob.getMonth();
    if(m<0||(m===0&&ref.getDate()<dob.getDate())) age--;
    return age;
  } catch(e){return null;}
}

function getPlayerAge(dob,startDate,division) {
  if(!dob) return null;
  if(division==="AYC U16"||division==="AYC U18"||division==="AWC"||division==="AYWC")
    return calcActualAge(dob,startDate);
  return calcLeagueAge(dob,startDate);
}

function getDefaultAge(division) {
  return {LL:12,IL:12,JL:13,SL:15,"AYC U16":15,"AYC U18":17,AWC:17,AYWC:15}[division]||15;
}

// ── Main creator ──────────────────────────────────────────────────────────────
function createTournamentSheet(data) {
  var tournamentName=data.tournamentName||"Tournament";
  var startDate=data.startDate||"";
  var teams=data.teams||[];
  var email=data.email||"";
  var division=data.division||"JL";
  var finalsTeams=Math.max(0,Math.min(Number(data.finalsTeams)||0,teams.length));

  // Team names drive the ladder and tab names, so they must be unique
  var usedNames={};
  teams.forEach(function(team,i){
    var base=String(team.name||"").trim()||("Team "+(i+1));
    var name=base, n=2;
    while(usedNames[name.toLowerCase()]) name=base+" ("+(n++)+")";
    usedNames[name.toLowerCase()]=true;
    team.name=name;
  });

  var ss=SpreadsheetApp.create(tournamentName);
  var spreadsheetId=ss.getId();
  var defaultSheet=ss.getSheets()[0];

  var webAppUrl="";
  try{ webAppUrl=ScriptApp.getService().getUrl()||""; }catch(e){}
  var cfg={
    tournamentName:tournamentName,startDate:startDate,division:division,teams:teams,
    finalsTeams:finalsTeams,spreadsheetId:spreadsheetId,webAppUrl:webAppUrl
  };

  var configSheet=ss.insertSheet("__config__");
  configSheet.getRange(1,1).setValue(JSON.stringify(cfg));
  configSheet.hideSheet();

  var instrSheet=ss.insertSheet("📋 Instructions — "+division);
  SpreadsheetApp.flush();
  buildInstructionsSheet(instrSheet,division,tournamentName);
  SpreadsheetApp.flush();

  // Ladder + Results (see Ladder.gs)
  var ladderSheet=ss.insertSheet(LADDER_SHEET);
  var resultsSheet=ss.insertSheet(RESULTS_SHEET);
  buildResultsSheet(resultsSheet,cfg);
  SpreadsheetApp.flush();
  updateLadder(ss);
  SpreadsheetApp.flush();

  teams.forEach(function(team){
    var teamDays=team.days||[];
    var games=buildGameList(teamDays);
    var cols=getGameColumns(division);
    var sh=ss.insertSheet(team.name||"Team");
    SpreadsheetApp.flush();
    buildTeamSheet(sh,team,games,cols,tournamentName,startDate,division);
    SpreadsheetApp.flush();
  });

  try{ss.deleteSheet(defaultSheet);}catch(e){}
  ss.setActiveSheet(ladderSheet);
  ss.moveActiveSheet(1);
  ss.setActiveSheet(resultsSheet);
  ss.moveActiveSheet(2);
  ss.setActiveSheet(instrSheet);
  ss.moveActiveSheet(1);

  // Auto-update the ladder when results are entered. If this fails (e.g. the
  // script has not been re-authorised for triggers) the sheet is still created
  // and the "Recalculate ladder" link on the Ladder tab still works.
  try{ installLadderTrigger(ss); }
  catch(e){ Logger.log("Ladder trigger not installed: "+e.message); }

  if(email){
    DriveApp.getFileById(spreadsheetId).addEditor(email);
    MailApp.sendEmail({
      to:email,
      subject:tournamentName+" — Participation Tracker Ready",
      body:
        "Your Tournament Participation Tracker for "+tournamentName+" is ready.\n\n"+
        "Open it here: https://docs.google.com/spreadsheets/d/"+spreadsheetId+"/edit\n\n"+
        "Competition Division: "+division+"\n\n"+
        "─────────────────────────────\n"+
        "TO MAKE YOURSELF THE OWNER:\n"+
        "Open the spreadsheet, then go to File → Make a copy.\n"+
        "Your copy will be fully owned by you in your Google Drive.\n\n"+
        "Note: the Ladder only updates automatically in the ORIGINAL sheet.\n"+
        "Enter pool play results in the original, not in a copy.\n"+
        "─────────────────────────────",
    });
  }
  return "https://docs.google.com/spreadsheets/d/"+spreadsheetId+"/edit";
}

// ── Build one team sheet ──────────────────────────────────────────────────────
function buildTeamSheet(sh,team,games,cols,tournamentName,startDate,division) {
  var ROSTER_COLS=3;
  var GAME_COLS=cols.length;
  var totalCols=ROSTER_COLS+games.length*GAME_COLS;
  var players=team.players||[];
  var numP=players.length;
  var totalRows=3+numP;
  var firstRow=4;
  var tiers=getDivisionTiers(division);

  var iDO   =colIdx(cols,"DO");
  var iP    =colIdx(cols,"P");
  var iStart=colIdx(cols,"Start");
  var iStat =colIdx(cols,"STATUS");
  var iC    =colIdx(cols,"C");

  sh.clearContents();sh.clearFormats();sh.clearConditionalFormatRules();

  // ── Colours ───────────────────────────────────────────────────────────────
  var H1="#1a3a5c",H1F="#ffffff";
  var H2="#2d6a9f",H2F="#ffffff";
  var H3="#4a90c4",H3F="#ffffff";
  var ODD="#ffffff",EVEN="#f5f5f5";
  var TEXT="#1a1a1a",FONT="Open Sans",FS=11;

  // ── Batch write header + player rows ─────────────────────────────────────
  var values=[],bgs=[],fcs=[],fws=[],has=[],ffs=[],fss=[];

  function makeRow(len,bg,fc,fw,ha){
    var rv=[],rb=[],rf=[],rw=[],rh=[],rff=[],rfs=[];
    for(var i=0;i<len;i++){
      rv.push("");rb.push(bg);rf.push(fc);rw.push(fw||"normal");
      rh.push(ha||"CENTER");rff.push(FONT);rfs.push(FS);
    }
    return {v:rv,b:rb,f:rf,w:rw,h:rh,ff:rff,fs:rfs};
  }

  var r1=makeRow(totalCols,H1,H1F,"bold","CENTER");
  values.push(r1.v);bgs.push(r1.b);fcs.push(r1.f);fws.push(r1.w);has.push(r1.h);ffs.push(r1.ff);fss.push(r1.fs);

  var r2=makeRow(totalCols,H2,H2F,"bold","CENTER");
  r2.v[0]="Roster";r2.v[1]="";r2.v[2]=""; // merged below; game cols set by day label merge
  games.forEach(function(g,gi){r2.v[ROSTER_COLS+gi*GAME_COLS]="Game "+g.gameNum;});
  values.push(r2.v);bgs.push(r2.b);fcs.push(r2.f);fws.push(r2.w);has.push(r2.h);ffs.push(r2.ff);fss.push(r2.fs);

  var r3=makeRow(totalCols,H3,H3F,"bold","CENTER");
  r3.v[0]="Surname";r3.v[1]="First Name";r3.v[2]="#";
  games.forEach(function(g,gi){
    cols.forEach(function(col,ci){r3.v[ROSTER_COLS+gi*GAME_COLS+ci]=col.label;});
  });
  values.push(r3.v);bgs.push(r3.b);fcs.push(r3.f);fws.push(r3.w);has.push(r3.h);ffs.push(r3.ff);fss.push(r3.fs);

  players.forEach(function(p,pi){
    var bg=pi%2===0?ODD:EVEN;
    var row=makeRow(totalCols,bg,TEXT,"normal","CENTER");
    row.v[0]=p.surname||"";row.v[1]=p.firstName||"";row.v[2]=p.number||"";
    row.h[0]="LEFT";row.h[1]="LEFT";
    if(iStat>=0) games.forEach(function(g,gi){row.w[ROSTER_COLS+gi*GAME_COLS+iStat]="bold";});
    values.push(row.v);bgs.push(row.b);fcs.push(row.f);fws.push(row.w);
    has.push(row.h);ffs.push(row.ff);fss.push(row.fs);
  });

  var range=sh.getRange(1,1,totalRows,totalCols);
  range.setValues(values);range.setBackgrounds(bgs);range.setFontColors(fcs);
  range.setFontWeights(fws);range.setHorizontalAlignments(has);
  range.setFontFamilies(ffs);range.setFontSizes(fss);
  SpreadsheetApp.flush();

  // ── Row 1 merges ──────────────────────────────────────────────────────────
  sh.getRange(1,1,1,ROSTER_COLS).merge()
    .setValue(tournamentName+" ("+division+")")
    .setBackground(H1).setFontColor(H1F).setFontWeight("bold")
    .setFontSize(11).setFontFamily(FONT).setHorizontalAlignment("left");

  var dayGroups={};
  games.forEach(function(g,gi){
    if(!dayGroups[g.dayIdx]) dayGroups[g.dayIdx]={label:g.dayLabel,start:gi,count:0};
    dayGroups[g.dayIdx].count++;
  });
  Object.keys(dayGroups).forEach(function(key){
    var dg=dayGroups[key];
    var col=ROSTER_COLS+dg.start*GAME_COLS+1;
    var span=dg.count*GAME_COLS;
    var cell=sh.getRange(1,col,1,span);
    if(span>1) cell.merge();
    cell.setValue(dg.label).setBackground(H1).setFontColor(H1F)
        .setFontWeight("bold").setHorizontalAlignment("center").setFontFamily(FONT);
  });

  // Merge roster columns in row 2 and label as "Roster"
  sh.getRange(2,1,1,ROSTER_COLS).merge()
    .setValue("Roster").setBackground(H2).setFontColor(H2F)
    .setFontWeight("bold").setHorizontalAlignment("center").setFontFamily(FONT);
  games.forEach(function(g,gi){
    sh.getRange(2,ROSTER_COLS+gi*GAME_COLS+1,1,GAME_COLS).merge();
  });
  SpreadsheetApp.flush();

  // ── Borders ───────────────────────────────────────────────────────────────
  if(numP>0){
    var SM=SpreadsheetApp.BorderStyle.SOLID_MEDIUM;
    var SO=SpreadsheetApp.BorderStyle.SOLID;
    var DARK="#1a3a5c",MID="#999999";
    sh.getRange(1,1,3,totalCols).setBorder(true,true,true,true,null,null,DARK,SM);
    sh.getRange(4,1,numP,totalCols).setBorder(true,true,true,true,null,null,DARK,SM);
    sh.getRange(1,ROSTER_COLS+1,totalRows,1).setBorder(null,true,null,null,null,null,DARK,SM);
    games.forEach(function(g,gi){
      var bc=ROSTER_COLS+gi*GAME_COLS+1;
      sh.getRange(1,bc,totalRows,GAME_COLS).setBorder(true,true,true,true,null,null,DARK,SM);
      sh.getRange(4,bc+1,numP,1).setBorder(null,true,null,null,null,null,MID,SO);
      var si=null;
      cols.forEach(function(col,ci){if(col.key==="STATUS") si=ci;});
      if(si!==null&&si+1<GAME_COLS)
        sh.getRange(4,bc+si+1,numP,1).setBorder(null,true,null,null,null,null,MID,SO);
      sh.getRange(4,bc,numP,GAME_COLS).setBorder(null,null,null,null,null,true,"#dddddd",SO);
    });
    if(numP>1) sh.getRange(4,1,numP,ROSTER_COLS).setBorder(null,null,null,null,null,true,"#dddddd",SO);
  }
  SpreadsheetApp.flush();

  // ── DOB notes ─────────────────────────────────────────────────────────────
  players.forEach(function(p,pi){if(p.dob) sh.getRange(4+pi,1).setNote("DOB:"+p.dob);});

  // ── Column widths + row heights ───────────────────────────────────────────
  sh.setColumnWidth(1,120); // Surname: fixed — header text is long, don't auto-resize
  sh.autoResizeColumn(2);   // First name: fit to header
  sh.autoResizeColumn(3);   // Player number: fit to header
  games.forEach(function(g,gi){
    cols.forEach(function(col,ci){
      sh.setColumnWidth(ROSTER_COLS+gi*GAME_COLS+ci+1,col.width);
    });
  });
  sh.setRowHeight(1,28);sh.setRowHeight(2,24);sh.setRowHeight(3,22);
  for(var r=4;r<4+numP;r++) sh.setRowHeight(r,22);
  sh.setFrozenRows(3);sh.setFrozenColumns(3);
  SpreadsheetApp.flush();

  // ── STATUS formulas + conditional formatting ──────────────────────────────
  if(numP>0){
    applyStatusFormulas(sh,players,games,cols,division,startDate,tiers,
      ROSTER_COLS,GAME_COLS,firstRow,numP);
    applyConditionalFormatting(sh,games,cols,ROSTER_COLS,GAME_COLS,firstRow,numP,division);
  }
  SpreadsheetApp.flush();
}

// ── Apply STATUS formulas ─────────────────────────────────────────────────────
// Key design: the STATUS formula for each game is self-contained and references
// only fixed column letters. This keeps formulas short and avoids length limits.
function applyStatusFormulas(sh,players,games,cols,division,startDate,tiers,
    ROSTER_COLS,GAME_COLS,firstRow,numP) {

  var iP    =colIdx(cols,"P");
  var iStart=colIdx(cols,"Start");
  var iStat =colIdx(cols,"STATUS");
  var iC    =colIdx(cols,"C");
  var iDO   =colIdx(cols,"DO");

  // Pre-compute column letters for every game's P, Start, C, STATUS
  var gameInfo=games.map(function(g,gi){
    var base=ROSTER_COLS+gi*GAME_COLS+1;
    return {
      gi:gi,g:g,base:base,
      pLetter:    iP>=0    ? colLetter(base+iP)    : null,
      startLetter:iStart>=0? colLetter(base+iStart): null,
      statLetter: iStat>=0 ? colLetter(base+iStat) : null,
      cLetter:    iC>=0    ? colLetter(base+iC)     : null,
      doLetter:   iDO>=0   ? colLetter(base+iDO)    : null,
    };
  });

  players.forEach(function(p,pi){
    var row=firstRow+pi;
    var R=row.toString();

    // Get player age
    var note=sh.getRange(row,1).getNote()||"";
    var dm=note.match(/DOB:([\d-]+)/);
    var dob=dm?dm[1]:(p.dob||"");
    var age=getPlayerAge(dob,startDate,division)||getDefaultAge(division);
    var noLimit=(division==="AWC"&&age>=18);
    var noPitchCatch=(division==="AYC U16"||division==="AYC U18"||
                      division==="AWC"||division==="AYWC");
    // Divisions where pitching in both games of a DH is allowed
    // (JL non-age12 and SL): pitch counts add together for rest purposes
    var canPitchBothGames=(division==="JL"&&age!==12)||division==="SL";


    gameInfo.forEach(function(gi_info,gi){
      if(iStat<0) return;
      var statCell=sh.getRange(row,gi_info.base+iStat);

      if(noLimit){statCell.setValue("");return;}

      var pRef    =gi_info.pLetter     ? gi_info.pLetter+R     : null;
      var stRef   =gi_info.startLetter ? gi_info.startLetter+R : null;
      var cRef    =gi_info.cLetter     ? gi_info.cLetter+R     : null;
      var dayIdx  =gi_info.g.dayIdx;
      var gameNum =gi_info.g.gameNum;

      // Start is the ONLY column used for rest-day calculations
      if(!stRef) return;

      // ── Rest basis ───────────────────────────────────────────────────
      // For game 2 in JL(non-age12)/SL: sum both games Start — combined
      // pitch count from both DH games drives the rest requirement.
      var basisExpr = stRef;
      if(canPitchBothGames && gameNum===2){
        var g1forBasis=null;
        gameInfo.forEach(function(prev){
          if(prev.g.dayIdx===dayIdx&&prev.g.gameNum===1&&prev.startLetter)
            g1forBasis=prev;
        });
        if(g1forBasis)
          basisExpr='('+g1forBasis.startLetter+R+'+'+stRef+')';
      }

      // ── Rest days for THIS game ───────────────────────────────────────
      var thisDays  = restDaysFormula(basisExpr, tiers);
      var thisLabel = restDaysLabel(thisDays);
      // Show rest label when Start > 0. Both blank -> empty.
      var normalStatus = 'IF('+stRef+'>0,'+thisLabel+',"")' ;

      // ── Previous days blackout ────────────────────────────────────────
      // Collect ALL games from each previous day — not just the first.
      // If a player only pitched in game 2 of a doubleheader, game 1
      // has Start=0. Storing only game 1 kills the blackout condition.
      var prevDayData={};
      gameInfo.forEach(function(prev,pgi){
        if(pgi>=gi) return;
        if(!prev.startLetter) return;
        var pd=prev.g.dayIdx;
        if(!prevDayData[pd]) prevDayData[pd]=[];
        prevDayData[pd].push(prev.startLetter+R);
      });

      // Build blackout conditions from previous days
      var blackoutParts=[];
      Object.keys(prevDayData).forEach(function(pd){
        pd=Number(pd);
        var gap=dayIdx-pd;
        if(gap<=0) return;
        var stRefs=prevDayData[pd];
        if(canPitchBothGames && stRefs.length>1){
          // JL/SL DH: sum all games on that day — combined pitch count drives rest
          var sumExpr='('+stRefs.join('+')+')';
          var anyPitched='OR('+stRefs.map(function(s){return s+'>0';}).join(',')+')'
          var prevDays=restDaysFormula(sumExpr,tiers);
          blackoutParts.push("AND("+anyPitched+",("+prevDays+")>="+gap+")");
        } else {
          // All other divisions: at most one game can have pitches, treat independently
          stRefs.forEach(function(stRef){
            var prevDays=restDaysFormula(stRef,tiers);
            blackoutParts.push("AND("+stRef+">0,("+prevDays+")>="+gap+")");
          });
        }
      });

      // 3-consecutive-days rule — any game pitched on each of the two previous days
      var pd1games=prevDayData[dayIdx-1], pd2games=prevDayData[dayIdx-2];
      if(pd1games&&pd2games){
        var pd1any=pd1games.map(function(s){return s+'>0';}).join(',');
        var pd2any=pd2games.map(function(s){return s+'>0';}).join(',');
        if(pd1games.length>1) pd1any='OR('+pd1any+')';
        if(pd2games.length>1) pd2any='OR('+pd2any+')';
        blackoutParts.push('AND('+pd1any+','+pd2any+')');
      }
      // ── Game 2 same-day blocking ──────────────────────────────────────
      var g2blockPart=null;
      if(gameNum===2){
        // Find game 1 of same day
        var g1=null;
        gameInfo.forEach(function(prev){
          if(prev.g.dayIdx===dayIdx&&prev.g.gameNum===1) g1=prev;
        });
        if(g1&&g1.startLetter){
          var g1st=g1.startLetter?g1.startLetter+R:null;
          var g1basis=g1st; // Start ONLY — no P fallback

          if(division==="LL"||division==="IL"){
            g2blockPart=g1basis+'>0';
          } else if(division==="JL"){
            g2blockPart=(age===12)
              ? g1basis+'>0'
              : g1basis+'>30';
          } else if(division==="SL"){
            g2blockPart=g1basis+'>30';
          } else {
            // AYC/AWC/AYWC — one outing per day
            g2blockPart=g1basis+'>0';
          }
        }

        // Catcher-to-pitcher block: if G1 catching ≥4 innings → ⛔ Ineligible in G2
        // Gated on g1.cLetter only — Start need not be entered in G1
        if(g1&&g1.cLetter){
          var catchBlock=g1.cLetter+R+">=4";
          g2blockPart=g2blockPart?"OR("+g2blockPart+","+catchBlock+")":catchBlock;
        }
      }

      // ── Flag conditions ───────────────────────────────────────────────
      var flagParts=[];

      if(noPitchCatch&&cRef){
        // Same-day: any catching on this day when pitching
        var dayCatchRefs=[];
        gameInfo.forEach(function(other){
          if(other.g.dayIdx===dayIdx&&other.cLetter)
            dayCatchRefs.push(other.cLetter+R);
        });
        if(dayCatchRefs.length>0){
          var anyCatch=dayCatchRefs.map(function(r){return r+'<>""';}).join(",");
          anyCatch=dayCatchRefs.length>1?"OR("+anyCatch+")":anyCatch;
          flagParts.push("AND("+stRef+">0,"+anyCatch+")");
        }
      } else if(cRef){
        // Same game: C>=4 is tracked separately as ⛔ Ineligible (proactive —
        // fires as soon as C is entered, no Start needed)
        // Removed from flagParts — handled by catcherIneligPart below
      }

      if(!noPitchCatch&&gameNum===2){
        var g1f=null;
        gameInfo.forEach(function(prev){
          if(prev.g.dayIdx===dayIdx&&prev.g.gameNum===1) g1f=prev;
        });
        if(g1f&&g1f.startLetter){
          var g1fst=g1f.startLetter+R;
          // G1 ≥21 pitches and this game has pitches
          flagParts.push("AND("+stRef+">0,"+g1fst+">=21)");

        }
      }

      // ── Assemble final STATUS formula ─────────────────────────────────
      // Same-game catcher ineligible: proactive ⛔ as soon as C>=4,
      // no Start required — scorer should not pitch this player at all
      // Only block pitching when Start is blank - if Start is already entered,
      // pitching came first and catching after is permitted (under 41-pitch rule).
      // Entry order proxy: Start present = pitched first.
      var catcherIneligPart=(!noPitchCatch&&cRef&&stRef) ? "AND("+stRef+"<=0,"+cRef+">=4)" : null;

      // Combine all ⛔ Ineligible sources: G2 same-day block + same-game catcher
      var allIneligParts=[];
      if(g2blockPart)       allIneligParts.push(g2blockPart);
      if(catcherIneligPart) allIneligParts.push(catcherIneligPart);

      // Priority (innermost → outermost = lowest → highest):
      //   normalStatus → ⛔ Ineligible → ⛔ Rest → ⚠️ Review
      var formula=normalStatus;

      if(allIneligParts.length>0){
        var ineligCond=allIneligParts.length===1
          ? allIneligParts[0]
          : "OR("+allIneligParts.join(",")+")";
        formula='IF('+ineligCond+',"⛔ Ineligible",'+formula+')';
      }

      if(blackoutParts.length>0){
        var blackoutCond=blackoutParts.length===1
          ? blackoutParts[0]
          : "OR("+blackoutParts.join(",")+")";
        formula='IF('+blackoutCond+',"⛔ Rest",'+formula+')';
      }

      if(flagParts.length>0){
        var flagCond=flagParts.length===1
          ? flagParts[0]
          : "OR("+flagParts.join(",")+")";
        formula='IF('+flagCond+',"⚠️ Review",'+formula+')';
      }
      statCell.setFormula("="+formula);
    });
  });
  SpreadsheetApp.flush();
}

// ── Apply conditional formatting ──────────────────────────────────────────────
function applyConditionalFormatting(sh,games,cols,ROSTER_COLS,GAME_COLS,firstRow,numP,division) {
  var iDO   =colIdx(cols,"DO");
  var iP    =colIdx(cols,"P");
  var iStart=colIdx(cols,"Start");
  var iStat =colIdx(cols,"STATUS");
  var iC    =colIdx(cols,"C");
  var noPitchCatch=(division==="AYC U16"||division==="AYC U18"||
                    division==="AWC"||division==="AYWC");

  var rules=[];

  games.forEach(function(g,gi){
    var base=ROSTER_COLS+gi*GAME_COLS+1;
    var statLetter=iStat>=0 ? colLetter(base+iStat) : null;

    // ── STATUS colours ────────────────────────────────────────────────
    if(statLetter){
      var statRange=sh.getRange(firstRow,base+iStat,numP,1);

      // ✅ Verified — manual override, bright green, highest priority
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextStartsWith("✅")
        .setBackground("#1e8c3a").setFontColor("#ffffff").setBold(true)
        .setRanges([statRange]).build());
      // Ensure STATUS data cells are centred so ✅ Verified sits correctly
      statRange.setHorizontalAlignment("center").setVerticalAlignment("middle");

      // ⛔ — black
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextStartsWith("⛔")
        .setBackground("#222222").setFontColor("#aaaaaa").setBold(false)
        .setRanges([statRange]).build());

      // Nil — green
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("Nil")
        .setBackground("#c8f0c8").setFontColor("#1a7a1a")
        .setRanges([statRange]).build());

      // 1 Day — amber
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("1 Day")
        .setBackground("#ffe066").setFontColor("#7a5000")
        .setRanges([statRange]).build());

      // 2/3/4 Days — deeper amber
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextContains("Days")
        .setBackground("#ffb300").setFontColor("#5a3000")
        .setRanges([statRange]).build());

      // ⚠️ Review — red flag
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextStartsWith("⚠️")
        .setBackground("#cc2222").setFontColor("#ffffff")
        .setRanges([statRange]).build());

      // ── P column: black when ⛔, pink when ⚠️ ─────────────────────
      if(iP>=0){
        var pRange=sh.getRange(firstRow,base+iP,numP,1);
        rules.push(SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=LEFT('+statLetter+firstRow+',1)="⛔"')
          .setBackground("#222222").setFontColor("#888888")
          .setRanges([pRange]).build());
        rules.push(SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=LEFT('+statLetter+firstRow+',1)="⚠"')
          .setBackground("#ffeeee").setFontColor("#cc0000")
          .setRanges([pRange]).build());
      }

      // ── Start column: black when ⛔ ───────────────────────────────
      if(iStart>=0){
        var startRange=sh.getRange(firstRow,base+iStart,numP,1);
        rules.push(SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=LEFT('+statLetter+firstRow+',1)="⛔"')
          .setBackground("#222222").setFontColor("#888888")
          .setRanges([startRange]).build());
      }

      // ── C column: black when ⛔ (can't pitch = can't catch for AYC/AWC/AYWC)
      //             black when ⛔ Rest/Ineligible for all divisions
      //             pink when ⚠️ flag
      if(iC>=0){
        var cRange=sh.getRange(firstRow,base+iC,numP,1);
        // For AYC/AWC/AYWC: C blacks out on ⛔ (no pitch-and-catch same day —
        // if ⛔ Ineligible they pitched in G1 so can't catch G2 either)
        // For LL/IL/JL/SL: pitching rest does NOT prevent catching — only the
        // 41+ pitch yellow rule restricts catching, handled separately below.
        if(noPitchCatch){
          rules.push(SpreadsheetApp.newConditionalFormatRule()
            .whenFormulaSatisfied('=LEFT('+statLetter+firstRow+',1)="⛔"')
            .setBackground("#222222").setFontColor("#888888")
            .setRanges([cRange]).build());
        }
        // For AYC/AWC/AYWC: C also blacks out when STATUS shows any rest days
        if(noPitchCatch){
          rules.push(SpreadsheetApp.newConditionalFormatRule()
            .whenFormulaSatisfied('=AND('+statLetter+firstRow+'<>"",'+statLetter+firstRow+'<>"Nil",LEFT('+statLetter+firstRow+',1)<>"⚠",LEFT('+statLetter+firstRow+',1)<>"⛔")')
            .setBackground("#ffe0b0").setFontColor("#7a4000")
            .setRanges([cRange]).build());
        }
        // ── Yellow: can't catch due to 41+ pitch rule (LL/IL/JL/SL only) ──
        // Uses OR(Start>=41, P>=41) — whichever is entered first triggers the warning
        if(!noPitchCatch && (iStart>=0||iP>=0)){
          var startLet41=iStart>=0?colLetter(base+iStart):null;
          var pLet41=iP>=0?colLetter(base+iP):null;
          var parts41=[];
          if(startLet41) parts41.push(startLet41+firstRow+'>=41');
          if(pLet41)     parts41.push(pLet41+firstRow+'>=41');
          var cond41same=parts41.length>1?'OR('+parts41.join(',')+')'
                                         :parts41[0];
          // Same game: this game's Start or P >= 41
          rules.push(SpreadsheetApp.newConditionalFormatRule()
            .whenFormulaSatisfied('='+cond41same)
            .setBackground('#fff0a0').setFontColor('#7a5000')
            .setRanges([cRange]).build());
          // Game 2: game 1 of same day had Start or P >= 41
          if(g.gameNum===2){
            var g1cf=null; var g1cfIdx=-1;
            games.forEach(function(prev,pi){
              if(prev.dayIdx===g.dayIdx&&prev.gameNum===1){g1cf=prev;g1cfIdx=pi;}
            });
            if(g1cf!==null){
              var g1cfBase=ROSTER_COLS+g1cfIdx*GAME_COLS+1;
              var g1StartLet=iStart>=0?colLetter(g1cfBase+iStart):null;
              var g1PLet=iP>=0?colLetter(g1cfBase+iP):null;
              var g1parts41=[];
              if(g1StartLet) g1parts41.push(g1StartLet+firstRow+'>=41');
              if(g1PLet)     g1parts41.push(g1PLet+firstRow+'>=41');
              if(g1parts41.length>0){
                var cond41g1=g1parts41.length>1?'OR('+g1parts41.join(',')+')'
                                                :g1parts41[0];
                rules.push(SpreadsheetApp.newConditionalFormatRule()
                  .whenFormulaSatisfied('='+cond41g1)
                  .setBackground('#fff0a0').setFontColor('#7a5000')
                  .setRanges([cRange]).build());
              }
            }
          }
        }
        // Pink when flag — lowest C priority
        rules.push(SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=LEFT('+statLetter+firstRow+',1)="⚠"')
          .setBackground("#ffeeee").setFontColor("#cc0000")
          .setRanges([cRange]).build());
      }
    }

    // ── DO column: green YES, red NO ──────────────────────────────────
    if(iDO>=0){
      var doLetter=colLetter(base+iDO);
      var doRange=sh.getRange(firstRow,base+iDO,numP,1);
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=OR(UPPER('+doLetter+firstRow+')="YES",UPPER('+doLetter+firstRow+')="Y")')
        .setBackground("#c8f0c8").setFontColor("#1a7a1a").setBold(true)
        .setRanges([doRange]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=OR(UPPER('+doLetter+firstRow+')="NO",UPPER('+doLetter+firstRow+')="N")')
        .setBackground("#ffcccc").setFontColor("#cc0000").setBold(true)
        .setRanges([doRange]).build());
    }
  });

  sh.setConditionalFormatRules(rules);
  SpreadsheetApp.flush();
}

// ── Division instructions ─────────────────────────────────────────────────────
function getDivisionInstructions(division) {
  var isLL=division==="LL",isIL=division==="IL",isJL=division==="JL",isSL=division==="SL";
  var isAYC16=division==="AYC U16",isAYC18=division==="AYC U18";
  var isAWC=division==="AWC",isAYWC=division==="AYWC";
  var isAYCFam=isAYC16||isAYC18||isAWC||isAYWC;

  var divFull={
    "LL":"Little League (LL)","IL":"Intermediate League (IL)",
    "JL":"Junior League (JL)","SL":"Senior League (SL)",
    "AYC U16":"Australian Youth Championship U16 (AYC U16)",
    "AYC U18":"Australian Youth Championship U18 (AYC U18)",
    "AWC":"Australian Women's Championship (AWC)",
    "AYWC":"Australian Youth Women's Championship (AYWC)",
  }[division]||division;

  var ageSystem=isAYCFam
    ?"Player ages are calculated as their actual age on the tournament start date."
    :"Player ages are calculated using the Little League league age system — how old a player turns between 1 September of the previous year and 31 August of the current season year.";

  var maxP={LL:14,IL:14,JL:14,SL:16,"AYC U16":20,"AYC U18":20,AWC:18,AYWC:16}[division]||16;

  var pitchLimits,restTiers,twoGameRule,catchingRules,consecutiveRule,specialRules;

  if(isLL){
    pitchLimits="League age 7-8: 50 pitches per day.\nLeague age 9-10: 75 pitches per day.\nLeague age 11-12: 85 pitches per day.\nLeague age 13-14: 95 pitches per day.";
    restTiers="66 or more pitches — 4 calendar days rest\n51-65 pitches — 3 calendar days rest\n36-50 pitches — 2 calendar days rest\n21-35 pitches — 1 calendar day rest\n1-20 pitches — 0 days rest\n\nRest is calculated from the first pitch thrown to the final batter faced (Start value), not the last pitch delivered.";
    twoGameRule="A pitcher cannot pitch in two games in a day (Tournament Rule 4.f).\nOnce a pitcher throws even one pitch in Game 1, Game 2 pitch cells are automatically blacked out.";
    catchingRules="A player who catches 4 or more innings cannot pitch that calendar day.\nA player who catches 3 or fewer innings then pitches 21 or more pitches may not return to catch.\nA player who delivers 41 or more pitches may not catch for the remainder of that day.";
    consecutiveRule="Under no circumstances shall a player pitch in three consecutive calendar days.";
    specialRules="DO (Defensive Outs): All players must complete 3 consecutive Defensive Outs per game. Enter YES or NO. Green = completed, Red = not completed.\nPitchers once removed may not return as pitchers in Little League.";
  } else if(isIL){
    pitchLimits="League age 11-12: 85 pitches per day.\nLeague age 13: 95 pitches per day.";
    restTiers="66 or more pitches — 4 calendar days rest\n51-65 pitches — 3 calendar days rest\n36-50 pitches — 2 calendar days rest\n21-35 pitches — 1 calendar day rest\n1-20 pitches — 0 days rest\n\nRest is calculated from the first pitch thrown to the final batter faced (Start value).";
    twoGameRule="A pitcher cannot pitch in two games in a day (Tournament Rule 4.f).\nOnce a pitcher throws even one pitch in Game 1, Game 2 pitch cells are automatically blacked out.";
    catchingRules="A player who catches 4 or more innings cannot pitch that calendar day.\nA player who catches 3 or fewer innings then pitches 21 or more pitches may not return to catch.\nA player who delivers 41 or more pitches may not catch for the remainder of that day.";
    consecutiveRule="Under no circumstances shall a player pitch in three consecutive calendar days.";
    specialRules="DO (Defensive Outs): All players must complete 3 consecutive Defensive Outs per game. Enter YES or NO.\nPitchers may return to pitch later in the same game but only once per game.";
  } else if(isJL){
    pitchLimits="All Junior League players: 95 pitches per day maximum.";
    restTiers="66 or more pitches — 4 calendar days rest\n51-65 pitches — 3 calendar days rest\n36-50 pitches — 2 calendar days rest\n21-35 pitches — 1 calendar day rest\n1-20 pitches — 0 days rest\n\nRest is calculated from the first pitch thrown to the final batter faced (Start value).";
    twoGameRule="A player who pitches 30 or fewer pitches (Start value) in Game 1 may pitch in Game 2.\nIf the Start value exceeds 30, Game 2 is automatically blacked out.\nEXCEPTION — League Age 12: Cannot pitch in two games in a day regardless of pitch count.";
    catchingRules="A player who catches 4 or more innings cannot pitch that calendar day.\nA player who catches 3 or fewer innings then pitches 21 or more pitches may not return to catch.\nA player who delivers 41 or more pitches may not catch for the remainder of that day.";
    consecutiveRule="Under no circumstances shall a player pitch in three consecutive calendar days.";
    specialRules="DO (Defensive Outs): All players must complete 3 consecutive Defensive Outs per game. Enter YES or NO.\nPitchers may return to pitch later in the same game but only once per game.";
  } else if(isSL){
    pitchLimits="All Senior League players (league age 13-16): 95 pitches per day maximum.";
    restTiers="76 or more pitches — 4 calendar days rest\n61-75 pitches — 3 calendar days rest\n46-60 pitches — 2 calendar days rest\n31-45 pitches — 1 calendar day rest\n1-30 pitches — 0 days rest\n\nRest is calculated from the first pitch thrown to the final batter faced (Start value).";
    twoGameRule="A player who pitches 30 or fewer pitches (Start value) in Game 1 may pitch in Game 2.\nIf the Start value exceeds 30, Game 2 is automatically blacked out.";
    catchingRules="A player who catches 4 or more innings cannot pitch that calendar day.\nA player who catches 3 or fewer innings then pitches 31 or more pitches may not return to catch.\nA player who delivers 41 or more pitches may not catch for the remainder of that day.";
    consecutiveRule="Under no circumstances shall a player pitch in three consecutive calendar days.";
    specialRules="No Defensive Outs (DO) requirement in Senior League.\nPitchers may return to pitch later in the same game but only once per game.";
  } else if(isAYC16||isAYWC){
    pitchLimits="All players (actual age under 16 at tournament start): 95 pitches per day maximum.";
    restTiers="Short (1-30 pitches) — 0 days rest\nModerate (31-45 pitches) — 1 calendar day rest\nSubstantial (46-60 pitches) — 2 calendar days rest\nMajor (61-75 pitches) — 3 calendar days rest\nMaximum (76+ pitches) — 4 calendar days rest\n\nRest is calculated from the first pitch thrown to the final batter faced (Start value).";
    twoGameRule="Players may only pitch one outing per day (Technical Norms 17.6).\nOnce pitches are recorded in any game, all other game cells for that day are blacked out.\nPlayers with a Substantial, Major or Maximum assignment in Game 1 may only participate in Game 2 as DH, pinch hitter or pinch runner.";
    catchingRules="No player may pitch and catch on the same calendar day (Technical Norms 18.1).\nIf catching is recorded on a day a player has pitched, a ⚠️ Review flag appears.";
    consecutiveRule="A player cannot pitch on three consecutive calendar days.\nThree Short assignments on successive days require one day's rest (Technical Norms 17.4).";
    specialRules="No Defensive Outs (DO) requirement (Technical Norms 16.1).\nA player once removed from pitching may not pitch again in the same game.";
  } else if(isAYC18){
    pitchLimits="All players (actual age under 18 at tournament start): 105 pitches per day maximum.";
    restTiers="Short (1-30 pitches) — 0 days rest\nModerate (31-45 pitches) — 1 calendar day rest\nSubstantial (46-60 pitches) — 2 calendar days rest\nMajor (61-80 pitches) — 3 calendar days rest\nMaximum (81+ pitches) — 4 calendar days rest\n\nRest is calculated from the first pitch thrown to the final batter faced (Start value).";
    twoGameRule="Players may only pitch one outing per day (Technical Norms 17.6).\nOnce pitches are recorded in any game, all other game cells for that day are blacked out.";
    catchingRules="No player may pitch and catch on the same calendar day (Technical Norms 18.1).";
    consecutiveRule="A player cannot pitch on three consecutive calendar days.\nThree Short assignments on successive days require one day's rest (Technical Norms 17.4).";
    specialRules="No Defensive Outs (DO) requirement (Technical Norms 16.1).";
  } else if(isAWC){
    pitchLimits="Players UNDER 18 at tournament start: 95 pitches per day maximum.\nPlayers aged 18 OR OLDER at tournament start: no pitch limit and no rest requirements apply.";
    restTiers="For players under 18:\nShort (1-30 pitches) — 0 days rest\nModerate (31-45 pitches) — 1 calendar day rest\nSubstantial (46-60 pitches) — 2 calendar days rest\nMajor (61-75 pitches) — 3 calendar days rest\nMaximum (76+ pitches) — 4 calendar days rest\n\nPlayers 18+ — no limits apply.";
    twoGameRule="Players under 18 may only pitch one outing per day.\nPlayers aged 18 or older are not subject to the one-outing-per-day restriction.";
    catchingRules="Players under 18 may not pitch and catch on the same calendar day.\nEXCEPTION: Players aged 18 or over are exempt from the pitcher/catcher restriction.";
    consecutiveRule="Players under 18 cannot pitch on three consecutive calendar days.\nThree Short assignments on successive days require one day's rest.\nPlayers aged 18 or older are not subject to consecutive day restrictions.";
    specialRules="No Defensive Outs (DO) requirement (Technical Norms 16.1).\nPlayers 18+ at tournament start: pitch and status cells remain active regardless of pitch count.";
  }

  return {
    divFull:divFull,maxP:maxP,ageSystem:ageSystem,
    pitchLimits:pitchLimits,restTiers:restTiers,twoGameRule:twoGameRule,
    catchingRules:catchingRules,consecutiveRule:consecutiveRule,specialRules:specialRules,
  };
}

// ── Build instructions sheet ──────────────────────────────────────────────────
function buildInstructionsSheet(sh,division,tournamentName) {
  sh.clearContents();sh.clearFormats();
  sh.setColumnWidth(1,240);sh.setColumnWidth(2,620);

  var FONT="Open Sans";
  var HB="#1a3a5c",HF="#ffffff",GOLD="#c8a84b",DARK="#1a1a1a";
  var PALE="#f0f4f8",WHITE="#ffffff";
  var GBG="#c8f0c8",GFG="#1a7a1a";
  var ABG="#ffe066",AFG="#7a5000";
  var RBG="#ffcccc",RFG="#cc0000";
  var BBG="#222222",BFG="#888888";
  var FBG="#cc2222",FFG="#ffffff";

  var info=getDivisionInstructions(division);
  var row=1;

  function write(r,label,value,bold){
    sh.getRange(r,1).setValue(label||"").setFontFamily(FONT).setFontSize(10)
      .setFontWeight(bold?"bold":"normal").setFontColor(DARK).setWrap(true).setVerticalAlignment("top");
    sh.getRange(r,2).setValue(value||"").setFontFamily(FONT).setFontSize(10)
      .setFontWeight("normal").setFontColor(DARK).setWrap(true).setVerticalAlignment("top");
    sh.setRowHeight(r,Math.max(22,(value||"").split("\n").length*18));
  }
  function heading(r,text){
    sh.getRange(r,1,1,2).merge().setValue(text).setBackground(HB).setFontColor(HF)
      .setFontFamily(FONT).setFontSize(11).setFontWeight("bold").setVerticalAlignment("middle");
    sh.setRowHeight(r,28);
  }
  function subheading(r,text){
    sh.getRange(r,1,1,2).merge().setValue(text).setBackground(PALE).setFontColor(HB)
      .setFontFamily(FONT).setFontSize(10).setFontWeight("bold").setVerticalAlignment("middle");
    sh.setRowHeight(r,24);
  }
  function blank(r){sh.setRowHeight(r,8);sh.getRange(r,1,1,2).setBackground(WHITE);}
  function full(r,text,bg,fg){
    sh.getRange(r,1,1,2).merge().setValue(text||"").setBackground(bg||WHITE).setFontColor(fg||DARK)
      .setFontFamily(FONT).setFontSize(10).setWrap(true).setVerticalAlignment("top");
    sh.setRowHeight(r,Math.max(22,(text||"").split("\n").length*18));
  }
  function ck(r,bg,fg,label,meaning){
    sh.getRange(r,1).setValue(label).setBackground(bg).setFontColor(fg)
      .setFontFamily(FONT).setFontSize(10).setFontWeight("bold")
      .setHorizontalAlignment("center").setVerticalAlignment("middle");
    sh.getRange(r,2).setValue(meaning).setFontFamily(FONT).setFontSize(10)
      .setFontColor(DARK).setWrap(true).setVerticalAlignment("middle");
    sh.setRowHeight(r,22);
  }

  // Title
  sh.getRange(row,1,1,2).merge()
    .setValue("⚾  "+tournamentName+" — Participation Tracker Instructions")
    .setBackground(HB).setFontColor(GOLD).setFontFamily(FONT)
    .setFontSize(13).setFontWeight("bold").setVerticalAlignment("middle");
  sh.setRowHeight(row,36);row++;

  sh.getRange(row,1,1,2).merge()
    .setValue("Competition Division: "+info.divFull+
      "   ·   Max roster: "+info.maxP+" players"+
      "   ·   "+((division==="LL"||division==="IL"||division==="JL"||division==="SL")
        ?"League age system (1 Sep – 31 Aug)":"Actual age at tournament start date"))
    .setBackground("#2d6a9f").setFontColor(WHITE).setFontFamily(FONT)
    .setFontSize(10).setFontWeight("bold").setVerticalAlignment("middle");
  sh.setRowHeight(row,24);row++;
  blank(row);row++;

  heading(row,"HOW TO USE THIS SPREADSHEET");row++;
  write(row,"Team tabs","Each team has its own tab at the bottom. Click a team name to open their tracker.",false);row++;
  write(row,"Entering data","After each game enter Start (first pitch to last batter), P (total pitches), C (innings caught), and DO if applicable. Everything else is automatic.\n\nEntry order matters for pitcher/catcher combinations: always enter the role the player performed first. If they pitched first then caught, enter Start before C. If they caught first then pitched, enter C before Start. The system uses entry order to determine eligibility.",false);row++;
  write(row,"Automatic updates","STATUS, colours, and blackouts update instantly as you type. No scripts or triggers — works for anyone who opens the sheet.",false);row++;
  write(row,"Black cells","A black cell means the player is ineligible to pitch in that game. The STATUS cell shows the reason. Do not enter data in black cells.",false);row++;
  blank(row);row++;

  heading(row,"WHAT TO ENTER IN EACH COLUMN");row++;
  var hasDO=(division==="LL"||division==="IL"||division==="JL");
  if(hasDO){
    write(row,"DO  (Defensive Outs)","Type YES (or Y) if the player completed 3 Defensive Outs. Type NO (or N) if they did not. Turns green for YES, red for NO.",true);row++;
  }
  write(row,"Start  (First Pitch to Last Batter)","The pitch NUMBER of the first pitch thrown to the last batter faced. Enter this before P — it is the only value used to determine rest requirements. STATUS calculates automatically once Start is entered.",true);row++;
  write(row,"P  (Total Pitches)","Total pitches thrown in this game including balls, strikes, and fouls.",true);row++;
  write(row,"STATUS  (automatic — do not type here)","Fills automatically. Shows: Nil (no rest needed), rest days, ⛔ Rest/Ineligible (blacked out), or ⚠️ Review (human review needed).",true);row++;
  write(row,"⛔ Ineligible — Manual Override","If ⛔ Ineligible appears incorrectly (e.g. player pitched before catching, confirmed on scorecard), you can clear it manually. Click the STATUS cell, delete its contents, then paste: ✅ Verified\n\nThe cell will show ✅ Verified in bright green. This overrides the formula for that cell only — all other cells are unaffected. Note: only do this after confirming the order of play on the official scorecard.",false);row++;
  write(row,"C  (Innings Caught)","Number of complete innings caught in this game. Used to enforce pitcher/catcher restrictions.",true);row++;
  blank(row);row++;

  heading(row,"COLOUR KEY — STATUS COLUMN");row++;
  ck(row,GBG,GFG,"Nil","No rest required — player may pitch again the next day if otherwise eligible.");row++;
  ck(row,ABG,AFG,"1 Day","One full calendar day of rest required.");row++;
  ck(row,"#ffb300","#5a3000","2 / 3 / 4 Days","Multiple calendar days rest required.");row++;
  ck(row,BBG,BFG,"⛔ Rest / Ineligible","Player cannot pitch in this game. Do not enter pitches here.");row++;
  ck(row,FBG,FFG,"⚠️ Review","Potential rule issue — human review required before this player pitches.");row++;
  if(hasDO){
    ck(row,GBG,GFG,"DO — YES","Completed 3 Defensive Outs.");row++;
    ck(row,RBG,RFG,"DO — NO","Did not complete 3 Defensive Outs.");row++;
  }
  blank(row);row++;

  heading(row,"PITCH LIMITS — COMPETITION DIVISION: "+division);row++;
  info.pitchLimits.split("\n").forEach(function(l){if(!l.trim())return;full(row,l.trim());row++;});
  write(row,"Age system",info.ageSystem,true);row++;
  blank(row);row++;

  heading(row,"REST REQUIREMENTS — COMPETITION DIVISION: "+division);row++;
  subheading(row,"Start value (first pitch to last batter faced) → Rest required");row++;
  info.restTiers.split("\n").forEach(function(l){
    if(!l.trim())return;
    if(l.indexOf("—")>-1){var p=l.split("—");write(row,p[0].trim(),p[1].trim(),false);}
    else{full(row,l.trim(),PALE,HB);}
    row++;
  });
  blank(row);row++;

  heading(row,"DOUBLE-HEADER RULE — COMPETITION DIVISION: "+division);row++;
  info.twoGameRule.split("\n").forEach(function(l){if(!l.trim())return;full(row,l.trim());row++;});
  blank(row);row++;

  heading(row,"PITCHER / CATCHER RESTRICTIONS — COMPETITION DIVISION: "+division);row++;
  info.catchingRules.split("\n").forEach(function(l){if(!l.trim())return;full(row,l.trim());row++;});
  blank(row);row++;

  heading(row,"CONSECUTIVE DAY RULE — COMPETITION DIVISION: "+division);row++;
  info.consecutiveRule.split("\n").forEach(function(l){if(!l.trim())return;full(row,l.trim());row++;});
  blank(row);row++;

  heading(row,"ADDITIONAL NOTES — COMPETITION DIVISION: "+division);row++;
  info.specialRules.split("\n").forEach(function(l){if(!l.trim())return;full(row,l.trim());row++;});
  blank(row);row++;

  heading(row,"⚠️ REVIEW FLAGS — HUMAN ACTION REQUIRED");row++;
  full(row,
    "A ⚠️ Review flag means the tracker has detected a potential rule issue. "+
    "The player has NOT been blocked automatically — a responsible adult must review the scorecard "+
    "and confirm eligibility before the player pitches.\n\n"+
    "To clear a ⚠️ Review flag once checked and confirmed: the flag clears automatically when the "+
    "situation is resolved (e.g. the player does not pitch in that game and no data is entered). "+
    "If the player is confirmed eligible, no action is needed — the flag is advisory only and does not affect other calculations. "+
    "If the player is confirmed ineligible, remove their Start and P values for that game.");row++;
  blank(row);row++;
  subheading(row,"Flag  —  Meaning  —  Action required");row++;
  write(row,"⚠️ Review (pitches)","Pitcher threw 21 or more pitches in Game 1 and pitches are entered for Game 2, OR catching and pitching restrictions may have been breached. Review before allowing the player to pitch.",true);row++;
  if(division==="JL"){
    write(row,"⛔ Ineligible","Game 2 blacked out. Either League Age 12 restriction applies, or Start value in Game 1 exceeded 30.",true);row++;
  }
  if(division==="SL"){
    write(row,"⛔ Ineligible","Start value in Game 1 exceeded 30 — player ineligible to pitch in Game 2.",true);row++;
  }
  write(row,"⛔ Rest","Player is within a mandatory rest period based on their Start value from a previous day.",true);row++;
  blank(row);row++;

  var reg=getRegulationInnings(division);
  heading(row,"LADDER & FINALS SEEDING");row++;
  write(row,"Entering results","Open the 📝 Results tab and enter each POOL PLAY game: home team, runs, away team, runs. Only fill Innings if the game went to extra innings. Do not enter finals games. The 🏆 Ladder tab updates automatically within a few seconds.",true);row++;
  write(row,"Points","Win 2 · Draw 1 · Loss 0. Teams are ranked on points.",true);row++;
  write(row,"Tiebreaker 1 - Head-to-head","A tied team advances only if it beat EVERY other team in the tie, in EVERY pool game between them, AND played each of them an equal number of times. The remaining tied teams then go back to this step.",true);row++;
  write(row,"Tiebreaker 2 - Runs-allowed ratio","When head-to-head cannot separate the teams: total runs allowed in all pool games ÷ defensive innings ("+reg+" per game, or more for extra innings). Lowest ratio advances, and each next place is decided the same way.\nExample: 8 runs allowed in 4 games = 8 ÷ "+(reg*4)+" = "+(8/(reg*4)).toFixed(4)+".",true);row++;
  write(row,"Tiebreaker 3 - Still level on RA ratio","Head-to-head between those teams. If that cannot be used, the RA ratio is recalculated using only games between those teams. This advances ONE team, then the rest go back to the all-games RA ratio.",true);row++;
  write(row,"Still tied","Marked ⚠️ on the Ladder. The Tournament Committee decides (playoff, blind draw or coin flip).",true);row++;
  write(row,"Finals","The top teams (as set when this tracker was created) are highlighted and listed as seeds. Forfeits are usually recorded as "+reg+"-0, but only the Tournament Committee can decree a forfeit.",true);row++;
  write(row,"Not updating?","Click 🔄 Recalculate ladder at the bottom of the Ladder tab.",true);row++;
  blank(row);row++;

  heading(row,"MAKING YOURSELF THE OWNER");row++;
  full(row,
    "This spreadsheet was shared to your email as Editor. "+
    "To become the full owner: go to File → Make a copy. "+
    "Your copy will be fully owned by you in Google Drive.\n"+
    "Note: the Ladder only updates automatically in this ORIGINAL sheet. Enter pool play results here, not in a copy.",PALE,DARK);row++;
  blank(row);row++;

  sh.getRange(row,1,1,2).merge()
    .setValue("This tracker is a management aid only. Coaches and managers remain solely responsible for compliance with all pitching rules. When in doubt, consult the official rule book or your Tournament Director.")
    .setBackground(PALE).setFontColor("#666666").setFontFamily(FONT)
    .setFontSize(9).setFontStyle("italic").setWrap(true).setVerticalAlignment("top");
  sh.setRowHeight(row,40);
  sh.setFrozenRows(2);
  SpreadsheetApp.flush();
}
