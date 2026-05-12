/**
 * Prisma Schema Language (PSL) parser for SQLite.
 *
 * Parses a schema.prisma file and returns Schema[] instances
 * compatible with SqliteBruv. Only handles SQLite-compatible types.
 *
 * Supported PSL types → SQLite mapping:
 *   Int, BigInt        → INTEGER
 *   Float, Decimal     → REAL
 *   String             → TEXT
 *   Boolean            → INTEGER (0/1)
 *   DateTime           → DATETIME
 *   Bytes              → BLOB (stored as TEXT)
 *
 * Supported attributes:
 *   @id                → PRIMARY KEY (skipped from columns, handled by SqliteBruv)
 *   @unique            → UNIQUE
 *   @default(...)      → DEFAULT value
 *   @relation(...)     → REFERENCES (foreign key target)
 *   ?                  → nullable (not required)
 *   no ?               → NOT NULL (required)
 *
 * Ignored (not relevant for SQLite):
 *   @map, @@map, @@index, @updatedAt, @db.*, generator, datasource, enum
 */

import { Schema } from "./index.js";
import { readFileSync } from "node:fs";

interface ParsedColumn {
  type: "INTEGER" | "REAL" | "TEXT" | "DATETIME";
  required?: boolean;
  unique?: boolean;
  default?: () => string;
  target?: string;
  check?: string[];
}

interface ParsedModel {
  name: string;
  columns: Record<string, ParsedColumn>;
}

const TYPE_MAP: Record<string, "INTEGER" | "REAL" | "TEXT" | "DATETIME"> = {
  Int: "INTEGER",
  BigInt: "INTEGER",
  Float: "REAL",
  Decimal: "REAL",
  String: "TEXT",
  Boolean: "INTEGER",
  DateTime: "DATETIME",
  Bytes: "TEXT",
  Json: "TEXT",
};

function parseDefault(attr: string): (() => string) | undefined {
  const match = attr.match(/@default\(([^)]+)\)/);
  if (!match) return undefined;

  const val = match[1].trim();

  // autoincrement — SQLite handles via INTEGER PRIMARY KEY, skip
  if (val === "autoincrement()") return undefined;
  // uuid/cuid — handled by SqliteBruv's Id()
  if (val === "uuid()" || val === "cuid()") return undefined;
  // now() → CURRENT_TIMESTAMP
  if (val === "now()") return () => "CURRENT_TIMESTAMP";
  // boolean
  if (val === "true") return () => "1";
  if (val === "false") return () => "0";
  // numeric
  if (/^-?\d+(\.\d+)?$/.test(val)) return () => val;
  // string literal "value"
  if (val.startsWith('"') && val.endsWith('"')) {
    const str = val.slice(1, -1);
    return () => `'${str}'`;
  }

  return () => val;
}

function parseRelation(attr: string): string | undefined {
  // @relation(fields: [userId], references: [id])
  // We want the model this field points to — but in PSL the type IS the model name
  // So we just return undefined here; the target is derived from the field type
  return undefined;
}

function isRelationField(typeName: string, allModelNames: Set<string>): boolean {
  return allModelNames.has(typeName) || allModelNames.has(typeName.replace("[]", ""));
}

export function parsePrismaSchema(filePath: string): Schema[] {
  const content = readFileSync(filePath, "utf8");
  return parsePrismaContent(content);
}

export function parsePrismaContent(content: string): Schema[] {
  const models: ParsedModel[] = [];
  const modelNames = new Set<string>();

  // First pass: collect model names
  const modelNameRegex = /^model\s+(\w+)\s*\{/gm;
  let nameMatch;
  while ((nameMatch = modelNameRegex.exec(content)) !== null) {
    modelNames.add(nameMatch[1]);
  }

  // Second pass: parse each model
  const modelRegex = /^model\s+(\w+)\s*\{([^}]+)\}/gm;
  let modelMatch;

  while ((modelMatch = modelRegex.exec(content)) !== null) {
    const modelName = modelMatch[1];
    const body = modelMatch[2];
    const columns: Record<string, ParsedColumn> = {};

    const lines = body.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//") && !l.startsWith("@@"));

    for (const line of lines) {
      // Parse: fieldName Type? @attributes...
      const fieldMatch = line.match(/^(\w+)\s+(\w+)(\[\])?\s*(\?)?\s*(.*)?$/);
      if (!fieldMatch) continue;

      const [, fieldName, typeName, isArray, isOptional, attrs = ""] = fieldMatch;

      // Skip @id fields — SqliteBruv adds id automatically
      if (attrs.includes("@id")) continue;

      // Skip relation fields (type is another model or model[])
      if (isRelationField(typeName, modelNames)) {
        // But if it has @relation, it might be a FK scalar field — those are separate
        // Actually in Prisma, the scalar FK field (e.g. userId Int) is separate from the relation field (user User @relation...)
        // So we skip fields whose type is a model name
        continue;
      }
      if (isArray) continue; // Skip array relations like posts Post[]

      // Map type
      const sqliteType = TYPE_MAP[typeName];
      if (!sqliteType) continue; // Unknown type, skip

      const col: ParsedColumn = {
        type: sqliteType,
        required: !isOptional,
      };

      // Parse attributes
      if (attrs.includes("@unique")) {
        col.unique = true;
      }

      const defaultFn = parseDefault(attrs);
      if (defaultFn) {
        col.default = defaultFn;
      }

      // Foreign key: look for @relation or field naming convention (ends with Id and references a model)
      // In Prisma, scalar FK fields are like: userId Int
      // We detect by checking if fieldName minus "Id" suffix is a model name
      const possibleTarget = fieldName.replace(/Id$/, "");
      const targetModel = [...modelNames].find(
        m => m.toLowerCase() === possibleTarget.toLowerCase() && m !== modelName
      );
      if (targetModel) {
        // Convert model name to table name (lowercase plural-ish, but Prisma uses model name as table)
        // SqliteBruv uses the schema.name which is the model block name lowercased
        col.target = targetModel.toLowerCase() + "s";
      }

      columns[fieldName] = col;
    }

    // Only add model if it has columns (beyond id)
    if (Object.keys(columns).length > 0) {
      models.push({
        name: modelName.toLowerCase() + "s", // Convention: pluralize table name
        columns,
      });
    }
  }

  // Convert to Schema instances
  return models.map(m => new Schema({ name: m.name, columns: m.columns as any }));
}
