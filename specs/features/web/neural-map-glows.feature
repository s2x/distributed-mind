@delta-added
Feature: Neural Map Cyberpunk Glows

  Scenario: T1 Hot memory nodes glow with red-orange ambient pulse
    Given the neural map is displayed
    When a T1 (Hot) memory node is rendered
    Then the node should have a red-orange glow filter applied
    And the glow should pulse with a 2s infinite animation
    And the glow brightness should oscillate between 80% and 120%

  Scenario: T2 Warm memory nodes glow with gold steady glow
    Given the neural map is displayed
    When a T2 (Warm) memory node is rendered
    Then the node should have a gold glow that is always on
    And the glow should be steady (no animation)

  Scenario: T3 Cold memory nodes glow with blue subtle glow
    Given the neural map is displayed
    When a T3 (Cold) memory node is rendered
    Then the node should have a blue glow at 60% intensity
    And the glow should be steady (no animation)

  Scenario: Graph edges have subtle glow
    Given the neural map is displayed with edges
    When an edge between two nodes is rendered
    Then the edge stroke should have a subtle glow effect
    And the glow color should be cyan at 30% opacity
    And the glow width should add 2px blur to the stroke

  Scenario: Focused node has enhanced glow
    Given a node is clicked and becomes focused
    When the focused node renders
    Then the node should have an enhanced glow ring around it
    And the ring should be cyan with 0 0 12px var(--neon-cyan), 0 0 24px rgba(0,240,255,0.5)
    And the ring should pulse once per second

  Scenario: Graph background has subtle radial gradient
    Given the neural map SVG is visible
    Then the background should have a subtle radial gradient from center
    And the gradient should go from #0a0a1a (center) to #050510 (edges)
    And the gradient should give a depth/vignette effect

  Scenario: Concentric tier rings have glow
    Given the neural map displays tier rings
    When the rings are rendered
    Then each ring stroke should have a glow matching its tier color
    And the ring glow should be very subtle (opacity 0.2)
