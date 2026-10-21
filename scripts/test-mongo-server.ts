/** Starts a throwaway in-memory MongoDB for tests and prints its URI. Ctrl-C to stop. */
import { MongoMemoryServer } from "mongodb-memory-server";

MongoMemoryServer.create({ instance: { port: 27999 } }).then((m) => {
  console.log(`MONGO_READY ${m.getUri()}`);
});
