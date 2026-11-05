const token = location.pathname.split("/").filter(Boolean).pop();
const verifyPanel = document.querySelector("#verifyPanel");
const questionnairePanel = document.querySelector("#questionnairePanel");
const completePanel = document.querySelector("#completePanel");
const form = document.querySelector("#publicQuestionnaire");
const birthInput = document.querySelector("#birthInput");
let verifiedBirth = "";
let patientSex = "";
let saveTimer = 0;

const yesNo = ["はい", "いいえ"];
const diseaseStatus = ["治療中（服薬あり）", "治療中（服薬なし）", "経過観察中", "手術", "治癒"];
const diseases = ["高血圧","糖尿病","高脂血症・脂質異常症","脳出血","脳梗塞","他 脳神経疾患","狭心症・心筋梗塞","不整脈","他 心臓病","貧血","甲状腺疾患","乳腺疾患","結核・胸膜炎","気管支喘息","他 呼吸器疾患","胃・十二指腸潰瘍","胃ポリープ","大腸ポリープ","他 胃腸疾患","B型肝炎・C型肝炎","脂肪肝","胆嚢ポリープ","他 肝・胆疾患","膵臓疾患","慢性腎臓病・腎不全","痛風・高尿酸血症","他 腎臓疾患","前立腺肥大","他 泌尿器科疾患","婦人科疾患","眼科疾患","耳鼻科疾患","骨粗鬆症","整形外科疾患","皮膚疾患","その他"];
const groups = [
  { section:"問診票", title:"病気について", items:diseases.map(label=>({id:`問診_病気_${label}`,label,type:"multi",options:diseaseStatus})) },
  { section:"問診票", title:"お薬の使用について", items:["血をサラサラにする薬","胃腸薬","その他"].map(label=>({id:`問診_薬_${label.replace("をサラサラにする薬", "液サラサラ")}`,label,type:"checkText"})) },
  { section:"問診票", title:"自覚症状について", items:["頭痛","めまい","耳鳴り","不安","不眠","体がだるい","手のしびれ","足のしびれ","むくみ","胸痛","咳","動悸","息切れ","腹痛","下痢","頻尿","腰痛・関節痛","その他"].map(label=>({id:`問診_症状_${label}`,label,type:label==="その他"?"checkText":"check"})) },
  { section:"問診票", title:"運転に関わる症状について", items:[
    {id:"問診_運転_意識消失",label:"意識を失ったことがある",type:"check"},
    {id:"問診_運転_一時麻痺",label:"身体の全部または一部が一時的に思い通りに動かせなくなったことがある",type:"check"},
    {id:"問診_運転_日中眠気",label:"十分な睡眠時間をとっていても、日中活動中に眠り込んでしまったことがある",type:"check"}] },
  { section:"問診票", title:"検査について", items:["ペースメーカー、ICD（埋め込み型除細動器）を装着している","動脈瘤、下肢に深部静脈血栓症がある","インスリンポンプ、持続グルコース測定器を装着している","V-Pシャント、CVポートを留置している","体内金属（ボルト、人工関節、インプラント）が入っている","人工透析をしている","乳がんの手術をした"].map(label=>({id:`問診_検査_${label}`,label,type:"check"})) },
  { section:"問診票", title:"女性の方へ", female:true, items:[
    {id:"問診_女性_月経状況",label:"月経の状況",type:"radio",options:["月経中","順調","不順あり","不正出血あり","閉経した","無月経"]},
    {id:"問診_女性_妊娠可能性",label:"妊娠の可能性",type:"radio",options:["可能性なし","可能性あり","妊娠中"]}] },
  { section:"問診票", title:"個人情報の取扱いについて", items:[
    {id:"問診_同意",label:"個人情報の取扱いに同意する",type:"check",value:"同意する"},
    {id:"問診_署名",label:"署名",type:"text"}] },
  { section:"特定健康診査質問票", title:"服薬・既往歴", items:[
    ["特定_01_血圧薬","現在、血圧を下げる薬を使用していますか。"],["特定_02_血糖薬","現在、血糖を下げる薬又はインスリン注射を使用していますか。"],["特定_03_脂質薬","現在、コレステロールや中性脂肪を下げる薬を使用していますか。"],["特定_04_脳卒中","医師から、脳卒中にかかっているといわれたり、治療を受けたことがありますか。"],["特定_05_心臓病","医師から、心臓病にかかっているといわれたり、治療を受けたことがありますか。"],["特定_06_腎臓病","医師から、慢性腎臓病や腎不全にかかっているといわれたり、治療を受けていますか。"],["特定_07_貧血","医師から、貧血といわれたことがありますか。"]].map(([id,label])=>({id,label,type:"radio",options:yesNo})) },
  { section:"特定健康診査質問票", title:"喫煙・運動", items:[
    {id:"特定_08_喫煙",label:"現在、たばこを習慣的に吸っていますか。",type:"radio",options:["はい","以前は吸っていたが最近1か月間は吸っていない","いいえ"]},
    ...[["特定_09_体重増加","20歳の時の体重から10kg以上増加していますか。"],["特定_10_運動習慣","1回30分以上の軽い汗をかく運動を週2日以上、1年以上実施している。"],["特定_11_身体活動","日常生活で歩行又は同等の身体活動を1日1時間以上実施している。"],["特定_12_歩行速度","ほぼ同じ年齢の同性と比較して歩く速度が速い。"]].map(([id,label])=>({id,label,type:"radio",options:yesNo}))] },
  { section:"特定健康診査質問票", title:"食事・飲酒・睡眠", items:[
    {id:"特定_13_咀嚼",label:"食事をかんで食べる時の状態はどれにあてはまりますか。",type:"radio",options:["何でもかんで食べることができる","かみにくいことがある","ほとんどかめない"]},
    {id:"特定_14_食速度",label:"人と比較して食べる速度が速い。",type:"radio",options:["速い","普通","遅い"]},
    {id:"特定_15_就寝前夕食",label:"就寝前の2時間以内に夕食をとることが週に3回以上ある。",type:"radio",options:yesNo},
    {id:"特定_16_間食",label:"朝昼夕の3食以外に間食や甘い飲み物を摂取していますか。",type:"radio",options:["毎日","時々","ほとんど摂取しない"]},
    {id:"特定_17_朝食欠食",label:"朝食を抜くことが週に3回以上ある。",type:"radio",options:yesNo},
    {id:"特定_18_飲酒頻度",label:"お酒を飲む頻度はどのくらいですか。",type:"radio",options:["毎日","週5〜6日","週3〜4日","週1〜2日","月に1〜3日","月に1日未満","やめた","飲まない（飲めない）"]},
    {id:"特定_19_飲酒量",label:"飲酒日の1日当たりの飲酒量は。",type:"radio",options:["1合未満","1〜2合未満","2〜3合未満","3〜5合未満","5合以上"]},
    {id:"特定_20_睡眠",label:"睡眠で休養が十分とれている。",type:"radio",options:yesNo}] },
  { section:"特定健康診査質問票", title:"生活習慣改善", items:[
    {id:"特定_21_生活改善",label:"運動や食生活等の生活習慣を改善してみようと思いますか。",type:"radio",options:["改善するつもりはない","改善するつもりである（概ね6ヶ月以内）","近いうちに改善するつもりであり、少しずつ始めている","既に改善に取り組んでいる（6ヶ月未満）","既に改善に取り組んでいる（6ヶ月以上）"]},
    {id:"特定_22_保健指導",label:"生活習慣の改善について、これまでに特定保健指導を受けたことがありますか。",type:"radio",options:yesNo}] }
];

function esc(value){ const node=document.createElement("span"); node.textContent=value??""; return node.innerHTML; }
function itemHtml(item){
  const choices=(item.options||[]).map(option=>`<label class="choice"><input type="${item.type==="multi"?"checkbox":"radio"}" name="${esc(item.id)}" value="${esc(option)}"><span>${esc(option)}</span></label>`).join("");
  if(item.type==="text") return `<div class="question" data-field="${esc(item.id)}"><strong>${esc(item.label)}</strong><input name="${esc(item.id)}" maxlength="100"></div>`;
  if(item.type==="check"||item.type==="checkText") return `<div class="question" data-field="${esc(item.id)}"><label class="choice"><input type="checkbox" name="${esc(item.id)}" value="${esc(item.value||"該当")}"><span>${esc(item.label)}</span></label>${item.type==="checkText"?`<input class="inline-text" name="${esc(item.id)}_text" placeholder="内容を入力" maxlength="100">`:""}</div>`;
  return `<div class="question" data-field="${esc(item.id)}"><strong>${esc(item.label)}</strong><div class="choices">${choices}</div></div>`;
}
function render(answers={}){
  let section="";
  form.innerHTML=groups.filter(group=>!group.female||/女/.test(patientSex)).map(group=>{
    const heading=group.section!==section?`<h2 class="section-title">${esc(group.section)}</h2>`:""; section=group.section;
    return `${heading}<section class="question-group"><h2>${esc(group.title)}</h2>${group.items.map(itemHtml).join("")}</section>`;
  }).join("");
  Object.entries(answers).forEach(([name,value])=>{
    const fields=form.elements.namedItem(name); if(!fields)return;
    const list=fields.length!==undefined&&!fields.tagName?[...fields]:[fields];
    list.forEach(field=>{ if(field.type==="checkbox"||field.type==="radio") field.checked=Array.isArray(value)?value.includes(field.value):value===field.value; else field.value=value||""; });
  });
}
function answers(){
  const result={};
  new FormData(form).forEach((value,key)=>{ if(result[key]!==undefined) result[key]=[].concat(result[key],value); else result[key]=value; });
  return result;
}
function validationError(data){
  if(data["問診_同意"]!=="同意する") return ["問診_同意","個人情報の取扱いへの同意が必要です。"];
  if(!String(data["問診_署名"]||"").trim()) return ["問診_署名","署名を入力してください。"];
  if(/女/.test(patientSex)){
    if(!data["問診_女性_月経状況"]) return ["問診_女性_月経状況","月経の状況を選択してください。"];
    if(!data["問診_女性_妊娠可能性"]) return ["問診_女性_妊娠可能性","妊娠の可能性を選択してください。"];
  }
  const frequency=data["特定_18_飲酒頻度"], amount=data["特定_19_飲酒量"];
  if((frequency==="やめた"||frequency==="飲まない（飲めない）")&&amount&&! ["1合未満"].includes(amount)) return ["特定_19_飲酒量","飲酒頻度と飲酒量の回答を確認してください。"];
  return null;
}
async function api(method, body){
  const response=await fetch(`/api/public-questionnaire/${encodeURIComponent(token)}`,{method,headers:{"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
  const data=await response.json().catch(()=>({error:`HTTP ${response.status}`})); if(!response.ok)throw new Error(data.error||"通信に失敗しました。"); return data;
}
async function verify(){
  const birth=birthInput.value.replace(/\D/g,""); document.querySelector("#verifyError").textContent="";
  if(birth.length!==4){document.querySelector("#verifyError").textContent="月日を4桁で入力してください。";return;}
  try{
    const response=await fetch(`/api/public-questionnaire/${encodeURIComponent(token)}?birth=${birth}`); const data=await response.json(); if(!response.ok)throw new Error(data.error);
    verifiedBirth=birth; patientSex=data.patient.sex||""; document.querySelector("#patientName").textContent=`${data.patient.kana||""}　${data.patient.name||""} 様`; document.querySelector("#groupName").textContent=`${data.group.name||""}　${data.group.scheduledDate||""}`; render(data.answers); verifyPanel.hidden=true; questionnairePanel.hidden=false; document.querySelector("#saveState").textContent=data.status==="submitted"?"送信済み":"入力中";
  }catch(error){document.querySelector("#verifyError").textContent=error.message||"本人確認に失敗しました。";}
}
async function save(action){
  if(action==="submit") clearTimeout(saveTimer);
  const data=answers(); const error=action==="submit"?validationError(data):null; const errorNode=document.querySelector("#formError"); errorNode.textContent="";
  if(error){errorNode.textContent=error[1]; form.querySelector(`[data-field="${CSS.escape(error[0])}"]`)?.scrollIntoView({behavior:"smooth",block:"center"}); return;}
  try{document.querySelector("#saveState").textContent="保存中"; await api("POST",{birth:verifiedBirth,answers:data,action}); if(action==="submit"){questionnairePanel.hidden=true; completePanel.hidden=false; sessionStorage.clear(); scrollTo(0,0);}else document.querySelector("#saveState").textContent="保存済み";}catch(error){errorNode.textContent=error.message;document.querySelector("#saveState").textContent="未保存";}
}

document.querySelector("#verifyButton").addEventListener("click",verify);
birthInput.addEventListener("keydown",event=>{if(event.key==="Enter")verify();});
document.querySelector("#saveDraft").addEventListener("click",()=>save("save"));
document.querySelector("#submitAnswers").addEventListener("click",()=>save("submit"));
document.querySelector("#clearAndClose").addEventListener("click",()=>{location.replace("about:blank");});
form.addEventListener("input",()=>{document.querySelector("#saveState").textContent="未保存"; clearTimeout(saveTimer); saveTimer=setTimeout(()=>save("save"),1500);});
form.addEventListener("change",event=>{if(event.target.name==="問診_女性_月経状況"&&event.target.value==="閉経した"){const field=form.elements.namedItem("問診_女性_妊娠可能性");[...field].forEach(item=>{item.checked=item.value==="可能性なし";item.disabled=item.value!=="可能性なし";});}});
