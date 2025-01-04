# SQLiteBruv Query Builder

A Tiny Type-Safe, Secure SQLite Query Builder with D1/Turso support with built-in migrations and security features.

[![npm version](https://badge.fury.io/js/sqlitebruv.svg)](https://www.npmjs.com/package/sqlitebruv)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![npm](https://img.shields.io/npm/dm/sqlitebruv.svg)](https://www.npmjs.com/package/sqlitebruv) [![TypeScript](https://img.shields.io/badge/Typescript-%3E%3D4.0-blue.svg)](https://www.typescriptlang.org/)

## Features

- 🛡️ Security-first design with SQL injection prevention
- 📡 JSON interface for http no sql queries
- 🔄 Automatic schema migrations
- 🏃‍♂️ In-memory caching
- 🌐 Cloudflare D1 & Turso support
- 📝 Type-safe queries
- 🔍 Query validation & sanitization
- 📊 Schema management
- 🌠 Bunjs Support 100%

<center>
<img src="https://github.com/FridayCandour/SQLiteBruv/blob/main/icon.png?raw=true" style="width: 320px; margin: auto;" />
</center>
## Installation

```bash
npm install sqlite-bruv
```

## 🚀 Updates

- **Light weight**: Zero dependency and small size.
- **Bun-Ready**: built for Bunjs
- **Platform Support**:
  - Cloudflare D1
  - Turso
  - Local SQLite
  - raw query output
- **Security**: SQL injection prevention, query validation, parameter sanitization
- **Type Safety**: Full TypeScript support with inferred types
- **Migrations**: Automatic schema diff detection and migration generation
- **Caching**: Built-in memory caching with invalidation
- **Relations**: Support for one-to-one and one-to-many relationships

## 📦 Installation

```bash
# bun
bun add sqlite-bruv

# npm
npm install sqlite-bruv
```

## Usage/Examples

```typescript
import { SqliteBruv, Schema } from "sqlite-bruv";

// Define your schema
const UserSchema = new Schema<{
  name: string;
  email: string;
  role: "admin" | "user";
  createdAt: Date;
}>({
  name: "users",
  columns: {
    name: { type: "TEXT", required: true },
    email: { type: "TEXT", unique: true },
    role: { type: "TEXT", default: () => "user" },
    createdAt: { type: "DATETIME", default: () => new Date() },
  },
});

const PostSchema = new Schema({
  name: "posts",
  columns: {
    title: { type: "TEXT", required: true },
    content: { type: "TEXT" },
    userId: {
      type: "TEXT",
      target: "users",
      relationType: "ONE",
    },
  },
});

const CommentSchema = new Schema({
  name: "comments",
  columns: {
    content: { type: "TEXT", required: true },
    postId: {
      type: "TEXT",
      target: "posts",
      relationType: "MANY",
    },
  },
});

// Initialize database

const db = new SqliteBruv({
  schema: [UserSchema],
});
```

Platform-Specific Setup
Cloudflare D1

```typescript
const db = new SqliteBruv({
  D1: {
    accountId: process.env.CF_ACCOUNT_ID,
    databaseId: process.env.D1_DATABASE_ID,
    apiKey: process.env.CF_API_KEY,
  },
  schema: [UserSchema, PostSchema, CommentSchema],
});
```

Turso;

```typescript
const db = new SqliteBruv({
  turso: {
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
  schema: [UserSchema, PostSchema, CommentSchema],
});
```

## Example usage:

```typescript
const queryBuilder = new SqliteBruv({
  schema: [UserSchema, PostSchema, CommentSchema],
});

// Insert
await queryBuilder
  .from("users")
  .insert({ name: "John Doe", email: "john@example.com" })
  .then((changes) => {
    // console.log({ changes });
  });

// Update
await queryBuilder
  .from("users")
  .where("id = ?", 1)
  .update({ name: "Jane Doe" })
  .then((changes) => {
    // console.log({ changes });
  });

// Search
await queryBuilder
  .from("users")
  .where("id = ?", 1)
  .andWhere("name LIKE ?", `%oh%`)
  .get()
  .then((changes) => {
    // console.log({ changes });
  });

// Delete
await queryBuilder
  .from("users")
  .where("id = ?", 1)
  .delete()
  .then((changes) => {
    console.log({ changes });
  });

// Get all users
queryBuilder
  .from("users")
  .get()
  .then((changes) => {
    // console.log({ changes });
  });

// Get one user
await queryBuilder
  .from("users")
  .where("id = ?", 1)
  .getOne()
  .then((changes) => {
    // console.log({ changes });
  });

// Select specific columns
await queryBuilder
  .from("users")
  .select("id", "name")
  .get()
  .then((changes) => {
    // console.log({ changes });
  });

// Where conditions
await queryBuilder
  .from("users")
  .where("age > ?", 18)
  .get()
  .then((changes) => {
    // console.log({ changes });
  });

// AndWhere conditions
await queryBuilder
  .from("users")
  .where("age > ?", 18)
  .andWhere("country = ?", "USA")
  .get()
  .then((changes) => {
    // console.log({ changes });
  });

// OrWhere conditions
await queryBuilder
  .from("users")
  .where("age > ?", 18)
  .orWhere("country = ?", "Canada")
  .get()
  .then((changes) => {
    // console.log({ changes });
  });

// Limit and Offset
await queryBuilder
  .from("users")
  .limit(10)
  .offset(5)
  .get()
  .then((changes) => {
    // console.log({ changes });
  });

// OrderBy
await queryBuilder
  .from("users")
  .orderBy("name", "ASC")
  .get()
  .then((changes) => {
    // console.log({ changes });
  });

await queryBuilder
  .from("users")
  .orderBy("name", "ASC")
  .get()
  .then((changes) => {
    // console.log({ changes });
  });
```

## 💡 Advanced Usage

Complex Queries

```ts
// Relations and joins
const posts = await db
  .from("posts")
  .select("posts.*", "users.name as author")
  .where("posts.published = ?", true)
  .andWhere("posts.views > ?", 1000)
  .orderBy("posts.createdAt", "DESC")
  .limit(10)
  .get();

// Raw queries with safety
await db.raw("SELECT * FROM users WHERE id = ?", [userId]);

// Cache usage
const users = await db
  .from("users")
  .select("*")
  .where("active = ?", true)
  .cacheAs("active-users")
  .get();

// Cache invalidation
db.invalidateCache("active-users");
```

## Using from over the network via JSON interface

```typescript
//  JSON interface structure
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
// Example usage in an Express.js route
import express from "express";
const app = express();
app.use(express.json());

app.post("/execute-query", async (req, res) => {
  try {
    const queryInput = req.body;
    // do your role authentication here,
    // use query.from to know the table being accessed
    const result = await qb.executeJsonQuery(queryInput);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

## 🔄 Migrations

Migrations are automatically generated when schema changes are detected:

```sql
-- Generated in ./Bruv-migrations/timestamp_add_user_role.sql:
-- Up
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';

-- Down
ALTER TABLE users DROP COLUMN role;
```

### Setting up your schema

This if your DB is new and your are not using any orm, just call toString
and query your db with the queryBuilder.raw() method.

Note: raw is not secured, it can be used to apply migrations too.
be careful what you do with queryBuilder.raw().

```ts
console.log(user.toString());
const raw = await qb.raw(user.toString());
console.log({ raw });
```

## 🛡️ Security Features

The query builder implements several security measures to prevent SQL injection and malicious queries:

- Parameter validation (max 100 params)
- SQL injection prevention
- Query timeout limits
- Rate limiting
- String length validation
- Dangerous pattern detection
- Allowed parameter types: string, number, boolean, null

#### Condition Validation

- Whitelisted operators: `=, >, <, >=, <=, LIKE, IN, BETWEEN, IS NULL, IS NOT NULL`
- Blocked dangerous patterns: `; DROP, DELETE, UPDATE, INSERT, ALTER, EXEC, UNION`
- Parameterized queries enforced

### Security Examples

```typescript
// ✅ Safe queries
db.from("users")
  .where("email LIKE ?", "%@example.com") // ✅ Safe
  .andWhere("role = ?", "admin") // ✅ Safe
  .get();
db.from("users")
  .where("age > ?", 18)
  .andWhere("status = ?", "active")
  .orWhere("role IN (?)", ["admin", "mod"]);

// ❌ These will throw security errors:
db.where("1=1; DROP TABLE users;"); // Dangerous pattern
db.where("col = (SELECT ...)"); // Complex subqueries blocked
db.where("name = ?", "a".repeat(1001)); // String too long
```

## 🎮 Features

**Cloudflare D1**

- D1 API integration

**Turso**

- HTTP API support

**📊 Performance**

- Prepared statements
- Connection pooling
- Built-in Query caching

**🚔 Security**

- Block dangerous patterns
- Block Complex subqueries
- Block very long string parameters

**🤝 Contributing**

1. Fork the repository
2. Create feature branch (git checkout -b feature/amazing)
3. Commit changes (git commit -am 'Add amazing feature')
4. Push branch (git push origin feature/amazing)
5. Open a Pull Request

## 📝 License

[MIT License](https://choosealicense.com/licenses/mit/) - see LICENSE file

### 🆘 Support

Contributions are always welcome! creates issues and pull requests.
Documentation
GitHub Issues
Discord Community
