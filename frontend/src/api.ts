export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const IMPORT_ID_PATTERN = /^[0-9a-f]{32}$/;

export interface Ticket {
  ticket_number: string;
  count: number;
}

export interface SourceMessage {
  message_id?: string;
  message_timestamp_raw?: string | null;
  sender?: string | null;
  text?: string | null;
}

export interface Draft extends SourceMessage {
  source_type: string;
  party?: string | null;
  source_image_url?: string | null;
  tickets: Ticket[];
  status: string;
}

export interface Issue extends SourceMessage {
  issue_id?: string;
  source_type?: string;
  reason?: string | null;
  source_image_url?: string | null;
  original_filename?: string | null;
  details?: unknown;
}

export interface ImportResult {
  import_id: string;
  party: string | null;
  import_timestamp: string;
  business_date: string;
  status: string;
  message_count: number;
  image_count: number;
  drafts: Draft[];
  issues: Issue[];
  accepted_ticket_count: number;
}

export interface FinalTicket extends Ticket {
  record_id: string;
  business_date: string;
  import_timestamp: string;
  saved_at: string;
  party: string;
  didWin: null;
  source_image_url: string | null;
  import_id: string | null;
  message_id: string | null;
  entry_source: "manual" | "confirmed_draft";
}

export interface ManualTicket extends Ticket { party: string }
export interface SaveResult { records: FinalTicket[]; saved_count: number }
export interface DailyTickets { business_date: string; records: FinalTicket[]; count: number }
export interface TicketSearchResult {
  business_date: string;
  ticket_number: string;
  match_count: number;
  matches: FinalTicket[];
}

function isFinalTicket(value: unknown): value is FinalTicket {
  return isRecord(value) && typeof value.record_id === "string" &&
    IMPORT_ID_PATTERN.test(value.record_id) && typeof value.business_date === "string" &&
    typeof value.import_timestamp === "string" && typeof value.saved_at === "string" &&
    typeof value.party === "string" && !!value.party.trim() &&
    typeof value.ticket_number === "string" && /^[0-9]+$/.test(value.ticket_number) &&
    Number.isSafeInteger(value.count) && Number(value.count) > 0 && value.didWin === null &&
    (value.entry_source === "manual" || value.entry_source === "confirmed_draft") &&
    (value.source_image_url === null || (typeof value.source_image_url === "string" && !!imageUrl(value.source_image_url))) &&
    [value.import_id, value.message_id].every(id => id === null || (typeof id === "string" && IMPORT_ID_PATTERN.test(id)));
}

export async function getTickets(businessDate: string): Promise<DailyTickets> {
  const data = await request(`/tickets?${new URLSearchParams({business_date: businessDate})}`);
  if (!isRecord(data) || data.business_date !== businessDate || !Array.isArray(data.records) ||
      !data.records.every(isFinalTicket) || data.count !== data.records.length) {
    throw new ApiError("The backend returned an invalid stored-ticket response. Check storage and retry.");
  }
  return data as unknown as DailyTickets;
}

export async function saveTickets(path: "/tickets/bulk" | "/tickets/confirm-draft", payload: unknown, key: string): Promise<SaveResult> {
  const data = await request(path, {method: "POST", headers: {"Content-Type": "application/json", "Idempotency-Key": key}, body: JSON.stringify(payload)});
  if (!isRecord(data) || !Array.isArray(data.records) || !data.records.length ||
      !data.records.every(isFinalTicket) || data.saved_count !== data.records.length) {
    throw new ApiError("The save response could not be verified. Retry the unchanged submission with the same key.", true);
  }
  return data as unknown as SaveResult;
}

export async function searchTickets(businessDate: string, ticketNumber: string): Promise<TicketSearchResult> {
  const query = new URLSearchParams({business_date: businessDate, ticket_number: ticketNumber});
  const data = await request(`/tickets/search?${query}`);
  if (!isRecord(data) || data.business_date !== businessDate || data.ticket_number !== ticketNumber ||
      !Array.isArray(data.matches) || !data.matches.every(isFinalTicket) ||
      !data.matches.every(record => record.ticket_number === ticketNumber && record.business_date === businessDate) ||
      data.match_count !== data.matches.length) {
    throw new ApiError("The backend returned an invalid final-ticket search response.");
  }
  return data as unknown as TicketSearchResult;
}

export function currentBusinessDate(): string {
  // Build ISO date parts explicitly, using the same timezone as backend imports.
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly uncertain = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorDetail(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map(errorDetail).filter(Boolean).join("\n");
  if (isRecord(value)) {
    if (typeof value.msg === "string") {
      const location = Array.isArray(value.loc) ? value.loc.join(" → ") : "";
      return `${location ? `${location}: ` : ""}${value.msg}`;
    }
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${errorDetail(item)}`)
      .join("\n");
  }
  return value == null ? "" : String(value);
}

function parseResult(value: unknown): ImportResult {
  const countKeys = ["message_count", "image_count", "accepted_ticket_count"];
  if (
    !isRecord(value) ||
    typeof value.import_id !== "string" ||
    !IMPORT_ID_PATTERN.test(value.import_id) ||
    typeof value.import_timestamp !== "string" ||
    typeof value.business_date !== "string" ||
    typeof value.status !== "string" ||
    !countKeys.every(
      (key) => Number.isInteger(value[key]) && Number(value[key]) >= 0,
    ) ||
    !Array.isArray(value.drafts) ||
    !Array.isArray(value.issues) ||
    !value.issues.every(isRecord) ||
    !value.drafts.every(
      (draft) =>
        isRecord(draft) &&
        Array.isArray(draft.tickets) &&
        draft.tickets.every(
          (ticket) =>
            isRecord(ticket) &&
            typeof ticket.ticket_number === "string" &&
            Number.isInteger(ticket.count) &&
            Number(ticket.count) > 0,
        ),
    )
  ) {
    throw new ApiError(
      "The backend returned an unexpected result format. No result has been added to your browser list.",
    );
  }
  return value as unknown as ImportResult;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const uploading = init?.method === "POST";
  const saving = uploading && path.startsWith("/tickets/");
  const retryAction = path.startsWith("/tickets/search")
    ? "searching again"
    : path.startsWith("/tickets") ? "loading stored tickets again" : "opening the import again";
  let response: Response;
  let body: string;
  try {
    // No timeout or automatic retry. A repeated POST creates another import.
    response = await fetch(`/api${path}`, init);
    body = await response.text();
  } catch {
    throw new ApiError(
      saving
        ? "The save outcome is uncertain. Retry the unchanged submission; its original idempotency key will be reused."
        : uploading
        ? "The connection was interrupted. Server processing may still be running. Do not submit the ZIP again until you have checked the server. If you have its import ID, open it below."
        : `Could not reach the backend. Check that the local server is running and try ${retryAction}.`,
      uploading,
    );
  }
  let data: unknown;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail = isRecord(data) ? errorDetail(data.detail ?? data) : "";
    const fallback =
      response.status === 404
        ? "Import or processing result not found."
        : response.status === 502
          ? `The frontend could not reach the local backend on port 8000. Wait for Application startup complete in the backend terminal, then try ${retryAction}.`
          : `Check that the local backend is running, then try ${retryAction}.`;
    const uncertain = uploading && response.status >= 500;
    throw new ApiError(
      `${detail || fallback} (HTTP ${response.status})${
        uncertain
          ? saving ? "\nRetry the unchanged submission with the same key." : "\nThe result is uncertain; server processing may still be running. Check the server before submitting again."
          : ""
      }`,
      uncertain,
    );
  }
  if (data === null) {
    throw new ApiError(
      `The backend returned an unreadable response.${
        uploading
          ? saving ? " Tickets may have been saved. Retry the unchanged submission with the same key." : " The import may have been created. Check the server before submitting again."
          : ""
      }`,
      uploading,
    );
  }
  return data;
}

export async function uploadImport(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  const data = await request("/imports", { method: "POST", body: form });
  try {
    return parseResult(data);
  } catch {
    throw new ApiError(
      "The backend returned an unexpected result format. The import may have been created. Check the server before submitting again.",
      true,
    );
  }
}

export async function getImport(id: string): Promise<ImportResult> {
  if (!IMPORT_ID_PATTERN.test(id))
    throw new ApiError(
      "Enter a valid import ID: 32 lowercase letters (a–f) and digits.",
    );
  return parseResult(await request(`/imports/${id}`));
}

export function imageUrl(path: string | null | undefined): string | null {
  // Only retained backend image paths are allowed, never remote URLs.
  return path &&
    /^\/imports\/[0-9a-f]{32}\/images\/[0-9a-f]{32}\.(jpg|jpeg|png|webp)$/.test(
      path,
    )
    ? `/api${path}`
    : null;
}

export function draftTicketCount(result: ImportResult): number {
  return result.drafts.reduce((sum, draft) => sum + draft.tickets.length, 0);
}

export function formatImportTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp || "Not available";
  return (
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(date) + " IST"
  );
}
