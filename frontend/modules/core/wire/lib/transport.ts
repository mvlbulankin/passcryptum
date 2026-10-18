import type { Transport } from './types'

// Production transport: the only place the app touches fetch. The service
// worker intercepts it exactly like it intercepted axios. Fetch does not
// throw on HTTP error statuses — the client maps them to WireError kinds.
// Redirects are refused: v1 defines none, and following one would re-send
// the auth headers (and the signed body) to wherever Location points.
export const fetchTransport: Transport = async ({
  method,
  url,
  body,
  headers,
}) => {
  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'error',
  })

  return { status: response.status, body: await response.text() }
}
