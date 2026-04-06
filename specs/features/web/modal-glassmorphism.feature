@delta-added
Feature: Modal Glassmorphism Cyberpunk

  Scenario: Modal backdrop has blur effect
    Given a modal is triggered to open
    When the modal backdrop renders
    Then the backdrop should have backdrop-filter: blur(12px) saturate(180%)
    And the background should be rgba(5, 5, 16, 0.7)
    And the blur should create a frosted glass effect over the content behind

  Scenario: Modal scales in from center on appear
    Given a modal is triggered to open
    When the modal enters the screen
    Then the modal should scale from 0.92 to 1.0
    And the opacity should go from 0 to 1
    And the animation should take 250ms with ease-out-expo timing

  Scenario: Modal has glowing border
    Given the modal is visible
    Then the modal border should have a cyan glow
    And the glow should be 0 0 8px var(--neon-cyan), 0 0 16px rgba(0,240,255,0.3)
    And the border should be rgba(0,240,255,0.4) color
    And the border glow should pulse subtly every 3 seconds

  Scenario: Modal header text has subtle glow
    Given the modal is visible
    Then the modal title should have a subtle text-shadow glow
    And the glow should be 0 0 8px rgba(0,240,255,0.4)
    And the text should be slightly brighter than body text

  Scenario: Modal input glows on focus
    Given a modal input field is visible
    When the input receives focus
    Then the input border should glow cyan
    And the glow should be 0 0 6px var(--neon-cyan), 0 0 16px rgba(0,240,255,0.4)
    And the transition should take 200ms

  Scenario: Modal backdrop fades in
    Given a modal is opening
    When the modal backdrop appears
    Then the backdrop should fade in over 200ms
    And the modal content should begin its scale animation simultaneously

  Scenario: Modal closes with fade out
    Given a modal is open
    When the user clicks outside or presses Escape
    Then the modal should fade out over 150ms
    And the scale should decrease slightly to 0.96 during exit
    And the backdrop should fade out simultaneously

  Scenario: Modal glass has subtle inner highlight
    Given the modal is visible
    Then the top edge of the modal should have a subtle white inner highlight
    And the highlight should be a 1px gradient from rgba(255,255,255,0.1) to transparent
    And the highlight should give a glass edge reflection effect
