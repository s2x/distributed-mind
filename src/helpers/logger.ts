import type { MindStore } from '../store/mind-store';

export interface Logger {
  logInfo: (message: string) => void;
  logError: (message: string) => void;
}

export const useLogger = (): Logger => {
  const logInfo = (message: string) => {
    console.log(message);
  };

  const logError = (message: string) => {
    console.error(message);
  };

  return {
    logInfo,
    logError,
  };
};

export interface LogEntryInput {
  source: 'cli' | 'mcp' | 'api';
  operation: string;
  level?: 'info' | 'warn' | 'error';
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
  errorMessage?: string;
  callerInfo?: Record<string, unknown>;
  durationMs?: number;
}

export function createLogEntry(store: MindStore) {
  return (entry: LogEntryInput): void => {
    void store.addLog(entry);
  };
}
