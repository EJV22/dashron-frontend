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

const statusOf = (match) => {
  const now = Date.now();
  if (now < new Date(match.startTime)) return 'scheduled';
  return now >= new Date(match.endTime) ? 'finished' : 'live';
};

// merge entries, dedupe by id, newest first
const merge = (existing, incoming) => {
  const byId = new Map();
  [...existing, ...incoming].forEach((entry) => byId.set(entry.id, entry));
  return [...byId.values()].sort((a, b) => b.id - a.id);
};

const send = async (method, url, body) => {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(json.details) ? json.details.map((d) => d.message).join(', ') : '';
    const text = [json.message || json.error, detail].filter(Boolean).join(': ');
    throw new Error(text || `Request failed (${res.status})`);
  }
  return json.data;
};
const post = (url, body) => send('POST', url, body);
const patch = (url, body) => send('PATCH', url, body);

function CreateMatch({ onCreated, onClose }) {
  const toLocal = (ms) => {
    const offset = new Date().getTimezoneOffset() * 60000;
    return new Date(ms - offset).toISOString().slice(0, 16);
  };

  const [form, setForm] = useState({
    sport: 'football',
    homeTeam: '',
    awayTeam: '',
    startTime: toLocal(Date.now() - 5 * 60000),
    endTime: toLocal(Date.now() + 2 * 3600000),
  });
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      const match = await post('/matches', {
        ...form,
        startTime: new Date(form.startTime).toISOString(),
        endTime: new Date(form.endTime).toISOString(),
      });
      onCreated(match);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h3>New match</h3>
      <input list="sports" aria-label="Sport" placeholder="Sport" value={form.sport} onChange={set('sport')} required />
      <datalist id="sports">
        {Object.keys(EVENTS).map((sport) => (
          <option key={sport} value={sport} />
        ))}
      </datalist>
      <input aria-label="Home team" placeholder="Home team" value={form.homeTeam} onChange={set('homeTeam')} required />
      <input aria-label="Away team" placeholder="Away team" value={form.awayTeam} onChange={set('awayTeam')} required />
      <label>
        Start
        <input type="datetime-local" value={form.startTime} onChange={set('startTime')} required />
      </label>
      <label>
        End
        <input type="datetime-local" value={form.endTime} onChange={set('endTime')} required />
      </label>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row">
        <button className="btn">Create</button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ScoreEditor({ match, onSaved }) {
  const [home, setHome] = useState(match.homeScore);
  const [away, setAway] = useState(match.awayScore);
  const [error, setError] = useState('');

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      onSaved(
        await patch(`/matches/${match.id}/score`, {
          homeScore: Number(home),
          awayScore: Number(away),
        }),
      );
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="composer" onSubmit={save}>
      <div className="row">
        <small>Score</small>
        <input className="sm" type="number" min="0" aria-label="Home score" value={home} onChange={(e) => setHome(e.target.value)} />
        <span className="muted">:</span>
        <input className="sm" type="number" min="0" aria-label="Away score" value={away} onChange={(e) => setAway(e.target.value)} />
        <button className="btn">Update score</button>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
    </form>
  );
}

function Composer({ match, entries, onPosted }) {
  const events = EVENTS[match.sport?.toLowerCase()] || ['update'];
  const [form, setForm] = useState({
    eventType: events[0],
    team: match.homeTeam,
    actor: '',
    minute: '',
    message: '',
  });
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      const entry = await post(`/matches/${match.id}/commentary`, {
        minute: Number(form.minute === '' ? entries[0]?.minute ?? 1 : form.minute),
        sequence: entries.reduce((max, x) => Math.max(max, x.sequence), 0) + 1,
        eventType: form.eventType,
        team: form.team,
        actor: form.actor || undefined,
        message: form.message,
      });
      onPosted(entry);
      setForm({ ...form, message: '', actor: '' });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="row">
        <select aria-label="Event type" value={form.eventType} onChange={set('eventType')}>
          {events.map((event) => (
            <option key={event}>{event}</option>
          ))}
        </select>
        <select aria-label="Team" value={form.team} onChange={set('team')}>
          <option>{match.homeTeam}</option>
          <option>{match.awayTeam}</option>
        </select>
        <input
          className="sm"
          type="number"
          min="0"
          aria-label="Minute" placeholder={`Min ${entries[0]?.minute ?? 1}`}
          value={form.minute}
          onChange={set('minute')}
        />
        <input aria-label="Player" placeholder="Player (optional)" value={form.actor} onChange={set('actor')} />
      </div>
      <div className="row">
        <input
          className="grow"
          aria-label="Commentary text" placeholder="Write commentary…"
          value={form.message}
          onChange={set('message')}
          required
        />
        <button className="btn">Post</button>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
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
    try {
      return JSON.parse(localStorage.getItem('follows')) || [];
    } catch {
      return [];
    }
  });

  const wsRef = useRef(null);
  const sent = useRef(new Set());
  const desired = useRef(new Set());
  const selectedRef = useRef(null);
  selectedRef.current = selectedId;

  const addMatch = useCallback((match) => {
    setMatches((prev) => [match, ...prev.filter((m) => m.id !== match.id)]);
  }, []);

  const updateMatch = useCallback((match) => {
    setMatches((prev) => prev.map((m) => (m.id === match.id ? { ...m, ...match } : m)));
  }, []);

  // re-render every 30s so status pills flip scheduled -> live -> finished
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // load matches once
  useEffect(() => {
    fetch(`${API}/matches?limit=100`)
      .then((res) => res.json())
      .then(({ data }) => {
        setMatches(data || []);
        if (data?.length) setSelectedId((current) => current ?? data[0].id);
      })
      .catch(console.error);
  }, []);

  // keep the server's subscriptions in sync: followed matches + the one being viewed
  const sync = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;

    desired.current.forEach((id) => {
      if (!sent.current.has(id)) {
        ws.send(JSON.stringify({ type: 'subscribe', matchId: id }));
      }
    });
    sent.current.forEach((id) => {
      if (!desired.current.has(id)) {
        ws.send(JSON.stringify({ type: 'unsubscribe', matchId: id }));
      }
    });
    sent.current = new Set(desired.current);
  }, []);

  useEffect(() => {
    desired.current = new Set([...follows, selectedId].filter(Boolean));
    try {
      localStorage.setItem('follows', JSON.stringify(follows));
    } catch {
      // storage unavailable, ignore
    }
    sync();
  }, [follows, selectedId, sync]);

  // single WebSocket with reconnect + backoff
  useEffect(() => {
    let timer;
    let retries = 0;
    let dead = false;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      sent.current = new Set();

      ws.onopen = () => {
        setConnected(true);
        setEpoch((n) => n + 1);
        sync();
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === 'welcome') retries = 0;

        if (msg.type === 'commentary') {
          const id = msg.data.matchId;
          setFeeds((prev) => ({ ...prev, [id]: merge(prev[id] || [], [msg.data]) }));
          if (id !== selectedRef.current) {
            setUnread((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
          }
        }

        if (msg.type === 'match_created') addMatch(msg.data);
        if (msg.type === 'score_update') updateMatch(msg.data);
      };

      ws.onclose = (event) => {
        if (dead) return;
        setConnected(false);
        if (event.code === 1008) return;
        timer = setTimeout(connect, Math.min(1000 * 2 ** retries++, 15000));
      };
    };

    connect();

    return () => {
      dead = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [sync, addMatch, updateMatch]);

  // history for the selected match (re-fetched after every reconnect)
  useEffect(() => {
    if (selectedId == null) return;

    setUnread((prev) => ({ ...prev, [selectedId]: 0 }));
    fetch(`${API}/matches/${selectedId}/commentary?limit=100`)
      .then((res) => res.json())
      .then(({ data }) => {
        if (data) {
          setFeeds((prev) => ({ ...prev, [selectedId]: merge(prev[selectedId] || [], data) }));
        }
      })
      .catch(console.error);
  }, [selectedId, epoch]);

  const toggleFollow = (id) => {
    setFollows((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const sports = ['all', ...new Set(matches.map((m) => m.sport))];
  const shown = matches.filter(
    (m) => (sport === 'all' || m.sport === sport) && (status === 'all' || statusOf(m) === status),
  );
  const selected = matches.find((m) => m.id === selectedId);
  const entries = feeds[selectedId] || [];

  return (
    <div className="app">
      <aside>
        <div className="row between">
          <h1>dashron</h1>
          <button className="btn" aria-expanded={creating} onClick={() => setCreating(true)}>
            New match
          </button>
        </div>

        <div className="chips">
          {sports.map((s) => (
            <button key={s} className={s === sport ? 'chip on' : 'chip'} aria-pressed={s === sport} onClick={() => setSport(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="chips">
          {['all', 'live', 'scheduled', 'finished'].map((s) => (
            <button key={s} className={s === status ? 'chip on' : 'chip'} aria-pressed={s === status} onClick={() => setStatus(s)}>
              {s}
            </button>
          ))}
        </div>

        {creating && (
          <CreateMatch
            onClose={() => setCreating(false)}
            onCreated={(match) => {
              addMatch(match);
              setSelectedId(match.id);
              setCreating(false);
            }}
          />
        )}

        <ul className="matches">
          {shown.map((m) => {
            const following = follows.includes(m.id);
            const name = `${m.homeTeam} v ${m.awayTeam}`;
            return (
              <li key={m.id} className={m.id === selectedId ? 'match active' : 'match'}>
                <button
                  className="match-main"
                  aria-current={m.id === selectedId ? 'true' : undefined}
                  onClick={() => setSelectedId(m.id)}
                >
                  <strong className="match-title">{name}</strong>
                  <span className="match-meta">
                    <span className={`pill ${statusOf(m)}`}>{statusOf(m)}</span>
                    {m.sport}
                  </span>
                </button>
                <button
                  className={following ? 'bell on' : 'bell'}
                  aria-label={`${following ? 'Following' : 'Follow'} ${name}`}
                  onClick={() => toggleFollow(m.id)}
                >
                  {following ? 'Following' : 'Follow'}
                </button>
                {unread[m.id] > 0 && (
                  <span className="badge" aria-label={`${unread[m.id]} new updates`}>
                    {unread[m.id]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {shown.length === 0 && <p className="muted">No matches for these filters.</p>}
      </aside>

      <main>
        {!selected ? (
          <p className="muted">Select a match from the list to follow it.</p>
        ) : (
          <>
            <header className="board">
              <div className="team">{selected.homeTeam}</div>
              <div className="score">
                {selected.homeScore} <span>:</span> {selected.awayScore}
              </div>
              <div className="team">{selected.awayTeam}</div>
              <div className="meta">
                <span className={`pill ${statusOf(selected)}`}>{statusOf(selected)}</span>{' '}
                {selected.sport}
                <span className={connected ? 'conn on' : 'conn off'} role="status">
                  {connected ? 'Live updates on' : 'Reconnecting…'}
                </span>
              </div>
            </header>

            <ScoreEditor
              key={`${selected.id}:${selected.homeScore}:${selected.awayScore}`}
              match={selected}
              onSaved={updateMatch}
            />

            <Composer
              key={selected.id}
              match={selected}
              entries={entries}
              onPosted={(entry) => {
                setFeeds((prev) => ({
                  ...prev,
                  [selected.id]: merge(prev[selected.id] || [], [entry]),
                }));
              }}
            />

            <section className="feed" aria-labelledby="feed-title" aria-live="polite">
              <h2 id="feed-title" className="section-title">Commentary</h2>
              {entries.length === 0 && <p className="muted">No commentary yet. Post the first update above.</p>}
              {entries.map((c) => (
                <div key={c.id} className={HOT.includes(c.eventType) ? 'entry hot' : 'entry'}>
                  <span className="min">{c.minute}'</span>
                  <div>
                    {c.eventType && (
                      <span
                        className={`tag ${
                          HOT.includes(c.eventType) ? 'hot' : BAD.includes(c.eventType) ? 'bad' : ''
                        }`}
                      >
                        {c.eventType.replaceAll('_', ' ')}
                      </span>
                    )}
                    <div className="msg">{c.message}</div>
                    <small className="muted">
                      {[c.period, c.actor, c.team].filter(Boolean).join(' · ')}
                    </small>
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