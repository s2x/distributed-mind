import { describe, expect, test } from 'bun:test';

import { renderTemplate } from '../src/helpers/template-renderer';

describe('template renderer strict mode', () => {
  test('renders placeholders and conditionals when all keys are resolved', async () => {
    const output = renderTemplate('Hello {{name}} {{#if excited}}!{{/if}}', {
      name: 'mind',
      excited: true,
    });

    expect(output).toBe('Hello mind !');
  });

  test('throws when a placeholder key is missing', async () => {
    expect(() => renderTemplate('Hello {{name}}', {})).toThrow(/name/);
  });

  test('throws when a placeholder resolves to nullish value', async () => {
    expect(() => renderTemplate('Hello {{name}}', { name: undefined })).toThrow(/name/);
  });

  test('throws when a conditional key is missing', async () => {
    expect(() => renderTemplate('{{#if enabled}}ok{{/if}}', {})).toThrow(/enabled/);
  });

  test('throws when template contains unresolved tokens after rendering', async () => {
    expect(() => renderTemplate('Hello {{#if feature}}world', { feature: true })).toThrow(
      /unresolved/i
    );
  });
});
