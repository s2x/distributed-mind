# Mind Checkpoint Protocol

## Overview

The checkpoint system allows AI agents to persist work state across sessions and recover from context compaction. It uses hidden spaces (`<space>:sessions`) to store checkpoint memories without cluttering the main workspace.

## When to Use Checkpoints

### SET: Create a checkpoint when starting significant work

```typescript
// MCP tool: checkpoint_set
checkpoint_set({
  space: "my-project",
  goal: "Implement user authentication",
  pending: "Add OAuth2 provider, fix session validation bug",
  notes: "Started working on auth module"
})
```

**When to set a checkpoint:**
- Starting a new feature or bugfix
- When the task will take multiple sessions
- Before context compaction (the agent should auto-checkpoint)

### RECOVER: At the start of a new session

```typescript
// MCP tool: checkpoint_recover
checkpoint_recover({
  space: "my-project",
  includeHistory: false  // true to also get completed checkpoints
})
```

**When to recover:**
- At the start of EVERY new session
- After context compaction
- When the user asks to "continue" or "resume" previous work

### COMPLETE: When finishing significant work

```typescript
// MCP tool: checkpoint_complete
checkpoint_complete({
  space: "my-project",
  checkpointId: 1,
  whatWasDone: "Added JWT validation, fixed session expiry check"
})
```

**When to complete:**
- When a feature is done
- When moving to a different task
- At the end of a productive session

### LIST: To find older checkpoints

```typescript
// MCP tool: checkpoint_list
checkpoint_list({
  space: "my-project",
  status: "active"  // or "completed" or "all"
})
```

## Recovery After Compaction

**This is critical!** When context is compacted:

1. **Immediately after compaction**, call:
```typescript
checkpoint_recover({ space: "<current-project>", includeHistory: true })
```

2. If there's an active checkpoint, continue that work

3. If not, review completed checkpoints to understand previous context

## Checkpoint Storage

Checkpoints are stored in hidden spaces:
- Space name: `<project>:sessions`
- Tags: `checkpoint`, `active` or `completed`
- Content: JSON with goal, pending, notes, timestamps
- Links: Point to relevant memories in the main project space

Use `list --hidden` to see checkpoint spaces, or use checkpoint tools directly.

## Best Practices

1. **Set checkpoint at session start** with clear goal
2. **Update checkpoint** when priorities change
3. **Complete checkpoint** when finishing significant work
4. **Always recover** at the start of new sessions
5. **Use links** to connect checkpoints to relevant memories
