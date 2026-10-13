'use strict';

/**
 * ProVeri — South African identity validation (offline, deterministic).
 *
 * The 13-digit SA ID is self-validating: it encodes date of birth, gender,
 * citizenship and a Luhn check digit. Validating it locally costs nothing,
 * needs no partner key, and catches typos and fabricated numbers before we
 * ever spend money on a paid Home Affairs verification call.
 *
 * Layout: YYMMDD SSSS C A Z
 *   YYMMDD  date of birth (century resolved from the citizenship/issue digit)
 *   SSSS    0000-4999 female, 5000-9999 male
 *   C       0 = SA citizen, 1 = permanent resident
 *   A       historical check position (8 or 9)
 *   Z       Luhn check digit
 *
 * Live enrichment (paid, adapter-swappable): DHA NPR real-time ID verification,
 * 3D facial liveness and biometric matching via OmniCheck / Datanamix class APIs.
 */

const { sha256, nowIso } = require('../kernel/util');

const ID_REGEX = /^\d{13}$/;

function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function resolveCentury(twoDigitYear, citizenshipDigit, issuedAfter1986) {
  const yy = Number(twoDigitYear);
  // Post-1986 IDs use the 8/9 marker; the practical rule: a birth year that
  // would make the person younger than ~14 or older than ~110 is the wrong century.
  const currentYear = new Date().getFullYear() % 100;
  const currentCentury = Math.floor(new Date().getFullYear() / 100);
  const candidate1900 = (currentCentury - 1) * 100 + yy;
  const candidate2000 = currentCentury * 100 + yy;
  const ageIf1900 = new Date().getFullYear() - candidate1900;
  const ageIf2000 = new Date().getFullYear() - candidate2000;
  if (ageIf2000 >= 0 && ageIf2000 <= 110) return candidate2000;
  if (ageIf1900 >= 0 && ageIf1900 <= 110) return candidate1900;
  return issuedAfter1986 || citizenshipDigit === '0' ? candidate2000 : candidate1900;
}

function parseDateOfBirth(idNumber) {
  const yy = idNumber.slice(0, 2);
  const mm = Number(idNumber.slice(2, 4));
  const dd = Number(idNumber.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const year = resolveCentury(yy, idNumber[10], Number(idNumber[11]) === 9);
  const date = new Date(Date.UTC(year, mm - 1, dd));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null;
  return { year, month: mm, day: dd, iso: `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` };
}

/**
 * Validate an SA ID number.
 * @returns {{valid:boolean, reasons:string[], dateOfBirth:*, gender:*, citizenship:*, age:*, masked:string}}
 */
function validateSaId(idNumber) {
  const reasons = [];
  const raw = String(idNumber || '').replace(/\s|-/g, '');

  if (!ID_REGEX.test(raw)) {
    return { valid: false, reasons: ['ID must be exactly 13 digits'], dateOfBirth: null, gender: null, citizenship: null, age: null, masked: null };
  }

  if (!luhnValid(raw)) reasons.push('Checksum digit is invalid — this number was not issued by Home Affairs');

  const dob = parseDateOfBirth(raw);
  if (!dob) reasons.push('Embedded birth date is not a real calendar date');

  const genderCode = Number(raw.slice(6, 10));
  const gender = Number.isNaN(genderCode) ? null : genderCode < 5000 ? 'FEMALE' : 'MALE';

  const citizenshipDigit = raw[10];
  const citizenship = citizenshipDigit === '0' ? 'SA_CITIZEN'
    : citizenshipDigit === '1' ? 'PERMANENT_RESIDENT'
    : null;
  if (!citizenship) reasons.push(`Citizenship digit "${citizenshipDigit}" is not valid (expected 0 or 1)`);

  const marker = raw[11];
  if (marker !== '8' && marker !== '9') reasons.push(`Control digit "${marker}" is not valid (expected 8 or 9)`);

  let age = null;
  if (dob) {
    const today = new Date();
    const birthdayThisYear = Date.UTC(today.getUTCFullYear(), dob.month - 1, dob.day);
    const hadBirthday = today.getTime() >= birthdayThisYear;
    age = today.getUTCFullYear() - dob.year - (hadBirthday ? 0 : 1);
  }

  if (age !== null && age < 18) reasons.push(`Holder is ${age} — under 18 and cannot register as a pro`);
  if (age !== null && age > 110) reasons.push(`Implied age ${age} is not credible`);

  return {
    valid: reasons.length === 0,
    reasons,
    dateOfBirth: dob,
    gender,
    citizenship,
    age,
    masked: `${raw.slice(0, 6)}******${raw.slice(-1)}`,
    // Never store the raw ID in the ledger — only its seal.
    seal: sha256(raw),
    checkedAt: nowIso(),
  };
}

/** Extract the province-less but useful signals we surface on the trust card. */
function describeSaId(idNumber) {
  const result = validateSaId(idNumber);
  if (!result.valid) return { valid: false, reasons: result.reasons };
  return {
    valid: true,
    age: result.age,
    gender: result.gender,
    citizenship: result.citizenship,
    dateOfBirth: result.dateOfBirth.iso,
    masked: result.masked,
    seal: result.seal,
  };
}

/**
 * Generate a *syntactically valid* demo ID for seeding and tests.
 * Deterministic from a seed so snapshots stay stable.
 */
function synthesiseSaId({ seed = 'demo', gender = 'MALE', age = 34, citizenship = 'SA_CITIZEN' } = {}) {
  const year = new Date().getFullYear() - age;
  const hashSeed = Number.parseInt(sha256(seed).slice(0, 8), 16);
  const month = (hashSeed % 12) + 1;
  const day = (hashSeed % 28) + 1;
  const yy = String(year % 100).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const genderCode = String(gender === 'MALE' ? 5000 + (hashSeed % 5000) : hashSeed % 5000).padStart(4, '0');
  const citizenDigit = citizenship === 'SA_CITIZEN' ? '0' : '1';
  const marker = year >= 1986 ? '8' : '9';
  const base = `${yy}${mm}${dd}${genderCode}${citizenDigit}${marker}`;
  for (let z = 0; z <= 9; z += 1) {
    if (luhnValid(base + z)) return base + z;
  }
  throw new Error('could not synthesise a valid SA ID');
}

module.exports = { validateSaId, describeSaId, synthesiseSaId, luhnValid, ID_REGEX };
