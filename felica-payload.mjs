const MAGIC = [0x4d, 0x45, 0x50, 0x31]; // MEP1
const MAX_PAYLOAD_BYTES = 96;

const GROUPS = [
  ["便区分", 1, encodeStool],
  ["視力", 2, encodeVision],
  ["X線", 3, encodeXray],
  ["食後", 4, encodeFasting],
  ["尿", 5, encodeUrine],
  ["血圧", 6, encodeBloodPressure],
  ["脈", 7, encodePulse],
  ["身体", 8, encodeBody],
  ["聴力", 9, encodeHearing],
  ["採血", 10, () => [1]],
  ["診察", 11, encodeDiagnosis]
];

const URINE_VALUES = ["", "－", "±", "＋", "＋＋", "＋＋＋"];
const FINDING_VALUES = ["", "放置可", "要観察", "要受診"];

export function encodeFelicaExamPayload({ groupId = "", patientCode = "", groupValues = [] }) {
  const confirmed = new Map(
    groupValues
      .filter((item) => item?.verificationStatus === "confirmed")
      .map((item) => [item.groupKey, item])
  );
  const bytes = [...MAGIC, 1];
  pushU32(bytes, fnv1a(`${groupId}::${patientCode}`));
  const latestTime = Math.max(0, ...Array.from(confirmed.values()).map((item) => Date.parse(item.confirmedAt || item.updatedAt || "") || 0));
  pushU32(bytes, Math.floor(latestTime / 60000));
  let bitmap = 0;
  GROUPS.forEach(([key], index) => {
    if (confirmed.has(key)) bitmap |= (1 << index);
  });
  pushU16(bytes, bitmap);
  for (const [key, id, encoder] of GROUPS) {
    const item = confirmed.get(key);
    if (!item) continue;
    const data = encoder(item.values || {});
    bytes.push(id, data.length, ...data);
  }
  if (bytes.length > MAX_PAYLOAD_BYTES) throw new Error(`FeliCa用データが${MAX_PAYLOAD_BYTES}バイトを超えました。`);
  return Uint8Array.from(bytes);
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function inspectFelicaExamPayload(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (data.length < 15 || !MAGIC.every((value, index) => data[index] === value)) throw new Error("カード用健診データの形式が不正です。");
  const groups = [];
  for (let offset = 15; offset < data.length;) {
    const id = data[offset++];
    const length = data[offset++];
    if (offset + length > data.length) throw new Error("カード用健診データが途中で切れています。");
    groups.push({ id, bytes: Array.from(data.slice(offset, offset + length)) });
    offset += length;
  }
  return {
    version: data[4],
    patientHash: readU32(data, 5),
    updatedMinute: readU32(data, 9),
    confirmedBitmap: data[13] | (data[14] << 8),
    groups
  };
}

function encodeStool(values) {
  return [enumCode(values["便区分"], ["", "1回", "2回"])];
}

function encodeVision(values) {
  return ["視力右裸眼", "視力右矯正", "視力左裸眼", "視力左矯正"].map((key) => scaledU8(values[key], 10));
}

function encodeXray(values) {
  const result = [];
  pushU16(result, numericU16(values["胸部X線フィルム番号"]));
  pushU16(result, numericU16(values["胃部X線フィルム番号"]));
  result.push((values["塵肺"] ? 1 : 0) | (values["アスベスト"] ? 2 : 0));
  return result;
}

function encodeFasting(values) {
  const hours = values["空腹時間（時）"] === "空腹" ? 254 : scaledU8(values["空腹時間（時）"], 1);
  return [hours, scaledU8(values["空腹時間（分）"], 1)];
}

function encodeUrine(values) {
  const keys = ["尿蛋白定性", "尿糖定性", "尿潜血", "尿ウロビリノーゲン定性", "ケトン体（アセトン体）"];
  return [...keys.map((key) => enumCode(values[key], URINE_VALUES)), scaledU8(values["尿PH"], 10)];
}

function encodeBloodPressure(values) {
  const result = [];
  ["1回目最高血圧", "1回目最低血圧", "2回目最高血圧", "2回目最低血圧"].forEach((key) => pushU16(result, numericU16(values[key])));
  return result;
}

function encodePulse(values) {
  const result = [];
  pushU16(result, numericU16(values["脈拍"]));
  return result;
}

function encodeBody(values) {
  const result = [];
  ["身長", "体重", "腹囲"].forEach((key) => pushU16(result, scaledU16(values[key], 10)));
  return result;
}

function encodeHearing(values) {
  const keys = ["聴力(右)1000Hz", "聴力(左)1000Hz", "聴力(右)4000Hz", "聴力(左)4000Hz"];
  return [keys.reduce((packed, key, index) => packed | (enumCode(values[key], ["", "所見なし", "所見あり"]) << (index * 2)), 0)];
}

function encodeDiagnosis(values) {
  const keys = ["巡回診察", "結膜貧血", "甲状腺腫大", "心雑音", "脈の異常", "呼吸音異常", "その他"];
  let packed = enumCode(values["巡回診察"], ["", "所見なし", "異常所見あり"]);
  keys.slice(1).forEach((key, index) => {
    packed |= enumCode(values[key], FINDING_VALUES) << ((index + 1) * 2);
  });
  return [packed & 0xff, (packed >>> 8) & 0xff];
}

function enumCode(value, options) {
  const index = options.indexOf(String(value || ""));
  return index < 0 ? 0 : index;
}

function scaledU8(value, scale) {
  if (value === "" || value === null || value === undefined || !Number.isFinite(Number(value))) return 255;
  return Math.max(0, Math.min(253, Math.round(Number(value) * scale)));
}

function numericU16(value) {
  return scaledU16(value, 1);
}

function scaledU16(value, scale) {
  if (value === "" || value === null || value === undefined || !Number.isFinite(Number(value))) return 0xffff;
  return Math.max(0, Math.min(0xfffe, Math.round(Number(value) * scale)));
}

function pushU16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushU32(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function readU32(data, offset) {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
