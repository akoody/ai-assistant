import express from 'express';
import { createServiceApp } from '../../../shared/serviceRuntime.js';
import toolsRoutes from './routes/tools.js';

// The HTTP application without a port or database connection, so tests can drive it.
export function createApp() {
  return createServiceApp({
    express,
    routes: [['/api/tools', toolsRoutes]],
    jsonLimit: '1mb',
  });
}
