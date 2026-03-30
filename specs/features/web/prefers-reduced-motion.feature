@delta-added
Feature: Reduced Motion Accessibility

  Scenario: All animations disabled when prefers-reduced-motion is reduce
    Given the user has prefers-reduced-motion: reduce set in OS
    When the page loads and renders all components
    Then NO animations should play (neon-pulse, glow-breathe, etc.)
    And transitions should complete instantly (0ms or 0.01ms)
    And motion should be eliminated entirely

  Scenario: Memory panel shows instantly without slide animation
    Given the user has reduced motion preference
    When a memory is selected
    Then the memory panel should appear immediately with no slide animation
    And the panel should be fully visible from the first frame

  Scenario: Memory panel hides instantly without exit animation
    Given the user has reduced motion preference and panel is open
    When the user closes the panel
    Then the panel should disappear immediately with no slide-out animation

  Scenario: Modal appears instantly without scale animation
    Given the user has reduced motion preference
    When a modal is triggered
    Then the modal should appear immediately at full scale
    And no scale-in animation should play

  Scenario: Modal closes instantly without fade animation
    Given the user has reduced motion preference and modal is open
    When the user dismisses the modal
    Then the modal should disappear immediately
    And no fade-out animation should play

  Scenario: Graph nodes have no ambient pulse animation
    Given the user has reduced motion preference
    When the neural map renders
    Then T1 nodes should NOT pulse or breathe
    And all node glows should be static

  Scenario: Toggle indicator moves instantly without slide
    Given the user has reduced motion preference
    When the user switches between List and Map views
    Then the indicator should snap immediately to the new position
    And no sliding animation should occur

  Scenario: Hover glow effects are reduced
    Given the user has reduced motion preference
    When hovering over interactive elements (buttons, tags, items)
    Then glow effects should appear instantly without fade-in
    And glow intensity should be reduced by 50% to avoid jarring visual effects

  Scenario: Spinner animation stops
    Given the user has reduced motion preference
    When a spinner is displayed (graph loading, etc.)
    Then the spinner should be static (not rotating)
    And the spinner should show a static frame of its rotation

  Scenario: Toast notifications appear without slide animation
    Given the user has reduced motion preference
    When a toast notification is triggered
    Then the toast should appear immediately without slide-in
    And the toast should disappear immediately without slide-out when dismissed
