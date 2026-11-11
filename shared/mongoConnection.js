export function createMongoConnection({ MongoClient, uri, databaseName }) {
  let clientPromise = null;
  let closingPromise = null;

  async function getClient() {
    if (closingPromise) await closingPromise;
    if (!clientPromise) {
      if (!uri || !databaseName) throw new Error('MONGODB_URI and DB_NAME are required');
      const client = new MongoClient(uri);
      const pending = client
        .connect()
        .then(() => client)
        .catch(async (error) => {
          if (clientPromise === pending) clientPromise = null;
          await client.close().catch(() => {});
          throw error;
        });
      clientPromise = pending;
    }
    return clientPromise;
  }

  async function getDatabase() {
    return (await getClient()).db(databaseName);
  }

  async function getCollection(name) {
    return (await getDatabase()).collection(name);
  }

  async function closeConnection() {
    if (closingPromise) return closingPromise;
    const pending = clientPromise;
    if (!pending) return;
    closingPromise = (async () => {
      const client = await pending.catch(() => null);
      if (client) await client.close();
    })();
    try {
      await closingPromise;
    } finally {
      if (clientPromise === pending) clientPromise = null;
      closingPromise = null;
    }
  }

  return { getClient, getDatabase, getCollection, closeConnection };
}
