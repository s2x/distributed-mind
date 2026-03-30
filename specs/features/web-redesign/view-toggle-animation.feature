@delta-added
Feature: View Toggle Cyberpunk Animation

  Scenario: Toggle track has glass background
    Given the view toggle (List/Neural Map) is rendered
    When the toggle track renders
    Then the track background should be rgba(10, 10, 26, 0.8)
    And the track should have a subtle blur effect (backdrop-filter blur)
    And the track border should be rgba(0,240,255,0.2)

  Scenario: Active toggle button has cyan glow
    Given the view toggle shows List as active
    When the List button is active
    Then the active button should have a cyan glow
    And the glow should be 0 0 6px var(--neon-cyan), 0 0 12px rgba(0,240,255,0.4)
    And the inactive button should have no glow

  Scenario: Sliding indicator moves between options
    Given the view toggle is on List view
    When the user clicks Neural Map
    Then the active indicator should slide from List to Neural Map
    And the slide animation should take 200ms with ease-out-expo
    And the indicator should glow cyan during the transition

  Scenario: Toggle buttons have glow on hover
    Given the view toggle is displayed
    When the user hovers over an inactive toggle button
    Then the hovered button should gain a subtle glow
    And the glow should be 0 0 4px var(--neon-cyan), 0 0 8px rgba(0,240,255,0.3)
    And the transition should take 150ms

  Scenario: Keyboard navigation moves indicator
    Given the view toggle has focus
    When the user presses ArrowLeft or ArrowRight
    Then the active indicator should move to the next/prev option
    And the movement should animate over 200ms
    And the correct button should gain the glow
