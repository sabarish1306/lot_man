import { useState } from "react";
import {
  CircleAlert,
  FileText,
  ImageOff,
  ScanText,
  ShieldCheck,
  ZoomIn,
} from "lucide-react";
import { imageUrl, isRecord, type Issue } from "../api";
import ImagePreview from "./ImagePreview";

export default function ReviewIssues({ issues }: { issues: Issue[] }) {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(
    null,
  );

  return (
    <div className="review-content">
      <div className="review-intro">
        <div>
          <h2>Source material that needs a closer look</h2>
          <p>
            Inspect the reasons and original sources. Corrections cannot be
            saved in this workspace yet.
          </p>
        </div>
        <span className="review-label">
          <CircleAlert size={14} />
          Manual review
        </span>
      </div>
      {issues.length === 0 ? (
        <div className="empty-state">
          <ShieldCheck size={32} strokeWidth={1.4} />
          <h3>No issues reported</h3>
          <p>
            There are no review issues in this result. Draft entries still
            require validation.
          </p>
        </div>
      ) : (
        <div className="issues-list">
          {issues.map((issue, index) => (
            <IssueCard
              key={`${issue.issue_id ?? "issue"}-${index}`}
              issue={issue}
              index={index}
              onPreview={(url, name) => setPreview({ url, name })}
            />
          ))}
        </div>
      )}
      {preview && (
        <ImagePreview {...preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

function IssueCard({
  issue,
  index,
  onPreview,
}: {
  issue: Issue;
  index: number;
  onPreview: (url: string, name: string) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const url = imageUrl(issue.source_image_url);
  const hasImage = issue.source_type === "image" || !!issue.source_image_url;
  const name = issue.original_filename || "Retained source image";
  const details = isRecord(issue.details) ? issue.details : null;
  const ocr = details && isRecord(details.ocr) ? details.ocr : null;
  const regions =
    ocr && Array.isArray(ocr.regions) ? ocr.regions.filter(isRecord) : [];
  const extraction =
    details?.extraction ?? (details && "tickets" in details ? details : null);

  return (
    <article className={`issue-card ${hasImage ? "image-issue" : ""}`}>
      {hasImage && (
        <div className="issue-image">
          {url && !imageFailed ? (
            <button
              className="image-trigger"
              onClick={() => onPreview(url, name)}
              aria-label={`Enlarge source image for issue ${index + 1}`}
            >
              <img
                src={url}
                alt={`Source image for review issue ${index + 1}`}
                loading="lazy"
                onError={() => setImageFailed(true)}
              />
              <span>
                <ZoomIn size={15} />
                Enlarge image
              </span>
            </button>
          ) : (
            <div className="image-unavailable">
              <ImageOff size={26} />
              <strong>Image unavailable</strong>
              <p>The source image could not be loaded or is not available.</p>
            </div>
          )}
        </div>
      )}
      <div className="issue-body">
        <div className="issue-heading">
          <span className="issue-type">
            {hasImage ? <ScanText size={15} /> : <FileText size={15} />}
            {hasImage ? "IMAGE" : "TEXT"}{" "}
            <span>/{String(index + 1).padStart(2, "0")}</span>
          </span>
          <span className="review-badge">Needs review</span>
        </div>
        <h3>{issue.reason || "This source requires manual review."}</h3>
        <dl className="issue-meta">
          {issue.sender && (
            <div>
              <dt>Sender</dt>
              <dd>{issue.sender}</dd>
            </div>
          )}
          {issue.message_timestamp_raw && (
            <div>
              <dt>Message time</dt>
              <dd>{issue.message_timestamp_raw}</dd>
            </div>
          )}
          {issue.original_filename && (
            <div>
              <dt>Filename</dt>
              <dd>{issue.original_filename}</dd>
            </div>
          )}
        </dl>
        {issue.text && (
          <details className="inspection">
            <summary>Original source message</summary>
            <pre className="source-text">{issue.text}</pre>
          </details>
        )}
        {ocr && (
          <details className="inspection">
            <summary>
              OCR regions <span className="detail-count">{regions.length}</span>
            </summary>
            <p className="recognition-note">
              Recognition scores do not guarantee correct digits. Check the
              source image.
            </p>
            {regions.length ? (
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="OCR regions"
              >
                <table className="ocr-table">
                  <thead>
                    <tr>
                      <th scope="col">Text</th>
                      <th scope="col">Score</th>
                      <th scope="col">Box [left, top, right, bottom]</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regions.map((region, regionIndex) => (
                      <tr key={regionIndex}>
                        <td>
                          {typeof region.text === "string"
                            ? region.text
                            : "Not available"}
                        </td>
                        <td>
                          {typeof region.recognition_score === "number" &&
                          Number.isFinite(region.recognition_score)
                            ? region.recognition_score.toFixed(4)
                            : "Not available"}
                        </td>
                        <td className="font-mono">
                          {Array.isArray(region.box)
                            ? `[${region.box.join(", ")}]`
                            : "Not available"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No OCR regions were returned.</p>
            )}
          </details>
        )}
        {extraction != null && (
          <details className="inspection">
            <summary>Suggested extraction — unverified</summary>
            <p className="recognition-note">
              Model output is a suggestion, not a validated ticket record.
            </p>
            <pre className="json-output">
              {JSON.stringify(extraction, null, 2)}
            </pre>
          </details>
        )}
        {typeof details?.error === "string" && (
          <details className="inspection">
            <summary>Extraction error details</summary>
            <pre className="source-text">{details.error}</pre>
          </details>
        )}
        {details &&
          !ocr &&
          extraction == null &&
          typeof details.error !== "string" && (
            <details className="inspection">
              <summary>Processing details — unverified</summary>
              <pre className="json-output">
                {JSON.stringify(details, null, 2)}
              </pre>
            </details>
          )}
      </div>
    </article>
  );
}
