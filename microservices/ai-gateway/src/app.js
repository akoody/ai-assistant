import express from 'express';
import { createServiceApp } from '../../../shared/serviceRuntime.js';
import chatRoutes from './routes/chat.js';

// The HTTP application without a port or database connection, so tests can drive it.
export function createApp() {
  return createServiceApp({
    express,
    routes: [['/api/chat', chatRoutes]],
    jsonLimit: '1mb',
  });
}
