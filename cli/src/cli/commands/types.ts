import type { ArgParser } from '../arg-parser';
import type { MindStore } from '../../store/mind-store';
import type { Logger } from '../../helpers/logger';

export interface CommandHandler {
  matches: (args: string[]) => boolean;
  execute: (args: string[], store: MindStore, logger: Logger) => Promise<void>;
}

export interface CommandGroup {
  name: string;
  commands: CommandHandler[];
  helpEntries: ArgParser[];
}
