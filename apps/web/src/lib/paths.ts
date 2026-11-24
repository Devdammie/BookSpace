export function orgPath(slug: string, path = '') {
  const clean = path.startsWith('/') ? path : path ? `/${path}` : '';
  return `/o/${slug}${clean}`;
}
