@web @product/list-view
Feature: List View

  List view displays memories organized by tier sections.

  Background:
    Given the web application is loaded
    And a space "test" exists with memories in all tiers

  Rule: Tier sections

    Scenario: T1 section displays hot memories
      Given memories in tier 1
      When the list view renders
      Then a "T1 Hot" section exists
      And T1 memories are listed under it

    Scenario: T2 section displays warm memories
      Given memories in tier 2
      When the list view renders
      Then a "T2 Warm" section exists
      And T2 memories are listed under it

    Scenario: T3 section displays cold memories
      Given memories in tier 3
      When the list view renders
      Then a "T3 Cold" section exists
      And T3 memories are listed under it

    Scenario: Empty tier section shows message
      Given no memories in tier 1
      When the list view renders
      Then the T1 section shows "No hot memories"

  Rule: Memory items

    Scenario: Memory item shows tier badge
      Given a memory in tier 1
      When the list item renders
      Then a tier badge shows "T1"

    Scenario: Memory item shows name and tags
      Given a memory "test-memory" with tags "cat:decision"
      When the list item renders
      Then the name "test-memory" is displayed
      And the tag is shown

    Scenario: Memory item hover shows glow
      Given a memory item in the list
      When hovering over the item
      Then a cyan border glow appears

    Scenario: Active memory item has persistent glow
      Given a memory is selected
      When the list renders
      Then the selected item has a persistent glow

  Rule: Inline editing

    Scenario: Double-click enables inline edit
      Given a memory item is displayed
      When double-clicking the memory name
      Then an edit input appears
      And the current name is in the input

    Scenario: Enter saves the edit
      Given an inline edit input is active
      When pressing Enter
      Then the new name is saved
      And the input closes

    Scenario: Escape cancels the edit
      Given an inline edit input is active
      When pressing Escape
      Then the original name is preserved
      And the input closes

  Rule: Memory actions

    Scenario: Promote button moves memory up
      Given a memory in tier 2
      When clicking the promote button
      Then the memory moves to tier 1
      And the UI updates

    Scenario: Demote button moves memory down
      Given a memory in tier 1
      When clicking the demote button
      Then the memory moves to tier 2
      And the UI updates

    Scenario: Pin button pins memory
      Given a memory is not pinned
      When clicking the pin button
      Then the memory becomes pinned
      And a pin icon appears

    Scenario: Delete button removes memory
      Given a memory exists
      When clicking the delete button
      Then the memory is removed from the list
      And a confirmation is shown if configured
