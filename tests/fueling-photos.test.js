const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { S3Client } = require("@aws-sdk/client-s3");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
process.env.SESSION_SECRET = "photo-test-secret";
process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-access";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.R2_BUCKET = "test-bucket";

const api = require("../api/[...path].js");

function token() {
  const body = Buffer.from(JSON.stringify({ id: "user-1", exp: Date.now() + 60000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function response() {
  return {
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    end(body) { this.body = body; return this; },
  };
}

test("serves only the requested fueling photo through authenticated R2 access", async () => {
  const originalFetch = global.fetch;
  const originalSend = S3Client.prototype.send;
  let requestedKey;
  global.fetch = async (url) => ({
    ok: true,
    text: async () => JSON.stringify(url.includes("app_users?")
      ? [{ id: "user-1", active: true, role: "attendant" }]
      : [{ vehicle_photo_url: "https://old-public.example/photos/fuelings/vehicles/photo-1.jpg" }]),
  });
  S3Client.prototype.send = async (command) => {
    requestedKey = command.input.Key;
    return { ContentType: "image/jpeg", Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3]) } };
  };
  try {
    const res = response();
    await api({ method: "GET", query: { path: ["fuelings", "fuel-1", "photos", "vehicle"] }, headers: { authorization: `Bearer ${token()}` } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "image/jpeg");
    assert.equal(requestedKey, "fuelings/vehicles/photo-1.jpg");
    assert.deepEqual(res.body, Buffer.from([1, 2, 3]));
  } finally {
    global.fetch = originalFetch;
    S3Client.prototype.send = originalSend;
  }
});

test("rejects photo requests without a session", async () => {
  const res = response();
  await api({ method: "GET", query: { path: ["fuelings", "fuel-1", "photos", "vehicle"] }, headers: {} }, res);
  assert.equal(res.statusCode, 401);
});
