/**
 * Gravatar URL generation with minimal MD5 implementation.
 *
 * Used for author avatars in the commit graph canvas.
 */

// ---------- MD5 (RFC 1321) ----------

// Per-round left-rotate amounts
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4,
  11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6,
  10, 15, 21,
];

// Pre-computed T constants: floor(2^32 * abs(sin(i+1)))
const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
}

function md5(input: string): string {
  const msg = new TextEncoder().encode(input);

  // Padding: append 0x80, then zeros, then 64-bit little-endian bit length
  const bitLen = msg.length * 8;
  const padLen = Math.ceil((msg.length + 9) / 64) * 64;
  const padded = new Uint8Array(padLen);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, bitLen & 0xffffffff, true);
  dv.setUint32(padLen - 4, Math.floor(bitLen / 0x100000000), true);

  // Initial hash values
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  // Process each 64-byte block
  for (let off = 0; off < padLen; off += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);

    let a = a0,
      b = b0,
      c = c0,
      d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      f = (f + a + K[i] + M[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((f << S[i]) | (f >>> (32 - S[i])))) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const hex = (n: number) =>
    Array.from({ length: 4 }, (_, i) =>
      ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, "0"),
    ).join("");

  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

// ---------- Gravatar ----------

/**
 * Build a Gravatar URL for an email address.
 * Uses `d=404` so we can detect missing avatars and fall back to initials.
 */
export function gravatarUrl(email: string, size = 64): string {
  const hash = md5(email.trim().toLowerCase());
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
}
