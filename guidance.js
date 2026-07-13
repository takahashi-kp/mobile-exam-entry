function clampedDate(year, month, day) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

function addYearsClamped(date, years) {
  return clampedDate(date.getFullYear() + years, date.getMonth(), date.getDate());
}

function addMonthsClamped(date, months) {
  const firstOfTarget = new Date(date.getFullYear(), date.getMonth() + months, 1);
  return clampedDate(firstOfTarget.getFullYear(), firstOfTarget.getMonth(), date.getDate());
}

function compareDateOnly(left, right) {
  const leftValue = new Date(left.getFullYear(), left.getMonth(), left.getDate()).getTime();
  const rightValue = new Date(right.getFullYear(), right.getMonth(), right.getDate()).getTime();
  return Math.sign(leftValue - rightValue);
}

export function ageAtFiscalYearEnd(birthDate, fiscalYear) {
  const end = new Date(fiscalYear + 1, 2, 31);
  let age = end.getFullYear() - birthDate.getFullYear();
  const birthday = addYearsClamped(birthDate, age);
  if (compareDateOnly(end, birthday) < 0) age -= 1;
  return age;
}

export function ageOnDate(birthDate, targetDate) {
  let age = targetDate.getFullYear() - birthDate.getFullYear();
  const birthday = addYearsClamped(birthDate, age);
  if (compareDateOnly(targetDate, birthday) < 0) age -= 1;
  return age;
}

export function evaluateGuidanceAge(birthDate, fiscalYear, examDate) {
  if (!birthDate || !examDate || !Number.isFinite(fiscalYear)) {
    return { included: null, fiscalYearEndAge: null, examAge: null, completionDeadline: null, turns75On: null, reason: "生年月日と受診日を入力してください" };
  }
  const fiscalYearEndAge = ageAtFiscalYearEnd(birthDate, fiscalYear);
  const examAge = ageOnDate(birthDate, examDate);
  const turns75On = addYearsClamped(birthDate, 75);
  const completionDeadline = addMonthsClamped(turns75On, -6);
  if (fiscalYearEndAge < 40) {
    return { included: false, fiscalYearEndAge, examAge, completionDeadline, turns75On, reason: "年度末年齢40歳未満は対象外" };
  }
  if (compareDateOnly(examDate, turns75On) >= 0) {
    return { included: false, fiscalYearEndAge, examAge, completionDeadline, turns75On, reason: "受診日に75歳以上は対象外" };
  }
  if (compareDateOnly(examDate, completionDeadline) >= 0) {
    return { included: false, fiscalYearEndAge, examAge, completionDeadline, turns75On, reason: "75歳までに6か月の保健指導期間を確保できないため対象外" };
  }
  return { included: true, fiscalYearEndAge, examAge, completionDeadline, turns75On, reason: "年度末40歳以上で、受診日と完了期限の年齢条件を満たします" };
}

export function formatJapaneseDate(date) {
  if (!date) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

