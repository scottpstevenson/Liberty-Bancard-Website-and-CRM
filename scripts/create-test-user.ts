import { db } from "../server/db";
import { users } from "../shared/schema";
import bcrypt from "bcryptjs";

export const TEST_EMAIL = "playwright-test@libertybancard.internal";
export const TEST_PASSWORD = "PlaywrightTest2024!";

async function run() {
  const hash = await bcrypt.hash(TEST_PASSWORD, 12);
  await db
    .insert(users)
    .values({
      email: TEST_EMAIL,
      firstName: "Playwright",
      lastName: "Tester",
      passwordHash: hash,
      role: "admin",
      authProvider: "local",
      emailVerified: new Date(),
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash: hash, role: "admin", emailVerified: new Date() },
    });
  console.log(`Test user ready: ${TEST_EMAIL} / ${TEST_PASSWORD}`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
