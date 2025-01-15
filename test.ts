import { Schema, SqliteBruv } from "./src/index";
import { readFileSync } from "node:fs";
// Example usage:

const user = new Schema<{
  name: string;
  username: string;
  age: number;
  createdAt: Date;
}>({
  name: "users",
  columns: {
    name: { type: "TEXT", required: true },
    username: { type: "TEXT", required: true, unique: true },
    age: { type: "INTEGER", required: true },
    createdAt: {
      type: "DATETIME",
      default() {
        return "CURRENT_TIMESTAMP";
      },
    },
  },
});
const works = new Schema<{
  name: string;
  user: string;
  createdAt: Date;
}>({
  name: "works",
  columns: {
    name: { type: "TEXT", required: true },
    user: {
      type: "TEXT",
      required: true,
      target: "users",
    },
    createdAt: {
      type: "DATETIME",
      default() {
        return "CURRENT_TIMESTAMP";
      },
    },
  },
});

const qb = new SqliteBruv({
  schema: [user, works],
  // turso: {
  //   url: process.env.TURSO_URL!,
  //   authToken: process.env.TURSO_AUTH_TOKEN!,
  // },
  // D1: {
  //   accountId: process.env.CFAccountId!,
  //   databaseId: process.env.D1databaseId!,
  //   apiKey: process.env.CFauthorizationToken!,
  // },
  // logging: true,
});
// console.log(user.toString());

// await qb.raw(user.toString());
// await qb.raw(works.toString());
const time = Date.now();
const usero = await qb.executeJsonQuery({
  action: "insert",
  where: [{ condition: "username = ? ", params: ["JohnDoe"] }],
  data: {
    name: "John Doe",
    username: "JohnDoe@" + time,
    age: 10,
  },
  from: "users",
});
console.log({ usero });

const a = (await user.query.where("username = ? ", "JohnDoe@" + time).count())
  .lastInsertRowid;
const result = await qb.executeJsonQuery({
  action: "getOne",
  where: [{ condition: "username =? ", params: ["JohnDoe@" + time] }],
  from: "users",
});

console.log({ result, a });
await qb.executeJsonQuery({
  action: "insert",
  where: [{ condition: "username = ? ", params: ["JohnDoe"] }],
  data: {
    name: "John Doe's work",
    user: result.id,
  },
  from: "works",
});

const gh = await user.query.select("*").getOne();
gh.name;
