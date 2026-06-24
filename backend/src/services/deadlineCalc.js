'use strict';
// Pure date math for statutory clocks. No DB. Works at DATE granularity (YYYY-MM-DD), UTC.
// weekend = array of UTC day numbers treated as non-business (default [0,6] = Sun, Sat).
// holidays = array of 'YYYY-MM-DD' strings.

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function toDate(s) {
  // accepts 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS'; returns a UTC-midnight Date of the date portion
  var d = String(s).slice(0, 10).split('-');
  return new Date(Date.UTC(parseInt(d[0], 10), parseInt(d[1], 10) - 1, parseInt(d[2], 10)));
}
function fmt(dt) { return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()); }
function addDays(dt, n) { return new Date(dt.getTime() + n * 86400000); }

function holidaySet(holidays) {
  var set = {}; (holidays || []).forEach(function (h) { set[String(h).slice(0, 10)] = true; }); return set;
}
function isBusinessDay(dt, hset, weekend) {
  weekend = weekend || [0, 6];
  if (weekend.indexOf(dt.getUTCDay()) >= 0) return false;
  if (hset[fmt(dt)]) return false;
  return true;
}

function addCalendarDays(startStr, n) { return fmt(addDays(toDate(startStr), n)); }

// N business days AFTER start (start day not counted). n may be negative.
function addBusinessDays(startStr, n, holidays, weekend) {
  var hset = holidaySet(holidays); weekend = weekend || [0, 6];
  var dt = toDate(startStr); var step = n >= 0 ? 1 : -1; var remaining = Math.abs(n);
  while (remaining > 0) { dt = addDays(dt, step); if (isBusinessDay(dt, hset, weekend)) remaining--; }
  return fmt(dt);
}

function calendarDaysBetween(aStr, bStr) {
  return Math.round((toDate(bStr).getTime() - toDate(aStr).getTime()) / 86400000);
}

// count of business days in (a, b]  (a excluded, b included); signed if b < a.
function businessDaysBetween(aStr, bStr, holidays, weekend) {
  var hset = holidaySet(holidays); weekend = weekend || [0, 6];
  var a = toDate(aStr), b = toDate(bStr);
  if (a.getTime() === b.getTime()) return 0;
  var sign = b > a ? 1 : -1; var lo = sign > 0 ? a : b, hi = sign > 0 ? b : a;
  var count = 0, dt = addDays(lo, 1);
  while (dt <= hi) { if (isBusinessDay(dt, hset, weekend)) count++; dt = addDays(dt, 1); }
  return sign * count;
}

function addBasisDays(startStr, n, basis, holidays, weekend) {
  return basis === 'business_days' ? addBusinessDays(startStr, n, holidays, weekend) : addCalendarDays(startStr, n);
}
function basisDaysBetween(aStr, bStr, basis, holidays, weekend) {
  return basis === 'business_days' ? businessDaysBetween(aStr, bStr, holidays, weekend) : calendarDaysBetween(aStr, bStr);
}

module.exports = {
  toDate: toDate, fmt: fmt, isBusinessDay: isBusinessDay, holidaySet: holidaySet,
  addCalendarDays: addCalendarDays, addBusinessDays: addBusinessDays,
  calendarDaysBetween: calendarDaysBetween, businessDaysBetween: businessDaysBetween,
  addBasisDays: addBasisDays, basisDaysBetween: basisDaysBetween
};
