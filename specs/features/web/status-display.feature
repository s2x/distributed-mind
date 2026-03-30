@web @product/status-display
Feature: Status Display

  Status display shows storage info and tier breakdowns.

  Background:
    Given the web application is loaded

  Rule: Tier pills

    Scenario: Status shows T1 pill with count and limit
      Given a space with 10 T1 memories
      When viewing status
      Then a T1 pill shows "T1: 10/25"

    Scenario: Status shows T2 pill with count and limit
      Given a space with 30 T2 memories
      When viewing status
      Then a T2 pill shows "T2: 30/50"

    Scenario: Status shows T3 pill as unlimited
      Given a space with 100 T3 memories
      When viewing status
      Then a T3 pill shows "T3: 100"

    Scenario: T1 full shows full indicator
      Given a space with 25 T1 memories
      When viewing status
      Then the T1 pill indicates it is full

  Rule: Global status

    Scenario: Status shows total memory count
      Given multiple spaces with memories
      When viewing global status
      Then total memory count is shown

    Scenario: Status shows memory breakdown by tier
      When viewing global status
      Then tier breakdown shows counts for T1, T2, T3

    Scenario: Status shows link count
      Given memories with links
      When viewing status
      Then total link count is shown
