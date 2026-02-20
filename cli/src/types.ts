type SpaceName = string;

export interface Memory {
    name: string;
    description: string;
}

interface Space {
    description: string;
    memories: Memory[];
}

export interface Brain {
    [spaceName: SpaceName]: Space;
}
