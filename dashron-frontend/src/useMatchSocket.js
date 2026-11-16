const API = import.meta.env.VITE_API_URL;

const [matches, setMatches] = useState([]);

useEffect(() => {
  fetch(`${API}/matches`)
    .then((r) => r.json())
    .then((json) => setMatches(json.data ?? json));
}, []);

const { connected } = useMatchSocket((msg) => {
  if (msg.type === "match_created") {
    setMatches((m) => [msg.data, ...m]);
  }
  if (msg.type === "score_update") {
    setMatches((m) => m.map((x) => (x.id === msg.data.id ? msg.data : x)));
  }
});