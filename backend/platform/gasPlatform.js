// Apps Script implementation of the platform object (same interface as createNodePlatform).
// Utilities and PropertiesService are Apps Script globals; nothing is imported here.

// Apps Script returns digest bytes as signed numbers (-128..127).
const toHex = (bytes) => bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join('');

export function createGasPlatform() {
  const sha256Hex = (text) =>
    toHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));

  let secretValue = null;

  return {
    now: () => Date.now(),
    // Uuids carry fixed version bits, so each one is hashed before its hex is used.
    randomHex(bytes) {
      let out = '';
      while (out.length < bytes * 2) out += sha256Hex(Utilities.getUuid().replace(/-/g, ''));
      return out.slice(0, bytes * 2);
    },
    sha256Hex,
    // computeHmacSha256Signature takes the value first, then the key.
    hmacSha256Hex: (key, text) =>
      toHex(Utilities.computeHmacSha256Signature(text, key, Utilities.Charset.UTF_8)),
    secret() {
      if (secretValue === null) {
        const stored = PropertiesService.getScriptProperties().getProperty('SECRET');
        if (!stored) throw new Error('SECRET is not set; run setup()');
        secretValue = stored;
      }
      return secretValue;
    },
  };
}
