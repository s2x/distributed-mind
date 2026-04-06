@web @product/memory-panel
Feature: Memory Panel

  The memory panel slides in from the right showing memory details and actions.

  Background:
    Given the web application is loaded
    And a space "test" with a memory "test-memory" exists

  Rule: Panel animation

    Scenario: Panel slides in from right when memory selected
      When clicking on memory "test-memory"
      Then the panel slides in from the right edge
      And the animation takes 300ms with ease-out-expo

    Scenario: Panel slides out when closed
      Given the memory panel is open
      When clicking the close button or pressing Escape
      Then the panel slides out to the right
      And the animation takes 250ms

    Scenario: Panel has neon cyan glow on left border
      Given the memory panel is visible
      Then the left border has a vertical cyan glow line
      And the glow pulses subtly

  Rule: Panel content

    Scenario: Panel shows memory name
      Given a memory "my-memory" exists
      When the panel opens for "my-memory"
      Then the name "my-memory" is displayed

    Scenario: Panel shows memory content
      Given a memory with content "test content here"
      When the panel opens
      Then the content is displayed

    Scenario: Panel shows tier badge
      Given a memory in tier 2
      When the panel opens
      Then a "T2" badge is shown

    Scenario: Panel shows tags
      Given a memory with tags "cat:decision"
      When the panel opens
      Then the tags are displayed

    Scenario: Content fade in after panel enters
      Given the panel is animating in
      When the panel has traveled 50% of the animation
      Then the inner content begins fading in

  Rule: Panel actions

    Scenario: Inline edit mode
      Given the panel is open
      When clicking the edit button
      Then an edit input replaces the content display

    Scenario: Promote action
      Given a memory in tier 2
      When clicking promote in the panel
      Then the memory moves to tier 1
      And the tier badge updates

    Scenario: Demote action
      Given a memory in tier 1
      When clicking demote in the panel
      Then the memory moves to tier 2

    Scenario: Pin action
      Given a memory is not pinned
      When clicking pin in the panel
      Then the memory becomes pinned

    Scenario: Delete action
      Given a memory exists
      When clicking delete in the panel
      Then the memory is deleted
      And the panel closes

  Rule: Tag management

    Scenario: Add tag in panel
      Given the panel is open
      When clicking add tag
      Then a tag input appears
      And entering a tag and pressing Enter adds it

    Scenario: Remove tag in panel
      Given a memory has tag "cat:decision"
      When clicking the remove button on that tag
      Then the tag is removed

  Rule: Close behavior

    Scenario: Close on Escape key
      Given the panel is open
      When pressing Escape
      Then the panel closes

    Scenario: Close on click outside
      Given the panel is open
      When clicking in the main content area
      Then the panel closes

    Scenario: Rapid memory selection queues animations
      Given the panel is animating in for memory A
      When clicking memory B before animation completes
      Then the animation reverses for A
      And then plays enter for B
