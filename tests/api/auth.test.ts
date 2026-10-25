import assert from "node:assert/strict";
import { test } from "node:test";
import { loginSchema } from "../../apps/api/src/services/auth.js";

test("login input normalizes email and retains password exactly", () => {
  assert.deepEqual(loginSchema.parse({ email: "  Demo.User@DEMO.LOCAL ", password: "DemoOnly-2026!" }), {
    email: "demo.user@demo.local",
    password: "DemoOnly-2026!",
  });
});

test("login input rejects malformed email, missing password, oversized credentials, and extra identity fields", () => {
  assert.equal(loginSchema.safeParse({ email: "not-an-email", password: "password" }).success, false);
  assert.equal(loginSchema.safeParse({ email: "student@demo.local" }).success, false);
  assert.equal(loginSchema.safeParse({ email: "student@demo.local", password: "x".repeat(129) }).success, false);
  assert.equal(loginSchema.safeParse({ email: "student@demo.local", password: "pass", role: "AICTE_ADMIN" }).success, false);
});
