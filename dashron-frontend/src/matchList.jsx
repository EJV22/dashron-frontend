import { useEffect, useState } from "react";
import { getMatches } from "./api";
import { useMatchSocket } from "./hooks/useMatchSocket";

export default function MatchList() {
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    getMatches().then(setMatches).catch(console.error);
  }, []);

  const { connected } = useMatchSocket((msg) => {
    if (msg.type === "match_created") {
      // guard against a duplicate if the fetch already returned it
      setMatches((m) => (m.some((x) => x.id === msg.data.id) ? m : [msg.data, ...m]));
    }
    if (msg.type === "score_update") {
      setMatches((m) => m.map((x) => (x.id === msg.data.id ? msg.data : x)));
    }
  });

  return (
    <div>
      <p>{connected ? "🟢 Live" : "🔴 Reconnecting..."}</p>
      {matches.map((m) => (
        <div key={m.id}>
          {m.homeTeam} {m.homeScore} - {m.awayScore} {m.awayTeam} ({m.status})
        </div>
      ))}
    </div>
  );
}