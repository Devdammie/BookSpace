export function classifyDatabaseUrl(url) {
  if (!url) return 'missing';
  if (url.includes('-pooler')) return 'pooled';
  const local = /localhost|127\.0\.0\.1/.test(url);
  if (!local && !url.includes('sslmode=require')) return 'insecure';
  return 'direct';
}

export function canRunRestore(url, confirmed) {
  return classifyDatabaseUrl(url) === 'direct' && confirmed === 'yes';
}
