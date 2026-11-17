// Kunci yang sama dipakai ulang hanya bila isi request persis sama. Ini menjaga
// retry setelah gangguan jaringan tidak menggandakan batch/riwayat di server.
export function resolveIdempotencyKey(
  previous,
  fingerprint,
  createKey = () => globalThis.crypto.randomUUID(),
) {
  if (previous && previous.fingerprint === fingerprint) {
    return { ...previous, reused: true };
  }
  return { fingerprint, key: createKey(), reused: false };
}
