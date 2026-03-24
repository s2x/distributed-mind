# Mind Checkpoint Protocol

## Overview

The checkpoint system allows AI agents to persist work state across sessions and recover from context compaction. Checkpoints are stored as tagged memories (`checkpoint` tag) in the same project space alongside regular memories.

## When to Use Checkpoints

### SAVE: Create a checkpoint when starting significant work

```typescript
// MCP tool: checkpoint_save
checkpoint_save({
    space: 'my-project',
    goal: 'Implement user authentication',
    pending: 'Add OAuth2 provider, fix session validation bug',
    notes: 'Started working on auth module',
    relatedRefs: ['JWT-decision', 'auth-architecture'], // link to relevant memories by name
});
```

**When to save a checkpoint:**

- Starting a new feature or bugfix
- When the task will take multiple sessions
- Before context compaction (the agent should auto-checkpoint)

### LOAD: At the start of a new session

```typescript
// MCP tool: checkpoint_load
checkpoint_load({
    space: 'my-project',
    includeHistory: false, // true to also get completed checkpoints
});
```

**When to load:**

- At the start of EVERY new session
- After context compaction
- When the user asks to "continue" or "resume" previous work

### DONE: When finishing significant work

```typescript
// MCP tool: checkpoint_done
checkpoint_done({
    space: 'my-project',
    summary: 'Added JWT validation, fixed session expiry check',
});
```

**When to complete:**

- When a feature is done
- When moving to a different task
- At the end of a productive session

### LIST: To find older checkpoints

```typescript
// MCP tool: checkpoint_list
checkpoint_list({
    space: 'my-project',
    status: 'active', // or "completed" or "all"
});
```

## Recovery After Compaction

**This is critical!** When context is compacted:

1. **Immediately after compaction**, call:

```typescript
checkpoint_load({ space: '<current-project>', includeHistory: true });
```

2. If there's an active checkpoint, continue that work

3. If not, review completed checkpoints to understand previous context

## Checkpoint Storage

Checkpoints are stored in the same space as project memories:

- Tags: `checkpoint`, `active` or `completed`
- Content: JSON with goal, pending, notes, timestamps
- Tier: T1 (hot) while active, demoted to T2 (warm) when completed
- Links: Use `relatedRefs` to connect checkpoints to relevant memories by name

## Best Practices

1. **Save checkpoint at session start** with clear goal
2. **Update checkpoint** when priorities change
3. **Complete checkpoint** when finishing significant work
4. **Always load** at the start of new sessions
5. **Use relatedRefs** to link checkpoints to relevant memories for better recovery context
