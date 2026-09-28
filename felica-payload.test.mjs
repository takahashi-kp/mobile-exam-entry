import assert from "node:assert/strict";
import test from "node:test";
import { bytesToHex, encodeFelicaExamPayload, inspectFelicaExamPayload } from "./felica-payload.mjs";

test("confirmed exam groups fit into one FeliCa payload", () => {
  const confirmed = (groupKey, values) => ({ groupKey, values, verificationStatus: "confirmed", confirmedAt: "2026-09-28T01:02:00.000Z" });
  const payload = encodeFelicaExamPayload({
    groupId: "visit-1",
    patientCode: "2026071501",
    groupValues: [
      confirmed("便区分", { "便区分": "2回" }),
      confirmed("視力", { "視力右裸眼": "1.2", "視力右矯正": "1.5", "視力左裸眼": "0.8", "視力左矯正": "2.0" }),
      confirmed("X線", { "胸部X線フィルム番号": "12345", "胃部X線フィルム番号": "54321", "塵肺": "該当" }),
      confirmed("食後", { "空腹時間（時）": "空腹", "空腹時間（分）": "" }),
      confirmed("尿", { "尿蛋白定性": "－", "尿糖定性": "±", "尿潜血": "＋", "尿ウロビリノーゲン定性": "＋＋", "ケトン体（アセトン体）": "＋＋＋", "尿PH": "6.5" }),
      confirmed("血圧", { "1回目最高血圧": "120", "1回目最低血圧": "80", "2回目最高血圧": "118", "2回目最低血圧": "78" }),
      confirmed("脈", { "脈拍": "72" }),
      confirmed("身体", { "身長": "170.1", "体重": "65.2", "腹囲": "82.3" }),
      confirmed("聴力", { "聴力(右)1000Hz": "所見なし", "聴力(左)1000Hz": "所見あり", "聴力(右)4000Hz": "所見なし", "聴力(左)4000Hz": "所見あり" }),
      confirmed("採血", { "採血確認": "済" }),
      confirmed("診察", { "巡回診察": "異常所見あり", "結膜貧血": "要観察", "甲状腺腫大": "放置可", "その他": "要受診" })
    ]
  });
  const decoded = inspectFelicaExamPayload(payload);
  assert.ok(payload.length <= 96);
  assert.equal(payload.length, 75);
  assert.equal(decoded.groups.length, 11);
  assert.equal(decoded.confirmedBitmap, 0x7ff);
  assert.match(bytesToHex(payload), /^[0-9A-F]+$/);
});

test("draft groups are not written to the card", () => {
  const payload = encodeFelicaExamPayload({
    groupId: "visit-1",
    patientCode: "1",
    groupValues: [{ groupKey: "身体", verificationStatus: "draft", values: { "身長": "170.0" } }]
  });
  const decoded = inspectFelicaExamPayload(payload);
  assert.equal(decoded.confirmedBitmap, 0);
  assert.deepEqual(decoded.groups, []);
});
