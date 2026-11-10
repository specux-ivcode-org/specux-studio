const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_EDITOR_IMAGE_BYTES = 12 * 1024 * 1024;

/** Creates an Error carrying the HTTP status used for its response. */
function requestError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/** Writes a JSON response with the server's standard safety and cache headers. */
function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

/** Reads a request body up to the JSON limit and parses it as JSON. */
async function readJsonBody(request) {
  // Collect the request body while enforcing the JSON endpoint size limit.
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      throw requestError("Request body exceeds the 2 MB limit.", 413);
    }
    chunks.push(chunk);
  }

  // Parse only after the full bounded body has been collected.
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw requestError("Request body must be valid JSON.");
  }
}

/** Reads a request body into a Buffer, rejecting payloads above the supplied limit. */
async function readBufferBody(request, maximumBytes) {
  // Collect binary chunks and reject immediately once the caller's limit is exceeded.
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      throw requestError(`Request body exceeds the ${Math.floor(maximumBytes / (1024 * 1024))} MB limit.`, 413);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = {
  MAX_EDITOR_IMAGE_BYTES,
  MAX_REQUEST_BYTES,
  readBufferBody,
  readJsonBody,
  requestError,
  sendJson
};
