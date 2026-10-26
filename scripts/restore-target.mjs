export function classifyDatabaseUrl(url) {
  if (!url) return 'missing';
  if (url.includes('-pooler')) return 'pooled';
  if (!url.includes('sslmode=require')) return 'insecure';
  return 'direct';
}

export function canRunRestore(url, confirmed) {
  return classifyDatabaseUrl(url) === 'direct' && confirmed === 'yes';
}
