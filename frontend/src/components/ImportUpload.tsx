import { useRef, useState, type DragEvent } from "react";
import {
  ArrowRight,
  CircleAlert,
  FileArchive,
  LoaderCircle,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { MAX_UPLOAD_BYTES } from "../api";

interface Props {
  busy: boolean;
  processing: boolean;
  onSubmit: (file: File) => void;
  onSelection: () => void;
}

export default function ImportUpload({
  busy,
  processing,
  onSubmit,
  onSelection,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  function select(files: FileList | File[]) {
    if (busy) return;
    onSelection();
    setError("");
    setFile(null);
    if (files.length !== 1) {
      setError("Choose one ZIP file at a time.");
      return;
    }
    const selected = files[0];
    if (!selected.name.toLowerCase().endsWith(".zip")) {
      setError("Choose a WhatsApp export ZIP file (.zip).");
      return;
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setError("This file exceeds the 100 MB limit. Choose a smaller ZIP.");
      return;
    }
    if (!selected.size) {
      setError("This ZIP is empty. Choose a file with content.");
      return;
    }
    setFile(selected);
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    dragDepth.current = 0;
    select(event.dataTransfer.files);
  }

  return (
    <section
      className="upload-card card"
      aria-labelledby="upload-title"
      aria-busy={processing}
    >
      <div className="card-heading">
        <span className="section-icon">
          <Upload size={20} />
        </span>
        <div>
          <h2 id="upload-title">Import a chat export</h2>
          <p>One ZIP. Your messages and attached images.</p>
        </div>
        <span className="step-label">STEP 01</span>
      </div>
      <div className="upload-body">
        <input
          ref={picker}
          id="zip-file"
          className="sr-only"
          tabIndex={-1}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          aria-label="Choose WhatsApp export ZIP"
          disabled={busy}
          onChange={(event) => {
            if (event.target.files?.length) select(event.target.files);
            event.target.value = "";
          }}
        />
        <div
          className={`drop-zone ${dragging && !busy ? "dragging" : ""} ${file ? "has-file" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDragEnter={(event) => {
            event.preventDefault();
            dragDepth.current++;
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => {
            dragDepth.current--;
            if (dragDepth.current === 0) setDragging(false);
          }}
          onDrop={drop}
        >
          {file ? (
            <>
              <div className="upload-art selected-art">
                <FileArchive size={35} strokeWidth={1.4} />
              </div>
              <h3 className="selected-filename">{file.name}</h3>
              <p>
                {(file.size / (1024 * 1024)).toLocaleString("en-IN", {
                  maximumFractionDigits: 2,
                  minimumFractionDigits: 2,
                })}{" "}
                MB <span className="mx-2">·</span> ZIP archive
              </p>
              <div className="file-actions">
                <button
                  className="text-button"
                  onClick={() => picker.current?.click()}
                  disabled={busy}
                >
                  <RefreshCw size={14} />
                  Replace file
                </button>
                <span />
                <button
                  className="text-button muted"
                  disabled={busy}
                  onClick={() => {
                    setFile(null);
                    setError("");
                    onSelection();
                  }}
                >
                  <X size={15} />
                  Remove
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="upload-art">
                <FileArchive size={36} strokeWidth={1.35} />
                <span>
                  <PlusIcon />
                </span>
              </div>
              <h3>Drop your WhatsApp ZIP here</h3>
              <p>or choose a file from your computer</p>
              <button
                className="button button-outline browse-button"
                disabled={busy}
                onClick={() => picker.current?.click()}
              >
                <Upload size={16} />
                Browse files
              </button>
              <span className="file-requirements">
                ZIP files only <span>·</span> Up to 100 MB
              </span>
            </>
          )}
        </div>
        {error && (
          <p className="field-error" role="alert">
            <CircleAlert size={16} />
            {error}
          </p>
        )}
        {processing && (
          <div className="processing-state" role="status">
            <LoaderCircle size={21} className="spinner" />
            <div>
              <strong>Processing your import</strong>
              <p>
                Processing messages and images. This may take several minutes.
              </p>
              <p className="processing-hint">
                Keep this page open. Your request will not be retried
                automatically.
              </p>
            </div>
          </div>
        )}
        <div className="upload-action">
          <p>
            Results are saved on your local backend.
            <br />
            <span>No tickets are automatically accepted.</span>
          </p>
          <button
            className="button button-primary"
            disabled={!file || busy}
            onClick={() => file && onSubmit(file)}
          >
            {processing ? <LoaderCircle size={17} className="spinner" /> : null}
            {processing ? "Processing…" : "Process ZIP"}
            {!processing && <ArrowRight size={17} />}
          </button>
        </div>
      </div>
    </section>
  );
}

function PlusIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 2v8M2 6h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
