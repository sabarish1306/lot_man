import { useEffect, useRef, useState } from "react";
import { ApiError, currentBusinessDate, saveTickets, type ManualTicket } from "../api";

const blank = () => ({ party: "", ticket_number: "", count: "" });

export default function ManualEntry({ onSaved }: { onSaved: (day: string) => void }) {
  const [rows, setRows] = useState([blank()]);
  const [preview, setPreview] = useState<ManualTicket[] | null>(null);
  const [day, setDay] = useState(currentBusinessDate);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ key: string; payload: ManualTicket[] } | null>(null);
  const lock = useRef(false);
  useEffect(() => { const timer = window.setInterval(() => setDay(currentBusinessDate()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!preview) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [preview]);

  function review() {
    setError(""); setMessage("");
    const invalid = rows.findIndex(row => !row.party.trim() || !/^[0-9]+$/.test(row.ticket_number) ||
      !/^[0-9]+$/.test(row.count) || !Number.isSafeInteger(Number(row.count)) || Number(row.count) <= 0);
    if (invalid >= 0) { setError(`Row ${invalid + 1}: enter a Party, an ASCII digit ticket number, and a positive whole-number Count.`); return; }
    setPreview(rows.map(row => ({party: row.party.trim(), ticket_number: row.ticket_number, count: Number(row.count)})));
  }
  async function save() {
    if (lock.current || !preview) return;
    lock.current = true; setSaving(true); setError("");
    const current = attempt.current ?? {key: crypto.randomUUID(), payload: preview};
    attempt.current = current;
    try {
      const result = await saveTickets("/tickets/bulk", {tickets: current.payload}, current.key);
      setRows([blank()]); setPreview(null); attempt.current = null;
      setMessage(`Saved ${result.saved_count} final ticket records for ${result.records[0].business_date}.`);
      onSaved(result.records[0].business_date);
    } catch (failure) {
      if (failure instanceof ApiError && !failure.uncertain) attempt.current = null;
      setError(failure instanceof Error ? failure.message : "Save failed. Retry this submission.");
    }
    finally { lock.current = false; setSaving(false); }
  }
  return <section className="card ticket-editor" aria-labelledby="manual-title">
    <h2 id="manual-title">Manual entry</h2>
    <p>Destination business date: <strong>{day}</strong> (Asia/Kolkata). New submissions use the server date at save time. Retries retain the original date.</p>
    <p>Manual entries have no linked image or import. Verify every row before saving.</p>
    <div className="table-scroll" role="region" aria-label="Manual ticket entry rows" tabIndex={0}>
      <table className="draft-table"><thead><tr><th>Party</th><th>Ticket Number</th><th>Count</th><th>Actions</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>
          {(["party", "ticket_number", "count"] as const).map(field => <td key={field}><input
            aria-label={`${field === "party" ? "Party" : field === "count" ? "Count" : "Ticket Number"} row ${index + 1}`}
            inputMode={field === "party" ? "text" : "numeric"} value={row[field]} disabled={!!preview || saving}
            onChange={event => setRows(rows.map((item, i) => i === index ? {...item, [field]: event.target.value} : item))} /></td>)}
          <td><button className="text-button" disabled={rows.length === 1 || !!preview || saving} onClick={() => setRows(rows.filter((_, i) => i !== index))} aria-label={`Remove row ${index + 1}`}>Remove</button></td>
        </tr>)}</tbody></table>
    </div>
    {!preview && <div className="ticket-actions"><button className="button button-outline" onClick={() => setRows([...rows, blank()])}>Add row</button><button className="button button-primary" onClick={review}>Preview batch</button></div>}
    {preview && <div className="save-preview" aria-label="Batch preview">
      <h3>Confirm {preview.length} entries</h3>
      <ol>{preview.map((row, index) => <li key={index}>{row.party} · {row.ticket_number} · Count {row.count}</li>)}</ol>
      <p>Verify the Party, digits and counts. All rows will be saved together.</p>
      <div className="ticket-actions"><button className="button button-primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : attempt.current ? "Retry same submission" : "Confirm and save batch"}</button>
        {!attempt.current && <button className="button button-outline" onClick={() => setPreview(null)}>Back to editing</button>}</div>
      {attempt.current && <p>Keep this page open and retry to establish the save outcome before starting a different batch.</p>}
    </div>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {message && <p className="notice notice-info" role="status">{message}</p>}
  </section>;
}
