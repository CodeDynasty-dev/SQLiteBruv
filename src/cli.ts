#!/usr/bin/env bun
/**
 * SQLiteBruv CLI — Prisma-style migration workflow.
 *
 * Reads schema from `./prisma/schema.prisma` (PSL, single source of truth).
 * Reads connection info from env vars with local SQLite as default.
 *
 * Commands:
 *   bun bruv migrate dev --name <name>   Generate + apply migration
 *   bun bruv migrate deploy              Apply all pending migrations
 *   bun bruv migrate reset               Rollback last migration
 *   bun bruv migrate status              Show applied/pending migrations
 *   bun bruv db push                     Push schema directly (no migration file)
 */

import { SqliteBruv, Schema, getSchema, generateMigration, parsePrismaSchema } from "./index.js";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "path";

const MIGRATIONS_TABLE = "_bruv_migrations";
const FOLDER = SqliteBruv.migrationFolder;
const SCHEMA_PATH = SqliteBruv.schemaFile;

// --- Resolve DB connection from env vars ---
function resolveDb(schema: Schema[], dev: boolean): SqliteBruv {
  if (dev) {
    return new SqliteBruv({
      schema,
      localFile: "./bruv/dev.db",
      createMigrations: false,
    });
  }
  const tursoUrl = process.env["TURSO_URL"];
  const tursoToken = process.env["TURSO_AUTH_TOKEN"];
  const cfAccount = process.env["CFAccountId"];
  const d1Database = process.env["D1databaseId"];
  const cfToken = process.env["CFauthorizationToken"];
  const localFile = process.env["DB_FILE"];

  if (
    localFile &&
    !localFile.endsWith(".db") &&
    !localFile.endsWith(".sqlite") &&
    !localFile.endsWith(".sqlite3")
  ) {
    console.log(localFile);

    console.error("Error: DB_FILE must point to a .db/.sqlite/.sqlite3 file");
    process.exit(1);
  }

  if (tursoUrl && tursoToken) {
    return new SqliteBruv({
      schema,
      TursoConfig: { url: tursoUrl, authToken: tursoToken },
      createMigrations: false,
    });
  }

  if (cfAccount && d1Database && cfToken) {
    return new SqliteBruv({
      schema,
      D1Config: {
        accountId: cfAccount,
        databaseId: d1Database,
        apiKey: cfToken,
      },
      createMigrations: false,
    });
  }

  return new SqliteBruv({
    schema,
    localFile: localFile || "main.db",
    createMigrations: false,
  });
}

// --- Load schema from prisma/schema.prisma ---
async function loadSchema(): Promise<Schema[]> {
  const absPath = join(process.cwd(), SCHEMA_PATH);
  if (!existsSync(absPath)) {
    await mkdir(join(process.cwd(), "bruv"), { recursive: true });
    writeFileSync(
      absPath,
      `generator client {\n  provider = "sqlite-bruv"\n}\n\nmodel User {
  id    String @id @default(uuid())
  email String @unique
  name  String?
}
`,
    );
  }
  const schema = parsePrismaSchema(absPath);
  if (!schema.length) {
    console.error(`Error: No models found in ${SCHEMA_PATH}`);
    process.exit(1);
  }
  return schema;
}

// --- Migration helpers ---
async function ensureTable(db: SqliteBruv) {
  await db.raw(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function getApplied(db: SqliteBruv): Promise<Set<string>> {
  await ensureTable(db);
  const rows: any = await db.raw(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY applied_at`,
  );
  return new Set((Array.isArray(rows) ? rows : []).map((r: any) => r.name));
}

// --- Commands ---

async function migrateDev(db: SqliteBruv, name: string, schema: Schema[]) {
  if (!name) {
    console.error(
      "Error: Migration needs a name.\n  Usage: bun bruv migrate dev --name <name>",
    );
    process.exit(1);
  }

  const tempPath = join(process.cwd(), ".bruv_temp.sqlite");
  const cloned = schema.map((s) => s._clone());
  const tempDb = new SqliteBruv({ schema: cloned, localFile: tempPath, createMigrations: false });
  await tempDb.loading;
  cloned.forEach((s) => { s.db = tempDb; s._induce(); });

  const [current, target] = await Promise.all([getSchema(db), getSchema(tempDb)]);
  const migration = await generateMigration(current || [], target || []);

  if (existsSync(tempPath)) await unlink(tempPath);

  if (!migration.up.trim()) {
    console.log("Already in sync, no migration needed.");
    return;
  }

  const ts = new Date().toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '');
  const safeName = name.replace(/\W+/g, "_").toLowerCase();
  const filename = `${ts}_${safeName}.sql`;
  const content = `-- --> up\n${migration.up.trim()}\n\n-- --> down\n${migration.down.trim()}\n`;

  await mkdir(FOLDER, { recursive: true });
  await writeFile(join(FOLDER, filename), content);
  console.log(`✓ Created migration: ${filename}`);
  // Auto-apply in dev
  await applyMigration(db, filename);
  console.log(`✓ Applied migration: ${filename}`);
}

async function applyMigration(db: SqliteBruv, file: string) {
  await ensureTable(db); 
  const sql = readFileSync(join(FOLDER, file), "utf8");
  const upSql = sql.split("-- --> down")[0].replace("-- --> up", "").trim();

  await db.raw("BEGIN");
  try {
    for (const stmt of upSql.split(";").filter((s: string) => s.trim())) {
      await db.raw(stmt);
    }
    await db.raw(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES (?)`, [file]);
    await db.raw("COMMIT");
  } catch (e) {
    await db.raw("ROLLBACK");
    throw e;
  }
}

async function migrateDeploy(db: SqliteBruv) {
  await ensureTable(db);
  if (!existsSync(FOLDER)) return console.log("No migrations directory found.");
  const files = readdirSync(FOLDER)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const applied = await getApplied(db);
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    console.log(
      `Applying ${file}... ${db._localFile_path ? " to '" + db._localFile_path + "'" : ""}`,
    );
    await applyMigration(db, file);
    count++;
  }

  console.log(
    count > 0
      ? `✓ Applied ${count} migration(s)${db._localFile_path ? " to '" + db._localFile_path + "'" : ""}.`
      : "Already up to date.",
  );
}

async function migrateReset(db: SqliteBruv) {
  await ensureTable(db);
  const last: any = await db.raw(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY applied_at DESC LIMIT 1`,
  );
  if (!last?.length) return console.log("Nothing to rollback.");

  const file = last[0].name;
  const filePath = join(FOLDER, file);
  if (!existsSync(filePath)) {
    console.error(`Migration file not found: ${file}`);
    process.exit(1);
  }

  const sql = readFileSync(filePath, "utf8");
  const downSql = sql.split("-- --> down")[1]?.trim();
  if (!downSql) return console.error("No down migration found in file.");

  console.log(`Rolling back ${file}...`);
  await db.raw("BEGIN");
  try {
    for (const stmt of downSql.split(";").filter((s: string) => s.trim())) {
      await db.raw(stmt);
    }
    await db.raw(`DELETE FROM ${MIGRATIONS_TABLE} WHERE name = ?`, [file]);
    await db.raw("COMMIT");
    console.log(`✓ Rolled back: ${file}`);
  } catch (e) {
    await db.raw("ROLLBACK");
    console.error("Rollback failed:", e);
    process.exit(1);
  }
}

async function migrateStatus(db: SqliteBruv) {
  await ensureTable(db);
  const files = existsSync(FOLDER)
    ? readdirSync(FOLDER)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];
  const applied = await getApplied(db);

  if (files.length === 0) {
    console.log("No migrations found.");
    return;
  }

  console.log("\nMigration status:\n");
  for (const f of files) {
    const status = applied.has(f) ? "✓ applied " : "○ pending  ";
    console.log(`  ${status} ${f}`);
  }
  console.log("");
}

async function dbPush(db: SqliteBruv, schema: Schema[]) {
  const tempPath = join(process.cwd(), ".bruv_temp.sqlite");
  const cloned = schema.map((s) => s._clone());
  const tempDb = new SqliteBruv({
    schema: cloned,
    localFile: tempPath,
    createMigrations: false,
  });
  await tempDb.loading;
  cloned.forEach((s) => {
    s.db = tempDb;
    s._induce();
  });

  const [current, target] = await Promise.all([
    getSchema(db),
    getSchema(tempDb),
  ]);
  const migration = await generateMigration(current || [], target || []);

  if (existsSync(tempPath)) await unlink(tempPath);

  if (!migration.up.trim()) {
    console.log("Already in sync.");
    return;
  }

  await db.raw("BEGIN");
  try {
    for (const stmt of migration.up
      .split(";")
      .filter((s: string) => s.trim())) {
      await db.raw(stmt);
    }
    await db.raw("COMMIT");
    console.log("✓ Schema pushed to database.");
  } catch (e) {
    await db.raw("ROLLBACK");
    console.error("Push failed:", e);
    process.exit(1);
  }
}

// --- CLI entry ---
const args = process.argv.slice(2);
const cmd = args[0];
const sub = args[1];

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const HELP = `
SQLiteBruv CLI

Usage:
  bun bruv migrate dev --name <name>   Create and apply a new migration
  bun bruv migrate deploy              Apply all pending migrations (production)
  bun bruv migrate reset               Rollback the last migration
  bun bruv migrate status              Show migration status
  bun bruv db push                     Push schema directly without migration files
`;

if (!cmd || args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const schema = await loadSchema();
const db = resolveDb(schema, sub === "dev");
await db.loading;

if (cmd === "migrate") {
  switch (sub) {
    case "dev":
      await migrateDev(db, getFlag("--name") || "", schema);
      break;
    case "deploy":
      await migrateDeploy(db);
      break;
    case "reset":
      await migrateReset(db);
      break;
    case "status":
      await migrateStatus(db);
      break;
    default:
      console.error(`Unknown command: migrate ${sub}`);
      console.log(HELP);
      process.exit(1);
  }
} else if (cmd === "db") {
  switch (sub) {
    case "push":
      await dbPush(db, schema);
      break;
    default:
      console.error(`Unknown command: db ${sub}`);
      console.log(HELP);
      process.exit(1);
  }
} else {
  console.error(`Unknown command: ${cmd}`);
  console.log(HELP);
  process.exit(1);
}
