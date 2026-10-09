import {
  draftTicketCount,
  IMPORT_ID_PATTERN,
  isRecord,
  type ImportResult,
} from "./api";

const STORAGE_KEY = "ticket-import.opened.v1";

export interface OpenedImport {
  id: string;
  timestamp: string;
  businessDate: string;
  draftCount: number;
  issueCount: number;
}

export function loadHistory(): { items: OpenedImport[]; unavailable: boolean } {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(data)) return { items: [], unavailable: true };
    const items = data.filter(
      (item): item is OpenedImport =>
        isRecord(item) &&
        typeof item.id === "string" &&
        IMPORT_ID_PATTERN.test(item.id) &&
        typeof item.timestamp === "string" &&
        typeof item.businessDate === "string" &&
        Number.isInteger(item.draftCount) &&
        Number(item.draftCount) >= 0 &&
        Number.isInteger(item.issueCount) &&
        Number(item.issueCount) >= 0,
    );
    return {
      items: items.slice(0, 20),
      unavailable: items.length !== data.length,
    };
  } catch {
    return { items: [], unavailable: true };
  }
}

export function rememberImport(result: ImportResult, existing: OpenedImport[]) {
  const summary: OpenedImport = {
    id: result.import_id,
    timestamp: result.import_timestamp,
    businessDate: result.business_date,
    draftCount: draftTicketCount(result),
    issueCount: result.issues.length,
  };
  const items = [
    summary,
    ...existing.filter((item) => item.id !== summary.id),
  ].slice(0, 20);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    return { items, unavailable: false };
  } catch {
    return { items, unavailable: true };
  }
}
