export const OPERATIONAL_TIMEZONE = 'Asia/Makassar';

const MONTHS_ID = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

const operationalDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: OPERATIONAL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const operationalDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: OPERATIONAL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function extractDateParts(formatter, date) {
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }
  return parts;
}

export function getOperationalDateString(date = new Date()) {
  const { year, month, day } = extractDateParts(operationalDateFormatter, date);
  return `${year}-${month}-${day}`;
}

export function addDaysToCalendarDate(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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
  const parts = extractDateParts(operationalDateTimeFormatter, date);
  const day = Number(parts.day);
  const month = MONTHS_ID[Number(parts.month) - 1];
  const year = parts.year;
  const hh = parts.hour === '24' ? '00' : parts.hour;
  const mm = parts.minute;
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
