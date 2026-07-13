import assert from "node:assert/strict";

import { evaluateGuidanceAge, formatJapaneseDate } from "./guidance.js";

const date = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const beforeHalfYear = evaluateGuidanceAge(date("1951-12-01"), 2026, date("2026-05-31"));
assert.equal(beforeHalfYear.fiscalYearEndAge, 75);
assert.equal(beforeHalfYear.examAge, 74);
assert.equal(beforeHalfYear.included, true);
assert.equal(formatJapaneseDate(beforeHalfYear.completionDeadline), "2026年6月1日");

const exactlyHalfYear = evaluateGuidanceAge(date("1951-12-01"), 2026, date("2026-06-01"));
assert.equal(exactlyHalfYear.included, false);

const beforeBirthdayButTooLate = evaluateGuidanceAge(date("1951-12-01"), 2026, date("2026-11-30"));
assert.equal(beforeBirthdayButTooLate.examAge, 74);
assert.equal(beforeBirthdayButTooLate.included, false);

const seventyFiveToday = evaluateGuidanceAge(date("1951-12-01"), 2026, date("2026-12-01"));
assert.equal(seventyFiveToday.examAge, 75);
assert.equal(seventyFiveToday.included, false);

const fiscalYearForty = evaluateGuidanceAge(date("1987-03-31"), 2026, date("2026-07-01"));
assert.equal(fiscalYearForty.fiscalYearEndAge, 40);
assert.equal(fiscalYearForty.examAge, 39);
assert.equal(fiscalYearForty.included, true);

const leapDay = evaluateGuidanceAge(date("1952-02-29"), 2026, date("2026-08-27"));
assert.equal(formatJapaneseDate(leapDay.completionDeadline), "2026年8月28日");
assert.equal(leapDay.included, true);

console.log("guidance age tests: ok");
