// Load env from server/.env, then the repo-root .env (the first file to set a variable wins).
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: [join(here, "..", ".env"), join(here, "..", "..", ".env")], quiet: true });

/** Where saves, keys and reports live (MOON_DATA_DIR lets a test server use its own). */
export const DATA_DIR = process.env.MOON_DATA_DIR || join(here, "..", "data");

/**
 * The hosted game: each signed-in player gets their own copy of this server
 * (started by gateway.ts with its own MOON_DATA_DIR). Nobody is "on this
 * computer", texting is off, and Claude Code is linked from the player's own
 * computer instead of read from this one.
 */
export const HOSTED = process.env.MOON_HOSTED === "1";
/** The site's public address (https://...), for links we hand out. */
export const PUBLIC_URL = (process.env.MOON_PUBLIC_URL ?? "").replace(/\/$/, "");
/** Hosted: whose copy this is. */
export const ACCOUNT = HOSTED && process.env.MOON_USER_EMAIL ? { email: process.env.MOON_USER_EMAIL, name: process.env.MOON_USER_NAME ?? "" } : null;
/** Hosted: this player's id (the gateway routes /bridge/<id>/... here). */
export const USER_ID = process.env.MOON_USER_ID ?? "";
