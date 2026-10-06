import fs from "node:fs";

// Next.js loads .env.local itself; the worker needs to do it by hand.
for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
