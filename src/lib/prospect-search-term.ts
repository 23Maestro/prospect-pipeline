export function normalizeProspectSearchTerm(term: string): string {
  const trimmed = String(term || '').trim();
  if (!trimmed) return '';

  const digits = trimmed.replace(/\D/g, '');
  const normalizedDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (normalizedDigits.length !== 10) {
    return trimmed;
  }

  return `(${normalizedDigits.slice(0, 3)}) ${normalizedDigits.slice(3, 6)}-${normalizedDigits.slice(6)}`;
}
