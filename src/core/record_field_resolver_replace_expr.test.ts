import { describe, it, expect } from 'bun:test';
import { ReplaceWithExpression } from './record_field_resolver_replace_expr';

describe('ReplaceWithExpression', () => {
  it('replaces placeholder in the old expression with new expression', () => {
    const expr = new ReplaceWithExpression(
      '@PH@',
      'SELECT * FROM t WHERE id = @PH@',
      '123',
    );
    expect(expr.build()).toBe('SELECT * FROM t WHERE id = 123');
  });

  it('replaces multiple occurrences', () => {
    const expr = new ReplaceWithExpression(
      '?',
      'a = ? AND b = ?',
      '1',
    );
    expect(expr.build()).toBe('a = 1 AND b = 1');
  });

  it('returns "0=1" when placeholder is empty', () => {
    const expr = new ReplaceWithExpression(
      '',
      'SELECT * FROM t WHERE id = ?',
      '1',
    );
    expect(expr.build()).toBe('0=1');
  });

  it('returns "0=1" when old expression is empty', () => {
    const expr = new ReplaceWithExpression(
      '@PH@',
      '',
      'new_val',
    );
    expect(expr.build()).toBe('0=1');
  });

  it('returns "0=1" when new expression is empty', () => {
    const expr = new ReplaceWithExpression(
      '@PH@',
      'old expression with @PH@',
      '',
    );
    expect(expr.build()).toBe('0=1');
  });

  it('handles expression with no placeholder match', () => {
    const expr = new ReplaceWithExpression(
      '@PH@',
      'no placeholder here',
      'new_val',
    );
    expect(expr.build()).toBe('no placeholder here');
  });

  it('replaces with SQL sub-expression', () => {
    const expr = new ReplaceWithExpression(
      '@CHANGED@',
      '@CHANGED@ = true',
      '(field_old IS NOT NULL AND field_old != field_new)',
    );
    expect(expr.build()).toBe(
      '(field_old IS NOT NULL AND field_old != field_new) = true',
    );
  });
});
