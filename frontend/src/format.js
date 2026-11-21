const MONTHS_ID = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

export function formatRupiah(value) {
  if (value === null || value === undefined || value === '') return 'Rp 0';
  const raw = String(value).trim();
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [intPart = '0', fracPart] = unsigned.split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  const trimmedFrac = fracPart ? fracPart.replace(/0+$/u, '') : '';
  const body = trimmedFrac ? `${formattedInt},${trimmedFrac}` : formattedInt;
  return `${negative ? '-' : ''}Rp ${body}`;
}

export function formatDateId(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(dateStr);
  if (!match) return dateStr;
  const year = match[1];
  const monthIdx = Number(match[2]) - 1;
  const day = Number(match[3]);
  const month = MONTHS_ID[monthIdx];
  if (!month) return dateStr;
  return `${day} ${month} ${year}`;
}

export function formatDateTimeId(isoStr) {
  if (!isoStr) return '—';
  const date = new Date(isoStr);
  if (Number.isNaN(date.valueOf())) return String(isoStr);
  const day = date.getDate();
  const month = MONTHS_ID[date.getMonth()];
  const year = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}

export function getRoleLabel(role) {
  if (role === 'admin') return 'Admin';
  if (role === 'petugas' || role === 'staff') return 'Petugas';
  return role || 'Pengguna';
}

export function getBatchStatusMeta(status) {
  switch (status) {
    case 'LAYAK':
      return { label: 'Layak', tone: 'success' };
    case 'MENDEKATI_KEDALUWARSA':
      return { label: 'Mendekati H-3', tone: 'warning' };
    case 'KEDALUWARSA':
      return { label: 'Kedaluwarsa', tone: 'danger' };
    case 'HABIS':
      return { label: 'Habis', tone: 'muted' };
    default:
      return { label: status || '—', tone: 'muted' };
  }
}
