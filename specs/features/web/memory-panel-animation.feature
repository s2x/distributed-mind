@delta-added
Feature: Memory Panel Slide Animation

  Scenario: Memory panel slides in from right when memory selected
    Given a memory exists in the current space
    When the user clicks on a memory item
    Then the memory panel should slide in from the right edge
    And the animation should take 300ms with ease-out-expo timing
    And the panel should start fully transparent and off-screen right
    And the panel should end fully visible at its resting position

  Scenario: Memory panel slides out to right when closed
    Given the memory panel is open and visible
    When the user clicks the close button or presses Escape
    Then the memory panel should slide out toward the right edge
    And the exit animation should take 250ms (faster than enter)
    And the panel should fade out simultaneously during slide

  Scenario: Memory panel has neon cyan glow border on left edge
    Given the memory panel is visible
    Then the left border of the panel should have a vertical cyan glow line
    And the glow should be 0 0 8px var(--neon-cyan), 0 0 16px rgba(0,240,255,0.3)
    And the glow should pulse subtly every 4 seconds

  Scenario: Memory panel content fades in after panel enters
    Given the memory panel is animating in
    When the panel has traveled 50% of the animation distance
    Then the inner content (title, tier badge, content) should begin fading in
    And the content fade should start at 0% opacity and reach 100% by panel arrival

  Scenario: Memory panel does not animate on page load
    Given the memory panel is initially hidden
    When the page first loads
    Then the memory panel should remain hidden until a memory is selected

  Scenario: Rapid memory selection queues animations correctly
    Given the memory panel is animating in for memory A
    When the user clicks memory B before the animation completes
    Then the panel should immediately reverse the current animation
    And then play the enter animation for memory B
    And no animation state should be lost or glitched
