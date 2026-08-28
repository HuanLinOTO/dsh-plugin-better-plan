import { describe, expect, it } from 'vitest'
import { isLoopbackHostname, isTrustedDeliveryRequest } from '../src/trust-fence.ts'

function req(headers: Record<string, string>): { headers: Record<string, string> } {
  return { headers }
}

describe('isLoopbackHostname', () => {
  it('accepts localhost and loopback literals', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.5.5.5')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
  })

  it('refuses other hosts and malformed octets', () => {
    expect(isLoopbackHostname('example.com')).toBe(false)
    expect(isLoopbackHostname('192.168.1.1')).toBe(false)
    expect(isLoopbackHostname('127.0.0')).toBe(false)
    expect(isLoopbackHostname('127.999.0.1')).toBe(false)
  })
})

describe('isTrustedDeliveryRequest', () => {
  it('accepts a loopback Host without browser markers', () => {
    expect(isTrustedDeliveryRequest(req({ host: '127.0.0.1:18080' }), [])).toBe(true)
    expect(isTrustedDeliveryRequest(req({ host: 'localhost:18080' }), [])).toBe(true)
  })

  it('refuses a non-loopback Host and a missing or unparsable one', () => {
    expect(isTrustedDeliveryRequest(req({ host: '192.168.1.5:18080' }), [])).toBe(false)
    expect(isTrustedDeliveryRequest(req({}), [])).toBe(false)
    expect(isTrustedDeliveryRequest(req({ host: 'not a host' }), [])).toBe(false)
  })

  it('accepts a trusted authority (host or host:port)', () => {
    expect(isTrustedDeliveryRequest(req({ host: '192.168.1.5:18080' }), ['192.168.1.5:18080'])).toBe(true)
    // A port-less entry trusts any port on that hostname.
    expect(isTrustedDeliveryRequest(req({ host: '192.168.1.5:9999' }), ['192.168.1.5'])).toBe(true)
  })

  it('refuses cross-site browser markers on a trusted host', () => {
    expect(isTrustedDeliveryRequest(
      req({ host: '192.168.1.5:18080', 'sec-fetch-site': 'cross-site' }),
      ['192.168.1.5:18080'],
    )).toBe(false)
  })

  it('compares a browser Origin against the Host hostname', () => {
    expect(isTrustedDeliveryRequest(
      req({ host: '127.0.0.1:18080', origin: 'http://127.0.0.1:18080' }),
      [],
    )).toBe(true)
    expect(isTrustedDeliveryRequest(
      req({ host: '127.0.0.1:18080', origin: 'http://evil.example' }),
      [],
    )).toBe(false)
    expect(isTrustedDeliveryRequest(
      req({ host: '127.0.0.1:18080', origin: 'null' }),
      [],
    )).toBe(false)
  })
})
