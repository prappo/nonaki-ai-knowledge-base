#!/bin/sh
# Generates a fresh JWT_SECRET + matching ANON_KEY, plus a random
# POSTGRES_PASSWORD, for a real deployment. The values in .env.docker.example
# are committed to a public repo — reusing them anywhere internet-reachable
# means anyone can mint their own valid ANON_KEY-equivalent tokens.
#
# Usage: ./docker/generate-secrets.sh >> .env.docker

node -e '
const crypto = require("crypto");

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = b64url(Buffer.from(JSON.stringify(header)));
  const encPayload = b64url(Buffer.from(JSON.stringify(payload)));
  const data = encHeader + "." + encPayload;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  return data + "." + b64url(sig);
}

const secret = crypto.randomBytes(32).toString("hex");
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 10 * 365 * 24 * 60 * 60; // ~10 years
const anonKey = sign({ role: "anon", iss: "nonaki", iat, exp }, secret);

console.log("POSTGRES_PASSWORD=\"" + crypto.randomBytes(24).toString("hex") + "\"");
console.log("JWT_SECRET=\"" + secret + "\"");
console.log("ANON_KEY=\"" + anonKey + "\"");
'
