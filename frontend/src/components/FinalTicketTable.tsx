import { formatImportTime, imageUrl, type FinalTicket } from "../api";

export default function FinalTicketTable({ records, onOpenImport }: {
  records: FinalTicket[]; onOpenImport?: (id: string) => void;
}) {
  return <div className="table-scroll" role="region" aria-label="Persisted final tickets, scroll horizontally if needed" tabIndex={0}>
    <table className="draft-table">
      <caption className="sr-only">Persisted final ticket records. Repeated entries are preserved.</caption>
      <thead><tr>{["Import timestamp", "Party", "Ticket Number", "Count", "Winning status", "Entry source", "Source image", "Source metadata"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{records.map(record => <tr key={record.record_id}>
        <td>{formatImportTime(record.import_timestamp)}</td><td>{record.party}</td>
        <td className="count-cell">{record.ticket_number}</td><td>{record.count}</td><td>Pending</td>
        <td>{record.entry_source === "manual" ? "Manual" : "Confirmed text draft"}</td>
        <td>{imageUrl(record.source_image_url) ? <a href={imageUrl(record.source_image_url)!} target="_blank" rel="noreferrer">View source image</a> : "None"}</td>
        <td><details><summary>Record details</summary>
          <p>Record: <code>{record.record_id}</code></p>
          <p>Saved: {formatImportTime(record.saved_at)}</p>
          {record.import_id ? <><p>Import: <code>{record.import_id}</code></p><p>Message: <code>{record.message_id}</code></p>
            {onOpenImport && <button className="text-button" onClick={() => onOpenImport(record.import_id!)}>Open full import</button>}</> : <p>Manual entry; no linked source.</p>}
        </details></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
