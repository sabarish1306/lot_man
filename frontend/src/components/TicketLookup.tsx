import { useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  CircleAlert,
  FileSearch,
  LoaderCircle,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  ApiError,
  currentBusinessDate,
  formatImportTime,
  imageUrl,
  searchTickets,
  type Draft,
  type TicketMatch,
  type TicketSearchResult,
} from "../api";
import ImagePreview from "./ImagePreview";

const PAGE_SIZE = 20;

export default function TicketLookup({
  onOpenImport,
  opening,
}: {
  onOpenImport: (id: string) => void;
  opening: boolean;
}) {
  const [businessDate, setBusinessDate] = useState(currentBusinessDate);
  const [ticketNumber, setTicketNumber] = useState("");
  const [result, setResult] = useState<TicketSearchResult | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [page, setPage] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);

  function clearResult() {
    setResult(null);
    setError("");
    setPage(0);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || opening) return;
    const number = ticketNumber.trim();
    if (!businessDate || !/^[0-9]+$/.test(number)) {
      setError(
        "Choose a business date and enter a ticket number containing digits only.",
      );
      return;
    }
    lock.current = true;
    setSearching(true);
    clearResult();
    try {
      setResult(await searchTickets(businessDate, number));
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Ticket search failed. Please try again.",
      );
    } finally {
      lock.current = false;
      setSearching(false);
    }
  }

  return (
    <div className="ticket-lookup">
      <section
        className="card lookup-form-card"
        aria-labelledby="lookup-form-title"
      >
        <div className="card-heading">
          <span className="section-icon">
            <FileSearch size={21} />
          </span>
          <div>
            <h2 id="lookup-form-title">Find a complete ticket record</h2>
            <p>
              Search every saved import for a business date, including imports
              never opened in this browser.
            </p>
          </div>
        </div>
        <form className="lookup-form" onSubmit={(event) => void submit(event)}>
          <div className="lookup-field">
            <label htmlFor="lookup-date">
              <CalendarDays size={15} />
              Business date
            </label>
            <input
              id="lookup-date"
              type="date"
              required
              value={businessDate}
              disabled={searching || opening}
              onChange={(event) => {
                setBusinessDate(event.target.value);
                clearResult();
              }}
              aria-describedby="lookup-help"
            />
          </div>
          <div className="lookup-field lookup-number">
            <label htmlFor="lookup-number">Ticket number</label>
            <input
              ref={input}
              id="lookup-number"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              required
              pattern="[0-9]+"
              value={ticketNumber}
              placeholder="e.g. 001234"
              disabled={searching || opening}
              onChange={(event) => {
                setTicketNumber(event.target.value);
                clearResult();
              }}
              aria-describedby="lookup-help"
            />
          </div>
          <button
            className="button button-primary"
            disabled={
              searching || opening || !businessDate || !ticketNumber.trim()
            }
          >
            {searching ? (
              <LoaderCircle size={17} className="spinner" />
            ) : (
              <Search size={17} />
            )}
            {searching ? "Searching…" : "Find records"}
          </button>
          <button
            className="button button-outline"
            type="button"
            disabled={searching || opening}
            onClick={() => {
              setTicketNumber("");
              clearResult();
              input.current?.focus();
            }}
          >
            <X size={16} />
            Clear
          </button>
          <p id="lookup-help" className="lookup-help">
            Exact match · Leading zeros matter · Date uses the saved business
            date (Asia/Kolkata), not the WhatsApp message date.
          </p>
        </form>
      </section>
      <div className="acceptance-note">
        <ShieldCheck size={18} />
        <p>
          Matches retain their original status. Drafts are unvalidated; image
          suggestions require manual review. Imports still processing or without
          saved results cannot be searched.
        </p>
      </div>
      {searching && (
        <div className="notice notice-info" role="status">
          <LoaderCircle size={20} className="spinner" />
          <p>Searching saved imports for the selected day…</p>
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          <CircleAlert size={20} />
          <p>{error}</p>
        </div>
      )}
      {result && (
        <>
          {result.warnings.length > 0 && (
            <div className="notice lookup-warning" role="alert">
              <CircleAlert size={20} />
              <div>
                <strong>Search may be incomplete</strong>
                <p>
                  {result.warnings.length} saved result(s) could not be read.
                  Results below include only readable imports.
                </p>
                <details>
                  <summary>Show affected imports</summary>
                  <ul>
                    {result.warnings.map((warning) => (
                      <li key={warning.import_id}>
                        <code>{warning.import_id}</code> — {warning.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </div>
          )}
          <section
            className="card lookup-results"
            aria-labelledby="lookup-results-title"
          >
            <div className="results-toolbar">
              <div>
                <h2
                  id="lookup-results-title"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {result.match_count} matching{" "}
                  {result.match_count === 1 ? "entry" : "entries"} across{" "}
                  {result.matched_import_count}{" "}
                  {result.matched_import_count === 1 ? "import" : "imports"}
                </h2>
                <p>
                  Ticket <strong>{result.ticket_number}</strong> · Business date{" "}
                  {result.business_date} · {result.searched_import_count}{" "}
                  completed{" "}
                  {result.searched_import_count === 1 ? "import" : "imports"}{" "}
                  searched
                </p>
              </div>
              <span className="lookup-exact">Exact match</span>
            </div>
            {result.matches.length ? (
              <>
                <div className="lookup-records">
                  {result.matches
                    .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                    .map((match) => (
                      <MatchRecord
                        key={`${match.import_id}-${match.record_type}-${match.record_index}-${match.ticket_index}`}
                        match={match}
                        onOpenImport={onOpenImport}
                        opening={opening}
                      />
                    ))}
                </div>
                <div className="table-footer">
                  <p>
                    Showing {page * PAGE_SIZE + 1}–
                    {Math.min((page + 1) * PAGE_SIZE, result.match_count)} of{" "}
                    {result.match_count} matching entries. Duplicates are
                    preserved.
                  </p>
                  <div className="pagination">
                    <button
                      className="button button-outline"
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous
                    </button>
                    <span>
                      Page {page + 1} of{" "}
                      {Math.ceil(result.match_count / PAGE_SIZE)}
                    </span>
                    <button
                      className="button button-outline"
                      disabled={(page + 1) * PAGE_SIZE >= result.match_count}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <Search size={30} />
                <h3>
                  {result.warnings.length
                    ? "No matches in the readable results"
                    : "No matching records"}
                </h3>
                <p>
                  {result.searched_import_count === 0
                    ? "No readable completed imports were found for this business date."
                    : "No stored ticket entry exactly matches this number on the selected business date."}
                </p>
                <p>Check the date and all digits, including leading zeros.</p>
              </div>
            )}
          </section>
        </>
      )}
      {!result && !searching && !error && (
        <div className="card empty-state">
          <FileSearch size={32} strokeWidth={1.4} />
          <h3>Find the record behind a number</h3>
          <p>
            Choose a day and enter the full ticket number to retrieve matching
            records.
          </p>
        </div>
      )}
    </div>
  );
}

function MatchRecord({
  match,
  onOpenImport,
  opening,
}: {
  match: TicketMatch;
  onOpenImport: (id: string) => void;
  opening: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const { record } = match;
  const sourceImage = imageUrl(record.source_image_url);
  const status =
    match.record_type === "review"
      ? "Needs review — unverified suggestion"
      : (record as Draft).status === "draft_unvalidated"
        ? "Unvalidated draft"
        : (record as Draft).status || "Unvalidated draft";

  return (
    <article
      className="lookup-record"
      aria-label={`Matching ticket ${match.ticket.ticket_number}, count ${match.ticket.count}`}
    >
      <div className="lookup-record-heading">
        <div>
          <span className="lookup-match-label">MATCH</span>
          <h3>
            Ticket <mark>{match.ticket.ticket_number}</mark>
          </h3>
        </div>
        <span
          className={
            match.record_type === "review" ? "review-badge" : "draft-badge"
          }
        >
          {status}
        </span>
      </div>
      <dl className="lookup-record-fields">
        <div>
          <dt>Count</dt>
          <dd className="lookup-quantity">{match.ticket.count}</dd>
        </div>
        <div>
          <dt>Sender</dt>
          <dd>{record.sender || "Not provided"}</dd>
        </div>
        <div>
          <dt>Original message time</dt>
          <dd>{record.message_timestamp_raw || "Not available"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{record.source_type || "Not available"}</dd>
        </div>
        <div>
          <dt>Import ID</dt>
          <dd>
            <code>{match.import_id}</code>
          </dd>
        </div>
        <div>
          <dt>Imported at</dt>
          <dd>{formatImportTime(match.import_timestamp)}</dd>
        </div>
        <div>
          <dt>Business date</dt>
          <dd>{match.business_date}</dd>
        </div>
        <div>
          <dt>Party</dt>
          <dd>
            {("party" in record ? record.party : match.party) || "Not provided"}
          </dd>
        </div>
      </dl>
      <div className="lookup-source">
        <h4>Original source message</h4>
        <pre
          className="source-text"
          tabIndex={0}
          role="region"
          aria-label="Original source message text"
        >
          {record.text || "No source text available."}
        </pre>
      </div>
      {"reason" in record && record.reason && (
        <p className="lookup-review-reason">
          <strong>Review reason:</strong> {record.reason}
        </p>
      )}
      <div className="lookup-record-actions">
        <button
          className="text-button"
          disabled={opening}
          onClick={() => onOpenImport(match.import_id)}
        >
          Open full import
          <ArrowUpRight size={15} />
        </button>
        {sourceImage && (
          <button className="text-button" onClick={() => setPreview(true)}>
            View source image
            <ArrowUpRight size={15} />
          </button>
        )}
      </div>
      <details className="inspection">
        <summary>Complete saved record</summary>
        <p className="recognition-note">
          Original record, including other tickets and any OCR/model details.
          All matching occurrences are returned separately.
        </p>
        <pre
          className="json-output"
          tabIndex={0}
          role="region"
          aria-label="Complete saved record JSON"
        >
          {JSON.stringify(record, null, 2)}
        </pre>
      </details>
      {preview && sourceImage && (
        <ImagePreview
          url={sourceImage}
          name={
            ("original_filename" in record && record.original_filename) ||
            "Retained source image"
          }
          onClose={() => setPreview(false)}
        />
      )}
    </article>
  );
}
