import { useEffect, useState } from "react";
import { getCommentary } from "./api";
import { useMatchSocket } from "./hooks/useMatchSocket";

export default function Commentary({ matchId }) {
  const [entries, setEntries] = useState([]);

  const { subscribe, unsubscribe } = useMatchSocket((msg) => {
    if (msg.type === "commentary" && msg.data.matchId === matchId) {
      setEntries((e) => (e.some((x) => x.id === msg.data.id) ? e : [msg.data, ...e]));
    }
  });

  useEffect(() => {
    getCommentary(matchId).then(setEntries).catch(console.error);
    subscribe(matchId);
    return () => unsubscribe(matchId);
  }, [matchId, subscribe, unsubscribe]);

  return (
    <ul>
      {entries.map((c) => (
        <li key={c.id}>{c.minute}' {c.message}</li>
      ))}
    </ul>
  );
}