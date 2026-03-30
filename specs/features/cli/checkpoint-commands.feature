@cli @product/checkpoint
Feature: CLI Checkpoint Commands

  CLI commands for session checkpoint management.

  Background:
    Given the CLI is initialized
    And a space "projects/test" exists

  Rule: checkpoint set command

    Scenario: checkpoint set creates checkpoint
      When running "./mind checkpoint set projects/test \"Implement login\" \"Add OAuth provider\""
      Then a checkpoint exists with the goal
      And it has pending items

    Scenario: checkpoint set with --notes
      When running "./mind checkpoint set projects/test \"Goal\" \"Pending\" --notes \"Some notes\""
      Then the checkpoint includes the notes

    Scenario: checkpoint set updates existing active
      Given an active checkpoint exists
      When running "./mind checkpoint set projects/test \"New goal\" \"New pending\""
      Then the checkpoint is updated

  Rule: checkpoint complete command

    Scenario: checkpoint complete marks done
      Given an active checkpoint exists
      When running "./mind checkpoint complete projects/test my-checkpoint \"Added OAuth\""
      Then the checkpoint is marked complete

    Scenario: checkpoint done is alias for complete
      When running "./mind checkpoint done projects/test my-checkpoint \"Summary\""
      Then the checkpoint is marked complete

  Rule: checkpoint recover command

    Scenario: checkpoint recover returns recovery pack
      Given an active checkpoint with goal "Login feature"
      When running "./mind checkpoint recover projects/test"
      Then the recovery pack is displayed
      And it includes the goal and pending items

    Scenario: checkpoint recover --history includes past checkpoints
      When running "./mind checkpoint recover projects/test --history"
      Then completed checkpoints are included

    Scenario: checkpoint recover --format md
      When running "./mind checkpoint recover projects/test --format md"
      Then the output is in markdown format

    Scenario: checkpoint recover --format json
      When running "./mind checkpoint recover projects/test --format json"
      Then the output is in JSON format

  Rule: checkpoint list command

    Scenario: checkpoint list shows all checkpoints
      Given checkpoints "active" and "done-1" exist
      When running "./mind checkpoint list projects/test"
      Then both checkpoints are listed

    Scenario: checkpoint list --status active
      When running "./mind checkpoint list projects/test --status active"
      Then only active checkpoints are shown

    Scenario: checkpoint list --status completed
      When running "./mind checkpoint list projects/test --status completed"
      Then only completed checkpoints are shown

  Rule: cp alias

    Scenario: cp set works as alias
      When running "./mind cp set projects/test \"Goal\" \"Pending\""
      Then the checkpoint is created

    Scenario: cp done works as alias
      When running "./mind cp done projects/test my-checkpoint \"Summary\""
      Then the checkpoint is marked complete
