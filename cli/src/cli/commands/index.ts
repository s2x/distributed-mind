import type { ArgParser } from '../arg-parser';
import { spacesGroup } from './spaces';
import { memoriesGroup } from './memories';
import { tiersGroup } from './tiers';
import { linksGroup } from './links';
import { searchGroup } from './search';
import { statusGroup } from './status';
import { tagsGroup } from './tags';
import { guideGroup } from './guide';
import { migrationGroup } from './migration';
import { runtimeGroup } from './runtime';
import { checkpointGroup } from './checkpoint';
import type { CommandGroup } from './types';

export const SERVER_GROUP_HELP: ArgParser[] = runtimeGroup.helpEntries;

export const ALL_GROUPS: CommandGroup[] = [
    spacesGroup,
    memoriesGroup,
    tiersGroup,
    linksGroup,
    searchGroup,
    statusGroup,
    tagsGroup,
    runtimeGroup,
    guideGroup,
    migrationGroup,
    checkpointGroup,
];

export * from './types';
