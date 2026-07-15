#!/usr/bin/env node
import { randomUUID } from "node:crypto";

import { readBetaOperatorConfig } from "../lib/beta-operator-client.ts";
import {
  operatorSignatureHeaders,
  signOperatorRequest
} from "../lib/operator-signature.ts";

const pathname = "/api/operator/observability";

try {
  if (process.argv.length !== 2) throw new Error("USAGE");
  const config = readBetaOperatorConfig(process.env);
  const body = JSON.stringify({ action: "test-alert" });
  const signature = signOperatorRequest({
    audience: config.audience,
    body,
    keyId: config.keyId,
    method: "POST",
    nonce: randomUUID(),
    pathname,
    privateKeyPkcs8Base64Url: config.privateKeyPkcs8Base64Url,
    timestamp: String(Math.floor(Date.now() / 1_000))
  });
  const endpoint = `${config.baseUrl}${pathname}`;
  const response = await fetch(endpoint, {
    body,
    cache: "no-store",
    credentials: "omit",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      [operatorSignatureHeaders.audience]: signature.audience,
      [operatorSignatureHeaders.keyId]: signature.keyId,
      [operatorSignatureHeaders.nonce]: signature.nonce,
      [operatorSignatureHeaders.signature]: signature.signature,
      [operatorSignatureHeaders.timestamp]: signature.timestamp
    },
    method: "POST",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(20_000)
  });
  const requestId = response.headers.get("x-request-id")?.toLowerCase() ?? "";
  if (!response.ok || response.redirected || response.url !== endpoint) {
    throw new Error(`HTTP_${response.status}`);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
  if (contentType !== "application/json" || (declaredLength && declaredLength > 4096)) {
    throw new Error("RESPONSE_INVALID");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 4096) throw new Error("RESPONSE_INVALID");
  const parsed = JSON.parse(text);
  if (parsed?.accepted !== true || !/^[0-9a-f-]{36}$/.test(requestId)) {
    throw new Error("RESPONSE_INVALID");
  }
  process.stdout.write(`${JSON.stringify({ action: "test-alert", accepted: true, requestId })}\n`);
} catch (error) {
  const code = error instanceof Error && /^(?:HTTP_[1-5][0-9]{2}|RESPONSE_INVALID|USAGE)$/.test(error.message)
    ? error.message
    : "OPERATION_FAILED";
  process.stderr.write(`Observability test alert failed (${code}).\n`);
  process.exitCode = code === "USAGE" ? 2 : 1;
}
