import type { MindStore } from '../../store/mind-store';

export interface RouteContext {
    req: Request;
    url: URL;
    store: MindStore;
    params: Record<string, string>;
    json: (data: unknown, status?: number) => Response;
    err: (msg: string, status?: number) => Response;
    parseBody: <T>(req: Request) => Promise<T>;
}

export interface RouteDefinition {
    method: string;
    match: (pathname: string) => Record<string, string> | null;
    handle: (ctx: RouteContext) => Promise<Response> | Response;
}

export function exact(pathname: string): (value: string) => Record<string, string> | null {
    return (value: string) => (value === pathname ? {} : null);
}

export function regex(re: RegExp, keys: string[]): (value: string) => Record<string, string> | null {
    return (value: string) => {
        const m = value.match(re);
        if (!m) return null;
        const params: Record<string, string> = {};
        for (let i = 0; i < keys.length; i++) {
            params[keys[i]!] = decodeURIComponent(m[i + 1] ?? '');
        }
        return params;
    };
}
