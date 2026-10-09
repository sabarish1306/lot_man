import { useRef, useState, type FormEvent } from "react";
import { currentBusinessDate, searchTickets, type TicketSearchResult } from "../api";
import FinalTicketTable from "./FinalTicketTable";

export default function TicketLookup({ onOpenImport, opening }: {
  onOpenImport: (id: string) => void; opening: boolean;
}) {
  const [day, setDay] = useState(currentBusinessDate);
  const [number, setNumber] = useState("");
  const [result, setResult] = useState<TicketSearchResult | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [page, setPage] = useState(0);
  const lock = useRef(false);
  function clear() { setResult(null); setError(""); setPage(0); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || opening) return;
    if (!day || !/^[0-9]+$/.test(number)) { setError("Choose a date and enter the exact ASCII digit ticket number."); return; }
    lock.current = true; setSearching(true); clear();
    try { setResult(await searchTickets(day, number)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Ticket search failed."); }
    finally { lock.current = false; setSearching(false); }
  }
  return <div className="ticket-lookup">
    <section className="card" aria-labelledby="lookup-title">
      <div className="card-heading"><div><h2 id="lookup-title">Find a stored final ticket</h2><p>Exact search in persisted final records only. Extraction suggestions stay in import review.</p></div></div>
      <form className="lookup-form" onSubmit={event => void submit(event)}>
        <div className="lookup-field"><label htmlFor="lookup-date">Business date</label><input id="lookup-date" type="date" required value={day} disabled={searching || opening} onChange={event => { setDay(event.target.value); clear(); }} /></div>
        <div className="lookup-field"><label htmlFor="lookup-number">Ticket number</label><input id="lookup-number" inputMode="numeric" required pattern="[0-9]+" value={number} disabled={searching || opening} onChange={event => { setNumber(event.target.value); clear(); }} /></div>
        <button className="button button-primary" disabled={searching || opening}>{searching ? "Searching…" : "Find records"}</button>
        <p className="lookup-help">Leading zeros matter. Dates use Asia/Kolkata. A match is not a winning result; winning status remains Pending.</p>
      </form>
    </section>
    {searching && <p className="notice notice-info" role="status">Searching final records…</p>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {result && <section className="card">
      <div className="results-toolbar"><h2 aria-live="polite">{result.match_count} matching final records</h2><p>Ticket {result.ticket_number} · {result.business_date}</p></div>
      {result.matches.length ? <><FinalTicketTable records={result.matches.slice(page * 20, (page + 1) * 20)} onOpenImport={opening ? undefined : onOpenImport} />
        <div className="table-footer"><p>Repeated entries are preserved.</p><div className="pagination">
          <button className="button button-outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} of {Math.ceil(result.match_count / 20)}</span>
          <button className="button button-outline" disabled={(page + 1) * 20 >= result.match_count} onClick={() => setPage(page + 1)}>Next</button>
        </div></div></> : <div className="empty-state"><h3>No matching records</h3><p>No final ticket exactly matches this number on this business date. Check the date and leading zeros.</p></div>}
    </section>}
  </div>;
}
