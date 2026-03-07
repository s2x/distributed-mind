import { describe, expect, test } from 'bun:test';
import { ArgParser } from '../src/cli/arg-parser';

describe('ArgParser', () => {
    describe('Multi-word commands', () => {
        test('should match single-word command', () => {
            const parser = new ArgParser(['create', '<space>', '<desc>'], 'Test', []);

            expect(parser.matches(['create', 'my-space', 'desc'])).toBe(true);
            expect(parser.matches(['other', 'my-space', 'desc'])).toBe(false);
        });

        test('should match two-word command with alias', () => {
            const parser = new ArgParser(['checkpoint set|cp set', '<space>', '<goal>'], 'Test', []);

            expect(parser.matches(['checkpoint', 'set', 'myproj', 'goal'])).toBe(true);
            expect(parser.matches(['cp', 'set', 'myproj', 'goal'])).toBe(true);
            expect(parser.matches(['checkpoint', 'other', 'myproj', 'goal'])).toBe(false);
        });

        test('should match three-word command', () => {
            const parser = new ArgParser(['checkpoint complete|cp complete', '<space>', '<id>', '<what>'], 'Test', []);

            expect(parser.matches(['checkpoint', 'complete', 'proj', '1', 'done'])).toBe(true);
            expect(parser.matches(['cp', 'complete', 'proj', '1', 'done'])).toBe(true);
        });

        test('should extract params correctly for multi-word commands', () => {
            const parser = new ArgParser(['checkpoint set|cp set', '<space>', '<goal>', '<pending>'], 'Test', []);

            const params = parser.getParams(['checkpoint', 'set', 'myproj', 'Implement auth', 'Fix bug']);

            expect(params.space).toBe('myproj');
            expect(params.goal).toBe('Implement auth');
            expect(params.pending).toBe('Fix bug');
        });

        test('should handle flags with multi-word commands', () => {
            const parser = new ArgParser(['checkpoint set|cp set', '<space>', '<goal>', '<pending>'], 'Test', [
                { name: 'notes', alias: 'n', hasValue: true },
            ]);

            const params = parser.getParams(['checkpoint', 'set', 'proj', 'goal', 'pending']);
            const flags = parser.getFlags(['--notes', 'My notes']);

            expect(params.space).toBe('proj');
            expect(flags.notes).toBe('My notes');
        });

        test('should reject wrong number of args', () => {
            const parser = new ArgParser(['test', '<arg>'], 'Test', []);

            expect(parser.matches(['test'])).toBe(false);
            expect(parser.matches(['test', 'a', 'b'])).toBe(false);
            expect(parser.matches(['test', 'a'])).toBe(true);
        });

        test('should handle piped aliases', () => {
            const parser = new ArgParser(['delete|d|rm', '<space>'], 'Test', []);

            expect(parser.matches(['delete', 'space'])).toBe(true);
            expect(parser.matches(['d', 'space'])).toBe(true);
            expect(parser.matches(['rm', 'space'])).toBe(true);
        });
    });

    describe('getPositionalArgs', () => {
        test('should extract positional args', () => {
            const parser = new ArgParser(['test', '<arg>'], 'Test', [{ name: 'flag', hasValue: true }]);

            const positional = parser.getPositionalArgs(['test', 'value', '--flag', 'flag-value']);

            expect(positional).toEqual(['test', 'value']);
        });

        test('should handle boolean flags', () => {
            const parser = new ArgParser(['test', '<arg>'], 'Test', [{ name: 'verbose', hasValue: false }]);

            const positional = parser.getPositionalArgs(['test', 'value', '--verbose']);

            expect(positional).toEqual(['test', 'value']);
        });
    });
});
