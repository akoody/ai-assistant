import { MongoClient } from 'mongodb';
import { loadRootEnv } from '../../../../shared/runtimeEnv.js';
import { createMongoConnection } from '../../../../shared/mongoConnection.js';

loadRootEnv(import.meta.url);

export const { getClient, getDatabase, getCollection, closeConnection } = createMongoConnection({
  MongoClient,
  uri: process.env.MONGODB_URI,
  databaseName: process.env.DB_NAME,
});
