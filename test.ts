import { db, user, works } from "./db.ts";

// await db.raw(await user.getSql());

// await db.raw(works.toString());
const time = Date.now();
await db.executeJsonQuery({
  action: "insert",
  data: {
    name: "John Doe",
    username: "JohnDoe@" + time,
    age: 10,
  },
  from: "users",
});

const a = await user.query.where("username = ? ", "JohnDoe@" + time).count();
const c = await user.query.count();
console.log({ a, c });
const result = await db.executeJsonQuery({
  action: "getOne",
  where: [{ condition: "username =? ", params: ["JohnDoe@" + time] }],
  from: "users",
});

// console.log({ result, a });
await db.executeJsonQuery({
  action: "insert",
  where: [{ condition: "username = ? ", params: ["JohnDoe"] }],
  data: {
    name: "John Doe's work",
    user: result.id,
  },
  from: "works",
});
const b = await db.executeJsonQuery({
  action: "get",
  where: [{ condition: "name = ? ", params: ["John Doe's work"] }],
  from: "works",
});

// console.log({ b, a });

const gh = await user.query.select("*").getOne();
// console.log(gh);
