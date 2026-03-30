@cli @product/search
Feature: CLI Search Commands

  CLI commands for searching memories.

  Background:
    Given the CLI is initialized
    And spaces with memories exist

  Rule: search command

    Scenario: search finds matching memories
      When running "./mind search \"typescript\""
      Then matching memories are displayed

    Scenario: search with --space filters to space
      When running "./mind search \"test\" --space projects/mind"
      Then only memories from that space are shown

    Scenario: search with --tag filters by tag
      When running "./mind search \"test\" --tag cat:decision"
      Then only memories with that tag are shown

    Scenario: search with --tier filters by tier
      When running "./mind search \"test\" --tier 1"
      Then only T1 memories are shown

    Scenario: search with --detail shows content preview
      When running "./mind search \"test\" --detail"
      Then content previews are shown

    Scenario: search with prefix matching
      When running "./mind search \"type*\""
      Then memories with words starting with "type" are found

    Scenario: search with quoted phrase
      When running './mind search \'"exact phrase"\' '
      Then exact phrase matches are returned

  Rule: query command

    Scenario: query returns memories by metadata
      When running "./mind query"
      Then memories are returned ordered by changed_at

    Scenario: query with --space filters
      When running "./mind query --space projects/mind"
      Then only memories from that space are returned

    Scenario: query with --tag filters
      When running "./mind query --tag cat:decision"
      Then only memories with that tag are returned

    Scenario: query with --tier filters
      When running "./mind query --tier 2"
      Then only T2 memories are returned

    Scenario: query with --from and --to date range
      When running "./mind query --from 2024-01-01 --to 2024-12-31"
      Then memories within that date range are returned

    Scenario: query with pagination
      When running "./mind query --limit 10 --offset 20"
      Then 10 memories are returned starting at offset 20

    Scenario: query returns all tiers including T3
      When running "./mind query --tier 3"
      Then T3 cold memories are included
