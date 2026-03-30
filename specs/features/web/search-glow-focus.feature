@delta-added
Feature: Search Input Cyberpunk Glow

  Scenario: Search input has subtle border by default
    Given the global search input is rendered in the sidebar
    When the input is in default state
    Then the border should be a subtle dark color (#1a1a3a)
    And no glow should be visible

  Scenario: Search input glows on focus
    Given the search input is in default state
    When the user clicks into the input or presses Tab
    Then the border should transition to cyan
    And the border glow should be 0 0 6px var(--neon-cyan), 0 0 16px rgba(0,240,255,0.4), 0 0 32px rgba(0,240,255,0.15)
    And the transition should take 200ms with ease-out-expo

  Scenario: Search input glow pulses while typing
    Given the search input has focus and user is typing
    When the user continues to type characters
    Then the glow should pulse subtly every 500ms
    And the pulse should only be visible after 1 second of continuous typing

  Scenario: Search input glow fades on blur
    Given the search input has glow from focus
    When the input loses focus
    Then the glow should fade out over 300ms
    And the border should return to default subtle color
    And the content of the input should remain unchanged

  Scenario: Search icon glows with input
    Given the search input has focus
    Then the search icon inside or beside the input should also glow
    And the icon glow should match the input border glow intensity

  Scenario: Search results inherit glow styling
    Given search results are displayed
    When each search result item renders
    Then the item should have a subtle glow on hover
    And the glow should be 0 0 4px var(--neon-cyan), 0 0 8px rgba(0,240,255,0.2)
