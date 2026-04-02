@mcp @product/checkpoint
Feature: MCP Checkpoint Tools

  MCP tools for session checkpoint management.

  Background:
    Given the MCP server is running
    And a space "projects/test" exists

  Rule: checkpoint.save tool (renamed from checkpoint_set)

    Scenario: checkpoint.save creates or updates checkpoint
      When calling checkpoint_save with space "projects/test" goal "Implement login" pending "Add OAuth"
      Then a checkpoint exists with the goal
      And the checkpoint has pending items

    Scenario: checkpoint.save with notes
      When calling checkpoint_save with space "projects/test" goal "Test" pending "QUnit" notes "Use Vitest instead"
      Then the checkpoint includes the notes

    Scenario: checkpoint.save with linked_memories links memories
      Given memories "mem1" and "mem2" exist in "projects/test"
      When calling checkpoint_save with space "projects/test" goal "Test" pending "QUnit" linked_memories ["mem1", "mem2"]
      Then the checkpoint is linked to those memories

  Rule: checkpoint.done tool (renamed from checkpoint_complete)

    Scenario: checkpoint.done transforms checkpoint into session memory and deletes checkpoint
      Given an active checkpoint in "projects/test" with goal "Complete API refactor" and pending "Write tests"
      And memories "mem1" and "mem2" exist in "projects/test"
      And the checkpoint has linked_memories ["mem1", "mem2"]
      When calling checkpoint_done with space "projects/test" checkpointName "current" summary "Completed login"
      Then a new memory is created in "sessions/test"
      And the memory has tags ["type:session", "cat:summary"]
      And the memory content includes "Complete API refactor"
      And the memory has linked references to "mem1" and "mem2"
      And the original checkpoint is deleted from "projects/test"

    Scenario: checkpoint.done without name completes active checkpoint
      Given an active checkpoint exists
      When calling checkpoint_done with space "projects/test" summary "Done"
      Then the active checkpoint is transformed into a session memory
      And the checkpoint is deleted

  Rule: checkpoint.load tool (renamed from checkpoint_recover)

    Scenario: checkpoint.load requires checkpointName
      Given an active checkpoint with goal "Login feature"
      When calling checkpoint_load with space "projects/test" checkpointName "current"
      Then the response includes goal "Login feature"
      And the response includes pending items

    Scenario: checkpoint.load with checkpointName
      Given an active checkpoint with goal "First goal" and pending "First pending"
      And a second active checkpoint with goal "Second goal" and pending "Second pending"
      When calling checkpoint_load with space "projects/test" checkpointName "First goal"
      Then the response includes goal "First goal"
      And the response includes pending "First pending"

  Rule: checkpoint.query tool (renamed from checkpoint_list)

    Scenario: checkpoint.query returns all checkpoints
      Given an active checkpoint exists in "projects/test"
      When calling checkpoint_query with space "projects/test"
      Then the active checkpoint is returned

    Scenario: checkpoint.query with status filter
      Given an active checkpoint exists
      When calling checkpoint_query with space "projects/test" status "active"
      Then only active checkpoints are returned

    Scenario: checkpoint.query with status completed
      Given an active checkpoint exists
      When calling checkpoint_query with space "projects/test" status "completed"
      Then no checkpoints are returned (completed checkpoints are deleted, not tagged)

    Scenario: checkpoint.query with date range filters
      Given checkpoints exist in "projects/test"
      When calling checkpoint_query with space "projects/test" from "2024-01-01" to "2024-12-31"
      Then checkpoints within the date range are returned

    Scenario: checkpoint.query with tag filter
      Given checkpoints exist in "projects/test"
      When calling checkpoint_query with space "projects/test" tag "checkpoint"
      Then checkpoints with the matching tag are returned

    Scenario: checkpoint.query with limit and offset
      Given multiple checkpoints exist in "projects/test"
      When calling checkpoint_query with space "projects/test" limit 1 offset 0
      Then paginated checkpoints are returned with total count
