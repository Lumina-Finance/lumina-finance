import { browserSupportsWebAuthn } from '@simplewebauthn/browser';

/** Why the current page cannot register a passkey, each paired with how the user resolves it */
export type PasskeyBlockReason =
  | 'unconfigured'
  | 'insecure-context'
  | 'unsupported-browser'
  | 'ip-host'
  | 'rp-mismatch';

export type PasskeySupport =
  | { supported: true }
  | { supported: false; reason: PasskeyBlockReason; message: string };

// Matches a bare IPv4 literal, which a passkey cannot bind to because it is not a registrable domain
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Whether a hostname is a bare IP literal rather than a registrable domain
 *
 * IPv6 literals always contain a colon, which never appears in a hostname, so the colon check
 * covers them without parsing
 */
function isIpLiteralHost(hostname: string): boolean {
  return IPV4_PATTERN.test(hostname) || hostname.includes(':');
}

/**
 * Reports whether the current page can register a passkey, and how to fix it when it cannot
 *
 * The browser only exposes the WebAuthn API in a secure context, so an IP-over-HTTP dev origin fails
 * the secure-context check first. The hostname must also fall under the relying party id the server is
 * configured with, otherwise the authenticator rejects the ceremony
 *
 * @param relyingPartyId The configured relying party id, blank when the server has none
 * @returns Whether passkeys can be registered here, with a remediation message when they cannot
 */
export function assessPasskeySupport(relyingPartyId: string): PasskeySupport {
  if (!relyingPartyId) {
    return {
      supported: false,
      reason: 'unconfigured',
      message: 'Passkeys are not configured on this server.',
    };
  }

  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: 'insecure-context',
      message:
        'Passkeys need a secure connection. Open Lumina over HTTPS, or http://localhost during development, instead of an IP address.',
    };
  }

  if (!browserSupportsWebAuthn()) {
    return {
      supported: false,
      reason: 'unsupported-browser',
      message: 'This browser does not support passkeys. Try a current version of Chrome, Safari, Firefox, or Edge.',
    };
  }

  const hostname = window.location.hostname;
  if (isIpLiteralHost(hostname)) {
    return {
      supported: false,
      reason: 'ip-host',
      message:
        'Passkeys cannot be used on a bare IP address. Open Lumina using its domain name, or http://localhost during development.',
    };
  }

  // A passkey is valid only on the relying party domain or a subdomain of it
  const matchesRelyingParty = hostname === relyingPartyId || hostname.endsWith(`.${relyingPartyId}`);
  if (!matchesRelyingParty) {
    return {
      supported: false,
      reason: 'rp-mismatch',
      message: `This address is not the configured passkey domain (${relyingPartyId}). Open Lumina at that domain to manage passkeys.`,
    };
  }

  return { supported: true };
}
