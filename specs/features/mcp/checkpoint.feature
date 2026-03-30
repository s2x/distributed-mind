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

    Scenario: checkpoint.save with relatedRefs links memories
      Given memories "mem1" and "mem2" exist in "projects/test"
      When calling checkpoint_save with space "projects/test" goal "Test" pending "QUnit" relatedRefs ["mem1", "mem2"]
      Then the checkpoint is linked to those memories

  Rule: checkpoint.done tool (renamed from checkpoint_complete)

    Scenario: checkpoint.done marks checkpoint complete and demotes to T2
      Given an active checkpoint in "projects/test"
      When calling checkpoint_done with space "projects/test" checkpointName "current" summary "Completed login"
      Then the checkpoint is marked complete
      And the associated memories are demoted to tier 2

    Scenario: checkpoint.done without name completes active checkpoint
      Given an active checkpoint exists
      When calling checkpoint_done with space "projects/test" summary "Done"
      Then the active checkpoint is completed

  Rule: checkpoint.load tool (renamed from checkpoint_recover)

    Scenario: checkpoint.load recovers active checkpoint
      Given an active checkpoint with goal "Login feature"
      When calling checkpoint_load with space "projects/test"
      Then the response includes goal "Login feature"
      And the response includes pending items

    Scenario: checkpoint.load with includeHistory
      Given completed checkpoints exist
      When calling checkpoint_load with space "projects/test" includeHistory true
      Then the response includes history of past checkpoints

    Scenario: checkpoint.load with format
      When calling checkpoint_load with space "projects/test" format "md"
      Then the recovery pack is in markdown format

    Scenario: checkpoint.load with agent capability
      When calling checkpoint_load with space "projects/test" agent "opencode"
      Then capability-appropriate guidance is included

  Rule: checkpoint.list tool

    Scenario: checkpoint.list returns all checkpoints
      Given checkpoints "active" and "done-1" exist in "projects/test"
      When calling checkpoint_list with space "projects/test"
      Then both checkpoints are returned

    Scenario: checkpoint.list with status filter
      Given an active and a completed checkpoint
      When calling checkpoint_list with space "projects/test" status "active"
      Then only active checkpoints are returned

    Scenario: checkpoint.list with status completed
      Given an active and a completed checkpoint
      When calling checkpoint_list with space "projects/test" status "completed"
      Then only completed checkpoints are returned
