import { MongoClient } from 'mongodb';
import { createMongoConnection } from '../../shared/mongoConnection.js';
import { MONGODB_URI, DB_NAME } from './config.js';

export const { getDatabase, closeConnection: closeDatabase } = createMongoConnection({
  MongoClient,
  uri: MONGODB_URI,
  databaseName: DB_NAME,
});
