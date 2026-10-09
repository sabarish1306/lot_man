# Application logging

The API and sample scripts emit application logs to stderr using Python's
standard logging module. The default level is `INFO`. In PowerShell, enable
detailed processing logs before starting the server:

```powershell
$env:LOG_LEVEL = "DEBUG"
.\paddle-env\Scripts\python.exe -m uvicorn main:app
```

Supported levels are `DEBUG`, `INFO`, `WARNING`, `ERROR`, and `CRITICAL`.
Invalid settings fall back to `INFO`. No log files are created automatically.
For direct service calls, call `logging_config.configure_logging()` once in
your entry point.

Logs cover application lifecycle, HTTP status and timing, uploads, ZIP
validation and extraction, chat parsing, image caching, OCR model loading,
ticket extraction, review decisions, and report persistence. `DEBUG` adds
individual message/image IDs and cache/lock activity. Request timing measures
time until response headers are available, not completion of image streaming.

Each HTTP request receives a generated request ID, returned in `X-Request-ID`
on responses handled by the request middleware. The same ID accompanies its
service logs, including synchronous endpoint work. Standalone service logs use
`request_id=-`. Routes are logged as templates, without raw URLs or query strings.

Application logs omit chat text, party/sender names, ticket values, original
filenames, model responses, and request bodies. Failure logs preserve stack
locations and exception types but omit exception messages, which may contain
private source data. Existing sample scripts still print their result JSON.
Third-party and Uvicorn logging retain their own configuration.
