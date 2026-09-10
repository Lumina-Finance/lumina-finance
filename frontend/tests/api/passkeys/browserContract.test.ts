/**
 * Exercises the installed passkey library at the browser boundary so dependency upgrades preserve
 * the binary options and base64url responses exchanged by the app's passkey ceremonies
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { isPasskeyCeremonyCancelled } from '@/utils/passkeyErrors';

const createCredential = vi.fn();
const getCredential = vi.fn();

const registrationOptions: PublicKeyCredentialCreationOptionsJSON = {
  challenge: 'AQIDBA',
  rp: { id: 'localhost', name: 'Lumina Finance' },
  user: { id: 'BQYHCA', name: 'passkey@example.com', displayName: 'Passkey test' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  excludeCredentials: [{ id: 'AAH-_w', type: 'public-key', transports: ['internal'] }],
  authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
};

const authenticationOptions: PublicKeyCredentialRequestOptionsJSON = {
  challenge: 'AQIDBA',
  rpId: 'localhost',
  allowCredentials: [{ id: 'AAH-_w', type: 'public-key', transports: ['internal'] }],
  userVerification: 'required',
};

beforeEach(() => {
  createCredential.mockReset();
  getCredential.mockReset();
  vi.stubGlobal('PublicKeyCredential', class {});
  vi.stubGlobal('navigator', { credentials: { create: createCredential, get: getCredential } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('passkey browser contract', () => {
  it('converts registration options and preserves the attestation response', async () => {
    createCredential.mockResolvedValue({
      id: 'AAH-_w',
      rawId: new Uint8Array([0, 1, 254, 255]).buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      getClientExtensionResults: () => ({ credProps: { rk: true } }),
      response: {
        clientDataJSON: new Uint8Array([9, 10, 11, 12]).buffer,
        attestationObject: new Uint8Array([13, 14, 15, 16]).buffer,
        getTransports: () => ['internal'],
        getPublicKeyAlgorithm: () => -7,
        getPublicKey: () => new Uint8Array([25, 26, 27, 28]).buffer,
        getAuthenticatorData: () => new Uint8Array([17, 18, 19, 20]).buffer,
      },
    });

    await expect(startRegistration({ optionsJSON: registrationOptions })).resolves.toEqual({
      id: 'AAH-_w',
      rawId: 'AAH-_w',
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        clientDataJSON: 'CQoLDA',
        attestationObject: 'DQ4PEA',
        transports: ['internal'],
        publicKeyAlgorithm: -7,
        publicKey: 'GRobHA',
        authenticatorData: 'ERITFA',
      },
    });
    expect(createCredential).toHaveBeenCalledExactlyOnceWith({
      signal: expect.any(AbortSignal),
      publicKey: {
        ...registrationOptions,
        challenge: new Uint8Array([1, 2, 3, 4]).buffer,
        user: { ...registrationOptions.user, id: new Uint8Array([5, 6, 7, 8]).buffer },
        excludeCredentials: [{
          id: new Uint8Array([0, 1, 254, 255]).buffer,
          type: 'public-key',
          transports: ['internal'],
        }],
      },
    });
  });

  it.each([true, false])('preserves sign-in response fields with user handle present: %s', async (hasUserHandle) => {
    getCredential.mockResolvedValue({
      id: 'AAH-_w',
      rawId: new Uint8Array([0, 1, 254, 255]).buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: new Uint8Array([9, 10, 11, 12]).buffer,
        authenticatorData: new Uint8Array([17, 18, 19, 20]).buffer,
        signature: new Uint8Array([21, 22, 23, 24]).buffer,
        userHandle: hasUserHandle ? new Uint8Array([5, 6, 7, 8]).buffer : null,
      },
    });

    await expect(startAuthentication({ optionsJSON: authenticationOptions })).resolves.toEqual({
      id: 'AAH-_w',
      rawId: 'AAH-_w',
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: 'CQoLDA',
        authenticatorData: 'ERITFA',
        signature: 'FRYXGA',
        userHandle: hasUserHandle ? 'BQYHCA' : undefined,
      },
    });
    expect(getCredential).toHaveBeenCalledExactlyOnceWith({
      signal: expect.any(AbortSignal),
      publicKey: {
        ...authenticationOptions,
        challenge: new Uint8Array([1, 2, 3, 4]).buffer,
        allowCredentials: [{
          id: new Uint8Array([0, 1, 254, 255]).buffer,
          type: 'public-key',
          transports: ['internal'],
        }],
      },
    });
  });

  it('allows discoverable sign-in when the server supplies no credential restriction', async () => {
    getCredential.mockResolvedValue(null);

    await expect(startAuthentication({
      optionsJSON: { ...authenticationOptions, allowCredentials: [] },
    })).rejects.toThrow('Authentication was not completed');
    expect(getCredential).toHaveBeenCalledWith(expect.objectContaining({
      publicKey: expect.objectContaining({ allowCredentials: undefined }),
    }));
  });

  describe.each(['registration', 'authentication'] as const)('%s error contract', (ceremony) => {
    it.each([
      ['NotAllowedError', 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', false],
      ['AbortError', 'ERROR_CEREMONY_ABORTED', true],
    ] as const)('preserves the app cancellation decision for %s', async (name, code, isCancelled) => {
      const browserError = new DOMException('The user cancelled the request', name);
      createCredential.mockRejectedValue(browserError);
      getCredential.mockRejectedValue(browserError);

      const result = ceremony === 'registration'
        ? startRegistration({ optionsJSON: registrationOptions })
        : startAuthentication({ optionsJSON: authenticationOptions });
      const error = await result.catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(WebAuthnError);
      expect(error).toMatchObject({ name, code, cause: browserError });
      expect(isPasskeyCeremonyCancelled(error)).toBe(isCancelled);
    });
  });
});
