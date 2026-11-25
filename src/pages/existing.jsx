import { useState } from "react";
import {
  uid, parseRosterPaste, LADDER_SYSTEMS, defaultLadderSystem, callApi,
  inp, sel, lbl, sub, card, sec, secT, divider, btn, okBox, errBox,
} from "./shared.js";

const blankPlayer = () => ({ id:uid(), surname:"", firstName:"", number:"", dob:"" });

// Work on a tracker that has already been created: add players, add a ladder
export default function ExistingTracker() {
  const [sheetUrl, setSheetUrl] = useState("");
  const [info,     setInfo]     = useState(null);   // result of listTeams
  const [busy,     setBusy]     = useState("");     // "load" | "players" | "ladder"
  const [loadErr,  setLoadErr]  = useState("");

  const [teamName, setTeamName] = useState("");
  const [players,  setPlayers]  = useState([blankPlayer()]);
  const [pasteOpen,setPasteOpen]= useState(false);
  const [pasteText,setPasteText]= useState("");
  const [playerMsg,setPlayerMsg]= useState(null);   // {ok, text}

  const [finalsTeams, setFinalsTeams] = useState(4);
  const [ladderSystem,setLadderSystem]= useState("LL");
  const [ladderMsg,   setLadderMsg]   = useState(null);

  const load = async (keepMessages=false) => {
    setBusy("load"); setLoadErr("");
    if (!keepMessages) { setPlayerMsg(null); setLadderMsg(null); }
    try {
      const data = await callApi({ action:"listTeams", sheetUrl });
      setInfo(data);
      setTeamName(t => data.teams.some(x=>x.name===t) ? t : (data.teams[0]?.name || ""));
      setLadderSystem(data.ladderSystem || defaultLadderSystem(data.division));
      setFinalsTeams(f => Math.min(f, data.teams.length));
    } catch(err) {
      setInfo(null); setLoadErr(err.message);
    } finally { setBusy(""); }
  };

  const team = info?.teams.find(t=>t.name===teamName);
  const room = info && team && team.players!==null ? info.maxPlayers - team.players : 0;
  const filled = players.filter(p=>p.surname.trim()||p.firstName.trim());

  const updatePlayer = (id,f,v) => setPlayers(p=>p.map(pl=>pl.id===id?{...pl,[f]:v}:pl));

  const applyPaste = () => {
    const rows = parseRosterPaste(pasteText);
    if (!rows.length) { setPlayerMsg({ok:false,text:"No valid rows. Copy data rows only - do not include the header row."}); return; }
    setPlayers(rows); setPasteOpen(false); setPasteText(""); setPlayerMsg(null);
  };

  const addPlayers = async () => {
    if (!filled.length) { setPlayerMsg({ok:false,text:"Enter at least one player's name."}); return; }
    if (filled.length > room) { setPlayerMsg({ok:false,text:`${teamName} only has room for ${room} more player(s).`}); return; }
    const missingDob = filled.filter(p=>!p.dob).length;
    if (missingDob && !confirm(`${missingDob} player(s) have no date of birth. Their pitching rules will use the division's default age. Continue?`)) return;
    setBusy("players"); setPlayerMsg(null);
    try {
      const data = await callApi({ action:"addPlayers", sheetUrl, teamName, players:filled });
      setPlayerMsg({ok:true,text:`✅ Added ${data.added} player(s) to ${data.team} (${data.players}/${data.max}). STATUS formulas and colour rules are in place.`});
      setPlayers([blankPlayer()]);
      await load(true);
    } catch(err) {
      setPlayerMsg({ok:false,text:err.message});
    } finally { setBusy(""); }
  };

  const addLadder = async () => {
    setBusy("ladder"); setLadderMsg(null);
    try {
      const data = await callApi({ action:"addLadder", sheetUrl, finalsTeams, ladderSystem });
      setLadderMsg({ok:true,text: data.autoUpdate
        ? "✅ Ladder and Results tabs added. The ladder updates automatically as results are entered."
        : "✅ Ladder and Results tabs added. Auto-update could not be switched on, so use the 🔄 Recalculate link on the Ladder tab after entering results."});
      await load(true);
    } catch(err) {
      setLadderMsg({ok:false,text:err.message});
    } finally { setBusy(""); }
  };

  return (
    <>
      {/* ── Find the tracker ─────────────────────────────────────────── */}
      <div style={sec}>
        <div style={secT}>🔗 Open an Existing Tracker</div>
        <label style={lbl}>Spreadsheet Link</label>
        <div style={{display:"flex",gap:8}}>
          <input style={inp} value={sheetUrl} onChange={e=>setSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."/>
          <button style={{...btn(),whiteSpace:"nowrap"}} disabled={!sheetUrl.trim()||busy==="load"} onClick={()=>load()}>
            {busy==="load" ? "Loading…" : "Load"}
          </button>
        </div>
        <div style={sub}>Use the link of the ORIGINAL tracker from your email, not a copy you made.</div>
        {loadErr && <div style={errBox}>{loadErr}</div>}

        {info && (
          <div style={{marginTop:14,fontSize:"0.84rem",color:"#c8d8e8",lineHeight:1.8}}>
            <strong style={{color:"#c8a84b"}}>{info.tournamentName}</strong> · {info.division} · max {info.maxPlayers} players per team
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:6}}>
              {info.teams.map(t=>(
                <span key={t.name} style={{background:"rgba(200,168,75,0.08)",border:"1px solid rgba(200,168,75,0.2)",borderRadius:6,padding:"2px 10px",fontSize:"0.76rem"}}>
                  {t.name}: {t.players===null ? "tab missing" : `${t.players}/${info.maxPlayers}`}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {info && (
        <>
          {/* ── Add players ────────────────────────────────────────────── */}
          <div style={sec}>
            <div style={secT}>➕ Add Players</div>
            <div style={card}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                <div>
                  <label style={lbl}>Team</label>
                  <select style={sel} value={teamName} onChange={e=>setTeamName(e.target.value)}>
                    {info.teams.map(t=><option key={t.name} value={t.name}>{t.name}</option>)}
                  </select>
                </div>
                <div style={{alignSelf:"end",fontSize:"0.78rem",color:room>0?"#8fa8c8":"#f08080",paddingBottom:8}}>
                  {team?.players===null ? "This team's tab is missing or was renamed." :
                    room>0 ? `Room for ${room} more player(s).` : "This team is at the roster maximum."}
                </div>
              </div>

              <button style={{...btn("ghost"),fontSize:"0.76rem",padding:"5px 12px",marginBottom:10}}
                onClick={()=>setPasteOpen(o=>!o)}>
                {pasteOpen ? "▲ Hide Paste" : "📋 Paste Players from Spreadsheet"}
              </button>
              {pasteOpen && (
                <div style={{background:"rgba(200,168,75,0.06)",border:"1px solid rgba(200,168,75,0.2)",borderRadius:8,padding:12,marginBottom:12}}>
                  <div style={{fontSize:"0.76rem",color:"#8fa8c8",marginBottom:8}}>
                    Columns: <strong style={{color:"#c8a84b"}}>Surname · First Name · # · Date of Birth</strong>. Data rows only.
                  </div>
                  <textarea style={{...inp,fontFamily:"monospace",fontSize:"0.78rem",minHeight:70,resize:"vertical",marginBottom:8}}
                    value={pasteText} onChange={e=>setPasteText(e.target.value)}
                    placeholder={"Smith\tJohn\t7\t15/04/2013"}/>
                  <button style={btn()} onClick={applyPaste}>✓ Use These Rows</button>
                </div>
              )}

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 55px 130px 28px",gap:6,marginBottom:4,paddingBottom:4,borderBottom:"1px solid rgba(200,168,75,0.15)"}}>
                {["Surname","First Name","#","Date of Birth",""].map((h,i)=>(
                  <span key={i} style={{fontSize:"0.7rem",color:"#5a7a9a"}}>{h}</span>
                ))}
              </div>
              {players.map(pl=>(
                <div key={pl.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr 55px 130px 28px",gap:6,marginBottom:5}}>
                  <input style={inp} placeholder="Surname" value={pl.surname} onChange={e=>updatePlayer(pl.id,"surname",e.target.value)}/>
                  <input style={inp} placeholder="First name" value={pl.firstName} onChange={e=>updatePlayer(pl.id,"firstName",e.target.value)}/>
                  <input style={inp} placeholder="#" value={pl.number} onChange={e=>updatePlayer(pl.id,"number",e.target.value)}/>
                  <input style={{...inp,fontSize:"0.78rem"}} type="date" value={pl.dob} onChange={e=>updatePlayer(pl.id,"dob",e.target.value)}/>
                  <button style={{...btn("danger"),padding:"6px 8px",fontSize:"0.78rem"}}
                    onClick={()=>setPlayers(p=>p.length>1?p.filter(x=>x.id!==pl.id):[blankPlayer()])}>✕</button>
                </div>
              ))}
              {players.length<room && (
                <button style={{...btn("ghost"),marginTop:8,fontSize:"0.76rem"}} onClick={()=>setPlayers(p=>[...p,blankPlayer()])}>+ Another Player</button>
              )}
              <div style={sub}>The date of birth sets each player's age-based pitching rules (league age for LL divisions, actual age for others).</div>

              <div style={divider}/>
              <button style={btn()} disabled={busy==="players"||room<=0} onClick={addPlayers}>
                {busy==="players" ? "Adding…" : `➕ Add ${filled.length||""} Player${filled.length===1?"":"s"} to ${teamName}`}
              </button>
              {playerMsg && <div style={playerMsg.ok?okBox:errBox}>{playerMsg.text}</div>}
            </div>
          </div>

          {/* ── Add ladder ─────────────────────────────────────────────── */}
          <div style={sec}>
            <div style={secT}>🏆 Ladder</div>
            {info.hasLadder ? (
              <div style={{fontSize:"0.84rem",color:"#8fa8c8"}}>
                This tracker already has a Ladder ({LADDER_SYSTEMS[info.ladderSystem]}). Enter results on its 📝 Results tab.
              </div>
            ) : (
              <>
                <div style={{fontSize:"0.82rem",color:"#8fa8c8",marginBottom:14}}>
                  This tracker was created before the ladder existed. Add the 📝 Results and 🏆 Ladder tabs to it. Team tabs and pitching data are not changed.
                </div>
                <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:12}}>
                  <div>
                    <label style={lbl}>Ladder Rules</label>
                    <select style={sel} value={ladderSystem} onChange={e=>setLadderSystem(e.target.value)}>
                      {Object.entries(LADDER_SYSTEMS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Teams Advancing to Finals</label>
                    <input style={inp} type="number" min={0} max={info.teams.length} value={finalsTeams}
                      onChange={e=>setFinalsTeams(Math.max(0,Math.min(info.teams.length,Number(e.target.value)||0)))}/>
                  </div>
                </div>
                <button style={{...btn(),marginTop:16}} disabled={busy==="ladder"} onClick={addLadder}>
                  {busy==="ladder" ? "Adding…" : "🏆 Add Ladder to This Tracker"}
                </button>
              </>
            )}
            {ladderMsg && <div style={ladderMsg.ok?okBox:errBox}>{ladderMsg.text}</div>}
          </div>
        </>
      )}
    </>
  );
}
