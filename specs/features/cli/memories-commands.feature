@cli @product/memories
Feature: CLI Memory Commands

  CLI commands for memory management.

  Background:
    Given the CLI is initialized
    And a space "test" exists

  Rule: list command (memories)

    Scenario: list shows T1 and T2 memories by default
      Given memories in T1 and T2
      When running "./mind list test"
      Then T1 and T2 memories are shown

    Scenario: list --tier 1 shows only T1
      When running "./mind list test --tier 1"
      Then only T1 memories are shown

    Scenario: list --tier 3 shows cold memories
      When running "./mind list test --tier 3"
      Then T3 memories are shown

    Scenario: list --tag filters by tag
      When running "./mind list test --tag cat:decision"
      Then only memories with that tag are shown

  Rule: add command

    Scenario: add creates a memory
      When running "./mind add test my-memory \"Memory content\""
      Then "my-memory" exists in "test"
      And it has content "Memory content"

    Scenario: add with --tags
      When running "./mind add test my-memory \"Content\" --tags cat:decision"
      Then the memory has the specified tag

    Scenario: add with --tier
      When running "./mind add test cold-memory \"Content\" --tier 3"
      Then the memory is in tier 3

  Rule: read command

    Scenario: read shows memory content
      Given a memory "my-memory" with content "test content"
      When running "./mind read test my-memory"
      Then the content is displayed
      And the memory tier is promoted

  Rule: edit command

    Scenario: edit updates content
      When running "./mind edit test my-memory \"New content\""
      Then the memory content is updated

  Rule: remove command

    Scenario: remove deletes memory
      When running "./mind remove test my-memory"
      Then the memory no longer exists

  Rule: tag command (memory tagging)

    Scenario: tag memory adds tag
      When running "./mind tag test my-memory cat:decision"
      Then the memory has tag "cat:decision"

    Scenario: untag memory removes tag
      Given memory "my-memory" has tag "cat:decision"
      When running "./mind untag test my-memory cat:decision"
      Then the tag is removed
