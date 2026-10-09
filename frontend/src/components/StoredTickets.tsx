import { useEffect, useState } from "react";
import { currentBusinessDate, getTickets, type DailyTickets } from "../api";
import FinalTicketTable from "./FinalTicketTable";
import ManualEntry from "./ManualEntry";

export default function StoredTickets({ active }: { active: boolean }) {
  const [day, setDay] = useState(currentBusinessDate);
  const [party, setParty] = useState("");
  const [number, setNumber] = useState("");
  const [data, setData] = useState<DailyTickets | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setData(null); setError("");
    if (!day) { setError("Choose a valid business date."); setLoading(false); return; }
    setLoading(true);
    getTickets(day).then(result => { if (alive) setData(result); })
      .catch(failure => { if (alive) setError(failure instanceof Error ? failure.message : "Unable to load stored tickets."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [day, revision, active]);
  const filtered = data?.records.filter(record => record.party.toLowerCase().includes(party.trim().toLowerCase()) && record.ticket_number.includes(number.trim())) ?? [];
  return <div className="ticket-workspace">
    <section className="card" aria-labelledby="stored-title">
      <div className="results-toolbar"><div><h2 id="stored-title">Stored tickets</h2><p>Persisted final records. Winning status is pending; no winning rules are applied.</p></div></div>
      <div className="lookup-form">
        <div className="lookup-field"><label htmlFor="stored-date">Business date</label><input id="stored-date" type="date" value={day} onChange={event => setDay(event.target.value)} /></div>
        <div className="lookup-field"><label htmlFor="stored-party">Filter by Party</label><input id="stored-party" type="search" value={party} onChange={event => setParty(event.target.value)} /></div>
        <div className="lookup-field"><label htmlFor="stored-number">Filter by Ticket Number</label><input id="stored-number" type="search" value={number} onChange={event => setNumber(event.target.value)} /></div>
        <button className="button button-outline" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh records</button>
      </div>
      {loading && <p className="notice notice-info" role="status">Loading stored tickets…</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {data && <><p className="ticket-count" role="status">{filtered.length} of {data.count} persisted records</p>{filtered.length ? <FinalTicketTable records={filtered} /> : <p className="empty-state">{data.count ? "No records match these filters." : "No final tickets saved for this date."}</p>}</>}
    </section>
    <ManualEntry onSaved={savedDay => { setDay(savedDay); setRevision(value => value + 1); }} />
  </div>;
}
