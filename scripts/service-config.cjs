const path = require('node:path');

function parseServices(content, root) {
  const names = new Set();
  const ports = new Set();
  const allowed = new Set(['ai-gateway', 'ai-slots', 'ai-tools', 'ai-planner', 'web-interface']);
  const services = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const match = /^([\w-]+):(\d+)$/.exec(line);
      if (!match) throw new Error(`Invalid service definition: ${line}`);
      const [, name, rawPort] = match;
      const port = Number(rawPort);
      if (!allowed.has(name)) throw new Error(`Unknown service: ${name}`);
      if (port < 1 || port > 65535) throw new Error(`Invalid port for ${name}`);
      if (names.has(name) || ports.has(port)) throw new Error(`Duplicate service or port: ${line}`);
      names.add(name);
      ports.add(port);
      const directory =
        name === 'web-interface' ? path.join(root, name) : path.join(root, 'microservices', name);
      return {
        name,
        port,
        directory,
        entry: name === 'web-interface' ? 'server.js' : 'src/index.js',
      };
    });
  if (!services.length) throw new Error('No services configured');
  return services;
}

module.exports = { parseServices };
