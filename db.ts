import { Schema, SqliteBruv } from "./src/index.ts";
// Example usage:

export const user = new Schema<{
  name: string;
  username: string;
  location: string;
  age: number;
  createdAt: Date;
}>({
  name: "users",
  columns: {
    name: { type: "TEXT", required: true },
    username: { type: "TEXT", required: true, unique: true },
    age: { type: "INTEGER", required: true },
    location: {
      type: "TEXT",
      required: true,
      default() {
        return "earth";
      },
    },
    createdAt: {
      type: "DATETIME",
      default() {
        return "CURRENT_TIMESTAMP";
      },
    },
  },
});
export const works = new Schema<{
  name: string;
  user: string;
  createdAt: Date;
}>({
  name: "works",
  columns: {
    name: {
      unique: true,
      type: "TEXT",
      required: true,
    },
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

export const db = new SqliteBruv({
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
