// Styles and helpers shared by the "New tracker" and "Existing tracker" screens

export const uid = () => Math.random().toString(36).slice(2,8);

// Accepts YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY (Australian order) and returns YYYY-MM-DD
export const parseDob = (raw) => {
  if (!raw) return "";
  raw = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  let m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  const d = new Date(raw);
  if (!isNaN(d)) return d.toISOString().slice(0,10);
  return raw;
};

// Tab-separated rows: Surname, First Name, #, Date of Birth
export const parseRosterPaste = (text) => {
  const players = [];
  (text||"").split(/\r?\n/).filter(r=>r.trim()).forEach(row => {
    const cols = row.split(/\t/).map(c=>c.trim());
    if (cols.length < 2) return;
    const [surname,firstName,number="",dobRaw=""] = cols;
    if (!surname&&!firstName) return;
    players.push({id:uid(),surname,firstName,number,dob:parseDob(dobRaw)});
  });
  return players;
};

export const LADDER_SYSTEMS = {
  LL:  "Little League - head-to-head, then runs-allowed ratio",
  PCT: "Points % - runs allowed per inning, then TQB, then coin toss",
};
const LL_DIVISIONS = ["LL","IL","JL","SL"];
export const defaultLadderSystem = (division) => LL_DIVISIONS.includes(division) ? "LL" : "PCT";

export async function callApi(payload) {
  const res = await fetch("/api/create-sheet", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ error:"Unexpected response from the server." }));
  if (!res.ok) throw new Error(data.error || "Unknown error");
  return data;
}

// ── Styles ───────────────────────────────────────────────────────────────────
export const inp = {
  background:"rgba(255,255,255,0.07)", border:"1px solid rgba(200,168,75,0.3)",
  borderRadius:6, padding:"8px 10px", color:"#e8dcc8", fontSize:"0.88rem",
  outline:"none", width:"100%", boxSizing:"border-box", fontFamily:"inherit",
};
export const sel  = {...inp, background:"#0d2040", cursor:"pointer"};
export const lbl  = { fontSize:"0.73rem", color:"#8fa8c8", marginBottom:4, display:"block", letterSpacing:"0.04em" };
export const sub  = { fontSize:"0.7rem", color:"#5a7a9a", marginTop:3 };
export const card = { background:"rgba(255,255,255,0.035)", border:"1px solid rgba(200,168,75,0.2)", borderRadius:10, padding:"18px", marginBottom:14 };
export const sec  = { background:"rgba(255,255,255,0.04)", border:"1px solid rgba(200,168,75,0.25)", borderRadius:12, padding:"22px", marginTop:20 };
export const secT = { fontSize:"0.88rem", fontWeight:"bold", color:"#c8a84b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:16 };
export const divider = { borderTop:"1px solid rgba(200,168,75,0.15)", margin:"18px 0" };
export const btn  = (v="gold") => ({
  padding: v==="sm"?"5px 12px":"11px 24px", borderRadius:6, border:"none",
  cursor:"pointer", fontWeight:"bold", fontSize:v==="sm"?"0.76rem":"0.88rem",
  letterSpacing:"0.05em", fontFamily:"inherit",
  background: v==="danger"?"rgba(180,50,50,0.7)":v==="ghost"?"rgba(255,255,255,0.07)":"linear-gradient(135deg,#c8a84b,#a07830)",
  color: v==="ghost"?"#8fa8c8":"#0a1628",
  border: v==="ghost"?"1px solid rgba(200,168,75,0.2)":"none",
});
export const okBox  = { background:"rgba(60,160,90,0.12)", border:"1px solid rgba(60,160,90,0.4)", borderRadius:8, padding:"10px 14px", fontSize:"0.82rem", color:"#a8e0b8", marginTop:12 };
export const errBox = { background:"rgba(200,80,80,0.1)", border:"1px solid rgba(200,80,80,0.3)", borderRadius:8, padding:"10px 14px", fontSize:"0.82rem", color:"#f08080", marginTop:12 };
