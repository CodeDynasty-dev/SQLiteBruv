import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// TYPES:

interface BruvSchema<Model> {
  name: string;
  columns: {
    [x in keyof Omit<Model, "_id">]: SchemaColumnOptions;
  };
}

interface SchemaColumnOptions {
  type: "INTEGER" | "REAL" | "TEXT" | "DATETIME";
  required?: boolean;
  unique?: boolean;
  default?: () => any;
  target?: string;
}
type Params = string | number | null | boolean;
type rawSchema = { name: string; schema: { sql: string } };
interface Query {
  from: string;
  select?: string[];
  where?: {
    condition: string;
    params: any[];
  }[];
  andWhere?: {
    condition: string;
    params: any[];
  }[];
  orWhere?: {
    condition: string;
    params: any[];
  }[];
  orderBy?: {
    column: string;
    direction: "ASC" | "DESC";
  };
  limit?: number;
  offset?: number;
  cacheAs?: string;
  invalidateCache?: string;
  action?: "get" | "getOne" | "insert" | "update" | "delete" | "count";
  /**
  ### For insert and update only
  */
  data?: any;
}

interface TursoConfig {
  url: string;
  authToken: string;
}

// SqliteBruv class

export class SqliteBruv<
  T extends Record<string, Params> = Record<string, Params>
> {
  static migrationFolder = "./Bruv-migrations";
  private db: any;
  dbMem: any;
  private _columns: string[] = ["*"];
  private _conditions: string[] = [];
  private _tableName?: string = undefined;
  private _params: Params[] = [];
  private _cacheName?: string;
  private _limit?: number;
  private _offset?: number;
  private _orderBy?: { column: string; direction: "ASC" | "DESC" };
  private _query: boolean = false;
  private _D1_api_key?: string;
  private _D1_url?: string;
  private _logging: boolean = false;
  private _hotCache: Record<string | number, any> = {};
  private _turso?: TursoConfig;
  private readonly MAX_PARAMS = 100;
  private readonly ALLOWED_OPERATORS = [
    "=",
    ">",
    "<",
    ">=",
    "<=",
    "LIKE",
    "IN",
    "BETWEEN",
    "IS NULL",
    "IS NOT NULL",
  ];
  private readonly DANGEROUS_PATTERNS = [
    /;\s*$/,
    /UNION/i,
    /DROP/i,
    /DELETE/i,
    /UPDATE/i,
    /INSERT/i,
    /ALTER/i,
    /EXEC/i,
  ];
  loading?: Promise<unknown>;
  constructor({
    D1,
    turso,
    logging,
    schema,
    name,
  }: {
    D1?: {
      accountId: string;
      databaseId: string;
      apiKey: string;
    };
    turso?: TursoConfig;
    schema: Schema[];
    logging?: boolean;
    name?: string;
  }) {
    schema.forEach((s) => {
      s.db = this;
    });
    this.loading = new Promise(async (r) => {
      const bun = avoidError(() => (Bun ? true : false));
      let Database;
      if (bun) {
        Database = (await import("bun:sqlite")).Database;
      } else {
        Database = (await import("node:sqlite")).DatabaseSync;
      }
      // ?setup db
      this.db = new Database((name || "Database") + ".sqlite", {
        create: true,
        strict: true,
      });
      if (!bun) {
        this.db.query = this.db.prepare;
      }
      this.dbMem = new Database(":memory:");
      if (D1) {
        const { accountId, databaseId, apiKey } = D1;
        this._D1_url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
        this._D1_api_key = apiKey;
      }
      // ?
      if (logging === true) {
        this._logging = true;
      }
      // ? get and set db for each schema
      if (!schema?.length) {
        throw new Error("Not database schema passed!");
      } else {
        schema.forEach((s) => {
          s._induce();
        });
      }
      //? Auto create migration files
      const isMigrating = process.argv
        .slice(1)
        .some((v) => v.includes("Bruv-migrations/migrate.ts"));
      if (!isMigrating) {
        Promise.all([getSchema(this.db), getSchema(this.dbMem)])
          .then(async ([currentSchema, targetSchema]) => {
            const migration = await generateMigration(
              currentSchema || [],
              targetSchema || []
            );
            await createMigrationFileIfNeeded(migration);
            this.dbMem.close();
          })
          .catch((e) => {
            console.log(e);
          });
      } else {
        console.log("running migrations..");
      }
      if (turso) {
        this._turso = turso;
      }
      this.loading = undefined;
      r(undefined);
    });
  }
  from<Model extends Record<string, any> = Record<string, any>>(
    tableName: string
  ) {
    this._tableName = tableName;
    return this as unknown as SqliteBruv<Model>;
  }
  // Read queries
  select(...columns: string[]) {
    this._columns = columns || ["*"];
    return this;
  }
  private validateCondition(condition: string): boolean {
    // Check for dangerous patterns
    if (this.DANGEROUS_PATTERNS.some((pattern) => pattern.test(condition))) {
      throw new Error("Invalid condition pattern detected");
    }

    // Validate operators
    const hasValidOperator = this.ALLOWED_OPERATORS.some((op) =>
      condition.toUpperCase().includes(op)
    );
    if (!hasValidOperator) {
      throw new Error("Invalid or missing operator in condition");
    }

    return true;
  }

  private validateParams(params: Params[]): boolean {
    if (params.length > this.MAX_PARAMS) {
      throw new Error("Too many parameters");
    }

    for (const param of params) {
      if (
        param !== null &&
        !["string", "number", "boolean"].includes(typeof param)
      ) {
        throw new Error("Invalid parameter type");
      }

      if (typeof param === "string" && param.length > 1000) {
        throw new Error("Parameter string too long");
      }
    }

    return true;
  }
  where(condition: string, ...params: Params[]) {
    // Validate inputs
    if (!condition || typeof condition !== "string") {
      throw new Error("Condition must be a non-empty string");
    }

    this.validateCondition(condition);
    this.validateParams(params);

    // Use parameterized query
    this._conditions.push(`WHERE ${condition}`);
    this._params.push(...params);

    return this;
  }
  andWhere(condition: string, ...params: Params[]) {
    this.validateCondition(condition);
    this.validateParams(params);

    this._conditions.push(`AND ${condition}`);
    this._params.push(...params);
    return this;
  }
  orWhere(condition: string, ...params: Params[]) {
    this.validateCondition(condition);
    this.validateParams(params);

    this._conditions.push(`OR ${condition}`);
    this._params.push(...params);
    return this;
  }
  limit(count: number) {
    this._limit = count;
    return this;
  }
  offset(count: number) {
    this._offset = count || -1;
    return this;
  }
  orderBy(column: string, direction: "ASC" | "DESC") {
    this._orderBy = { column, direction };
    return this;
  }
  cacheAs(cacheName: string) {
    this._cacheName = cacheName;
    return this;
  }
  invalidateCache(cacheName: string) {
    this._hotCache[cacheName] = undefined;
    return this;
  }
  get(): Promise<T[]> {
    if (this._cacheName && this._hotCache[this._cacheName]) {
      this._hotCache[this._cacheName];
    }
    const { query, params } = this.build();
    if (this._query === true) {
      return { query, params } as unknown as Promise<T[]>;
    }
    return this.run(query, params, { single: false });
  }
  getOne(): Promise<T> {
    if (this._cacheName && this._hotCache[this._cacheName]) {
      this._hotCache[this._cacheName];
    }
    const { query, params } = this.build();
    if (this._query === true) {
      return { query, params } as unknown as Promise<T>;
    }
    return this.run(query, params, { single: true });
  }
  insert(data: T): Promise<T> {
    //  @ts-ignore
    data.id = Id(); // sqlitebruv provide you with string id by default
    const attributes = Object.keys(data);
    const columns = attributes.join(", ");
    const placeholders = attributes.map(() => "?").join(", ");

    const query = `INSERT INTO ${this._tableName} (${columns}) VALUES (${placeholders})`;
    const params = Object.values(data) as Params[];
    this.clear();
    if (this._query === true) {
      return { query, params } as unknown as Promise<T>;
    }
    return this.run(query, params, { single: true });
  }
  update(data: Partial<T>): Promise<T> {
    const columns = Object.keys(data)
      .map((column) => `${column} = ?`)
      .join(", ");
    const query = `UPDATE ${
      this._tableName
    } SET ${columns} ${this._conditions.join(" AND ")}`;
    const params = [...(Object.values(data) as Params[]), ...this._params];
    this.clear();
    if (this._query === true) {
      return { query, params } as unknown as Promise<T>;
    }
    return this.run(query, params);
  }
  delete(): Promise<T> {
    const query = `DELETE FROM ${this._tableName} ${this._conditions.join(
      " AND "
    )}`;
    const params = [...this._params];
    this.clear();
    if (this._query === true) {
      return { query, params } as unknown as Promise<T>;
    }
    return this.run(query, params);
  }
  count(): Promise<{
    [x: string]: any;
    count: number;
  }> {
    const query = `SELECT COUNT(*) as count  FROM ${
      this._tableName
    } ${this._conditions.join(" AND ")}`;
    const params = [...this._params];
    this.clear();
    if (this._query === true) {
      return { query, params } as unknown as Promise<{
        count: number;
      }>;
    }
    return this.run(query, params);
  }

  // Parser function
  async executeJsonQuery(query: Query): Promise<any> {
    if (!query.action) {
      throw new Error("Action is required.");
    }
    if (!query.from) {
      throw new Error("Table is required.");
    }
    let queryBuilder = this.from(query.from);
    if (query.select) queryBuilder = queryBuilder.select(...query.select);
    if (query.limit) queryBuilder = queryBuilder.limit(query.limit);
    if (query.offset) queryBuilder = queryBuilder.offset(query.offset);
    if (query.cacheAs) queryBuilder = queryBuilder.cacheAs(query.cacheAs);
    if (query.where) {
      for (const condition of query.where) {
        queryBuilder = queryBuilder.where(
          condition.condition,
          ...condition.params
        );
      }
    }

    if (query.andWhere) {
      for (const condition of query.andWhere) {
        queryBuilder = queryBuilder.andWhere(
          condition.condition,
          ...condition.params
        );
      }
    }

    if (query.orWhere) {
      for (const condition of query.orWhere) {
        queryBuilder = queryBuilder.orWhere(
          condition.condition,
          ...condition.params
        );
      }
    }

    if (query.orderBy) {
      queryBuilder = queryBuilder.orderBy(
        query.orderBy.column,
        query.orderBy.direction
      );
    }

    let result: any;

    try {
      switch (query.action) {
        case "get":
          result = await queryBuilder.get();
          break;
        case "count":
          result = await queryBuilder.count();
          break;
        case "getOne":
          result = await queryBuilder.getOne();
          break;
        case "insert":
          if (!query.data) {
            throw new Error("Data is required for insert action.");
          }
          result = await queryBuilder.insert(query.data);
          break;
        case "update":
          if (!query.data || !query.from || !query.where) {
            throw new Error(
              "Data, from, and where are required for update action."
            );
          }
          result = await queryBuilder.update(query.data);
          break;
        case "delete":
          if (!query.from || !query.where) {
            throw new Error("From and where are required for delete action.");
          }
          result = await queryBuilder.delete();
          break;
        default:
          throw new Error("Invalid action specified.");
      }

      if (query.invalidateCache) {
        queryBuilder.invalidateCache(query.invalidateCache);
      }
    } catch (error) {
      // Handle errors and return appropriate response
      console.error("Query execution failed:", error);
      throw new Error("Query execution failed.");
    }

    return result;
  }

  private build() {
    const query = [
      `SELECT ${this._columns.join(", ")} FROM ${this._tableName}`,
      ...this._conditions,
      this._orderBy
        ? `ORDER BY ${this._orderBy.column} ${this._orderBy.direction}`
        : "",
      this._limit ? `LIMIT ${this._limit}` : "",
      this._offset ? `OFFSET ${this._offset}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const params = [...this._params];
    this.clear();
    return { query, params };
  }
  clear() {
    if (!this._tableName || typeof this._tableName !== "string") {
      throw new Error("no table selected!");
    }
    this._conditions = [];
    this._params = [];
    this._limit = undefined;
    this._offset = undefined;
    this._orderBy = undefined;
    this._tableName = undefined;
  }
  private async run(
    query: string,
    params: (string | number | null | boolean)[],
    { single }: { single?: boolean } = {}
  ) {
    if (this.loading) await this.loading;
    if (this._logging) {
      console.log({ query, params });
    }
    if (this._turso) {
      const results = await this.executeTursoQuery(query, params);
      if (single) {
        return results[0];
      }
      return results;
    }
    if (this._D1_api_key) {
      const res = await fetch(this._D1_url as string, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this._D1_api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql: query, params }),
      });
      const data = await res.json();
      if (data.success && data.result[0].success) {
        if (single) {
          return data.result[0].results[0];
        } else {
          return data.result[0].results;
        }
      }
      throw new Error(JSON.stringify(data.errors));
    }
    if (single === true) {
      if (this._cacheName) {
        return this.cacheResponse(this.db.query(query).get(...params));
      }
      return this.db.query(query).get(...params);
    }
    if (single === false) {
      if (this._cacheName) {
        return this.cacheResponse(this.db.query(query).all(...params));
      }
      return this.db.query(query).all(...params);
    }
    return this.db.exec(query);
  }
  private async executeTursoQuery(
    query: string,
    params: any[] = []
  ): Promise<any> {
    if (!this._turso) {
      throw new Error("Turso configuration not found");
    }

    const response = await fetch(this._turso.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this._turso.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        statements: [
          {
            q: query,
            params: params,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Turso API error: ${response.statusText}`);
    }

    const results = (await response.json())[0];
    const { columns, rows } = results?.results || {};
    if (results.error) {
      throw new Error(`Turso API error: ${results.error}`);
    }

    // Map each row to an object
    const transformedRows = rows.map((row: any[]) => {
      const rowObject: any = {};
      columns.forEach((column: string, index: number) => {
        rowObject[column] = row[index];
      });
      return rowObject;
    });

    return transformedRows;
  }
  raw(raw: string, params: (string | number | boolean)[] = []) {
    return this.run(raw, params);
  }
  async cacheResponse(response: any) {
    await response;
    this._hotCache[this._cacheName!] = response;
    return response;
  }
}

export class Schema<Model extends Record<string, any> = {}> {
  private string: string = "";
  name: string;
  db?: SqliteBruv;
  columns: { [x in keyof Omit<Model, "_id">]: SchemaColumnOptions };
  constructor(def: BruvSchema<Model>) {
    this.name = def.name;
    this.columns = def.columns;
  }
  get query() {
    return this.db?.from(this.name) as SqliteBruv<Model>;
  }
  queryRaw(raw: string) {
    return this.db?.from(this.name).raw(raw, [])!;
  }
  _induce() {
    const tables = Object.keys(this.columns);
    this.string = `CREATE TABLE IF NOT EXISTS ${
      this.name
    } (\n    id text PRIMARY KEY NOT NULL,\n     ${tables
      .map(
        (col, i) =>
          col +
          " " +
          this.columns[col].type +
          (this.columns[col].unique ? " UNIQUE" : "") +
          (this.columns[col].required ? " NOT NULL" : "") +
          (this.columns[col].target
            ? " REFERENCES " + this.columns[col].target + "(id)"
            : "") +
          (this.columns[col].default
            ? "  DEFAULT " + this.columns[col].default()
            : "") +
          (i + 1 !== tables.length ? ",\n    " : "\n")
      )
      .join(" ")})`;
    try {
      this.db?.raw(this.string);
      this.db?.dbMem.exec(this.string);
    } catch (error) {
      console.log({ err: String(error), schema: this.string });
    }
  }
  async getSql() {
    await this.db?.loading;
    return this.string;
  }
}

async function getSchema(db: any): Promise<rawSchema[] | void> {
  try {
    const tables = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    const schema = await Promise.all(
      tables.map(async (table: any) => ({
        name: table.name,
        schema: await db
          .prepare(
            `SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`
          )
          .get(table.name),
      }))
    );
    return schema;
  } catch (error) {
    console.error(error);
    db.close(); // Close connection
  }
}

async function generateMigration(
  currentSchema: rawSchema[],
  targetSchema: rawSchema[]
): Promise<{ up: string; down: string }> {
  if (!targetSchema?.length) return { up: "", down: "" };

  const currentTables: Record<string, string> = Object.fromEntries(
    currentSchema.map(({ name, schema }) => [name, schema.sql])
  );

  const targetTables: Record<string, string> = Object.fromEntries(
    targetSchema.map(({ name, schema }) => [name, schema.sql])
  );

  let upStatements: string[] = ["-- Up migration", "BEGIN IMMEDIATE;"];
  let downStatements: string[] = ["-- Down migration", "-- BEGIN IMMEDIATE;"];

  // Helper function to parse column definitions
  function parseSchema(
    sql: string
  ): Record<string, { type: string; constraints: string }> {
    const columnRegex =
      /(?<column_name>\w+)\s+(?<data_type>\w+)(?:\s+(?<constraints>.*?))?(?:,|\))/gi;

    const columnSectionMatch = sql.match(/\(([\s\S]+)\)/);
    if (!columnSectionMatch) return {};

    const columnSection = columnSectionMatch[1];
    const matches = columnSection.matchAll(columnRegex);

    const columns: Record<string, { type: string; constraints: string }> = {};
    for (const match of matches) {
      const columnName = match.groups?.["column_name"] || "";
      const dataType = match.groups?.["data_type"] || "";
      const constraints = (match.groups?.["constraints"] || "").trim();
      columns[columnName] = { type: dataType, constraints };
    }
    return columns;
  }

  // Generate migration steps
  let shouldMigrate = false;

  for (const [tableName, currentSql] of Object.entries(currentTables)) {
    const targetSql = targetTables[tableName];
    if (!targetSql) {
      // Table dropped
      shouldMigrate = true;
      upStatements.push(`DROP TABLE ${tableName};`);
      downStatements.push("-- " + currentSql + ";");
      continue;
    }

    const currentColumns = parseSchema(currentSql);
    const targetColumns = parseSchema(targetSql);

    if (JSON.stringify(currentColumns) !== JSON.stringify(targetColumns)) {
      // Recreate table to reflect column changes
      shouldMigrate = true;

      // 1. Create a new table with the target schema
      upStatements.push(targetSql.replace(tableName, `${tableName}_new`) + ";");

      // 2. Copy data to the new table
      const commonColumns = Object.keys(currentColumns)
        .filter((col) => targetColumns[col])
        .join(", ");
      upStatements.push(
        `INSERT INTO ${tableName}_new (${commonColumns}) SELECT ${commonColumns} FROM ${tableName};`
      );

      // 3. Drop the old table
      upStatements.push(`DROP TABLE ${tableName};`);

      // 4. Rename the new table to the old table's name
      upStatements.push(`ALTER TABLE ${tableName}_new RENAME TO ${tableName};`);

      // Down migration (reverse steps)
      // 1. Recreate the old table with the original schema
      downStatements.push(
        "-- " +
          currentSql
            .replace(tableName, `${tableName}_old`)
            .replaceAll("\n", "\n--") +
          ";"
      );

      // 2. Copy data back to the old table
      downStatements.push(
        `-- INSERT INTO ${tableName}_old (${commonColumns}) SELECT ${commonColumns} FROM ${tableName};`
      );

      // 3. Drop the current table
      downStatements.push(`-- DROP TABLE ${tableName};`);

      // 4. Rename the old table back to the original name
      downStatements.push(
        `-- ALTER TABLE ${tableName}_old RENAME TO ${tableName};`
      );
    }
  }

  // Handle new tables
  for (const [tableName, targetSql] of Object.entries(targetTables)) {
    if (!currentTables[tableName]) {
      shouldMigrate = true;
      upStatements.push(targetSql + ";");
      downStatements.push(`-- DROP TABLE ${tableName};`);
    }
  }

  upStatements.push("COMMIT;");
  downStatements.push("-- COMMIT;");

  return shouldMigrate
    ? { up: upStatements.join("\n"), down: downStatements.join("\n") }
    : { up: "", down: "" };
}

async function createMigrationFileIfNeeded(
  migration: { up: string; down: string } | null
) {
  if (!migration?.up || !migration?.down) return;
  const timestamp = new Date().toString().split(" ").slice(0, 5).join("_");
  const filename = `${timestamp}_auto_migration.sql`;
  const filepath = join(SqliteBruv.migrationFolder, filename);
  const filepath2 = join(SqliteBruv.migrationFolder, "migrate.ts");
  const fileContent = `${migration.up}\n\n${migration.down}`;
  try {
    await mkdir(SqliteBruv.migrationFolder, { recursive: true }).catch(
      (e) => {}
    );
    if (isDuplicateMigration(fileContent)) return;
    await writeFile(filepath, fileContent, {});
    await writeFile(
      filepath2,
      `// Don't rename this file or the directory
// import your db class correctly below and run the file to apply.
import { db } from "path/to/db";
import { readFileSync } from "node:fs";

const filePath = "${filepath}";
const migrationQuery = readFileSync(filePath, "utf8");
const info = await db.raw(migrationQuery);
console.log(info);
// bun Bruv-migrations/migrate.ts 
      `
    );
    console.log(`Created migration file: ${filename}`);
  } catch (error) {
    console.error("Error during file system operations: ", error);
  }
}

function isDuplicateMigration(newContent: string) {
  const migrationFiles = readdirSync(SqliteBruv.migrationFolder);
  for (const file of migrationFiles) {
    const filePath = join(SqliteBruv.migrationFolder, file);
    const existingContent = readFileSync(filePath, "utf8");
    if (existingContent.trim() === newContent.trim()) {
      return true;
    }
  }
  return false;
}

const PROCESS_UNIQUE = randomBytes(5);
const buffer = Buffer.alloc(12);
const Id = (): string => {
  let index = ~~(Math.random() * 0xffffff);
  const time = ~~(Date.now() / 1000);
  const inc = (index = (index + 1) % 0xffffff);
  // 4-byte timestamp
  buffer[3] = time & 0xff;
  buffer[2] = (time >> 8) & 0xff;
  buffer[1] = (time >> 16) & 0xff;
  buffer[0] = (time >> 24) & 0xff;
  // 5-byte process unique
  buffer[4] = PROCESS_UNIQUE[0];
  buffer[5] = PROCESS_UNIQUE[1];
  buffer[6] = PROCESS_UNIQUE[2];
  buffer[7] = PROCESS_UNIQUE[3];
  buffer[8] = PROCESS_UNIQUE[4];
  // 3-byte counter
  buffer[11] = inc & 0xff;
  buffer[10] = (inc >> 8) & 0xff;
  buffer[9] = (inc >> 16) & 0xff;
  return buffer.toString("hex");
};

const avoidError = (cb: { (): any; (): any; (): void }) => {
  try {
    cb();
    return true;
  } catch (error) {
    return false;
  }
};
