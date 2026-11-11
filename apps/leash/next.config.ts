import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// All apps share the single .env at the repo root.
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  transpilePackages: ["@leash/shared"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
