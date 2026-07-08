export const sessionCookieName = "kinsleuth_session";
export const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;

const encoder = new TextEncoder();

export async function createSessionToken(secret: string, issuedAt = Date.now()): Promise<string> {
  const payload = String(issuedAt);
  const signature = await signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  if (!token) {
    return false;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return false;
  }

  const issuedAt = Number(payload);
  if (!Number.isFinite(issuedAt) || now - issuedAt > sessionMaxAgeSeconds * 1000 || issuedAt - now > 60_000) {
    return false;
  }

  const expected = await signPayload(payload, secret);
  return timingSafeEqual(signature, expected);
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}
