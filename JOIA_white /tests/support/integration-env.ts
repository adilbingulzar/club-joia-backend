const url = process.env.TEST_RUN_DATABASE_URL;
if (!url) throw new Error("Integration global setup did not provide TEST_RUN_DATABASE_URL.");
process.env.DATABASE_URL = url;
process.env.AUTH_SECRET ??= "test-auth-secret-test-auth-secret-0001";
process.env.QR_SIGNING_SECRET ??= "test-qr-secret-test-qr-secret-test-0001";
// Push is exercised as "not configured" in tests (no network calls).
delete process.env.WEB_PUSH_PUBLIC_KEY;
delete process.env.WEB_PUSH_PRIVATE_KEY;
