# Import Desk

React, TypeScript, Vite, and Tailwind frontend for the existing local FastAPI
WhatsApp import service. See the [application README](../README.md) for the
complete architecture, storage, API contract, and troubleshooting guide.

Daily ticket lookup uses `GET /api/tickets/search` to retrieve complete exact
matches in persisted final records for a business date. It preserves duplicates,
leading zeros and source identifiers, with winning status Pending. It searches
backend files independently of browser history. The matching Python backend
must be running with `services/search_service.py` and the `/tickets/search` route.

## Start locally

From the repository root, in the first PowerShell terminal:

```powershell
.\paddle-env\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Keep Ollama running with the existing `qwen3:4b-instruct` model. The backend
loads PaddleOCR on its first image request, which can take time.

In a second PowerShell terminal, from the repository root:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. Node 22.12+ (or a newer version supported by
Vite 8) is required. This project was built with Node 26.8.1.

## API connection and behavior

- `src/api.ts` owns the response types, fetch calls, shape checks, image URL
  mapping, and FastAPI error formatting.
- `/api` proxies to `http://127.0.0.1:8000`, with the prefix removed. Returned
  `/imports/.../images/...` paths are mapped through the same proxy.
- Uploads use browser `FormData` and omit Party. No manual multipart headers,
  cloud calls, automatic retries, or application timeouts are used. Vite's
  request/proxy timeouts are disabled for long synchronous processing.
- Results include issues already, so opening an import uses one
  `GET /imports/{id}` rather than a redundant second issues request.
- A successful processing response means the result was returned and stored,
  not that tickets were accepted. Draft entry counts count ticket entries,
  not the sum of their quantities. Leading zeros, duplicates, and order remain
  intact. The backend's accepted count is displayed separately.
- Import times use `Asia/Kolkata`. Business dates and WhatsApp timestamps are
  shown as supplied, without guessing ambiguous source dates.
- Local storage keeps up to 20 successfully opened IDs with timestamps and
  summary counts. It does not store source messages, ticket numbers, or images.
  This is explicitly a browser list, not a backend history API.
- Image review includes native modal dialogs, source text, available OCR
  regions/scores/coordinates, and unverified model output. There are no accept,
  resolve, correction-save, database, winning, or Excel actions.
- The UI handles missing/corrupt images, optional issue fields, unavailable
  browser storage, missing imports, and interrupted requests. A failed upload
  connection can leave server processing running; check the server before
  making a deliberate new submission.

The proxy configuration follows [Vite's server proxy documentation](https://vite.dev/config/server-options#server-proxy).
Tailwind uses its [official Vite plugin](https://tailwindcss.com/docs/installation/using-vite).

## Checks

```powershell
cd frontend
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
```

The browser suite requires the real backend on port 8000 and uses installed
Microsoft Edge by default. It starts Vite if needed. To use bundled Chromium:

```powershell
npx.cmd playwright install chromium
$env:PLAYWRIGHT_CHANNEL = "chromium"
npm.cmd run test:e2e
```

Tests create explicitly labelled verification ZIPs in `.verification/` and
submit real imports to the backend. **These persist under `data/imports/`.**
They never fabricate successful API responses or seed fake UI records. Model
processing may take several minutes. The sample image uses `../sample.jpg`.
The existing virtual environment runs the fixture helper; override `PYTHON`
if using another interpreter.

Optional `TEST_TEXT_IMPORT_ID` and `TEST_IMAGE_IMPORT_ID` environment variables
reuse previously completed verification imports instead of rerunning the
models. Use IDs created from this suite's text/image fixtures. The upload and
error tests still create small real imports. Failed network/image requests
are deliberately aborted in the browser to check failure handling.

Coverage includes ZIP picking/drop/replace/remove, the size limit, loading and
duplicate prevention, actual FastAPI string/object/array errors, no automatic
POST retry, draft order/zeros/duplicates, search and original source inspection,
keyboard tabs, image loading and modal focus/Escape, browser history, empty
states, source-text escaping, blocked storage, and mobile page overflow.
Screenshots and failure traces are written to `test-results/`.

## Production build preview

```powershell
npm.cmd run build
npm.cmd run preview
```

Open **http://127.0.0.1:4173**. Both Vite dev and preview proxy the local backend.
The compiled `dist/` is static: any separate production host must provide its
own `/api` reverse proxy. Vite preview is for local build inspection.


Final tickets: use Stored tickets for manual batch previews and persisted daily
records; text drafts have an explicit Review and save action. Ticket lookup now
searches only final records, with Pending winning status. Requests still use /api.
Run `npm.cmd run test:e2e:tickets` for the isolated real-ticket-API browser suite
(temporary data, ports 8011/5174, no live OCR). See the root README for schema,
locking, retries and data backup details. The older `test:e2e` suite exercises
real model imports separately and writes fixture imports; it is not the isolated
final-ticket verification command.
