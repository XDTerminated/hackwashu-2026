// Load env from server/.env, then the repo-root .env (the first file to set a variable wins).
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: [join(here, "..", ".env"), join(here, "..", "..", ".env")], quiet: true });
