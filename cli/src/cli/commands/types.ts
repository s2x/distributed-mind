import type { Logger } from '../../helpers/logger';
import type { MindStore } from '../../store/mind-store';
import type { ArgParser } from '../arg-parser';

export interface CommandHandler {
  matches: (args: string[]) => boolean;
  execute: (_args: string[], _store: MindStore, _logger: Logger) => Promise<void>;
}

export interface CommandGroup {
  name: string;
  commands: CommandHandler[];
  helpEntries: ArgParser[];
}
