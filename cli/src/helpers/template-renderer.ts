export type TemplateValue = string | number | boolean | null | undefined;

type TemplateContext = Record<string, TemplateValue>;

function isTruthy(value: TemplateValue): boolean {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value !== 0;
    }

    if (typeof value === 'string') {
        return value.length > 0;
    }

    return false;
}

function hasKey(context: TemplateContext, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(context, key);
}

function ensureResolvedValue(context: TemplateContext, key: string, tokenType: 'placeholder' | 'conditional'): TemplateValue {
    if (!hasKey(context, key)) {
        throw new Error(`Template unresolved ${tokenType}: missing key "${key}"`);
    }

    const value = context[key];
    if (value === null || value === undefined) {
        throw new Error(`Template unresolved ${tokenType}: key "${key}" resolved to nullish value`);
    }

    return value;
}

function assertNoUnresolvedTokens(rendered: string): void {
    if (/\{\{[#/]?if\s+[a-zA-Z0-9_]+\s*\}\}|\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(rendered)) {
        throw new Error('Template unresolved tokens remain after rendering');
    }
}

export function renderTemplate(template: string, context: TemplateContext): string {
    const withConditionals = template.replace(/\{\{#if\s+([a-zA-Z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, key, body) => {
        const value = ensureResolvedValue(context, key as string, 'conditional');
        return isTruthy(value) ? body : '';
    });

    const rendered = withConditionals.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
        const value = ensureResolvedValue(context, key as string, 'placeholder');
        return String(value);
    });

    assertNoUnresolvedTokens(rendered);
    return rendered;
}
