@delta-added
Feature: Tier Sections Cyberpunk Glow

  Scenario: T1 tier heading has red glow underline
    Given the tier sections are displayed in list view
    When the T1 heading renders
    Then the heading should have a red glowing underline
    And the glow should be 0 0 4px var(--tier1), 0 0 8px rgba(255,123,114,0.5)
    And the underline should pulse subtly with a 3s animation

  Scenario: T2 tier heading has gold glow underline
    Given the tier sections are displayed in list view
    When the T2 heading renders
    Then the heading should have a gold glowing underline
    And the glow should be 0 0 4px var(--tier2), 0 0 8px rgba(227,179,65,0.5)

  Scenario: T3 tier heading has blue glow underline
    Given the tier sections are displayed in list view
    When the T3 heading renders
    Then the heading should have a blue glowing underline
    And the glow should be 0 0 4px var(--tier3), 0 0 8px rgba(121,192,255,0.5)

  Scenario: Memory item glows on hover
    Given a memory item is displayed in a tier list
    When the user hovers over the memory item
    Then the item should gain a cyan border glow
    And the glow should be 0 0 4px var(--neon-cyan), 0 0 8px rgba(0,240,255,0.25)
    And the transition should take 150ms

  Scenario: Active memory item has persistent glow
    Given a memory is currently selected
    When the memory list item renders
    Then the active item should have a persistent glow border
    And the glow should be cyan at 60% opacity
    And the glow should pulse subtly

  Scenario: Memory item tags glow on hover
    Given a memory item has tags displayed
    When the user hovers over the memory item
    Then each tag should have a subtle glow matching the current tier color
    And the tag glow should fade in over 100ms

  Scenario: Empty tier section has dimmed text
    Given a tier section has no memories
    When the empty tier message renders
    Then the text should be dimmed (muted color)
    And should not have any glow effects
