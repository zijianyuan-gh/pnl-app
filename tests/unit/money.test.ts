import { describe, expect, it } from 'vitest';
import { centsToDecimal, centsToInput, divRound, formatCompact, formatMoney, parseMoney, MINUS } from '../../src/lib/money';

const cents = (s: string | number) => {
  const r = parseMoney(s);
  if (!r.ok) throw new Error(`parse failed: ${s}`);
  return r.cents;
};

describe('parseMoney', () => {
  it('parses plain and formatted amounts to exact integer cents', () => {
    expect(cents('200')).toBe(20000);
    expect(cents('0.1')).toBe(10);
    expect(cents('.05')).toBe(5);
    expect(cents('1,234.56')).toBe(123456);
    expect(cents('$1,234.56')).toBe(123456);
    expect(cents('USD 12.3')).toBe(1230);
    expect(cents('+5')).toBe(500);
  });
  it('handles negatives in every common notation', () => {
    expect(cents('-50')).toBe(-5000);
    expect(cents(`${MINUS}50`)).toBe(-5000);
    expect(cents('-$50.25')).toBe(-5025);
    expect(cents('$-50.25')).toBe(-5025);
    expect(cents('(12.30)')).toBe(-1230);
    expect(cents('12.30-')).toBe(-1230);
  });
  it('avoids float errors', () => {
    expect(cents('0.1') + cents('0.2')).toBe(30);
    expect(cents('19.99') * 3).toBe(5997);
    expect(cents(1.005)).toBe(101);
    expect(cents(0.29)).toBe(29);
  });
  it('rounds >2 decimals half away from zero and flags it', () => {
    const r = parseMoney('1.005');
    expect(r.ok && r.cents).toBe(101);
    expect(r.ok && r.rounded).toBe(true);
    expect(cents('-1.004')).toBe(-100);
    expect(cents('9.995')).toBe(1000);
    const z = parseMoney('2.500');
    expect(z.ok && z.rounded).toBe(false);
  });
  it('rejects garbage', () => {
    expect(parseMoney('').ok).toBe(false);
    expect(parseMoney('abc').ok).toBe(false);
    expect(parseMoney('1.2.3').ok).toBe(false);
    expect(parseMoney('--5').ok).toBe(false);
    expect(parseMoney('12e5').ok).toBe(false);
    expect(parseMoney('99999999999999999').ok).toBe(false);
  });
  it('treats -0 as 0', () => {
    expect(cents('-0')).toBe(0);
    expect(Object.is(cents('-0.00'), -0)).toBe(false);
  });
});

describe('formatMoney', () => {
  it('formats with explicit signs', () => {
    expect(formatMoney(15000, { sign: 'always' })).toBe('+$150.00');
    expect(formatMoney(-5000, { sign: 'always' })).toBe(`${MINUS}$50.00`);
    expect(formatMoney(0, { sign: 'always' })).toBe('$0.00');
    expect(formatMoney(367000)).toBe('$3,670.00');
    expect(formatMoney(-123456789)).toBe(`${MINUS}$1,234,567.89`);
    expect(formatMoney(5, { sign: 'always' })).toBe('+$0.05');
    expect(formatMoney(123456, { cents: false })).toBe('$1,235');
  });
  it('compact format for calendar cells', () => {
    expect(formatCompact(20000)).toBe('+$200');
    expect(formatCompact(450)).toBe('+$4.50');
    expect(formatCompact(4950)).toBe('+$50');
    expect(formatCompact(-5000)).toBe(`${MINUS}$50`);
    expect(formatCompact(-92340)).toBe(`${MINUS}$923`);
    expect(formatCompact(99949)).toBe('+$999');
    expect(formatCompact(99950)).toBe('+$1K');
    expect(formatCompact(123456)).toBe('+$1.2K');
    expect(formatCompact(999999)).toBe('+$9.9K');
    expect(formatCompact(1234567)).toBe('+$12K');
    expect(formatCompact(99999999)).toBe('+$999K');
    expect(formatCompact(-250000000)).toBe(`${MINUS}$2.5M`);
    expect(formatCompact(0)).toBe('$0');
    for (const c of [1, 999, 99999, 123456, 9999999, 99999999, 123456789, 9999999999, 99999999999]) {
      expect(formatCompact(c).length).toBeLessThanOrEqual(6);
      expect(formatCompact(-c).length).toBeLessThanOrEqual(6);
    }
  });
  it('input/decimal round trips', () => {
    expect(centsToInput(-5025)).toBe('50.25');
    expect(centsToInput(20000)).toBe('200');
    expect(centsToDecimal(-5)).toBe('-0.05');
    expect(cents(centsToDecimal(-123456))).toBe(-123456);
  });
  it('divRound', () => {
    expect(divRound(10, 3)).toBe(3);
    expect(divRound(-10, 3)).toBe(-3);
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(7, 0)).toBe(0);
  });
});

describe('parseMoney — separators (iPhone decimal-comma regions, CSV)', () => {
  const c = (s: string) => {
    const r = parseMoney(s);
    return r.ok ? r.cents : r.error;
  };
  it('accepts decimal commas from comma-decimal keyboards', () => {
    expect(c('12,5')).toBe(1250);
    expect(c('12,50')).toBe(1250);
    expect(c(',5')).toBe(50);
    expect(c('-0,99')).toBe(-99);
    expect(c('1.234,56')).toBe(123456);
    expect(c('12.345.678,9')).toBe(1234567890);
  });
  it('keeps US grouping', () => {
    expect(c('1,234')).toBe(123400);
    expect(c('12,345,678')).toBe(1234567800);
    expect(c('1,234.56')).toBe(123456);
    expect(c('1.234.567')).toBe(123456700);
    expect(c("1'234.50")).toBe(123450);
    expect(c('1 234,50')).toBe(123450);
  });
  it('rejects malformed grouping instead of guessing', () => {
    for (const s of ['1,2,3', '12,3456', '1,23,456', '1.2.3', '1,234,56.00', '1.234.56', '1,234.5,6', '12,,5', ',']) {
      expect(parseMoney(s).ok, s).toBe(false);
    }
  });
});
