import { Db, MongoClient } from "mongodb";

const DATABASE_NAME = "casino-mini-app";

let client: MongoClient | undefined;
let connection: Promise<MongoClient> | undefined;

function mongoUri(): string {
  const value = process.env.MONGO_URI?.trim();
  if (!value) {
    throw new Error("MONGO_URI is not configured");
  }
  return value;
}

async function connectedClient(): Promise<MongoClient> {
  if (!client) {
    client = new MongoClient(mongoUri(), {
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 30_000,
      serverSelectionTimeoutMS: 5_000,
    });
  }

  if (!connection) {
    connection = client.connect().catch((error: unknown) => {
      connection = undefined;
      client = undefined;
      throw error;
    });
  }

  return connection;
}

/** Reuse the driver's pool across route invocations and hot reloads. */
export async function casinoDatabase(): Promise<Db> {
  const mongo = await connectedClient();
  return mongo.db(DATABASE_NAME);
}

