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
  rating: number;
}>({
  name: "works",
  columns: {
    name: {
      // unique: true,
      type: "TEXT",
      required: true,
    },
    user: {
      type: "TEXT",
      required: true,
      target: "users",
    },
    rating: {
      type: "INTEGER",
      default() {
        return 1;
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

export const db = new SqliteBruv({
  schema: [user, works],
  // QueryMode: true,
  TursoConfig: {
    url: process.env.TURSO_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  },
  // D1Config: {
  //   accountId: process.env.CFAccountId!,
  //   databaseId: process.env.D1databaseId!,
  //   apiKey: process.env.CFauthorizationToken!,
  // },
  // localFile: "sample.sqlite",
  logging: true,
});
