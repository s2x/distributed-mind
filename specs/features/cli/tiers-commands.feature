@cli @product/tier-system
Feature: CLI Tier Commands

  CLI commands for tier management.

  Background:
    Given the CLI is initialized
    And a space "test" with memories exists

  Rule: promote command

    Scenario: promote moves memory up one tier
      Given a memory "mem" in tier 2
      When running "./mind promote test mem"
      Then the memory is now in tier 1

    Scenario: promote T3 to T2
      Given a memory in tier 3
      When running "./mind promote test mem"
      Then the memory moves to tier 2

    Scenario: promote T1 throws
      Given a memory in tier 1
      When running "./mind promote test mem"
      Then an error "already at highest tier" is shown

  Rule: demote command

    Scenario: demote moves memory down one tier
      Given a memory in tier 1
      When running "./mind demote test mem"
      Then the memory moves to tier 2

    Scenario: demote T2 to T3
      Given a memory in tier 2
      When running "./mind demote test mem"
      Then the memory moves to tier 3

    Scenario: demote T3 throws
      Given a memory in tier 3
      When running "./mind demote test mem"
      Then an error "already at lowest tier" is shown

  Rule: pin command

    Scenario: pin makes memory immune to eviction
      When running "./mind pin test mem"
      Then the memory is pinned
      And the output confirms pinning

  Rule: unpin command

    Scenario: unpin removes immunity
      Given a pinned memory
      When running "./mind unpin test mem"
      Then the memory is no longer pinned
