import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileText,
  MessageSquareText,
  Search,
  X,
} from "lucide-react";
import { getTickets, type ImportResult, type FinalTicket } from "../api";
import ConfirmDraft from "./ConfirmDraft";

const PAGE_SIZE = 25;

export default function DraftEntries({ result }: { result: ImportResult }) {
  const drafts = result.drafts;
  const [savedRecords, setSavedRecords] = useState<FinalTicket[]>([]);
  const [stateError, setStateError] = useState("");
  const [stateReady, setStateReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => {
    let alive = true;
    setStateReady(false); setStateError("");
    getTickets(result.business_date).then(data => { if (alive) { setSavedRecords(data.records); setStateReady(true); } })
      .catch(error => { if (alive) setStateError(error instanceof Error ? error.message : "Could not load confirmation state."); });
    return () => { alive = false; };
  }, [result.business_date, revision]);
  const isSaved = (id?: string) => savedRecords.some(record => record.import_id === result.import_id && record.message_id === id);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const entries = useMemo(
    () =>
      drafts.flatMap((draft, draftIndex) =>
        draft.tickets.map((ticket, ticketIndex) => ({
          draft,
          draftIndex,
          ticket,
          key: `${draftIndex}-${ticketIndex}`,
        })),
      ),
    [drafts],
  );
  const filtered = entries.filter(
    ({ draft, ticket }) =>
      ticket.ticket_number.toLowerCase().includes(query.trim().toLowerCase()) ||
      (draft.sender ?? "").toLowerCase().includes(query.trim().toLowerCase()),
  );
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const source = selected !== null ? drafts[selected] : null;

  return (
    <>
      <div className="confirmation-state">
        {!stateReady && !stateError && <p role="status">Loading saved confirmation state…</p>}
        {stateError && <p className="notice notice-error" role="alert">{stateError}</p>}
        <button className="text-button" onClick={refresh}>Refresh confirmation state</button>
      </div>
      <div className="results-toolbar">
        <div>
          <h2>Extracted ticket entries</h2>
          <p>Original order and repeated entries are preserved.</p>
        </div>
        <div className="search-field">
          <Search size={17} />
          <label htmlFor="draft-search" className="sr-only">
            Search by ticket number or sender
          </label>
          <input
            id="draft-search"
            type="search"
            value={query}
            placeholder="Search ticket or sender…"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="empty-state">
          <FileText size={30} strokeWidth={1.4} />
          <h3>No draft entries in this import</h3>
          <p>Check Needs review for messages or images that need inspection.</p>
        </div>
      ) : (
        <div className={`draft-layout ${source ? "with-source" : ""}`}>
          <div className="min-w-0">
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Draft ticket entries, scroll horizontally if needed"
            >
              <table className="draft-table">
                <caption className="sr-only">
                  Unvalidated draft entries. Select a ticket number to inspect
                  its original message.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Message time</th>
                    <th scope="col">Sender</th>
                    <th scope="col">Ticket Number</th>
                    <th scope="col" className="numeric">
                      Count
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ draft, draftIndex, ticket, key }) => (
                    <tr
                      key={key}
                      className={draftIndex === selected ? "selected-row" : ""}
                    >
                      <td className="timestamp-cell">
                        {draft.message_timestamp_raw || "Not available"}
                      </td>
                      <td>
                        {draft.sender || (
                          <span className="muted">Not provided</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="ticket-link"
                          onClick={() => setSelected(draftIndex)}
                          aria-label={`View source for ticket ${ticket.ticket_number}`}
                          aria-expanded={draftIndex === selected}
                          aria-controls="source-panel"
                        >
                          <span>{ticket.ticket_number}</span>
                          <ArrowUpRight size={13} />
                        </button>
                      </td>
                      <td className="numeric count-cell">{ticket.count}</td>
                      <td>
                        <span className="draft-badge">{isSaved(draft.message_id) ? "Saved in final records" : "Unvalidated draft"}</span>
                        {draft.source_type === "text" && <button className="text-button" onClick={() => setSelected(draftIndex)}>Review and save</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <div className="empty-state compact">
                <Search size={25} />
                <h3>No matching entries</h3>
                <p>Try another ticket number or sender.</p>
                <button
                  className="text-button"
                  onClick={() => {
                    setQuery("");
                    setPage(0);
                  }}
                >
                  Clear search
                </button>
              </div>
            )}
            <div className="table-footer">
              <p>
                {filtered.length
                  ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length}`
                  : "0"}{" "}
                entries{query.trim() ? " matching your search" : ""}
              </p>
              <div className="pagination">
                <button
                  className="icon-button"
                  aria-label="Previous page"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  Page {page + 1} of{" "}
                  {Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}
                </span>
                <button
                  className="icon-button"
                  aria-label="Next page"
                  disabled={(page + 1) * PAGE_SIZE >= filtered.length}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          </div>
          {source && (
            <aside
              id="source-panel"
              className="source-panel"
              aria-label="Source message"
            >
              <div className="source-heading">
                <MessageSquareText size={18} />
                <h3>Source message</h3>
                <button
                  className="icon-button ml-auto"
                  aria-label="Close source message"
                  onClick={() => setSelected(null)}
                >
                  <X size={16} />
                </button>
              </div>
              <dl>
                <div>
                  <dt>Sender</dt>
                  <dd>{source.sender || "Not provided"}</dd>
                </div>
                <div>
                  <dt>Original WhatsApp timestamp</dt>
                  <dd>{source.message_timestamp_raw || "Not available"}</dd>
                </div>
              </dl>
              <pre className="source-text">
                {source.text || "No source text available."}
              </pre>
              <p className="source-footnote">
                Sender is source metadata, not Party. The timestamp is shown
                exactly as exported.
              </p>
            </aside>
          )}
        </div>
      )}
      {drafts.map((draft, index) => <div key={draft.message_id || index} hidden={selected !== index}>
        <ConfirmDraft draft={draft} result={result} saved={isSaved(draft.message_id)} onRefresh={refresh} available={stateReady} />
      </div>)}
      {!source && entries.length > 0 && (
        <div className="source-tip">
          <MessageSquareText size={16} />
          <p>Select a ticket number to inspect the original message.</p>
        </div>
      )}
    </>
  );
}
