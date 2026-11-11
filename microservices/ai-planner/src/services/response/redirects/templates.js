function renderTemplate(template, vars) {
  const base = String(template || '');
  return base.replace(/\{(\w+)\}/g, (_m, key) => String(vars?.[key] ?? ''));
}

export { renderTemplate };
