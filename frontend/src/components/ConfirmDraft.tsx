import { useRef, useState } from "react";
import { saveTickets, type Draft, type ImportResult } from "../api";

export default function ConfirmDraft({ draft, result, saved, onRefresh, available }: {
  draft: Draft; result: ImportResult; saved: boolean; onRefresh: () => void; available: boolean;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [party, setParty] = useState(draft.party || result.party || "");
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const attempt = useRef<{ key: string; party: string } | null>(null);
  const lock = useRef(false);
  async function confirm() {
    if (lock.current || !verified) return;
    if (!party.trim()) { setError("Enter a Party before confirming."); return; }
    lock.current = true; setSaving(true); setError("");
    const current = attempt.current ?? {key: crypto.randomUUID(), party: party.trim()};
    attempt.current = current;
    try {
      await saveTickets("/tickets/confirm-draft", {import_id: result.import_id, message_id: draft.message_id,
        party: current.party, tickets: draft.tickets}, current.key);
      setSuccess(true); onRefresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not confirm this draft.");
      onRefresh();
    } finally { lock.current = false; setSaving(false); }
  }
  if (draft.source_type !== "text" || !draft.message_id || !draft.tickets.length) return null;
  if (saved || success) return <p className="notice notice-info" role="status">Saved / already confirmed in final records. Original draft evidence is retained.</p>;
  return <div className="draft-confirmation">
    {!reviewing ? <button className="button button-primary" disabled={!available} onClick={() => setReviewing(true)}>Review and save</button> : <>
      <h3>Review and save complete text draft</h3>
      <p>Original import business date: <strong>{result.business_date}</strong></p>
      <pre className="source-text">{draft.text || "No source text available."}</pre>
      <ol>{draft.tickets.map((ticket, index) => <li key={index}>{ticket.ticket_number} · Count {ticket.count}</li>)}</ol>
      <p>Verify every entry against the original message. This saves the entire message together. For corrections, use Manual entry under Stored tickets.</p>
      <label>Party<input value={party} disabled={saving || !!attempt.current} onChange={event => setParty(event.target.value)} /></label>
      <label className="verification-checkbox"><input type="checkbox" checked={verified} disabled={saving} onChange={event => setVerified(event.target.checked)} />I verified all ticket numbers and counts against the original message.</label>
      <div className="ticket-actions"><button className="button button-primary" disabled={saving || !verified || !party.trim() || !available} onClick={() => void confirm()}>{saving ? "Saving…" : attempt.current ? "Retry draft confirmation" : "Confirm and save text draft"}</button>
        {!attempt.current && <button className="button button-outline" onClick={() => setReviewing(false)}>Cancel review</button>}</div>
    </>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
  </div>;
}
