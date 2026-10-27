import { rejectionFor, connectionAdmissionView } from 'file:///C:/Users/Administrator/.dsh/our-free-model/rollback/src/trust.js'

function makeReq(headers) {
  return { headers }
}

const cases = [
  {
    name: 'browser same-origin (should pass)',
    headers: { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:8080', 'sec-fetch-site': 'same-origin' },
  },
  {
    name: 'browser no origin (should pass)',
    headers: { host: '127.0.0.1:8080' },
  },
  {
    name: 'browser origin mismatch (should reject)',
    headers: { host: '127.0.0.1:8080', origin: 'http://evil.example' },
  },
  {
    name: 'cross-site fetch (should reject)',
    headers: { host: '127.0.0.1:8080', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
  },
  {
    name: 'non-loopback host (should reject)',
    headers: { host: 'evil.example:8080', origin: 'http://evil.example:8080' },
  },
  {
    name: 'localhost variant (should pass)',
    headers: { host: 'localhost:8080', origin: 'http://localhost:8080' },
  },
  {
    name: 'desktop relay referer (should pass)',
    headers: { host: '127.0.0.1:8080', referer: 'dsh-app://app' },
  },
  {
    name: 'desktop relay referer + origin present (should reject)',
    headers: { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:8080', referer: 'dsh-app://app', 'sec-fetch-site': 'same-origin' },
  },
]

// Simulate the connection-service shapes the plugin handles
const noConn = connectionAdmissionView(() => undefined)
const badConn = connectionAdmissionView(() => ({ rpc: {}, register() {}, registerInterceptor() {} }))

console.log('=== no connection service (replica fence) ===')
for (const c of cases) {
  const r = rejectionFor(makeReq(c.headers), noConn)
  console.log(`  ${r === undefined ? 'PASS' : 'REJECT ' + r}  ${c.name}`)
}

console.log('\n=== connection service with no admission methods (dsh 0.1.0-rc.6 shape) ===')
for (const c of cases) {
  const r = rejectionFor(makeReq(c.headers), badConn)
  console.log(`  ${r === undefined ? 'PASS' : 'REJECT ' + r}  ${c.name}`)
}

// ⚠️ The 503 path: connectionAdmissionView only guards `undefined`, not `null`.
// If ctx.get('connection') returns null, `current.admit` throws and rejectionFor's
// catch swallows it as 503 admission unavailable — on every request, any header.
console.log('\n=== connection service is NULL (the suspected 503 trigger) ===')
const nullConn = connectionAdmissionView(() => null)
for (const c of cases) {
  const r = rejectionFor(makeReq(c.headers), nullConn)
  console.log(`  ${r === undefined ? 'PASS' : 'REJECT ' + r}  ${c.name}`)
}