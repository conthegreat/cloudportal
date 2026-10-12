export function parseTime(value) {
  if (!value) return null;
  const text = String(value).trim().replace(/\.(\d{3})\d+((?:Z)|(?:[+-]\d{2}:?\d{2}))?$/, '.$1$2');
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function hoursBetween(earlierIso, laterDate) {
  const earlier = new Date(earlierIso);
  if (Number.isNaN(earlier.getTime())) return Number.POSITIVE_INFINITY;
  return (laterDate.getTime() - earlier.getTime()) / 36e5;
}

export function daysUntil(iso, laterDate) {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return Number.POSITIVE_INFINITY;
  return (target.getTime() - laterDate.getTime()) / 864e5;
}
