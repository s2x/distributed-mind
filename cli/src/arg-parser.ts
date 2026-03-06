import { style } from 'bun-style';

export class ArgParser {
    private shape: string[];
    private description: string;
    private flags: { name: string; alias?: string; hasValue: boolean; description?: string }[];

    constructor(
        shape: string[],
        description: string,
        flags: { name: string; alias?: string; hasValue: boolean; description?: string }[] = []
    ) {
        this.shape = shape;
        this.description = description;
        this.flags = flags;
    }

    /**
     * Matches positional args (ignoring flags like --tag, --tier, --label).
     */
    matches(args: string[]): boolean {
        const positional = this.getPositionalArgs(args);
        if (this.shape.length !== positional.length) return false;

        for (let i = 0; i < this.shape.length; i++) {
            if (this.isParam(this.shape[i]!)) continue;
            if (!this.shape[i]?.split('|').some((x) => x === positional[i])) return false;
        }
        return true;
    }

    static param(name: string): string {
        return `<${name}>`;
    }

    protected isParam(part: string): boolean {
        return part.startsWith('<') && part.endsWith('>');
    }

    protected getParamName(part: string): string {
        return part.slice(1, -1);
    }

    /**
     * Extract positional args, stripping out --flag and --flag=value pairs.
     */
    private getPositionalArgs(args: string[]): string[] {
        const result: string[] = [];
        for (let i = 0; i < args.length; i++) {
            const arg = args[i]!;
            if (arg.startsWith('--')) {
                // Check if this flag expects a value
                const flagName = arg.replace(/^--/, '');
                const flag = this.flags.find((f) => f.name === flagName || f.alias === flagName);
                if (flag?.hasValue) {
                    i++; // skip the next arg (the value)
                }
                continue;
            }
            result.push(arg);
        }
        return result;
    }

    getParams(args: string[]): any {
        const positional = this.getPositionalArgs(args);
        const params: any = {};

        for (let i = 0; i < this.shape.length; i++) {
            const part = this.shape[i]!;
            if (this.isParam(part)) {
                params[this.getParamName(part)] = positional[i];
            }
        }
        return params;
    }

    getFlags(args: string[]): Record<string, string | boolean> {
        const flags: Record<string, string | boolean> = {};
        for (let i = 0; i < args.length; i++) {
            const arg = args[i]!;
            if (!arg.startsWith('--')) continue;
            const flagName = arg.replace(/^--/, '');
            const flag = this.flags.find((f) => f.name === flagName || f.alias === flagName);
            if (flag?.hasValue && i + 1 < args.length) {
                flags[flag.name] = args[++i]!;
            } else if (flag) {
                flags[flag.name] = true;
            }
        }
        return flags;
    }

    public getRendered(): string {
        const flagsStr = this.flags
            .map((f) => {
                const flagPart = f.hasValue ? ` [--${f.name} <value>]` : ` [--${f.name}]`;
                const descPart = f.description ? style(` (${f.description})`, ['dim']) : '';
                return flagPart + descPart;
            })
            .join('');

        return (
            style(
                'mind ' +
                    this.shape
                        .map((part) => {
                            if (this.isParam(part)) {
                                return style(`<${this.getParamName(part)}>`, ['italic']);
                            }
                            return part;
                        })
                        .join(' ') +
                    flagsStr,
                ['bold']
            ) + style(`\n      ↪ ${this.description}`, ['dim'])
        );
    }
}
