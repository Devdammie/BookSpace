export function StatusBadge({ status }: { status: string }) {
  const label = status.replaceAll('_', ' ').toLowerCase();
  return <span className={`badge ${status.toLowerCase()}`}>{label}</span>;
}
