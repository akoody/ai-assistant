const path = require('node:path');

function shouldArchive(relativePath, outputDirectory = 'dist') {
  const normalized = relativePath.split(path.sep).join('/');
  const parts = normalized.split('/');
  if (
    parts.some((part) =>
      [
        '.git',
        'node_modules',
        '.idea',
        '.vscode',
        '.cache',
        '.turbo',
        'dist',
        'build',
        'out',
        'coverage',
      ].includes(part)
    )
  )
    return false;
  if (normalized === outputDirectory || normalized.startsWith(`${outputDirectory}/`)) return false;
  return !parts.some(
    (part) =>
      (part.startsWith('.env') && part !== '.env.example') ||
      part === '.DS_Store' ||
      /(?:\.log|\.pem|\.key|\.p12|\.pfx|\.zip|\.tgz)$/i.test(part) ||
      /^ssh-key-/.test(part) ||
      /^id_(?:rsa|ed25519|ecdsa)(?:\.|$)/.test(part)
  );
}

module.exports = { shouldArchive };
