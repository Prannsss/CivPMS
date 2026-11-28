#!/usr/bin/env node
// Guard for the Supabase secret key (CLAUDE.md data-access rule 1). The secret key bypasses RLS, so:
//   1. Only the admin client module (src/lib/supabase/admin.ts) may import the admin client.
//      Its importers must be server code: src/server/, src/app/api/ routes, or admin.ts itself.
//   2. Client components ("use client") must never import the admin client.
//   3. Only src/lib/env.ts reads process.env.SUPABASE_SECRET_KEY.
//   4. No NEXT_PUBLIC_ variable may carry the secret key (it would be inlined into the browser bundle).
//
// Usage: node scripts/check-secret-key.mjs [rootDir]   (defaults to the current directory)
// Exits 1 and lists each violation when a rule is broken.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2] ?? process.cwd();
const srcDir = join(root, "src");

const ADMIN_MODULE = "src/lib/supabase/admin.ts";
const ADMIN_IMPORTER_ALLOWED = [/^src\/server\//, /^src\/app\/api\//, new RegExp(`^${ADMIN_MODULE.replace(/\./g, "\\.")}$`)];
const KEY_READER_ALLOWED = [/^src\/lib\/env\.ts$/, /^src\/lib\/env\.test\.ts$/];

const ADMIN_IMPORT = /(?:from\s+|import\(\s*|require\(\s*)["'][^"']*supabase\/admin["']/;
const KEY_READ = /process\.env\.SUPABASE_SECRET_KEY\b/;
const PUBLIC_SECRET = /NEXT_PUBLIC_[A-Z_]*SECRET/;
const USE_CLIENT = /^\s*(["'])use client\1/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) yield path;
  }
}

const violations = [];
for (const file of walk(srcDir)) {
  const rel = relative(root, file).split("\\").join("/");
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const isClient = USE_CLIENT.test(text.trimStart());

  lines.forEach((line, index) => {
    const where = `${rel}:${index + 1}`;
    if (ADMIN_IMPORT.test(line)) {
      if (rel === ADMIN_MODULE) return;
      if (isClient) violations.push(`${where} client component imports the secret-key client`);
      else if (!ADMIN_IMPORTER_ALLOWED.some((re) => re.test(rel)))
        violations.push(`${where} imports the secret-key client from outside server code`);
    }
    if (KEY_READ.test(line) && !KEY_READER_ALLOWED.some((re) => re.test(rel)))
      violations.push(`${where} reads SUPABASE_SECRET_KEY outside src/lib/env.ts`);
    if (PUBLIC_SECRET.test(line)) violations.push(`${where} exposes a secret through a NEXT_PUBLIC_ variable`);
  });
}

if (violations.length > 0) {
  console.error("Supabase secret-key guard failed:");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log("Supabase secret-key guard: ok");
