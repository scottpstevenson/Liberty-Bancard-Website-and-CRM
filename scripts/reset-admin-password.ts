import { db } from "../server/db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const TEST_PASSWORD = "TestAdmin2024!";

async function run() {
  const email = process.env.ADMIN_SEED_EMAIL;
  if (!email) {
    console.error("Missing ADMIN_SEED_EMAIL");
    process.exit(1);
  }

  const hash = await bcrypt.hash(TEST_PASSWORD, 12);
  const result = await db
    .update(users)
    .set({ passwordHash: hash })
    .where(eq(users.email, email))
    .returning({ id: users.id, email: users.email });

  if (result.length === 0) {
    console.log("User not found:", email);
    process.exit(1);
  }
  console.log(`Password reset to "${TEST_PASSWORD}" for ${result[0].email}`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
