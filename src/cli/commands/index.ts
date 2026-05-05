import type { ArgParser } from '../arg-parser';

import { checkpointGroup } from './checkpoint';
import { dimindMemoriesGroup } from './dimind-memories';
import { guideGroup } from './guide';
import { linksGroup } from './links';
import { memoriesGroup } from './memories';
import { migrationGroup } from './migration';
import { runtimeGroup } from './runtime';
import { searchGroup } from './search';
import { spacesGroup } from './spaces';
import { statusGroup } from './status';
import { syncGroup } from './sync';
import { tagsGroup } from './tags';
import { tiersGroup } from './tiers';
import type { CommandGroup } from './types';

export const SERVER_GROUP_HELP: ArgParser[] = runtimeGroup.helpEntries;

export const ALL_GROUPS: CommandGroup[] = [
  spacesGroup,
  // dimindMemoriesGroup before memoriesGroup so `add` (with --soft default override)
  // and `memory promote-to-hard` / `memory demote-to-soft` / `history` are matched first.
  dimindMemoriesGroup,
  memoriesGroup,
  tiersGroup,
  linksGroup,
  searchGroup,
  statusGroup,
  tagsGroup,
  syncGroup,
  runtimeGroup,
  guideGroup,
  migrationGroup,
  checkpointGroup,
];

export * from './types';
