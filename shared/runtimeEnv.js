import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const INSECURE_TEST_API_KEY = 'test-api-key-123';

let loadedEnvPath = null;

function parseEnvLine(line) {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  if (trimmed.startsWith('export ')) {
    trimmed = trimmed.slice(7).trim();
  }

  const equalsIndex = trimmed.indexOf('=');
  if (equalsIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, equalsIndex).trim();
  let value = trimmed.slice(equalsIndex + 1).trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  } else {
    const commentIndex = value.indexOf(' #');
    if (commentIndex >= 0) {
      value = value.slice(0, commentIndex).trim();
    }
  }

  return { key, value };
}

function loadEnvFile(envPath) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }

    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

function findEnvFile(startDir) {
  let currentDir = startDir;
  let nearestEnvPath = null;

  while (currentDir) {
    const envPath = join(currentDir, '.env');
    if (existsSync(envPath)) {
      nearestEnvPath ||= envPath;
      if (existsSync(join(currentDir, 'shared')) && existsSync(join(currentDir, 'microservices'))) {
        return envPath;
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return nearestEnvPath;
}

export function loadRootEnv(importMetaUrl) {
  if (loadedEnvPath) {
    return loadedEnvPath;
  }

  const startDirs = [];
  if (importMetaUrl) {
    startDirs.push(dirname(fileURLToPath(importMetaUrl)));
  }
  if (process.cwd()) {
    startDirs.push(process.cwd());
  }

  for (const startDir of startDirs) {
    const envPath = findEnvFile(startDir);
    if (envPath) {
      loadEnvFile(envPath);
      loadedEnvPath = envPath;
      return loadedEnvPath;
    }
  }

  return null;
}

function normalizeSecret(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function uniqueEnvNames(envName, envNames) {
  return [...new Set([envName, ...envNames, 'INTERNAL_API_KEY'].filter(Boolean))];
}

export function resolveInternalApiKey({
  serviceName,
  settingName,
  configuredValue = null,
  envName = null,
  envNames = [],
}) {
  const candidates = uniqueEnvNames(envName, envNames);
  const envValue = normalizeSecret(
    candidates.map((name) => process.env[name]).find((value) => normalizeSecret(value))
  );
  const configuredSecret = normalizeSecret(configuredValue);
  const resolvedSecret = envValue || configuredSecret;

  if (
    String(process.env.NODE_ENV || '')
      .trim()
      .toLowerCase() !== 'test'
  ) {
    if (!resolvedSecret) {
      throw new Error(
        `[${serviceName}] API key is missing. Set ${candidates.join(' or ')} in the root .env or configure ${settingName} in DB.`
      );
    }

    if (resolvedSecret === INSECURE_TEST_API_KEY) {
      throw new Error(
        `[${serviceName}] API key must not be ${INSECURE_TEST_API_KEY}. Set a unique secret in ${candidates.join(' or ')}.`
      );
    }
  }

  return resolvedSecret || INSECURE_TEST_API_KEY;
}
