const decimalPattern = /^\d+(?:\.\d+)?$/u;

function isDecimal(value) {
  return typeof value === 'string' && decimalPattern.test(value);
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

// Validate the request body before looking up the item or writing stock.
export function validateReceipt(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { body: 'Isi permintaan harus berupa objek JSON' };
  }

  const { itemId, batchCode, quantity, unitCost, receivedOn, expiresOn } = body;
  const fields = {};

  if (typeof itemId !== 'string' || !/^[a-f\d]{24}$/iu.test(itemId)) {
    fields.itemId = 'Pilih barang yang valid';
  }
  if (typeof batchCode !== 'string' || batchCode.trim() === '') {
    fields.batchCode = 'Kode batch wajib diisi';
  }
  if (!isDecimal(quantity) || !/[1-9]/u.test(quantity)) {
    fields.quantity = 'Jumlah harus lebih dari 0';
  }
  if (!isDecimal(unitCost)) {
    fields.unitCost = 'Harga beli harus berupa angka desimal yang tidak negatif';
  }
  if (!isCalendarDate(receivedOn)) {
    fields.receivedOn = 'Tanggal masuk tidak valid';
  }
  if (!isCalendarDate(expiresOn)) {
    fields.expiresOn = 'Tanggal kedaluwarsa tidak valid';
  } else if (!fields.receivedOn && expiresOn < receivedOn) {
    fields.expiresOn = 'Tanggal kedaluwarsa tidak boleh mendahului tanggal masuk';
  }
  return fields;
}
