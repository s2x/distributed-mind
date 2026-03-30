@web @product/neural-map
Feature: Neural Map Graph View

  The neural map displays memories as nodes in a force-directed graph with concentric tier rings.

  Background:
    Given the web application is loaded
    And a space "test" exists with memories

  Rule: Graph API integration

    Scenario: Graph API call fetches nodes and edges
      When navigating to the neural map view
      Then the graph API is called for the current space
      And nodes and edges are rendered

    Scenario: Graph loading shows spinner
      When the graph data is loading
      Then a spinner is displayed

  Rule: Pan and zoom interaction

    Scenario: Pan with direct manipulation follows cursor
      Given the neural map is displayed
      When the user drags on the canvas
      Then the graph pans in the drag direction

    Scenario: Zoom with mouse wheel
      Given the neural map is displayed
      When the user scrolls the mouse wheel
      Then the graph zooms in or out

    Scenario: Zoom buttons work
      Given the neural map is displayed
      When clicking the zoom in button
      Then the graph zooms in
      And clicking zoom out zooms out

    Scenario: Zoom has minimum limit
      Given the neural map is at minimum zoom (0.45)
      When clicking zoom in
      Then the zoom level does not go below 0.45

    Scenario: Zoom has maximum limit
      Given the neural map is at maximum zoom (4.5)
      When clicking zoom out
      Then the zoom level does not exceed 4.5

  Rule: Node interaction

    Scenario: Node click opens memory panel
      Given the neural map is displayed
      When clicking on a memory node
      Then the memory panel slides in from the right
      And the panel shows the memory details

    Scenario: Neighborhood focus on selected node
      Given a node is selected
      When the node is focused
      Then connected nodes are highlighted
      And other nodes are dimmed

  Rule: Tier ring visualization

    Scenario: Three concentric rings exist for T1, T2, T3
      When the neural map renders
      Then concentric rings exist at radii 130, 230, 330

    Scenario: T1 ring is red
      When examining the T1 ring
      Then the ring color is red

    Scenario: T2 ring is gold
      When examining the T2 ring
      Then the ring color is gold

    Scenario: T3 ring is blue
      When examining the T3 ring
      Then the ring color is blue

  Rule: Node labels

    Scenario: Labels are truncated to 25 characters
      Given a memory with name "this-is-a-very-long-memory-name-that-exists"
      When the label renders
      Then the visible label is "this-is-a-very-long-memor..."
      And the full name is in a tooltip

    Scenario: Short labels display fully
      Given a memory with name "short"
      When the label renders
      Then the label is "short"

  Rule: graphTierColor function

    Scenario: graphTierColor returns red for tier 1
      When calling graphTierColor with tier 1
      Then the color is red

    Scenario: graphTierColor returns gold for tier 2
      When calling graphTierColor with tier 2
      Then the color is gold

    Scenario: graphTierColor returns blue for tier 3
      When calling graphTierColor with tier 3
      Then the color is blue

    Scenario: graphTierColor throws on invalid tier
      When calling graphTierColor with tier 4
      Then an error is thrown indicating tier is invalid
