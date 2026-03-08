import ansiStyles from 'ansi-styles';
import type { BackgroundColor, ForegroundColor, Modifier } from 'ansi-styles';

export type LogStyles = keyof ForegroundColor | keyof BackgroundColor | keyof Modifier;

export function style(message: string, styles?: LogStyles[]): string {
    if (!styles || styles.length === 0) {
        return message;
    }

    const openingTags: string[] = [];
    const closingTags: string[] = [];

    for (const styleName of styles) {
        const ansiStyle = ansiStyles[styleName];
        openingTags.push(ansiStyle.open);
        closingTags.unshift(ansiStyle.close);
    }

    return `${openingTags.join('')}${message}${closingTags.join('')}`;
}
