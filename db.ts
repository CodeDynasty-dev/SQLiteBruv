import { SqliteBruv } from "./src/index.ts";

// Schema is auto-loaded from ./bruv/schema.prisma
export const db = new SqliteBruv({
  localFile: "sample.sqlite",
  logging: true,
});
 

// Insert
await db
  .from("users")
  .insert({ name: "John Doe", email: "john@example.com" })
  .then((changes) => {
    console.log({ changes });
  });

// Update
await db
  .from("users")
  .where("id = ?", 1)
  .update({ name: "Jane Doe" })
  .then((changes) => {
    console.log({ changes });
  });

// Search
await db
  .from("users")
  .where("id = ?", 1)
  .andWhere("name LIKE ?", `%oh%`)
  .get()
  .then((changes) => {
    console.log({ changes });
  });

// Delete
await db
  .from("users")
  .where("id = ?", 1)
  .delete()
  .then((changes) => {
    console.log({ changes });
  });

// Get all users
db
  .from("users")
  .get()
  .then((changes) => {
    console.log({ changes });
  });

// Get one user
await db
  .from("users")
  .where("id = ?", 1)
  .getOne()
  .then((changes) => {
    console.log({ changes });
  });

// Select specific columns
await db
  .from("users")
  .select("id", "name")
  .get()
  .then((changes) => {
    console.log({ changes });
  });

// Where conditions
await db
  .from("users")
  .where("age > ?", 18)
  .get()
  .then((changes) => {
    console.log({ changes });
  });

// AndWhere conditions
await db
  .from("users")
  .where("age > ?", 18)
  .andWhere("country = ?", "USA")
  .get()
  .then((changes) => {
    console.log({ changes });
  });

// OrWhere conditions
await db
  .from("users")
  .where("age > ?", 18)
  .orWhere("country = ?", "Canada")
  .get()
  .then((changes) => {
    console.log({ changes });
  });

// Limit and Offset
await db
  .from("users")
  .limit(10)
  .offset(5)
  .get()
  .then((changes) => {
    console.log({ changes });
  });

// OrderBy
await db
  .from("users")
  .orderBy("name", "ASC")
  .get()
  .then((changes) => {
    console.log({ changes });
  });

await db
  .from("users")
  .orderBy("name", "ASC")
  .get()
  .then((changes) => {
    console.log({ changes });
  });