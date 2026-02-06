import fs from "fs";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node ops/extractor/inspect-stars.js <path-to-json>");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
const players = Array.isArray(data.players) ? data.players : [];

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function isGoalie(p) {
  const pos = String(p.position ?? "").trim().toUpperCase();
  return pos === "G" || pos.startsWith("G");
}

// Weights (locked from you)
const W = {
  // skater
  g: 65,
  a: 30,
  shot: 5,     // sog
  pass: 2.5,
  ta: 7.5,
  to: -5,
  entry: 1,
  exit: 1,
  hit: 2.5,

  // goalie
  save: 10,
  shutout: 100
};

function spSkater(p) {
  return (
    n(p.goals) * W.g +
    n(p.assists) * W.a +
    n(p.sog) * W.shot +
    n(p.passes) * W.pass +
    n(p.takeaways) * W.ta +
    n(p.turnovers) * W.to +
    n(p.entries) * W.entry +
    n(p.exits) * W.exit +
    n(p.hits) * W.hit
  );
}

function spGoalie(p) {
  const saves = n(p.saves);
  const ga = n(p.goalsAllowed);
  const shutout = (ga === 0) ? W.shutout : 0;

  return (
    saves * W.save +
    shutout +
    n(p.passes) * W.pass +
    n(p.goals) * W.g +
    n(p.assists) * W.a
  );
}

function computeSP(p) {
  return isGoalie(p) ? spGoalie(p) : spSkater(p);
}

const rows = players.map(p => ({
  steamId: String(p.steamId ?? ""),
  name: String(p.name ?? ""),
  team: String(p.team ?? ""),          // "Red"/"Blue"
  position: String(p.position ?? ""),
  sp: computeSP(p),
  // helpful goalie debug fields:
  shotsFaced: isGoalie(p) ? n(p.shotsFaced) : null,
  saves: isGoalie(p) ? n(p.saves) : null,
  goalsAllowed: isGoalie(p) ? n(p.goalsAllowed) : null
}));

rows.sort((a, b) => b.sp - a.sp);

console.log("Top 10 by computed SP (DRY RUN):");
rows.slice(0, 10).forEach((r, i) => {
  const extra = (String(r.position).toUpperCase().startsWith("G"))
    ? ` SA=${r.shotsFaced} SV=${r.saves} GA=${r.goalsAllowed}`
    : "";
  console.log(`${String(i+1).padStart(2,"0")}. ${r.name} [${r.team}] pos=${r.position} SP=${r.sp.toFixed(1)}${extra}`);
});

console.log("\nStars (computed top 3):");
rows.slice(0, 3).forEach((r, i) => {
  console.log(`star${i+1}: ${r.name} [${r.team}] pos=${r.position} SP=${r.sp.toFixed(1)}`);
});

console.log("\nDone. (No files modified.)");
