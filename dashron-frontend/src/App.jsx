import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';

const API = import.meta.env.VITE_API_URL;
const WS_URL = import.meta.env.VITE_WS_URL;

const EVENTS = {
  football: ['goal', 'shot', 'save', 'foul', 'yellow_card', 'substitution', 'pass', 'kickoff'],
  cricket: ['run', 'four', 'six', 'wicket', 'over_end', 'start'],
  basketball: ['basket', 'three', 'foul', 'timeout', 'tipoff'],
};
const HOT = ['goal', 'four', 'six', 'three', 'basket'];
const BAD = ['wicket', 'yellow_card'];

const statusOf = (m) => {
  const now = Date.now();
  if (now < new Date(m.startTime)) return 'scheduled';
  return now >= new Date(m.endTime) ? 'finished' : 'live';
};
const merge = (a, b) => {
  const map = new Map();
  [...a, ...b].forEach((e) => map.set(e.id, e));
  return [...map.values()].sort((x, y) => y.id - x.id);
};
const post = async (url, body) => {
  const r = await fetch(`${API}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Request failed (${r.status})`);
  return j.data;
};

function CreateMatch({ onCreated, onClose }) {
  const local = (ms) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState({
    sport: 'football', homeTeam: '', awayTeam: '',
    startTime: local(Date.now() - 5 * 60000), endTime: local(Date.now() + 2 * 3600000),
  });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr('');
    try {
      onCreated(await post('/matches', {
        ...f, startTime: new Date(f.startTime).toISOString(), endTime: new Date(f.endTime).toISOString(),
      }));
    } catch (x) { setErr(x.message); }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h3>New match</h3>
      <input list="sports" placeholder="Sport" value={f.sport} onChange={set('sport')} required />
      <datalist id="sports">{Object.keys(EVENTS).map((s) => <option key={s} value={s} />)}</datalist>
      <input placeholder="Home team" value={f.homeTeam} onChange={set('homeTeam')} required />
      <input placeholder="Away team" value={f.awayTeam} onChange={set('awayTeam')} required />
      <label>Start<input type="datetime-local" value={f.startTime} onChange={set('startTime')} required /></label>
      <label>End<input type="datetime-local" value={f.endTime} onChange={set('endTime')} required /></label>
      {err && <p className="err">{err}</p>}
      <div className="row"><button className="btn">Create</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
    </form>
  );
}

function Composer({ match, entries, onPosted }) {
  const events = EVENTS[match.sport?.toLowerCase()] || ['update'];
  const [f, setF] = useState({ eventType: events[0], team: match.homeTeam, actor: '', minute: '', message: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr('');
    try {
      const entry = await post(`/matches/${match.id}/commentary`, {
        minute: Number(f.minute === '' ? entries[0]?.minute ?? 1 : f.minute),
        sequence: entries.reduce((m, x) => Math.max(m, x.sequence), 0) + 1,
        eventType: f.eventType, team: f.team, actor: f.actor || undefined, message: f.message,
      });
      onPosted(entry);
      setF({ ...f, message: '', actor: '' });
    } catch (x) { setErr(x.message); }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="row">
        <select value={f.eventType} onChange={set('eventType')}>{events.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={f.team} onChange={set('team')}><option>{match.homeTeam}</option><option>{match.awayTeam}</option></select>
        <input className="sm" type="number" min="0" placeholder={`Min ${entries[0]?.minute ?? 1}`} value={f.minute} onChange={set('minute')} />
        <input placeholder="Player (optional)" value={f.actor} onChange={set('actor')} />
      </div>
      <div className="row">
        <input className="grow" placeholder="Write commentary…" value={f.message} onChange={set('message')} required />
        <button className="btn">Post</button>
      </div>
      {err && <p className="err">{err}</p>}
    </form>
  );
}

export default function App() {
  const [matches, setMatches] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [feeds, setFeeds] = useState({});
  const [unread, setUnread] = useState({});
  const [connected, setConnected] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [sport, setSport] = useState('all');
  const [status, setStatus] = useState('all');
  const [creating, setCreating] = useState(false);
  const [follows, setFollows] = useState(() => {
    try { return JSON.parse(localStorage.getItem('follows')) || []; } catch { return []; }
  });

  const wsRef = useRef(null);
  const sent = useRef(new Set());
  const desired = useRef(new Set());
  const selRef = useRef(null);
  selRef.current = selectedId;

  const addMatch = (m) => setMatches((p) => [m, ...p.filter((x) => x.id !== m.id)]);

  useEffect(() => {
    fetch(`${API}/matches?limit=100`).then((r) => r.json()).then(({ data }) => {
      setMatches(data || []);
      if (data?.length) setSelectedId((c) => c ?? data[0].id);
    }).catch(console.error);
  }, []);

  // keep the server's subscription list in sync: followed matches + the one being viewed
  const sync = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    desired.current.forEach((id) => {
      if (!sent.current.has(id)) ws.send(JSON.stringify({ type: 'subscribe', matchId: id }));
    });
    sent.current.forEach((id) => {
      if (!desired.current.has(id)) ws.send(JSON.stringify({ type: 'unsubscribe', matchId: id }));
    });
    sent.current = new Set(desired.current);
  }, []);

  useEffect(() => {
    desired.current = new Set([...follows, selectedId].filter(Boolean));
    try { localStorage.setItem('follows', JSON.stringify(follows)); } catch { /* ignore */ }
    sync();
  }, [follows, selectedId, sync]);

  useEffect(() => {
    let timer, retries = 0, dead = false;
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      sent.current = new Set();
      ws.onopen = () => { retries = 0; setConnected(true); setEpoch((n) => n + 1); sync(); };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'commentary') {
          const id = msg.data.matchId;
          setFeeds((f) => ({ ...f, [id]: merge(f[id] || [], [msg.data]) }));
          if (id !== selRef.current) setUnread((u) => ({ ...u, [id]: (u[id] || 0) + 1 }));
        }
        if (msg.type === 'match_created') addMatch(msg.data);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!dead) timer = setTimeout(connect, Math.min(1000 * 2 ** retries++, 15000));
      };
    };
    connect();
    return () => { dead = true; clearTimeout(timer); wsRef.current?.close(); };
  }, [sync]);

  // history for the selected match (re-fetched after every reconnect)
  useEffect(() => {
    if (selectedId == null) return;
    setUnread((u) => ({ ...u, [selectedId]: 0 }));
    fetch(`${API}/matches/${selectedId}/commentary`).then((r) => r.json()).then(({ data }) => {
      if (data) setFeeds((f) => ({ ...f, [selectedId]: merge(f[selectedId] || [], data) }));
    }).catch(console.error);
  }, [selectedId, epoch]);

  const toggleFollow = (id) => setFollows((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const sports = ['all', ...new Set(matches.map((m) => m.sport))];
  const shown = matches.filter((m) => (sport === 'all' || m.sport === sport) && (status === 'all' || statusOf(m) === status));
  const sel = matches.find((m) => m.id === selectedId);
  const entries = feeds[selectedId] || [];

  return (
    <div className="app">
      <aside>
        <div className="row between">
          <h1>dashron</h1>
          <button className="btn sm" onClick={() => setCreating(true)}>+ Match</button>
        </div>
        <div className="chips">{sports.map((s) => <button key={s} className={s === sport ? 'chip on' : 'chip'} onClick={() => setSport(s)}>{s}</button>)}</div>
        <div className="chips">{['all', 'live', 'scheduled', 'finished'].map((s) => <button key={s} className={s === status ? 'chip on' : 'chip'} onClick={() => setStatus(s)}>{s}</button>)}</div>
        {creating && <CreateMatch onClose={() => setCreating(false)} onCreated={(m) => { addMatch(m); setSelectedId(m.id); setCreating(false); }} />}
        {shown.map((m) => (
          <div key={m.id} className={m.id === selectedId ? 'match active' : 'match'} onClick={() => setSelectedId(m.id)}>
            <div className="row between">
              <strong>{m.homeTeam} v {m.awayTeam}</strong>
              <button className={follows.includes(m.id) ? 'bell on' : 'bell'} title="Follow for live updates"
                onClick={(e) => { e.stopPropagation(); toggleFollow(m.id); }}>🔔</button>
            </div>
            <span className={`pill ${statusOf(m)}`}>{statusOf(m)}</span> <small>{m.sport}</small>
            {unread[m.id] > 0 && <span className="badge">{unread[m.id]}</span>}
          </div>
        ))}
        {shown.length === 0 && <p className="muted">No matches.</p>}
      </aside>

      <main>
        {!sel ? <p className="muted">Select a match.</p> : (
          <>
            <header className="board">
              <div className="team">{sel.homeTeam}</div>
              <div className="score">{sel.homeScore} <span>:</span> {sel.awayScore}</div>
              <div className="team">{sel.awayTeam}</div>
              <div className="meta">
                <span className={`pill ${statusOf(sel)}`}>{statusOf(sel)}</span> {sel.sport}
                <span className={connected ? 'dot on' : 'dot off'} title={connected ? 'Connected' : 'Reconnecting…'} />
              </div>
            </header>
            <Composer key={sel.id} match={sel} entries={entries}
              onPosted={(e) => setFeeds((f) => ({ ...f, [sel.id]: merge(f[sel.id] || [], [e]) }))} />
            <section className="feed">
              {entries.length === 0 && <p className="muted">No commentary yet.</p>}
              {entries.map((c) => (
                <div key={c.id} className="entry">
                  <span className="min">{c.minute}'</span>
                  <div>
                    {c.eventType && <span className={`tag ${HOT.includes(c.eventType) ? 'hot' : BAD.includes(c.eventType) ? 'bad' : ''}`}>{c.eventType.replace('_', ' ')}</span>}
                    <div>{c.message}</div>
                    <small className="muted">{[c.period, c.actor, c.team].filter(Boolean).join(' · ')}</small>
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}