import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FolderOpen,
  HardDrive,
  Inbox,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  ApiError,
  formatImportTime,
  getImport,
  uploadImport,
  type ImportResult,
} from "./api";
import { loadHistory, rememberImport } from "./history";
import ImportUpload from "./components/ImportUpload";
import ImportResults from "./components/ImportResults";
import TicketLookup from "./components/TicketLookup";
import StoredTickets from "./components/StoredTickets";

export default function App() {
  const [view, setView] = useState<"imports" | "lookup" | "stored">("imports");
  const [storedVisited, setStoredVisited] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [history, setHistory] = useState(loadHistory);
  const [busy, setBusy] = useState<"upload" | "open" | null>(null);
  const [error, setError] = useState("");
  const [id, setId] = useState("");
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (result) heading.current?.focus();
  }, [result, view]);

  useEffect(() => {
    if (busy !== "upload") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function run(
    operation: "upload" | "open",
    request: () => Promise<ImportResult>,
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(operation);
    setError("");
    try {
      const imported = await request();
      setResult(imported);
      setView("imports");
      setId("");
      // Keep only IDs and summary counts, never messages or ticket values.
      const remembered = rememberImport(imported, history.items);
      setHistory(remembered);
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Something went wrong. Check the backend before trying again.",
      );
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  function openImport(event: FormEvent) {
    event.preventDefault();
    void run("open", () => getImport(id.trim()));
  }

  function newImport() {
    if (lock.current) return;
    setResult(null);
    setView("imports");
    setError("");
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Import workspace">
        <a
          className="brand"
          href="#main-content"
          aria-label="Import Desk, main content"
        >
          <span className="brand-mark">
            <ArrowDownToLine size={23} strokeWidth={1.8} />
          </span>
          <span>
            Import Desk<span className="brand-subtitle">TICKET WORKSPACE</span>
          </span>
        </a>
        <div className="sidebar-workspace">
          <span className="workspace-avatar">L</span>
          <div>
            <strong>Local workspace</strong>
            <span>WhatsApp imports</span>
          </div>
          <HardDrive size={16} />
        </div>
        <p className="eyebrow sidebar-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          <button
            className={`nav-button ${view === "imports" ? "active" : ""}`}
            disabled={!!busy}
            onClick={newImport}
          >
            <Inbox size={19} /> Imports{" "}
            <span className="nav-plus">
              <Plus size={15} />
            </span>
          </button>
          <button
            className={`nav-button ${view === "lookup" ? "active" : ""}`}
            disabled={!!busy}
            onClick={() => {
              setView("lookup");
              setError("");
            }}
          >
            <Search size={19} />
            Ticket lookup
          </button>
          <button className={`nav-button ${view === "stored" ? "active" : ""}`} disabled={!!busy} onClick={() => { setStoredVisited(true); setView("stored"); setError(""); }}>
            <HardDrive size={19} />Stored tickets
          </button>
        </nav>

        <section className="opened-section" aria-labelledby="opened-title">
          <div className="flex items-center gap-2">
            <Clock3 size={15} />
            <h2 id="opened-title">Imports opened in this browser</h2>
          </div>
          <p className="sidebar-description">
            A local list, not the full backend history.
          </p>
          {history.items.length === 0 ? (
            <div className="history-empty">
              <FolderOpen size={23} strokeWidth={1.4} />
              <p>
                No imports opened yet.
                <br />
                Your recent imports will appear here.
              </p>
            </div>
          ) : (
            <ul className="history-list">
              {history.items.map((item) => (
                <li key={item.id}>
                  <button
                    className={`history-item ${result?.import_id === item.id ? "selected" : ""}`}
                    disabled={!!busy}
                    onClick={() => void run("open", () => getImport(item.id))}
                    aria-label={`Open import ${item.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="history-date">{item.businessDate}</span>
                      <ChevronRight size={14} />
                    </div>
                    <span className="history-id">{item.id.slice(0, 12)}…</span>
                    <span className="history-counts">
                      {item.draftCount} draft entries <span>·</span>{" "}
                      {item.issueCount} to review
                    </span>
                    <span className="sr-only">
                      Imported {formatImportTime(item.timestamp)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {history.unavailable && (
            <p className="storage-warning" role="status">
              Browser storage is unavailable or could not be read. Copy the
              import ID to reopen it later.
            </p>
          )}
        </section>

        <form className="open-form" onSubmit={openImport}>
          <label htmlFor="import-id">Have an import ID?</label>
          <p>Reopen a result from this backend.</p>
          <input
            id="import-id"
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder="Paste the full import ID"
            spellCheck={false}
            autoComplete="off"
            disabled={!!busy}
            required
            aria-describedby="import-id-help"
          />
          <span id="import-id-help" className="sr-only">
            32 lowercase letters a through f and digits.
          </span>
          <button
            className="button button-outline w-full"
            disabled={!!busy || !id.trim()}
          >
            {busy === "open" ? (
              <LoaderCircle size={16} className="spinner" />
            ) : (
              <FolderOpen size={16} />
            )}
            Open import
            <ArrowRight size={15} className="ml-auto" />
          </button>
        </form>
        <div className="sidebar-footer">
          <ShieldCheck size={17} />
          <span>Files stored on your local backend</span>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <span>{view === "stored" ? "Stored tickets" : view === "lookup" ? "Ticket lookup" : "Imports"}</span>
            {view === "imports" && result && (
              <>
                <ChevronRight size={13} />
                <strong>Results</strong>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className="button button-outline lookup-shortcut"
              disabled={!!busy}
              onClick={() => {
                setView(view === "lookup" ? "imports" : "lookup");
                setError("");
              }}
            >
              <Search size={15} />
              {view === "lookup" ? "Back to imports" : "Find a ticket"}
            </button>
            <span className="local-badge">
              <HardDrive size={13} /> Local processing
            </span>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">IMPORT & REVIEW</div>
              <h1 ref={heading} tabIndex={-1}>
                {view === "stored" ? "Stored tickets" : view === "lookup"
                  ? "Daily ticket lookup"
                  : result
                    ? "Import results"
                    : "WhatsApp Ticket Import"}
              </h1>
              <p>
                {view === "stored" ? "View final records and explicitly save verified ticket entries." : view === "lookup"
                  ? "Search persisted final ticket records for a business day."
                  : result
                    ? "Inspect extracted entries and the source behind every result."
                    : "Bring your conversations into a clearer workspace."}
              </p>
            </div>
            {view === "imports" && result && (
              <button
                className="button button-primary"
                onClick={newImport}
                disabled={!!busy}
              >
                <Plus size={17} />
                New import
              </button>
            )}
          </div>
          {error && (
            <div className="notice notice-error" role="alert">
              <CircleAlert size={20} />
              <div>
                <strong>We couldn’t complete that request</strong>
                <p className="whitespace-pre-wrap break-words">{error}</p>
              </div>
            </div>
          )}
          {busy === "open" && (
            <div className="notice notice-info" role="status">
              <LoaderCircle className="spinner" size={20} />
              <p>Loading the stored import from your backend…</p>
            </div>
          )}
          {storedVisited && <div hidden={view !== "stored"}><StoredTickets active={view === "stored"} /></div>}
          {view === "stored" ? null : view === "lookup" ? (
            <TicketLookup
              opening={!!busy}
              onOpenImport={(importId) =>
                void run("open", () => getImport(importId))
              }
            />
          ) : result ? (
            <ImportResults key={result.import_id} result={result} />
          ) : (
            <>
              <div className="notice notice-neutral">
                <ShieldCheck size={20} />
                <div>
                  <strong>Every extraction starts as a draft.</strong>
                  <p>
                    Processing does not accept tickets. Check draft entries and
                    manually review image-derived results.
                  </p>
                </div>
                <span className="notice-tag">REVIEW REQUIRED</span>
              </div>
              <div className="import-layout">
                <ImportUpload
                  busy={!!busy}
                  processing={busy === "upload"}
                  onSubmit={(file) =>
                    void run("upload", () => uploadImport(file))
                  }
                  onSelection={() => setError("")}
                />
                <aside className="import-guide">
                  <div className="guide-icon">
                    <FolderOpen size={23} strokeWidth={1.6} />
                  </div>
                  <h2>
                    A little preparation.
                    <br />A clearer import.
                  </h2>
                  <p className="guide-intro">
                    Start with a WhatsApp chat export in one ZIP file.
                  </p>
                  <ul className="guide-list">
                    <li>
                      <span>
                        <Check size={14} />
                      </span>
                      <div>
                        <strong>Include the chat text</strong>
                        <p>Your ZIP must contain exactly one chat .txt file.</p>
                      </div>
                    </li>
                    <li>
                      <span>
                        <Check size={14} />
                      </span>
                      <div>
                        <strong>Keep images together</strong>
                        <p>
                          Include exported JPG, PNG, or WebP images to retain
                          their source.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>
                        <Check size={14} />
                      </span>
                      <div>
                        <strong>Leave time for processing</strong>
                        <p>
                          Messages and images are processed locally. Larger
                          imports may take several minutes.
                        </p>
                      </div>
                    </li>
                  </ul>
                  <div className="guide-note">
                    <ShieldCheck size={17} />
                    <p>
                      Original messages and images remain available for
                      inspection after import.
                    </p>
                  </div>
                </aside>
              </div>
              <div className="workflow-note">
                <span className="workflow-number">01</span>
                <span>Upload your export</span>
                <span className="workflow-line" />
                <span className="workflow-number">02</span>
                <span>Inspect draft entries</span>
                <span className="workflow-line" />
                <span className="workflow-number">03</span>
                <span>Review source material</span>
              </div>
            </>
          )}
          <footer className="main-footer">
            <span>
              Import Desk <span className="footer-dot">/</span> WhatsApp ticket
              workspace
            </span>
            <span>Drafts first. Verification always.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
