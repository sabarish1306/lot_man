import { useRef, useState, type KeyboardEvent } from "react";
import {
  CheckCheck,
  CircleAlert,
  Copy,
  FileText,
  Images,
  ListChecks,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { draftTicketCount, formatImportTime, type ImportResult } from "../api";
import DraftEntries from "./DraftEntries";
import ReviewIssues from "./ReviewIssues";

export default function ImportResults({ result }: { result: ImportResult }) {
  const [tab, setTab] = useState<"drafts" | "review">("drafts");
  const [copyMessage, setCopyMessage] = useState("");
  const draftTab = useRef<HTMLButtonElement>(null);
  const reviewTab = useRef<HTMLButtonElement>(null);
  const count = draftTicketCount(result);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(result.import_id);
      setCopyMessage("Import ID copied.");
    } catch {
      setCopyMessage(
        "Could not copy. Select the import ID to copy it manually.",
      );
    }
  }

  function navigateTabs(event: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "drafts"
        : event.key === "End"
          ? "review"
          : tab === "drafts"
            ? "review"
            : "drafts";
    setTab(next);
    (next === "drafts" ? draftTab : reviewTab).current?.focus();
  }

  return (
    <>
      <section className="result-metadata card" aria-label="Import details">
        <div className="result-received">
          <span className="received-icon">
            <CheckCheck size={21} />
          </span>
          <div>
            <strong>Processing response received</strong>
            <span>Results saved · review required</span>
          </div>
        </div>
        <dl className="metadata-fields">
          <div className="import-id-field">
            <dt>IMPORT ID</dt>
            <dd>
              <code>{result.import_id}</code>
              <button
                className="icon-button"
                aria-label="Copy import ID"
                onClick={() => void copyId()}
              >
                <Copy size={14} />
              </button>
            </dd>
          </div>
          <div>
            <dt>IMPORTED AT</dt>
            <dd>{formatImportTime(result.import_timestamp)}</dd>
          </div>
          <div>
            <dt>BUSINESS DATE</dt>
            <dd>{result.business_date}</dd>
          </div>
        </dl>
        {copyMessage && (
          <p className="copy-status" role="status">
            {copyMessage}
          </p>
        )}
      </section>
      <div className="stats-grid">
        {[
          {
            label: "Messages",
            value: result.message_count,
            icon: MessageSquare,
            note: "In the chat export",
          },
          {
            label: "Images",
            value: result.image_count,
            icon: Images,
            note: "Retained source images",
          },
          {
            label: "Draft ticket entries",
            value: count,
            icon: FileText,
            note: "Original extraction count",
          },
          {
            label: "Needs review",
            value: result.issues.length,
            icon: CircleAlert,
            note: "Image and text issues",
          },
        ].map(({ label, value, icon: Icon, note }, index) => (
          <section
            className={`stat-card ${index === 3 ? "review-stat" : ""}`}
            key={label}
          >
            <div>
              <span>{label}</span>
              <Icon size={18} strokeWidth={1.6} />
            </div>
            <strong>{value.toLocaleString("en-IN")}</strong>
            <p>{note}</p>
          </section>
        ))}
      </div>
      <div className="acceptance-note">
        <ShieldCheck size={18} />
        <p>
          <strong>Accepted at import time: {result.accepted_ticket_count} (historical).</strong>{" "}
          Live saved state appears below and in Stored tickets. Image-derived entries always
          require manual review.
        </p>
      </div>
      <section className="results-card card">
        <div
          className="result-tabs"
          role="tablist"
          aria-label="Import results"
          onKeyDown={navigateTabs}
        >
          <button
            ref={draftTab}
            id="draft-tab"
            role="tab"
            aria-selected={tab === "drafts"}
            aria-controls="draft-panel"
            tabIndex={tab === "drafts" ? 0 : -1}
            onClick={() => setTab("drafts")}
          >
            <ListChecks size={18} />
            Draft entries<span>{count}</span>
          </button>
          <button
            ref={reviewTab}
            id="review-tab"
            role="tab"
            aria-selected={tab === "review"}
            aria-controls="review-panel"
            tabIndex={tab === "review" ? 0 : -1}
            onClick={() => setTab("review")}
          >
            <CircleAlert size={18} />
            Needs review
            <span className={result.issues.length ? "review-count" : ""}>
              {result.issues.length}
            </span>
          </button>
        </div>
        <div
          id="draft-panel"
          role="tabpanel"
          aria-labelledby="draft-tab"
          hidden={tab !== "drafts"}
          tabIndex={0}
        >
          <DraftEntries result={result} />
        </div>
        <div
          id="review-panel"
          role="tabpanel"
          aria-labelledby="review-tab"
          hidden={tab !== "review"}
          tabIndex={0}
        >
          <ReviewIssues issues={result.issues} />
        </div>
      </section>
    </>
  );
}
