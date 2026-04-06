@delta-added
Feature: Sidebar Cyberpunk Glow

  Scenario: Logo displays neon cyan glow effect
    Given the user is on the main page
    When the sidebar renders
    Then the mind logo should have a cyan neon glow via stacked box-shadows
    And the glow should pulse subtly with a 3s infinite ease-in-out animation

  Scenario: Logo glow color and intensity
    Given the sidebar is visible
    When the user hovers over the logo area
    Then the logo glow intensity increases by 20% via enhanced box-shadow

  Scenario: Space item displays glow on hover
    Given the sidebar shows a list of spaces
    When the user hovers over a space item
    Then the space item should have a cyan border glow with 0 0 4px var(--neon-cyan), 0 0 8px rgba(0,240,255,0.3)
    And the glow should fade in over 150ms

  Scenario: Active space item has persistent glow
    Given a space is currently selected
    When the sidebar renders the active space item
    Then the active space item should have a persistent cyan glow border
    And the glow should be slightly dimmer than hover state (opacity 0.6)

  Scenario: Search input glows on focus
    Given the search input is visible in the sidebar
    When the user clicks or tabs into the search input
    Then the search input border should transition to neon cyan
    And the border glow should be 0 0 6px var(--neon-cyan), 0 0 16px rgba(0,240,255,0.4)
    And the transition should take 200ms with ease-out-expo timing

  Scenario: Search input glow disappears on blur
    Given the search input has neon cyan glow
    When the user clicks outside or tabs away from the search input
    Then the border glow should fade out over 200ms
    And the border returns to the default subtle border color

  Scenario: Sidebar header has subtle glow divider
    Given the sidebar is visible
    When the sidebar header renders
    Then the bottom border of the header should have a faint cyan glow
    And the glow should be barely visible (opacity 0.3)

  Scenario: Space item count badge has muted glow
    Given a space item is displayed with a count badge
    When the space item is in default state
    Then the count badge should have a subtle background glow matching the tier color
    And the badge glow should be very dim (opacity 0.2)
