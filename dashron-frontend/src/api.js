const API = import.meta.env.VITE_API_URL;

export async function getMatches() {
  const res = await fetch(`${API}/matches`);
  if (!res.ok) throw new Error("Failed to load matches");
  return (await res.json()).data;
}

export async function getCommentary(matchId) {
  const res = await fetch(`${API}/matches/${matchId}/commentary`);
  if (!res.ok) throw new Error("Failed to load commentary");
  return (await res.json()).data;
}