@delta-added
Feature: Button and Tag Cyberpunk Glow

  Scenario: Primary button has gradient and cyan glow
    Given a primary button is rendered (btn-primary)
    When the button is in default state
    Then the button should have a cyan background gradient
    And the gradient should go from var(--neon-cyan) to var(--neon-blue)
    And the button should have box-shadow glow of 0 0 8px rgba(0,240,255,0.4)
    And the glow should intensify on hover

  Scenario: Primary button glow intensifies on hover
    Given a primary button is in default state
    When the user hovers over the button
    Then the glow should intensify from 0.4 to 0.7 opacity
    And the glow spread should increase by 4px
    And the transition should take 150ms

  Scenario: Primary button glow animates on click
    Given a primary button is hovered
    When the user clicks the button
    Then the glow should flash bright white for 100ms
    And then return to hover state glow level

  Scenario: Ghost button has glow border on hover
    Given a ghost button is in default state (btn-ghost)
    When the user hovers over the ghost button
    Then the button border should gain a cyan glow
    And the glow should be 0 0 4px var(--neon-cyan), 0 0 8px rgba(0,240,255,0.3)
    And the button text should brighten to full white

  Scenario: Ghost button active state has glow
    Given a ghost button is currently active (is-active class)
    When the button renders
    Then the button should have a persistent cyan glow border
    And the glow should be at 50% intensity

  Scenario: Tag has subtle glow on hover
    Given a tag element is displayed
    When the user hovers over the tag
    Then the tag should have a subtle cyan glow
    And the glow should be 0 0 3px var(--neon-cyan), 0 0 6px rgba(0,240,255,0.2)
    And the transition should take 100ms

  Scenario: Tag glow color matches tier when inside memory item
    Given a tag is displayed within a memory item
    When the user hovers over the tag
    Then the tag glow should match the current tier color instead of cyan
    And the glow should be at 50% of the tier glow intensity

  Scenario: Add tag button has dashed glow on hover
    Given a tag-add button is displayed
    When the user hovers over the button
    Then the dashed border should glow cyan
    And the glow should be 0 0 4px var(--neon-cyan), 0 0 8px rgba(0,240,255,0.3)
    And the icon should brighten

  Scenario: Danger button has red glow
    Given a danger button is rendered (btn-danger)
    When the button is in default state
    Then the button should have a red glow
    And the glow should be 0 0 6px var(--danger), 0 0 12px rgba(255,51,102,0.4)
