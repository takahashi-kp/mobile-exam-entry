import { ageOnDate, evaluateGuidanceAge, formatJapaneseDate } from "./guidance.js?v=20260713-01";

const DB_NAME = "mobile-exam-entry";
const DEFAULT_CLOUD_URL = "https://mobile-exam-entry-b6w9-z574.onrender.com/api/exam-records";
const STORE = "records";
const SETTINGS = "settings";
const SCHEDULE_GROUPS = "scheduleGroups";
const SCHEDULE_PATIENTS = "schedulePatients";
const EXAM_GROUP_VALUES = "examGroupValues";
const PROGRESS_SUMMARIES = "progressSummaries";
const QUESTIONNAIRE_RESPONSES = "questionnaireResponses";

const URINE_TESTS = [
  { name: "尿蛋白定性", options: ["－", "±", "＋", "＋＋", "＋＋＋"] },
  { name: "尿糖定性", options: ["－", "±", "＋", "＋＋", "＋＋＋"] },
  { name: "尿潜血", options: ["－", "±", "＋", "＋＋", "＋＋＋"] },
  { name: "尿ウロビリノーゲン定性", options: ["±", "＋", "＋＋", "＋＋＋"] },
  { name: "ケトン体（アセトン体）", options: ["－", "±", "＋", "＋＋", "＋＋＋"] }
];
const FINDING_OPTIONS = ["放置可", "要観察", "要受診"];
const FINDING_FIELDS = ["結膜貧血", "甲状腺腫大", "心雑音", "脈の異常", "呼吸音異常", "その他"];
const DISEASE_STATUS_OPTIONS = ["治療中（服薬あり）", "治療中（服薬なし）", "経過観察中", "手術", "治癒"];
const DISEASE_ITEMS = [
  "高血圧",
  "糖尿病",
  "高脂血症・脂質異常症",
  "脳出血",
  "脳梗塞",
  "他 脳神経疾患",
  "狭心症・心筋梗塞",
  "不整脈",
  "他 心臓病",
  "貧血",
  "甲状腺疾患",
  "乳腺疾患",
  "結核・胸膜炎",
  "気管支喘息",
  "他 呼吸器疾患",
  "胃・十二指腸潰瘍",
  "胃ポリープ",
  "大腸ポリープ",
  "他 胃腸疾患",
  "B型肝炎・C型肝炎",
  "脂肪肝",
  "胆嚢ポリープ",
  "他 肝・胆疾患",
  "膵臓疾患",
  "慢性腎臓病・腎不全",
  "痛風・高尿酸血症",
  "他 腎臓疾患",
  "前立腺肥大",
  "他 泌尿器科疾患",
  "婦人科疾患",
  "眼科疾患",
  "耳鼻科疾患",
  "骨粗鬆症",
  "整形外科疾患",
  "皮膚疾患",
  "その他"
];
const DISEASE_TEXT_ITEMS = new Set([
  "他 脳神経疾患",
  "他 心臓病",
  "甲状腺疾患",
  "乳腺疾患",
  "他 呼吸器疾患",
  "他 胃腸疾患",
  "他 肝・胆疾患",
  "膵臓疾患",
  "他 腎臓疾患",
  "他 泌尿器科疾患",
  "婦人科疾患",
  "眼科疾患",
  "耳鼻科疾患",
  "整形外科疾患",
  "皮膚疾患",
  "その他"
]);
const YES_NO_OPTIONS = ["はい", "いいえ"];
const QUESTIONNAIRE_SECTIONS = [
  {
    title: "問診票",
    groups: [
      {
        title: "病気について",
        note: "該当する状態を選択してください。病名欄がある項目は必要に応じて入力します。",
        items: DISEASE_ITEMS.map((label) => ({
          id: `問診_病気_${label}`,
          label,
          type: DISEASE_TEXT_ITEMS.has(label) ? "multiCheckText" : "multiCheck",
          options: DISEASE_STATUS_OPTIONS,
          textLabel: "病名"
        }))
      },
      {
        title: "お薬の使用について",
        note: "あてはまる項目を選択し、薬剤名などが分かる場合は入力します。",
        items: [
          { id: "問診_薬_血液サラサラ", label: "血をサラサラにする薬", type: "checkText", textLabel: "薬剤名" },
          { id: "問診_薬_胃腸薬", label: "胃腸薬", type: "checkText", textLabel: "薬剤名" },
          { id: "問診_薬_その他", label: "その他", type: "checkText", textLabel: "内容" }
        ]
      },
      {
        title: "自覚症状について",
        items: [
          ...["頭痛", "めまい", "耳鳴り", "不安", "不眠", "体がだるい", "手のしびれ", "足のしびれ", "むくみ", "胸痛", "咳", "動悸", "息切れ", "腹痛", "下痢", "頻尿", "腰痛・関節痛"].map((label) => ({ id: `問診_症状_${label}`, label, type: "checkbox" })),
          { id: "問診_症状_その他", label: "その他", type: "checkText", textLabel: "内容" }
        ]
      },
      {
        title: "運転に関わる症状について",
        items: [
          { id: "問診_運転_意識消失", label: "意識を失ったことがある", type: "checkbox" },
          { id: "問診_運転_一時麻痺", label: "身体の全部または一部が一時的に思い通りに動かせなくなったことがある", type: "checkbox" },
          { id: "問診_運転_日中眠気", label: "十分な睡眠時間をとっていても、日中活動中に眠り込んでしまったことがある", type: "checkbox" }
        ]
      },
      {
        title: "検査について",
        items: [
          ...["ペースメーカー、ICD（埋め込み型除細動器）を装着している", "動脈瘤、下肢に深部静脈血栓症がある", "インスリンポンプ、持続グルコース測定器を装着している", "V-Pシャント、CVポートを留置している", "体内金属（ボルト、人工関節、インプラント）が入っている", "人工透析をしている", "乳がんの手術をした"].map((label) => ({ id: `問診_検査_${label}`, label, type: "checkbox" }))
        ]
      },
      {
        title: "女性の方へ",
        items: [
          { id: "問診_女性_月経状況", label: "月経の状況", type: "select", options: ["月経中", "順調", "不順あり", "不正出血あり", "閉経した", "無月経"] },
          { id: "問診_女性_妊娠可能性", label: "妊娠の可能性", type: "selectText", options: ["可能性なし", "可能性あり", "妊娠中"], textLabel: "妊娠週数" }
        ]
      },
      {
        title: "個人情報の取扱いについて",
        note: "健康診断の目的等を理解した上で、実施主体が指定する者及び健診機関が保健事業、健診精度管理等の目的の範囲内で個人情報を使用することに同意します。",
        items: [
          { id: "問診_同意", label: "個人情報の取扱いに同意する", type: "checkbox" },
          { id: "問診_署名", label: "署名", type: "text" }
        ]
      }
    ]
  },
  {
    title: "特定健康診査質問票",
    groups: [
      {
        title: "服薬・既往歴",
        items: [
          { id: "特定_01_血圧薬", label: "現在、血圧を下げる薬を使用していますか。", type: "radio", options: YES_NO_OPTIONS },
          { id: "特定_02_血糖薬", label: "現在、血糖を下げる薬又はインスリン注射を使用していますか。", type: "radio", options: YES_NO_OPTIONS },
          { id: "特定_03_脂質薬", label: "現在、コレステロールや中性脂肪を下げる薬を使用していますか。", type: "radio", options: YES_NO_OPTIONS },
          { id: "特定_04_脳卒中", label: "医師から、脳卒中にかかっているといわれたり、治療を受けたことがありますか。", type: "radio", options: YES_NO_OPTIONS },
          { id: "特定_05_心臓病", label: "医師から、心臓病にかかっているといわれたり、治療を受けたことがありますか。", type: "radio", options: YES_NO_OPTIONS },
          { id: "特定_06_腎臓病", label: "医師から、慢性腎臓病や腎不全にかかっているといわれたり、治療を受けていますか。", type: "radio", options: YES_NO_OPTIONS },
          { id: "特定_07_貧血", label: "医師から、貧血といわれたことがありますか。", type: "radio", options: YES_NO_OPTIONS }
        ]
      },
      {
        title: "喫煙・運動",
        items: [
          { id: "特定_08_喫煙", label: "現在、たばこを習慣的に吸っていますか。", type: "radioText", options: ["はい", "以前は吸っていたが最近1か月間は吸っていない", "いいえ"], textLabel: "1日 本数・年数" },
          { id: "特定_09_体重増加", label: "20歳の時の体重から10kg以上増加していますか。", type: "radio", options: YES_NO_OPTIONS },
          { id: "特定_10_運動習慣", label: "1回30分以上の軽い汗をかく運動を週2日以上、1年以上実施している。", type: "radio", options: YES_NO_OPTIONS },
          { id: "特定_11_身体活動", label: "日常生活で歩行又は同等の身体活動を1日1時間以上実施している。", type: "radio", options: YES_NO_OPTIONS },
          { id: "特定_12_歩行速度", label: "ほぼ同じ年齢の同性と比較して歩く速度が速い。", type: "radio", options: YES_NO_OPTIONS }
        ]
      },
      {
        title: "食事・飲酒・睡眠",
        items: [
          { id: "特定_13_咀嚼", label: "食事をかんで食べる時の状態はどれにあてはまりますか。", type: "radio", options: ["何でもかんで食べることができる", "かみにくいことがある", "ほとんどかめない"] },
          { id: "特定_14_食速度", label: "人と比較して食べる速度が速い。", type: "radio", options: ["速い", "普通", "遅い"] },
          { id: "特定_15_就寝前夕食", label: "就寝前の2時間以内に夕食をとることが週に3回以上ある。", type: "radio", options: YES_NO_OPTIONS },
          { id: "特定_16_間食", label: "朝昼夕の3食以外に間食や甘い飲み物を摂取していますか。", type: "radio", options: ["毎日", "時々", "ほとんど摂取しない"] },
          { id: "特定_17_朝食欠食", label: "朝食を抜くことが週に3回以上ある。", type: "radio", options: YES_NO_OPTIONS },
          { id: "特定_18_飲酒頻度", label: "お酒を飲む頻度はどのくらいですか。", type: "radio", options: ["毎日", "週5〜6日", "週3〜4日", "週1〜2日", "月に1〜3日", "月に1日未満", "やめた", "飲まない（飲めない）"] },
          { id: "特定_19_飲酒量", label: "飲酒日の1日当たりの飲酒量は。", type: "radio", options: ["1合未満", "1〜2合未満", "2〜3合未満", "3〜5合未満", "5合以上"] },
          { id: "特定_20_睡眠", label: "睡眠で休養が十分とれている。", type: "radio", options: YES_NO_OPTIONS }
        ]
      },
      {
        title: "生活習慣改善",
        items: [
          { id: "特定_21_生活改善", label: "運動や食生活等の生活習慣を改善してみようと思いますか。", type: "radio", options: ["改善するつもりはない", "改善するつもりである（概ね6ヶ月以内）", "近いうちに改善するつもりであり、少しずつ始めている", "既に改善に取り組んでいる（6ヶ月未満）", "既に改善に取り組んでいる（6ヶ月以上）"] },
          { id: "特定_22_保健指導", label: "生活習慣の改善について、これまでに特定保健指導を受けたことがありますか。", type: "radio", options: YES_NO_OPTIONS }
        ]
      }
    ]
  }
];
const PROGRESS_GROUPS = [
  { label: "便区分", target: "便区分", fields: ["便区分", "便区分_自由入力"] },
  { label: "視力", target: "視力", fields: ["視力右裸眼", "視力右矯正", "視力左裸眼", "視力左矯正", "視力_自由入力"] },
  { label: "X線", target: "X線", fields: ["胸部X線フィルム番号", "胃部X線フィルム番号", "塵肺・アスベスト", "X線_自由入力"] },
  { label: "食後", target: "食後", fields: ["空腹時間（時）", "空腹時間（分）", "食後時間_自由入力"] },
  { label: "尿", target: "尿", fields: ["尿蛋白定性", "尿糖定性", "尿潜血", "尿ウロビリノーゲン定性", "ケトン体（アセトン体）", "尿PH", "尿検査_自由入力"] },
  { label: "血圧", target: "血圧", fields: ["1回目最高血圧", "1回目最低血圧", "2回目最高血圧", "2回目最低血圧", "血圧_自由入力"] },
  { label: "脈", target: "脈", fields: ["脈拍", "脈_自由入力"] },
  { label: "身体", target: "身体", fields: ["身長", "体重", "腹囲", "身体計測_自由入力"] },
  { label: "聴力", target: "聴力", fields: ["聴力(右)1000Hz", "聴力(左)1000Hz", "聴力(右)4000Hz", "聴力(左)4000Hz", "聴力_自由入力"] },
  { label: "診察", target: "診察", fields: ["巡回診察", "結膜貧血", "甲状腺腫大", "心雑音", "脈の異常", "呼吸音異常", "その他", "その他_自由入力", "巡回診察_自由入力"] }
];

const form = document.querySelector("#examForm");
const questionnaireForm = document.querySelector("#questionnaireForm");
const questionnaireRoot = document.querySelector("#questionnaireRoot");
const urineGrid = document.querySelector("#urineGrid");
const findingGrid = document.querySelector("#findingGrid");
const statusEl = document.querySelector("#connectionStatus");
const recordRows = document.querySelector("#recordRows");
const scheduleRows = document.querySelector("#scheduleRows");
const searchRecords = document.querySelector("#searchRecords");
const syncMessage = document.querySelector("#syncMessage");
const cleanupSummary = document.querySelector("#cleanupSummary");
const guidanceFields = {
  year: document.querySelector("#guidanceYear"),
  sex: document.querySelector("#guidanceSex"),
  insurance: document.querySelector("#guidanceInsurance"),
  birthDate: document.querySelector("#guidanceBirthDate"),
  examDate: document.querySelector("#guidanceExamDate"),
  hba1c: document.querySelector("#guidanceHba1c"),
  mealTime: document.querySelector("#guidanceMealTime"),
  medication: document.querySelector("#guidanceMedication"),
  height: document.querySelector("#guidanceHeight"),
  weight: document.querySelector("#guidanceWeight"),
  waist: document.querySelector("#guidanceWaist")
};
const guidanceResult = document.querySelector("#guidanceResult");
const guidanceSummary = document.querySelector("#guidanceSummary");
const guidanceChecks = document.querySelector("#guidanceChecks");
const patientSummary = document.querySelector("#patientSummary");
const activeGroupLabel = document.querySelector("#activeGroupLabel");
let editingId = null;
let activeGroup = null;
let db;
let isDirty = false;
let isProgrammaticChange = false;
let personalValueBeforeEdit = "";
let syncInProgress = false;
let pullInProgress = false;
let lastAutomaticRefreshAt = 0;
const questionnaireChoiceState = new WeakMap();

init();

async function init() {
  document.body.dataset.view = "entry";
  db = await openDb();
  renderUrineControls();
  renderFindingControls();
  renderQuestionnaireControls();
  setupCollapsibleGroups();
  bindUi();
  await loadSettings();
  await prepareSyncSchemaV2();
  if (navigator.onLine) await syncAndRefresh({ force: true });
  await loadActiveGroup();
  await refreshScheduleRows();
  await refreshRows();
  updateOnlineStatus();
  window.addEventListener("online", () => {
    updateOnlineStatus();
    syncAndRefresh({ force: true }).catch(() => {});
  });
  window.addEventListener("offline", updateOnlineStatus);
  window.addEventListener("focus", () => syncAndRefresh().catch(() => {}));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncAndRefresh().catch(() => {});
  });
  window.setInterval(() => syncAndRefresh().catch(() => {}), 30000);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 5);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("syncState", "syncState");
      }
      if (!database.objectStoreNames.contains(SETTINGS)) {
        database.createObjectStore(SETTINGS, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(SCHEDULE_GROUPS)) {
        database.createObjectStore(SCHEDULE_GROUPS, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(SCHEDULE_PATIENTS)) {
        const patients = database.createObjectStore(SCHEDULE_PATIENTS, { keyPath: "id" });
        patients.createIndex("groupId", "groupId");
      }
      if (!database.objectStoreNames.contains(EXAM_GROUP_VALUES)) {
        const values = database.createObjectStore(EXAM_GROUP_VALUES, { keyPath: "id" });
        values.createIndex("recordId", "recordId");
        values.createIndex("patientKey", "patientKey");
      }
      if (!database.objectStoreNames.contains(PROGRESS_SUMMARIES)) {
        database.createObjectStore(PROGRESS_SUMMARIES, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(QUESTIONNAIRE_RESPONSES)) {
        const questionnaires = database.createObjectStore(QUESTIONNAIRE_RESPONSES, { keyPath: "id" });
        questionnaires.createIndex("patientKey", "patientKey");
        questionnaires.createIndex("syncState", "syncState");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function put(storeName, value) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, "readwrite").put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getOne(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteOne(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, "readwrite").delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function renderUrineControls() {
  URINE_TESTS.forEach(({ name, options }) => {
    urineGrid.appendChild(makeCheckGroup(name, options, "urine-row"));
  });
  const ph = document.createElement("label");
  ph.className = "short-input";
  ph.innerHTML = `<span>尿PH</span><input name="尿PH" maxlength="1" inputmode="decimal">`;
  urineGrid.appendChild(ph);
}

function renderFindingControls() {
  FINDING_FIELDS.forEach((field) => {
    const group = makeCheckGroup(field, FINDING_OPTIONS, "finding-row");
    if (field === "その他") {
      group.classList.add("other-finding");
      const input = document.createElement("input");
      input.name = "その他_自由入力";
      input.placeholder = "その他の内容";
      group.appendChild(input);
    }
    findingGrid.appendChild(group);
  });
}

function renderQuestionnaireControls() {
  if (!questionnaireRoot) return;
  questionnaireRoot.innerHTML = "";
  QUESTIONNAIRE_SECTIONS.forEach((section) => {
    const sectionEl = document.createElement("section");
    sectionEl.className = "questionnaire-section";
    sectionEl.innerHTML = `<h2>${escapeHtml(section.title)}</h2>`;
    section.groups.forEach((group) => {
      const groupEl = document.createElement("div");
      groupEl.className = "questionnaire-group section-block collapsible-group";
      groupEl.dataset.group = `問診_${group.title}`;
      groupEl.innerHTML = `
        <h2>${escapeHtml(group.title)}</h2>
        ${group.note ? `<p class="questionnaire-note">${escapeHtml(group.note)}</p>` : ""}
      `;
      group.items.forEach((item) => groupEl.appendChild(renderQuestionnaireItem(item)));
      sectionEl.appendChild(groupEl);
    });
    questionnaireRoot.appendChild(sectionEl);
  });
}

function renderQuestionnaireItem(item) {
  const row = document.createElement("div");
  row.className = `question-row question-${item.type}`;
  const title = document.createElement("div");
  title.className = "question-title";
  title.textContent = item.label;
  row.appendChild(title);
  const controls = document.createElement("div");
  controls.className = "question-controls";
  if (item.type === "checkbox") {
    controls.appendChild(makeQuestionChoice(item.id, "該当", "checkbox"));
  } else if (item.type === "checkText") {
    controls.appendChild(makeQuestionChoice(item.id, "該当", "checkbox"));
    controls.appendChild(makeQuestionText(`${item.id}_text`, item.textLabel || "内容"));
  } else if (item.type === "text") {
    controls.appendChild(makeQuestionText(item.id, item.label));
  } else if (item.type === "select" || item.type === "selectText") {
    controls.appendChild(makeQuestionSelect(item.id, item.options || []));
    if (item.type === "selectText") controls.appendChild(makeQuestionText(`${item.id}_text`, item.textLabel || "内容"));
  } else if (item.type === "multiCheck" || item.type === "multiCheckText") {
    (item.options || []).forEach((option) => controls.appendChild(makeQuestionChoice(item.id, option, "checkbox")));
    if (item.type === "multiCheckText") controls.appendChild(makeQuestionText(`${item.id}_text`, item.textLabel || "内容"));
  } else if (item.type === "radio" || item.type === "radioText") {
    (item.options || []).forEach((option) => controls.appendChild(makeQuestionChoice(item.id, option, "radio")));
    if (item.type === "radioText") controls.appendChild(makeQuestionText(`${item.id}_text`, item.textLabel || "補足"));
  }
  row.appendChild(controls);
  return row;
}

function makeQuestionChoice(name, value, type) {
  const label = document.createElement("label");
  label.className = "choice question-choice";
  label.innerHTML = `<input type="${type}" name="${escapeAttribute(name)}" value="${escapeAttribute(value)}">${escapeHtml(value)}`;
  return label;
}

function makeQuestionSelect(name, options) {
  const select = document.createElement("select");
  select.name = name;
  select.innerHTML = `<option value=""></option>${options.map((option) => `<option value="${escapeAttribute(option)}">${escapeHtml(option)}</option>`).join("")}`;
  return select;
}

function makeQuestionText(name, placeholder) {
  const input = document.createElement("input");
  input.name = name;
  input.placeholder = placeholder;
  return input;
}

function makeCheckGroup(name, options, className) {
  const row = document.createElement("div");
  row.className = className;
  const title = document.createElement("span");
  title.className = "field-title";
  title.textContent = name;
  row.appendChild(title);
  options.forEach((option) => {
    const label = document.createElement("label");
    label.className = "choice";
    label.innerHTML = `<input type="checkbox" name="${escapeAttribute(name)}" value="${escapeAttribute(option)}" data-exclusive>${escapeHtml(option)}`;
    row.appendChild(label);
  });
  return row;
}

function bindUi() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  form.addEventListener("change", handleExclusiveCheckboxes);
  form.addEventListener("input", markDirtyFromEvent);
  form.addEventListener("change", markDirtyFromEvent);
  questionnaireForm?.addEventListener("input", markDirtyFromEvent);
  questionnaireForm?.addEventListener("change", markDirtyFromEvent);
  questionnaireForm?.addEventListener("pointerdown", rememberQuestionnaireChoiceState, true);
  questionnaireForm?.addEventListener("click", toggleQuestionnaireChoice, true);
  document.addEventListener("input", markDirtyFromEvent);
  document.addEventListener("change", markDirtyFromEvent);
  document.querySelector("#saveRecord").addEventListener("click", saveCurrentRecord);
  document.querySelector("#saveQuestionnaire")?.addEventListener("click", saveQuestionnaireRecord);
  document.querySelector("#newRecord").addEventListener("click", async () => {
    if (await confirmSaveBeforeLeaving()) {
      startNewWalkInRecord();
    }
  });
  document.querySelector("#exportCsv").addEventListener("click", exportCsv);
  document.querySelector("#openAllGroups").addEventListener("click", () => setAllGroupsCollapsed(false));
  document.querySelector("#closeAllGroups").addEventListener("click", () => setAllGroupsCollapsed(true));
  document.querySelector("#scheduleCsv").addEventListener("change", importScheduleCsv);
  document.querySelector("#pullSchedules")?.addEventListener("click", () => pullCloud({ schedulesOnly: true }));
  document.querySelector("#syncNow").addEventListener("click", syncPending);
  document.querySelector("#saveSettings").addEventListener("click", saveSettings);
  document.querySelector("#pullCloud").addEventListener("click", pullCloud);
  document.querySelector("#deleteSyncedLocal").addEventListener("click", deleteSyncedLocalData);
  Object.values(guidanceFields).forEach((field) => field?.addEventListener("input", updateGuidanceSelection));
  Object.values(guidanceFields).forEach((field) => field?.addEventListener("change", updateGuidanceSelection));
  document.querySelector("#copyEntryToGuidance")?.addEventListener("click", copyEntryToGuidance);
  document.querySelector("#clearGuidance")?.addEventListener("click", clearGuidanceSelection);
  searchRecords.addEventListener("input", refreshRows);
  document.querySelector("#fastingHours").addEventListener("change", normalizeFastingHours);
  document.querySelectorAll(".vision-input").forEach((input) => {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("click", () => input.select());
  });
  const personalInput = form.elements.namedItem("個人番号");
  personalInput.addEventListener("focus", () => {
    personalValueBeforeEdit = personalInput.value;
  });
  personalInput.addEventListener("change", handlePersonalNumberChange);
  personalInput.addEventListener("input", updatePatientSummary);
  ["氏名", "カナ氏名", "生年月日"].forEach((name) => {
    form.elements.namedItem(name)?.addEventListener("input", updatePatientSummary);
  });
}

function markDirtyFromEvent(event) {
  if (isProgrammaticChange) return;
  const target = event.target;
  if (!target?.name) return;
  if (target.form !== form && !questionnaireForm?.contains(target)) return;
  isDirty = true;
}

function rememberQuestionnaireChoiceState(event) {
  const input = getQuestionnaireChoiceFromEvent(event);
  if (input) questionnaireChoiceState.set(input, input.checked);
}

function toggleQuestionnaireChoice(event) {
  const input = getQuestionnaireChoiceFromEvent(event);
  if (!input) return;
  const wasChecked = questionnaireChoiceState.has(input) ? questionnaireChoiceState.get(input) : input.checked;
  setTimeout(() => {
    if (input.type === "radio") {
      questionnaireForm.querySelectorAll(`input[type="radio"][name="${cssEscape(input.name)}"]`).forEach((field) => {
        field.checked = field === input;
      });
    } else {
      input.checked = !wasChecked;
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, 0);
}

function getQuestionnaireChoiceFromEvent(event) {
  const target = event.target;
  if (!target || !questionnaireForm?.contains(target)) return null;
  const input = target.matches?.("input[type='checkbox'], input[type='radio']")
    ? target
    : target.closest?.("label.choice")?.querySelector("input[type='checkbox'], input[type='radio']");
  return input && questionnaireForm.contains(input) ? input : null;
}

function setupCollapsibleGroups() {
  document.querySelectorAll(".section-block[data-group]").forEach((section) => {
    section.classList.add("collapsible-group");
    const heading = section.querySelector("h2");
    if (!heading || heading.querySelector(".group-toggle")) return;
    const button = document.createElement("button");
    button.className = "group-toggle";
    button.type = "button";
    button.addEventListener("click", () => setGroupCollapsed(section, !section.classList.contains("is-collapsed")));
    heading.appendChild(button);
    const saved = localStorage.getItem(groupStorageKey(section.dataset.group));
    setGroupCollapsed(section, saved === "closed", false);
  });
}

function setGroupCollapsed(section, collapsed, persist = true) {
  section.classList.toggle("is-collapsed", collapsed);
  const button = section.querySelector(".group-toggle");
  if (button) {
    button.textContent = collapsed ? "開く" : "閉じる";
    button.setAttribute("aria-expanded", String(!collapsed));
  }
  if (persist) {
    localStorage.setItem(groupStorageKey(section.dataset.group), collapsed ? "closed" : "open");
  }
}

function setAllGroupsCollapsed(collapsed) {
  document.querySelectorAll(".section-block[data-group]").forEach((section) => {
    setGroupCollapsed(section, collapsed);
  });
}

function groupStorageKey(group) {
  return `exam-group:${group}`;
}

function handleExclusiveCheckboxes(event) {
  const target = event.target;
  if (!target.matches("input[type='checkbox'][data-exclusive]") || !target.checked) return;
  form.querySelectorAll("input[type='checkbox'][data-exclusive]").forEach((input) => {
    if (input.name !== target.name) return;
    if (input !== target) input.checked = false;
  });
}

async function switchView(view) {
  const currentView = document.body.dataset.view || "entry";
  if (view === "questionnaire" && currentView !== "questionnaire") {
    await loadQuestionnaireForCurrentPatient({ force: true });
  }
  document.body.dataset.view = view;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((panel) => {
    panel.classList.toggle("is-visible", panel.id === `${view}View`);
  });
  if (navigator.onLine) await syncAndRefresh();
  if (view === "records") await refreshRows();
  if (view === "schedules") await refreshScheduleRows();
  if (view === "sync") await refreshCleanupSummary();
  if (view === "guidance") {
    hydrateGuidanceFromEntry(false);
    updateGuidanceSelection();
  }
}

function normalizeFastingHours() {
  const input = document.querySelector("#fastingHours");
  const value = input.value.trim();
  if (!value || value === "空腹") return;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 10) {
    input.value = "空腹";
  }
}


function hydrateGuidanceFromEntry(overwrite = false) {
  if (!guidanceFields.year) return;
  const data = formToRecord();
  setGuidanceValue(guidanceFields.year, String(defaultFiscalYear()), overwrite);
  setGuidanceValue(guidanceFields.sex, normalizeGuidanceSex(data["性別名称"]), overwrite);
  setGuidanceValue(guidanceFields.birthDate, data["生年月日"] || "", overwrite);
  setGuidanceValue(guidanceFields.examDate, todayGuidanceDateValue(), false);
  setGuidanceValue(guidanceFields.height, data["身長"] || "", overwrite);
  setGuidanceValue(guidanceFields.weight, data["体重"] || "", overwrite);
  setGuidanceValue(guidanceFields.waist, data["腹囲"] || "", overwrite);
  setGuidanceValue(guidanceFields.mealTime, mealTimeBucket(data["空腹時間（時）"], data["空腹時間（分）"]), overwrite);
}

function setGuidanceValue(field, value, overwrite) {
  if (!field || (!overwrite && field.value)) return;
  field.value = value;
}

function copyEntryToGuidance() {
  hydrateGuidanceFromEntry(true);
  updateGuidanceSelection();
  toast("入力画面の身体計測・生年月日を反映しました");
}

function clearGuidanceSelection() {
  Object.values(guidanceFields).forEach((field) => {
    if (!field) return;
    field.value = field.tagName === "SELECT" ? field.options[0]?.value || "" : "";
  });
  if (guidanceFields.year) guidanceFields.year.value = String(defaultFiscalYear());
  if (guidanceFields.examDate) guidanceFields.examDate.value = todayGuidanceDateValue();
  updateGuidanceSelection();
  guidanceFields.birthDate?.focus();
}

function updateGuidanceSelection() {
  if (!guidanceResult || !guidanceSummary || !guidanceChecks) return;
  if (guidanceFields.year && !guidanceFields.year.value) guidanceFields.year.value = String(defaultFiscalYear());
  const result = evaluateGuidanceSelection();
  guidanceResult.textContent = result.finalLabel;
  guidanceResult.className = result.finalClass;
  guidanceSummary.textContent = result.summary;
  guidanceChecks.innerHTML = result.items.map((item) => `
    <div class="guidance-check ${item.status}">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.text)}</strong>
      <small>${escapeHtml(item.detail)}</small>
    </div>
  `).join("");
}

function evaluateGuidanceSelection() {
  const year = Number(guidanceFields.year?.value || defaultFiscalYear());
  const sex = guidanceFields.sex?.value || "男性";
  const insurance = guidanceFields.insurance?.value || "";
  const birthDate = parseGuidanceDate(guidanceFields.birthDate?.value || "");
  const examDate = parseGuidanceDate(guidanceFields.examDate?.value || "");
  const hba1c = guidanceFields.hba1c?.value || "";
  const mealTime = guidanceFields.mealTime?.value || "";
  const medication = guidanceFields.medication?.value || "";
  const height = parseDecimal(guidanceFields.height?.value || "");
  const weight = parseDecimal(guidanceFields.weight?.value || "");
  const waist = parseDecimal(guidanceFields.waist?.value || "");
  const ageResult = evaluateGuidanceAge(birthDate, year, examDate);
  const bmi = height && weight ? weight / ((height / 100) ** 2) : null;
  const waistTarget = waist ? (sex === "男性" ? waist >= 85 : waist >= 90) : null;
  const bodyTarget = bmi == null && waistTarget == null ? null : (bmi != null && bmi >= 25) || waistTarget === true;
  const bodyText = [
    bmi == null ? "BMI 未入力" : `BMI ${bmi.toFixed(1)}`,
    waist ? `腹囲 ${waist}cm` : "腹囲 未入力"
  ].join(" / ");
  const ageText = ageResult.fiscalYearEndAge == null
    ? "未入力"
    : `年度末 ${ageResult.fiscalYearEndAge}歳 / 受診日 ${ageResult.examAge}歳${ageResult.completionDeadline ? ` / 期限 ${formatJapaneseDate(ageResult.completionDeadline)}` : ""}`;
  const items = [
    makeGuidanceItem("保険", insurance === "はい" ? true : insurance === "いいえ" ? false : null, insurance || "未入力", "協会・紙商・水産連合が『はい』なら対象"),
    makeGuidanceItem("年齢・保健指導期限", ageResult.included, ageText, ageResult.reason),
    makeGuidanceItem("HbA1c・食後時間", hba1c && mealTime ? !(hba1c === "なし" && mealTime === "3.5時間以内") : null, hba1c && mealTime ? `${hba1c} / ${mealTime}` : "未入力", "HbA1cなし、3.5時間以内は対象外"),
    makeGuidanceItem("内服", medication ? medication === "なし" : null, medication || "未入力", "血圧・血糖・脂質の内服ありは対象外"),
    makeGuidanceItem("BMI・腹囲", bodyTarget, bodyText, "BMI 25以上、または腹囲が男性85cm以上・女性90cm以上なら対象")
  ];
  const hasMissing = items.some((item) => item.status === "pending");
  const hasExcluded = items.some((item) => item.status === "excluded");
  if (hasExcluded) {
    return { finalLabel: "指導対象外", finalClass: "excluded", summary: "対象外条件があります", items };
  }
  if (hasMissing) {
    return { finalLabel: "--", finalClass: "pending", summary: "未入力の条件があります", items };
  }
  const deadlineLabel = ageResult.examAge === 74 && ageResult.completionDeadline
    ? `（${formatJapaneseDate(ageResult.completionDeadline)}までに保健指導完了する場合）`
    : "";
  return { finalLabel: `保健指導あり${deadlineLabel}`, finalClass: deadlineLabel ? "target deadline" : "target", summary: "すべての条件を満たしています", items };
}

function makeGuidanceItem(label, included, text, detail) {
  if (included == null) return { label, status: "pending", text, detail };
  return { label, status: included ? "target" : "excluded", text: included ? `対象: ${text}` : `対象外: ${text}`, detail };
}

function parseDecimal(value) {
  const normalized = String(value || "").replace(/[０-９．]/g, (char) => char === "．" ? "." : String(char.charCodeAt(0) - 0xFF10));
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function parseGuidanceDate(value) {
  const normalized = String(value || "").trim().replace(/[年月]/g, "/").replace(/日/g, "").replace(/-/g, "/");
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const valid = date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
  return valid ? date : null;
}

function todayGuidanceDateValue() {
  const today = new Date();
  return `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
}

function defaultFiscalYear() {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

function normalizeGuidanceSex(value) {
  return String(value || "").includes("女") ? "女性" : "男性";
}

function mealTimeBucket(hoursValue, minutesValue) {
  if (String(hoursValue || "") === "空腹") return "3.5時間超";
  const hours = Number(hoursValue || 0);
  const minutes = Number(minutesValue || 0);
  if (!Number.isFinite(hours) && !Number.isFinite(minutes)) return "";
  const total = (Number.isFinite(hours) ? hours : 0) + (Number.isFinite(minutes) ? minutes : 0) / 60;
  if (!total) return "";
  return total <= 3.5 ? "3.5時間以内" : "3.5時間超";
}

async function saveCurrentRecord() {
  if (document.body.dataset.view === "questionnaire") {
    await saveQuestionnaireRecord();
    return;
  }
  normalizeFastingHours();
  const data = formToRecord();
  await saveRecordData(data);
}

async function saveQuestionnaireRecord(options = {}) {
  const header = getPatientHeaderData();
  const planned = await getPlannedPatient(header["個人番号"]);
  if (planned) {
    header["氏名"] = planned["氏名"] || "";
    header["カナ氏名"] = planned["カナ氏名"] || "";
    header["性別名称"] = planned["性別名称"] || "";
    header["生年月日"] = planned["生年月日"] || "";
  }
  if (!header["受付番号"] && !header["個人番号"]) {
    toast("受付番号または個人番号を入力してください。", true);
    return false;
  }
  const answers = questionnaireToRecord();
  const validation = validateQuestionnaire(answers);
  if (validation) {
    showQuestionnaireError(validation);
    return false;
  }
  if (!Object.values(answers).some((value) => String(value || "").trim())) {
    toast("問診票・質問票の入力がありません。", true);
    return false;
  }
  const now = new Date().toISOString();
  const id = questionnaireResponseId(header["個人番号"]);
  const existing = await getOne(QUESTIONNAIRE_RESPONSES, id);
  const response = {
    id,
    entityType: "questionnaire_response",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    syncState: "pending",
    lastSyncError: "",
    tenantId: "local",
    scheduleGroupId: activeGroup?.id || existing?.scheduleGroupId || "",
    scheduleGroupName: activeGroup?.name || existing?.scheduleGroupName || "",
    patientCode: header["個人番号"] || existing?.patientCode || "",
    patientKey: `${activeGroup?.id || "nogroup"}::${header["個人番号"] || ""}`,
    data: header,
    answers
  };
  await put(QUESTIONNAIRE_RESPONSES, response);
  isDirty = false;
  personalValueBeforeEdit = header["個人番号"] || "";
  if (navigator.onLine) await syncPending();
  applyQuestionnaireAnswers(answers);
  clearQuestionnaireErrors();
  if (!options.silent) toast("保存しました");
  return true;
}

function questionnaireResponseId(patientCode) {
  return `${activeGroup?.id || "nogroup"}::${patientCode || "no-code"}::questionnaire`;
}

function getPatientHeaderData() {
  const data = pickHeaderData(formToRecord());
  return data;
}

function questionnaireToRecord() {
  const data = {};
  getQuestionnaireFields().forEach((field) => {
    if (!field.name) return;
    if (field.type === "checkbox") {
      const sameNameCount = questionnaireForm.querySelectorAll(`input[type="checkbox"][name="${cssEscape(field.name)}"]`).length;
      if (sameNameCount > 1) {
        if (!Array.isArray(data[field.name])) data[field.name] = [];
        if (field.checked) data[field.name].push(field.value);
      } else {
        data[field.name] = field.checked ? field.value : "";
      }
      return;
    }
    if (field.type === "radio") {
      if (field.checked) data[field.name] = field.value;
      else if (!(field.name in data)) data[field.name] = "";
      return;
    }
    data[field.name] = field.value.trim();
  });
  return data;
}

function getQuestionnaireFields() {
  return Array.from(questionnaireForm?.querySelectorAll("input[name], select[name], textarea[name]") || []);
}

function validateQuestionnaire(answers) {
  const linkedChecks = [
    {
      disease: "問診_病気_高血圧",
      required: "治療中（服薬あり）",
      question: "特定_01_血圧薬",
      message: "高血圧で「治療中（服薬あり）」が選択されています。服薬・既往歴の「血圧を下げる薬」は「はい」を選択してください。"
    },
    {
      disease: "問診_病気_糖尿病",
      required: "治療中（服薬あり）",
      question: "特定_02_血糖薬",
      message: "糖尿病で「治療中（服薬あり）」が選択されています。服薬・既往歴の「血糖を下げる薬又はインスリン注射」は「はい」を選択してください。"
    },
    {
      disease: "問診_病気_高脂血症・脂質異常症",
      required: "治療中（服薬あり）",
      question: "特定_03_脂質薬",
      message: "高脂血症・脂質異常症で「治療中（服薬あり）」が選択されています。服薬・既往歴の「コレステロールや中性脂肪を下げる薬」は「はい」を選択してください。"
    }
  ];
  for (const check of linkedChecks) {
    if (answerIncludes(answers, check.disease, check.required) && answers[check.question] !== "はい") {
      return { field: check.question, message: check.message };
    }
  }
  if (answerHasAny(answers, "問診_病気_貧血") && answers["特定_07_貧血"] !== "はい") {
    return {
      field: "特定_07_貧血",
      message: "病気についての「貧血」に入力があります。服薬・既往歴の「医師から、貧血といわれたことがありますか」は「はい」を選択してください。"
    };
  }
  const frequency = answers["特定_18_飲酒頻度"] || "";
  const amount = answers["特定_19_飲酒量"] || "";
  const noDrink = !frequency || ["やめた", "飲まない（飲めない）"].includes(frequency);
  const amountLevel = ["1合未満", "1〜2合未満", "2〜3合未満", "3〜5合未満", "5合以上"].indexOf(amount);
  if (noDrink && amount) {
    return {
      field: "特定_19_飲酒量",
      message: "飲酒頻度が未入力・「やめた」・「飲まない」の場合、飲酒量は入力しないでください。"
    };
  }
  if (["やめた", "飲まない（飲めない）"].includes(frequency) && amountLevel >= 1) {
    return {
      field: "特定_19_飲酒量",
      message: "お酒を「やめた」または「飲まない」とした場合、飲酒量は空欄または1合未満にしてください。"
    };
  }
  return "";
}

function answerIncludes(answers, key, value) {
  const answer = answers[key];
  return Array.isArray(answer) ? answer.includes(value) : answer === value;
}

function answerHasAny(answers, key) {
  const answer = answers[key];
  return Array.isArray(answer) ? answer.length > 0 : Boolean(String(answer || "").trim());
}

function showQuestionnaireError(error) {
  clearQuestionnaireErrors();
  const message = typeof error === "string" ? error : error.message;
  const fieldName = typeof error === "string" ? "" : error.field;
  toast(message, true);
  if (!fieldName) return;
  const field = questionnaireForm?.querySelector(`[name="${cssEscape(fieldName)}"]`);
  const row = field?.closest(".question-row");
  if (!row) return;
  row.classList.add("has-error");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearQuestionnaireErrors() {
  questionnaireForm?.querySelectorAll(".question-row.has-error").forEach((row) => {
    row.classList.remove("has-error");
  });
}

async function loadQuestionnaireForCurrentPatient(options = {}) {
  if (!questionnaireForm) return;
  const code = form.elements.namedItem("個人番号")?.value || "";
  const dirtyAtStart = isDirty || hasQuestionnaireInput();
  const response = await getOne(QUESTIONNAIRE_RESPONSES, questionnaireResponseId(code));
  if (!options.force && (dirtyAtStart || isDirty || hasQuestionnaireInput())) return;
  applyQuestionnaireAnswers(response?.answers || {});
  isDirty = false;
}

function applyQuestionnaireAnswers(answers) {
  setProgrammaticFormChange(() => {
    clearQuestionnaireForm();
    for (const [key, value] of Object.entries(answers)) {
      const fields = getQuestionnaireFields().filter((field) => field.name === key);
      fields.forEach((field) => {
        if (field.type === "checkbox" || field.type === "radio") {
          field.checked = Array.isArray(value) ? value.includes(field.value) : field.value === value;
        } else {
          field.value = value;
        }
      });
    }
  });
}

function clearQuestionnaireForm() {
  getQuestionnaireFields().forEach((field) => {
    if (field.type === "checkbox" || field.type === "radio") {
      field.checked = false;
    } else {
      field.value = "";
    }
  });
}

async function saveRecordData(data, options = {}) {
  const planned = await getPlannedPatient(data["個人番号"]);
  if (planned) {
    data["氏名"] = planned["氏名"] || "";
    data["カナ氏名"] = planned["カナ氏名"] || "";
    data["性別名称"] = planned["性別名称"] || "";
    data["生年月日"] = planned["生年月日"] || "";
  }
  const validation = validateRecord(data);
  if (validation) {
    toast(validation, true);
    return false;
  }
  const now = new Date().toISOString();
  const existing = editingId ? await getOne(STORE, editingId) : await findRecordByPatient(data["個人番号"]);
  const recordId = existing?.id || stableRecordId(activeGroup?.id || "", data["個人番号"] || "") || crypto.randomUUID();
  const headerData = pickHeaderData(data);
  const record = {
    id: recordId,
    entityType: "record_header",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    syncState: "pending",
    lastSyncError: "",
    scheduleGroupId: activeGroup?.id || existing?.scheduleGroupId || "",
    scheduleGroupName: activeGroup?.name || existing?.scheduleGroupName || "",
    patientCode: data["個人番号"] || existing?.patientCode || "",
    patientKey: `${activeGroup?.id || existing?.scheduleGroupId || "nogroup"}::${data["個人番号"] || existing?.patientCode || ""}`,
    data: headerData
  };
  await put(STORE, record);
  await saveGroupValues(record, data, now);
  await saveProgressSummary(record, data, now);
  editingId = record.id;
  isDirty = false;
  personalValueBeforeEdit = data["個人番号"] || "";
  await refreshRows();
  if (navigator.onLine) await syncPending();
  if (!options.silent) toast("ローカルに保存しました");
  return true;
}

function pickHeaderData(data) {
  const keys = ["受付番号", "個人番号", "氏名", "カナ氏名", "性別名称", "生年月日", "メモ"];
  return Object.fromEntries(keys.map((key) => [key, data[key] || ""]));
}

async function findRecordByPatient(patientCode) {
  const key = String(patientCode || "").trim();
  if (!key) return null;
  const records = await getAll(STORE);
  return records.find((record) => {
    const sameGroup = activeGroup ? record.scheduleGroupId === activeGroup.id : true;
    const code = record.patientCode || record.data?.["個人番号"] || "";
    return sameGroup && code === key;
  }) || null;
}

async function saveGroupValues(record, data, now) {
  const existingValues = await getGroupValuesForRecord(record);
  const existingByGroup = new Map(existingValues.map((item) => [item.groupKey, item]));
  for (const group of PROGRESS_GROUPS) {
    const values = pickFields(data, group.fields);
    const hasValue = Object.values(values).some((value) => String(value || "").trim());
    const existing = existingByGroup.get(group.target);
    if (!hasValue && !existing) continue;
    const patientKey = recordPatientKey(record);
    const item = {
      id: stableGroupValueId(patientKey, group.target),
      entityType: "exam_group_value",
      recordId: record.id,
      tenantId: "local",
      scheduleGroupId: record.scheduleGroupId || "",
      scheduleGroupName: record.scheduleGroupName || "",
      patientCode: record.patientCode || data["個人番号"] || "",
      patientKey: `${record.scheduleGroupId || "nogroup"}::${record.patientCode || data["個人番号"] || ""}`,
      groupKey: group.target,
      groupLabel: group.label,
      values,
      version: (existing?.version || 0) + 1,
      updatedAt: now,
      syncState: "pending"
    };
    await put(EXAM_GROUP_VALUES, item);
  }
}

async function saveProgressSummary(record, data, now) {
  const progress = {};
  for (const group of PROGRESS_GROUPS) {
    progress[group.target] = group.fields.some((field) => String(data[field] || "").trim()) ? "済" : "未";
  }
  await put(PROGRESS_SUMMARIES, {
    id: `progress::${recordPatientKey(record)}`,
    entityType: "progress_summary",
    recordId: record.id,
    tenantId: "local",
    scheduleGroupId: record.scheduleGroupId || "",
    scheduleGroupName: record.scheduleGroupName || "",
    patientCode: record.patientCode || data["個人番号"] || "",
    progress,
    updatedAt: now,
    syncState: "pending"
  });
}

function pickFields(data, fields) {
  return Object.fromEntries(fields.map((field) => [field, data[field] || ""]));
}

function stableRecordId(scheduleGroupId, patientCode) {
  const code = String(patientCode || "").trim();
  if (!code) return "";
  return `record::${scheduleGroupId || "nogroup"}::${code}`;
}

function recordPatientKey(record) {
  return record.patientKey || `${record.scheduleGroupId || "nogroup"}::${record.patientCode || record.data?.["個人番号"] || ""}`;
}

function stableGroupValueId(patientKey, groupKey) {
  return `exam::${patientKey || "nogroup::no-code"}::${groupKey}`;
}

async function getGroupValuesForRecord(record) {
  const patientKey = typeof record === "string" ? "" : recordPatientKey(record);
  const recordId = typeof record === "string" ? record : record.id;
  return (await getAll(EXAM_GROUP_VALUES)).filter((item) => {
    const itemPatientKey = item.patientKey || `${item.scheduleGroupId || "nogroup"}::${item.patientCode || ""}`;
    return patientKey ? itemPatientKey === patientKey : item.recordId === recordId;
  });
}

async function assembleRecordData(record) {
  const groupValues = await getGroupValuesForRecord(record);
  return groupValues.reduce((data, group) => ({ ...data, ...group.values }), { ...(record.data || {}) });
}

function formToRecord() {
  const data = {};
  Array.from(form.elements).forEach((field) => {
    if (!field.name) return;
    if (field.type === "checkbox") {
      if (field.checked) data[field.name] = field.value;
      return;
    }
    data[field.name] = field.value.trim();
  });
  return data;
}

function validateRecord(data) {
  if (!data["受付番号"] && !data["個人番号"]) return "受付番号または個人番号を入力してください。";
  if (data["便区分"] && !["1回", "2回"].includes(data["便区分"])) return "便区分は 1回 または 2回 です。";
  const fasting = data["空腹時間（時）"];
  if (fasting && fasting !== "空腹" && !Number.isFinite(Number(fasting))) return "空腹時間（時）は数値または空腹です。";
  for (const { name, options } of URINE_TESTS) {
    if (data[name] && !options.includes(data[name])) return `${name} の選択値を確認してください。`;
  }
  for (const field of FINDING_FIELDS) {
    if (data[field] && !FINDING_OPTIONS.includes(data[field])) return `${field} は 放置可・要観察・要受診 から選択してください。`;
  }
  return "";
}

function resetForm() {
  editingId = null;
  setProgrammaticFormChange(() => form.reset());
  isDirty = false;
  personalValueBeforeEdit = "";
  updatePatientSummary();
  toast("新規入力に切り替えました");
}

async function startNewWalkInRecord() {
  editingId = null;
  setProgrammaticFormChange(() => {
    form.reset();
    clearQuestionnaireForm();
  });
  isDirty = false;
  personalValueBeforeEdit = "";
  await updatePatientSummary();
  await switchView("entry");
  form.elements.namedItem("個人番号")?.focus();
  toast("飛び入り受診者の新規入力を開始しました。個人番号と氏名を入力してください。");
}

async function handlePersonalNumberChange(event) {
  event.stopPropagation();
  const input = event.target;
  const newValue = input.value.trim();
  const oldValue = personalValueBeforeEdit;
  if (document.body.dataset.view === "questionnaire") {
    personalValueBeforeEdit = newValue;
    await updatePatientSummary();
    return;
  }
  if (!oldValue || oldValue === newValue) {
    personalValueBeforeEdit = newValue;
    await updatePatientSummary();
    if (document.body.dataset.view === "questionnaire" && !isDirty && !hasQuestionnaireInput()) {
      await loadQuestionnaireForCurrentPatient();
    }
    return;
  }
  if (!isDirty || !hasCurrentInput()) {
    personalValueBeforeEdit = newValue;
    await updatePatientSummary();
    if (document.body.dataset.view === "questionnaire") {
      await loadQuestionnaireForCurrentPatient();
    }
    return;
  }
  const shouldSave = window.confirm("未保存の入力があります。移動する前に保存しますか？\n\nOK: 保存して移動\nキャンセル: 保存せずに移動");
  const currentData = formToRecord();
  currentData["個人番号"] = oldValue;
  if (shouldSave) {
    setProgrammaticFormChange(() => {
      input.value = oldValue;
    });
    const saved = document.body.dataset.view === "questionnaire"
      ? await saveQuestionnaireRecord({ silent: true })
      : await saveRecordData(currentData, { silent: true });
    if (!saved) {
      setProgrammaticFormChange(() => {
        input.value = oldValue;
      });
      personalValueBeforeEdit = oldValue;
      await updatePatientSummary();
      return;
    }
  }
  editingId = null;
  clearFormForPersonalNumber(newValue);
  resetQuestionnaireForm();
  personalValueBeforeEdit = newValue;
  isDirty = false;
  await updatePatientSummary();
  if (document.body.dataset.view === "questionnaire") await loadQuestionnaireForCurrentPatient();
  toast(shouldSave ? "保存して次の個人番号へ移動しました" : "保存せずに次の個人番号へ移動しました");
}

function hasExamInput() {
  return Array.from(form.elements).some((field) => {
    if (!field.name || ["受付番号", "個人番号"].includes(field.name)) return false;
    if (field.type === "checkbox") return field.checked;
    return String(field.value || "").trim() !== "";
  });
}

function hasQuestionnaireInput() {
  return getQuestionnaireFields().some((field) => {
    if (!field.name) return false;
    if (field.type === "checkbox" || field.type === "radio") return field.checked;
    return String(field.value || "").trim() !== "";
  });
}

function hasCurrentInput() {
  return document.body.dataset.view === "questionnaire" ? hasQuestionnaireInput() : hasExamInput();
}

function clearFormForPersonalNumber(personalNumber) {
  setProgrammaticFormChange(() => {
    Array.from(form.elements).forEach((field) => {
      if (!field.name) return;
      if (field.name === "個人番号") {
        field.value = personalNumber;
      } else if (field.type === "checkbox") {
        field.checked = false;
      } else {
        field.value = "";
      }
    });
  });
}

function resetQuestionnaireForm() {
  setProgrammaticFormChange(() => clearQuestionnaireForm());
}

async function confirmSaveBeforeLeaving() {
  if (!isDirty || !hasCurrentInput()) return true;
  const shouldSave = window.confirm("未保存の入力があります。移動する前に保存しますか？\n\nOK: 保存\nキャンセル: 保存せずに移動");
  if (!shouldSave) {
    isDirty = false;
    return true;
  }
  return document.body.dataset.view === "questionnaire"
    ? await saveQuestionnaireRecord({ silent: true })
    : await saveRecordData(formToRecord(), { silent: true });
}

function setProgrammaticFormChange(callback) {
  isProgrammaticChange = true;
  try {
    callback();
  } finally {
    isProgrammaticChange = false;
  }
}

async function getActiveRows() {
  const records = await getAll(STORE);
  if (!activeGroup) {
    const sorted = records
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return await Promise.all(sorted.map(async (record) => ({ record, patient: null, data: await assembleRecordData(record) })));
  }
  const patients = (await getAll(SCHEDULE_PATIENTS))
    .filter((patient) => patient.groupId === activeGroup.id)
    .sort((a, b) => String(a["受診者コード"]).localeCompare(String(b["受診者コード"])));
  const groupRecords = records.filter((record) => record.scheduleGroupId === activeGroup.id);
  const hydrated = await Promise.all(groupRecords.map(async (record) => ({ record, data: await assembleRecordData(record) })));
  const byCode = new Map(hydrated.map((item) => [item.record.patientCode || item.data["個人番号"], item]));
  const plannedRows = patients.map((patient) => {
    const item = byCode.get(patient["受診者コード"]) || null;
    return { patient, record: item?.record || null, data: item?.data || plannedToData(patient) };
  });
  const plannedCodes = new Set(patients.map((patient) => patient["受診者コード"]));
  const walkInRows = hydrated
    .filter((item) => !plannedCodes.has(item.record.patientCode || item.data["個人番号"]))
    .sort((a, b) => String(b.record.updatedAt || "").localeCompare(String(a.record.updatedAt || "")))
    .map((item) => ({ patient: null, record: item.record, data: item.data }));
  return [...plannedRows, ...walkInRows];
}

function plannedToData(patient) {
  return {
    "受付番号": "",
    "個人番号": patient["受診者コード"] || "",
    "氏名": patient["氏名"] || "",
    "カナ氏名": patient["カナ氏名"] || "",
    "性別名称": patient["性別名称"] || "",
    "生年月日": patient["生年月日"] || ""
  };
}

async function refreshRows() {
  const term = searchRecords?.value?.trim().toLowerCase() || "";
  const rows = (await getActiveRows()).filter(({ data }) => {
    const text = JSON.stringify(data).toLowerCase();
    return !term || text.includes(term);
  });
  recordRows.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    const progressCells = PROGRESS_GROUPS.map((group) => {
      const done = group.fields.some((field) => String(row.data?.[field] || "").trim());
      return `<td><button class="progress-mark ${done ? "done" : "missing"}" data-record="${row.record?.id || ""}" data-code="${escapeAttribute(row.data["個人番号"] || "")}" data-group="${escapeAttribute(group.target)}" type="button">${done ? "済" : "未"}</button></td>`;
    }).join("");
    tr.innerHTML = `
      <td><button class="link-cell" data-open-record="${row.record?.id || ""}" data-code="${escapeAttribute(row.data["個人番号"] || "")}" type="button">${escapeHtml(row.data["受付番号"] || "")}</button></td>
      <td><button class="link-cell" data-open-record="${row.record?.id || ""}" data-code="${escapeAttribute(row.data["個人番号"] || "")}" type="button">${escapeHtml(row.data["個人番号"] || row.data["個人No"] || "")}</button></td>
      <td><button class="link-cell name-link-cell" data-open-record="${row.record?.id || ""}" data-code="${escapeAttribute(row.data["個人番号"] || "")}" type="button">${formatPatientNameCell(row.data)}</button></td>
      ${progressCells}
      <td><button class="mini-button" data-open-questionnaire="${row.record?.id || ""}" data-code="${escapeAttribute(row.data["個人番号"] || "")}" type="button">問診</button></td>
      <td><span class="badge ${row.record?.syncState || "pending"}">${row.record ? syncLabel(row.record) : "未入力"}</span></td>
      <td>${row.record ? formatDate(row.record.updatedAt) : ""}</td>
    `;
    recordRows.appendChild(tr);
  }
  recordRows.querySelectorAll("[data-open-record]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.openRecord) editRecord(button.dataset.openRecord);
      else startRecordForPatient(button.dataset.code);
    });
  });
  recordRows.querySelectorAll("[data-group]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.record) editRecord(button.dataset.record, button.dataset.group);
      else startRecordForPatient(button.dataset.code, button.dataset.group);
    });
  });
  recordRows.querySelectorAll("[data-open-questionnaire]").forEach((button) => {
    button.addEventListener("click", () => {
      openQuestionnaireFromList(button.dataset.openQuestionnaire, button.dataset.code);
    });
  });
}

function formatPatientNameCell(data) {
  return `
    <span class="patient-name-lines list-name-lines">
      <span class="patient-kana">${escapeHtml(data["カナ氏名"] || "")}</span>
      <span class="patient-name">${escapeHtml(data["氏名"] || "")}</span>
    </span>
  `;
}

async function importScheduleCsv(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await readCsvText(file);
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error("データ行がありません");
    const header = rows[0].map((value) => value.trim());
    const required = ["受診者コード", "氏名", "カナ氏名", "性別名称", "生年月日"];
    const missing = required.filter((name) => !header.includes(name));
    if (missing.length) throw new Error(`${missing.join("、")} がありません`);
    const now = new Date().toISOString();
    const group = {
      entityType: "schedule_group",
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, ""),
      customerName: "",
      fileName: file.name,
      recordCount: 0,
      createdAt: now,
      updatedAt: now,
      syncState: "pending",
      lastSyncError: ""
    };
    let count = 0;
    for (const row of rows.slice(1)) {
      const patient = {};
      header.forEach((name, index) => {
        patient[name] = (row[index] || "").trim();
      });
      if (!patient["受診者コード"]) continue;
      await put(SCHEDULE_PATIENTS, {
        entityType: "schedule_patient",
        ...patient,
        id: `${group.id}::${patient["受診者コード"]}`,
        groupId: group.id,
        scheduleGroupId: group.id,
        scheduleGroupName: group.name,
        patientCode: patient["受診者コード"],
        createdAt: now,
        updatedAt: now,
        syncState: "pending",
        lastSyncError: ""
      });
      count += 1;
    }
    group.recordCount = count;
    await put(SCHEDULE_GROUPS, group);
    await setActiveGroup(group.id);
    await refreshScheduleRows();
    await refreshRows();
    if (navigator.onLine) await syncPending();
    toast(`${group.name} を${count}件で登録しました`);
  } catch (error) {
    toast(`受診予定CSVの取込に失敗しました: ${error.message}`, true);
  } finally {
    event.target.value = "";
  }
}

async function readCsvText(file) {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("shift_jis").decode(buffer);
  } catch {
    return utf8;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const normalized = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

async function loadActiveGroup() {
  const activeId = (await getOne(SETTINGS, "activeScheduleGroupId"))?.value || "";
  activeGroup = activeId ? await getOne(SCHEDULE_GROUPS, activeId) : null;
  updateActiveGroupLabel();
}

async function setActiveGroup(groupId) {
  activeGroup = await getOne(SCHEDULE_GROUPS, groupId);
  await put(SETTINGS, { key: "activeScheduleGroupId", value: groupId });
  updateActiveGroupLabel();
  await updatePatientSummary();
}

function updateActiveGroupLabel() {
  if (!activeGroupLabel) return;
  const customer = activeGroup?.customerName ? ` / 顧客: ${activeGroup.customerName}` : "";
  activeGroupLabel.textContent = activeGroup ? `予定グループ: ${activeGroup.name}${customer}` : "予定グループ未選択";
  activeGroupLabel.classList.toggle("found", Boolean(activeGroup));
}

async function refreshScheduleRows() {
  if (!scheduleRows) return;
  const groups = (await getAll(SCHEDULE_GROUPS)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  scheduleRows.innerHTML = "";
  for (const group of groups) {
    const active = activeGroup?.id === group.id;
    const tr = document.createElement("tr");
    tr.className = active ? "is-active-row" : "";
    tr.innerHTML = `
      <td>${escapeHtml(group.name)}</td>
      <td><input class="schedule-customer-input" data-customer-group-id="${group.id}" value="${escapeAttribute(group.customerName || "")}" placeholder="顧客名"></td>
      <td>${escapeHtml(group.fileName)}</td>
      <td>${escapeHtml(group.recordCount)}</td>
      <td>${formatDate(group.createdAt)}</td>
      <td><button class="ghost" data-group-id="${group.id}" type="button">${active ? "選択中" : "開く"}</button></td>
    `;
    scheduleRows.appendChild(tr);
  }
  scheduleRows.querySelectorAll("[data-customer-group-id]").forEach((input) => {
    input.addEventListener("change", () => saveScheduleCustomerName(input.dataset.customerGroupId, input.value));
  });
  scheduleRows.querySelectorAll("[data-group-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmSaveBeforeLeaving())) return;
      await setActiveGroup(button.dataset.groupId);
      resetForm();
      await refreshScheduleRows();
      await refreshRows();
      switchView("entry");
    });
  });
}

async function saveScheduleCustomerName(groupId, value) {
  const group = await getOne(SCHEDULE_GROUPS, groupId);
  if (!group) return;
  const customerName = String(value || "").trim();
  const updated = {
    ...group,
    customerName,
    updatedAt: new Date().toISOString(),
    syncState: "pending",
    lastSyncError: ""
  };
  await put(SCHEDULE_GROUPS, updated);
  if (activeGroup?.id === groupId) {
    activeGroup = updated;
    updateActiveGroupLabel();
  }
  if (navigator.onLine) await syncPending();
  toast("顧客名を保存しました");
}

async function getPlannedPatient(code) {
  const key = String(code || "").trim();
  if (!key || !activeGroup) return null;
  return (await getOne(SCHEDULE_PATIENTS, `${activeGroup.id}::${key}`)) || null;
}

async function updatePatientSummary() {
  if (!patientSummary) return;
  const patient = await getPlannedPatient(form.elements.namedItem("個人番号").value);
  if (!patient) {
    const data = formToRecord();
    if (data["氏名"] || data["カナ氏名"] || data["生年月日"]) {
      patientSummary.innerHTML = formatPatientSummary(data);
      patientSummary.classList.add("found");
      return;
    }
    patientSummary.innerHTML = activeGroup ? "予定外受診者" : "予定グループ未選択";
    patientSummary.classList.toggle("found", Boolean(data["個人番号"]));
    return;
  }
  patientSummary.innerHTML = formatPatientSummary(patient);
  patientSummary.classList.add("found");
}

function formatPatientSummary(data) {
  const birthDate = parseGuidanceDate(data["生年月日"] || "");
  const age = birthDate ? ageOnDate(birthDate, new Date()) : null;
  return `
    <span class="patient-name-lines">
      <span class="patient-kana">${escapeHtml(data["カナ氏名"] || "")}</span>
      <span class="patient-name">${escapeHtml(data["氏名"] || "")}</span>
    </span>
    <span class="patient-meta">${escapeHtml(data["性別名称"] || "")}　${age == null ? "年齢不明" : `${age}歳`}　${escapeHtml(data["生年月日"] || "")}</span>
  `;
}

function formatFasting(data) {
  const hours = data["空腹時間（時）"] || "";
  const minutes = data["空腹時間（分）"] || "";
  if (!hours && !minutes) return "";
  if (hours === "空腹") return "空腹";
  return `${hours}時${minutes ? `${minutes}分` : ""}`;
}

async function startRecordForPatient(code, targetGroup = "") {
  if (!(await confirmSaveBeforeLeaving())) return;
  editingId = null;
  setProgrammaticFormChange(() => {
    form.reset();
    form.elements.namedItem("個人番号").value = code || "";
  });
  isDirty = false;
  personalValueBeforeEdit = code || "";
  await updatePatientSummary();
  switchView("entry");
  scrollToGroup(targetGroup);
}

async function openQuestionnaireFromList(id, code) {
  if (!(await confirmSaveBeforeLeaving())) return;
  editingId = id || null;
  let data = {};
  if (id) {
    const record = await getOne(STORE, id);
    data = record ? await assembleRecordData(record) : {};
  } else {
    const patient = await getPlannedPatient(code);
    data = patient ? plannedToData(patient) : { "個人番号": code || "" };
  }
  setProgrammaticFormChange(() => {
    ["受付番号", "個人番号", "氏名", "カナ氏名", "性別名称", "生年月日"].forEach((key) => {
      const field = form.elements.namedItem(key);
      if (field) field.value = data[key] || "";
    });
  });
  personalValueBeforeEdit = data["個人番号"] || code || "";
  isDirty = false;
  await updatePatientSummary();
  await switchView("questionnaire");
}

async function editRecord(id, targetGroup = "") {
  if (!(await confirmSaveBeforeLeaving())) return;
  const record = await getOne(STORE, id);
  if (!record) return;
  const data = await assembleRecordData(record);
  editingId = id;
  setProgrammaticFormChange(() => {
    form.reset();
    for (const [key, value] of Object.entries(data)) {
      const fields = Array.from(form.elements).filter((field) => field.name === key);
      fields.forEach((field) => {
        if (field.type === "checkbox") {
          field.checked = field.value === value;
        } else {
          field.value = value;
        }
      });
    }
  });
  isDirty = false;
  personalValueBeforeEdit = data["個人番号"] || "";
  await updatePatientSummary();
  switchView("entry");
  scrollToGroup(targetGroup);
}

function scrollToGroup(targetGroup) {
  if (!targetGroup) return;
  requestAnimationFrame(() => {
    const section = document.querySelector(`.section-block[data-group="${cssEscape(targetGroup)}"]`);
    if (section) setGroupCollapsed(section, false);
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function saveSettings() {
  await put(SETTINGS, { key: "cloudUrl", value: document.querySelector("#cloudUrl").value.trim() });
  await put(SETTINGS, { key: "cloudKey", value: document.querySelector("#cloudKey").value.trim() });
  toast("同期設定を保存しました");
  if (navigator.onLine) await syncPending();
}

async function loadSettings() {
  document.querySelector("#cloudUrl").value = (await getOne(SETTINGS, "cloudUrl"))?.value || DEFAULT_CLOUD_URL;
  document.querySelector("#cloudKey").value = (await getOne(SETTINGS, "cloudKey"))?.value || "";
}

async function syncPending() {
  if (!navigator.onLine) {
    toast("オフラインのため未同期として保持します");
    return;
  }
  const settings = await getCloudSettings();
  if (!settings.url) {
    syncMessage.textContent = "クラウド同期API URLを設定すると、オンライン時に自動同期します。";
    return;
  }
  if (syncInProgress) return;
  syncInProgress = true;
  try {
  const pendingRecords = (await getAll(STORE)).filter((record) => record.syncState !== "synced");
  const pendingGroups = (await getAll(EXAM_GROUP_VALUES)).filter((item) => item.syncState !== "synced");
  const pendingProgress = (await getAll(PROGRESS_SUMMARIES)).filter((item) => item.syncState !== "synced");
  const pendingQuestionnaires = (await getAll(QUESTIONNAIRE_RESPONSES)).filter((item) => item.syncState !== "synced");
  const pendingScheduleGroups = (await getAll(SCHEDULE_GROUPS)).filter((item) => item.syncState !== "synced");
  const pendingSchedulePatients = (await getAll(SCHEDULE_PATIENTS)).filter((item) => item.syncState !== "synced");
  const pending = [
    ...pendingRecords,
    ...pendingGroups,
    ...pendingProgress,
    ...pendingQuestionnaires,
    ...pendingScheduleGroups,
    ...pendingSchedulePatients
  ];
  for (const item of pending) {
    try {
      await sendToCloud(settings, toSyncEnvelope(item));
      await put(getSyncStoreName(item), { ...item, syncState: "synced", lastSyncError: "", syncedAt: new Date().toISOString() });
    } catch (error) {
      await put(getSyncStoreName(item), { ...item, syncState: "error", lastSyncError: String(error.message || error) });
    }
  }
  await refreshRows();
  await refreshCleanupSummary();
  const failed = [
    ...(await getAll(STORE)),
    ...(await getAll(EXAM_GROUP_VALUES)),
    ...(await getAll(PROGRESS_SUMMARIES)),
    ...(await getAll(QUESTIONNAIRE_RESPONSES)),
    ...(await getAll(SCHEDULE_GROUPS)),
    ...(await getAll(SCHEDULE_PATIENTS))
  ].filter((item) => item.syncState === "error").length;
  syncMessage.textContent = failed ? `${failed}件の同期に失敗しました。URLとAPIキーを確認してください。` : "同期が完了しました。";
  } finally {
    syncInProgress = false;
  }
}

async function refreshCleanupSummary() {
  if (!cleanupSummary) return;
  const groupName = activeGroup?.name || "全体";
  const records = await getCleanupCandidates();
  const synced = records.filter((record) => record.syncState === "synced");
  const unsynced = records.filter((record) => record.syncState !== "synced");
  cleanupSummary.textContent = `${groupName}: 同期済 ${synced.length}件 / 未同期・失敗 ${unsynced.length}件`;
  document.querySelector("#deleteSyncedLocal").disabled = synced.length === 0 || unsynced.length > 0;
}

async function getCleanupCandidates() {
  const records = await getAll(STORE);
  return activeGroup ? records.filter((record) => record.scheduleGroupId === activeGroup.id) : records;
}

async function deleteSyncedLocalData() {
  const candidates = await getCleanupCandidates();
  const unsynced = candidates.filter((record) => record.syncState !== "synced");
  const synced = candidates.filter((record) => record.syncState === "synced");
  if (unsynced.length) {
    toast("未同期または同期失敗のデータがあるため削除できません。", true);
    await refreshCleanupSummary();
    return;
  }
  if (!synced.length) {
    toast("削除できる同期済データはありません。");
    return;
  }
  const scope = activeGroup ? `予定グループ「${activeGroup.name}」` : "全体";
  const ok = window.confirm(`${scope} の同期済データ ${synced.length}件をこの端末から削除します。\nクラウド側で受信済みであることを確認してから実行してください。\n\n削除しますか？`);
  if (!ok) return;
  for (const record of synced) {
    await deleteOne(STORE, record.id);
    const groupValues = await getGroupValuesForRecord(record);
    for (const item of groupValues) {
      await deleteOne(EXAM_GROUP_VALUES, item.id);
    }
    await deleteOne(PROGRESS_SUMMARIES, record.id);
    await deleteOne(QUESTIONNAIRE_RESPONSES, questionnaireResponseId(record.patientCode || record.data?.["個人番号"] || ""));
  }
  if (editingId && synced.some((record) => record.id === editingId)) {
    resetForm();
  }
  await refreshRows();
  await refreshCleanupSummary();
  toast(`${synced.length}件の同期済データを端末から削除しました。`);
}

function toSyncEnvelope(item) {
  if (item.entityType) return item;
  if (item.fileName && Object.prototype.hasOwnProperty.call(item, "recordCount")) return { entityType: "schedule_group", ...item };
  if (item.groupId && item["受診者コード"]) return { entityType: "schedule_patient", ...item };
  if (item.groupKey) return { entityType: "exam_group_value", ...item };
  if (item.progress) return { entityType: "progress_summary", ...item };
  return { entityType: "record_header", ...item };
}

function getSyncStoreName(item) {
  const entityType = item.entityType || toSyncEnvelope(item).entityType;
  if (entityType === "questionnaire_response") return QUESTIONNAIRE_RESPONSES;
  if (entityType === "schedule_group") return SCHEDULE_GROUPS;
  if (entityType === "schedule_patient") return SCHEDULE_PATIENTS;
  if (entityType === "exam_group_value") return EXAM_GROUP_VALUES;
  if (entityType === "progress_summary") return PROGRESS_SUMMARIES;
  if (entityType === "record_header") return STORE;
  return null;
}

async function pullCloud(options = {}) {
  const settings = await getCloudSettings();
  const { silent = false, schedulesOnly = false } = options;
  if (!settings.url) {
    if (!silent) toast("クラウド同期API URLを設定してください", true);
    return;
  }
  if (pullInProgress) return;
  pullInProgress = true;
  try {
    const response = await fetch(settings.url, { headers: cloudHeaders(settings) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const records = await response.json();
    if (!Array.isArray(records)) throw new Error("クラウド応答は配列にしてください");
    let imported = 0;
    let importedSchedules = 0;
    const now = new Date().toISOString();
    for (const cloudRecord of records) {
      const record = normalizeCloudRecord(cloudRecord);
      const storeName = getSyncStoreName(record);
      if (!storeName) continue;
      const isSchedule = storeName === SCHEDULE_GROUPS || storeName === SCHEDULE_PATIENTS;
      if (schedulesOnly && !isSchedule) continue;
      const remoteValue = {
        ...record,
        syncState: "synced",
        lastSyncError: "",
        updatedAt: record.updatedAt || now
      };
      const localValue = await getOne(storeName, remoteValue.id);
      if (localValue?.syncState === "pending" || localValue?.syncState === "error") {
        await put(storeName, {
          ...mergeWithoutErasing(remoteValue, localValue),
          syncState: localValue.syncState,
          lastSyncError: localValue.lastSyncError || ""
        });
      } else {
        await put(storeName, {
          ...mergeWithoutErasing(localValue || {}, remoteValue),
          syncState: "synced",
          lastSyncError: ""
        });
      }
      imported += 1;
      if (isSchedule) importedSchedules += 1;
    }
    if (importedSchedules) await selectLatestScheduleGroupIfNeeded();
    await loadActiveGroup();
    await refreshScheduleRows();
    await refreshRows();
    if (!silent) toast(`${imported}件を読み込みました`);
  } catch (error) {
    if (!silent) toast(`クラウド読込に失敗しました: ${error.message}`, true);
  } finally {
    pullInProgress = false;
  }
}

function normalizeCloudRecord(record) {
  const entityType = record.entityType || toSyncEnvelope(record).entityType;
  const patientCode = record.patientCode || record.data?.["個人番号"] || record["受診者コード"] || "";
  const patientKey = record.patientKey || `${record.scheduleGroupId || record.groupId || "nogroup"}::${patientCode}`;
  if (entityType === "record_header") {
    return { ...record, entityType, patientKey, id: stableRecordId(record.scheduleGroupId || "", patientCode) || record.id };
  }
  if (entityType === "exam_group_value") {
    return { ...record, entityType, patientKey, id: stableGroupValueId(patientKey, record.groupKey) };
  }
  if (entityType === "progress_summary") {
    return { ...record, entityType, patientKey, id: `progress::${patientKey}` };
  }
  return { ...record, entityType };
}

function hasSyncValue(value) {
  if (value == null) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function mergeWithoutErasing(base, incoming) {
  const merged = { ...(base || {}) };
  for (const [key, value] of Object.entries(incoming || {})) {
    const oldValue = merged[key];
    if (oldValue && value && typeof oldValue === "object" && typeof value === "object" && !Array.isArray(oldValue) && !Array.isArray(value)) {
      merged[key] = mergeWithoutErasing(oldValue, value);
    } else if (hasSyncValue(value) || !hasSyncValue(oldValue)) {
      merged[key] = value;
    }
  }
  return merged;
}

async function syncAndRefresh(options = {}) {
  if (!navigator.onLine) return;
  const now = Date.now();
  const minInterval = options.force ? 0 : 3000;
  if (now - lastAutomaticRefreshAt < minInterval) return;
  lastAutomaticRefreshAt = now;
  await syncPending();
  if (syncInProgress) return;
  await pullCloud({ silent: true });
}

async function prepareSyncSchemaV2() {
  const migrationKey = "syncSchemaV2Reseeded";
  if ((await getOne(SETTINGS, migrationKey))?.value) return;
  const stores = [STORE, EXAM_GROUP_VALUES, PROGRESS_SUMMARIES, QUESTIONNAIRE_RESPONSES, SCHEDULE_GROUPS, SCHEDULE_PATIENTS];
  for (const storeName of stores) {
    const items = await getAll(storeName);
    for (const item of items) {
      const normalized = normalizeCloudRecord(item);
      // Reseed the original id as well. Legacy random ids are retained until
      // the server history has received them, prioritizing recoverability over
      // aggressive local cleanup.
      await put(storeName, { ...item, syncState: "pending", lastSyncError: "" });
      const existing = await getOne(storeName, normalized.id);
      await put(storeName, {
        ...mergeWithoutErasing(existing || {}, normalized),
        syncState: "pending",
        lastSyncError: ""
      });
    }
  }
  await put(SETTINGS, { key: migrationKey, value: true });
}

async function selectLatestScheduleGroupIfNeeded() {
  const activeId = (await getOne(SETTINGS, "activeScheduleGroupId"))?.value || "";
  if (activeId && await getOne(SCHEDULE_GROUPS, activeId)) return;
  const groups = (await getAll(SCHEDULE_GROUPS)).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (groups[0]) await put(SETTINGS, { key: "activeScheduleGroupId", value: groups[0].id });
}

async function sendToCloud(settings, record) {
  const deviceId = await getSyncDeviceId();
  const response = await fetch(settings.url, {
    method: "POST",
    headers: cloudHeaders(settings),
    body: JSON.stringify({ ...record, syncDeviceId: deviceId })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function getSyncDeviceId() {
  const key = "syncDeviceId";
  const existing = (await getOne(SETTINGS, key))?.value;
  if (existing) return existing;
  const value = crypto.randomUUID();
  await put(SETTINGS, { key, value });
  return value;
}

function cloudHeaders(settings) {
  const headers = { "Content-Type": "application/json" };
  if (settings.key) headers.Authorization = `Bearer ${settings.key}`;
  return headers;
}

async function getCloudSettings() {
  return {
    url: (await getOne(SETTINGS, "cloudUrl"))?.value || DEFAULT_CLOUD_URL,
    key: (await getOne(SETTINGS, "cloudKey"))?.value || ""
  };
}

async function exportCsv() {
  const rows = await getActiveRows();
  const filtered = rows.filter((row) => row.record);
  const questionnaireByPatient = await getQuestionnairesByPatient();
  const merged = filtered.map((row) => {
    const code = row.record.patientCode || row.data["個人番号"] || "";
    const questionnaire = questionnaireByPatient.get(code);
    const questionnaireFields = questionnaire
      ? Object.fromEntries(Object.entries(questionnaire.answers || {}).map(([key, value]) => [`問診:${key}`, value]))
      : {};
    return { ...row, exportData: { ...row.data, ...questionnaireFields } };
  });
  const fields = collectFields(merged.map((row) => ({ data: row.exportData })));
  const lines = [
    ["id", "scheduleGroupName", "createdAt", "updatedAt", "syncState", ...fields],
    ...merged.map((row) => [row.record.id, row.record.scheduleGroupName || "", row.record.createdAt, row.record.updatedAt, row.record.syncState, ...fields.map((field) => row.exportData[field] || "")])
  ];
  const csv = lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `出張健診_${activeGroup?.name || "全体"}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function getQuestionnairesByPatient() {
  const items = await getAll(QUESTIONNAIRE_RESPONSES);
  const scoped = activeGroup ? items.filter((item) => item.scheduleGroupId === activeGroup.id) : items;
  return new Map(scoped.map((item) => [item.patientCode || item.data?.["個人番号"] || "", item]));
}

function collectFields(records) {
  const fromForm = Array.from(form.elements).map((field) => field.name).filter(Boolean);
  const fromRecords = records.flatMap((record) => Object.keys(record.data));
  return Array.from(new Set([...fromForm, ...fromRecords]));
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function updateOnlineStatus() {
  const online = navigator.onLine;
  statusEl.textContent = online ? "オンライン" : "オフライン";
  statusEl.classList.toggle("online", online);
  statusEl.classList.toggle("offline", !online);
}

function syncLabel(record) {
  if (record.syncState === "synced") return "同期済";
  if (record.syncState === "error") return "失敗";
  return "未同期";
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replaceAll('"', '\\"');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toast(message, isError = false) {
  syncMessage.textContent = message;
  syncMessage.style.background = isError ? "var(--bad)" : "var(--soft)";
}
