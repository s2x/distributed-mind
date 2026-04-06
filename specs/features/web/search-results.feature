@web @product/search-results
Feature: Search Results

  Search results display with grouping and navigation.

  Background:
    Given the web application is loaded
    And search results are available

  Rule: Result grouping

    Scenario: Results are grouped by space
      When searching for "test"
      Then results from the same space are grouped together
      And each group shows the space name

    Scenario: Multiple space groups shown
      Given results exist in "projects/mind" and "projects/other"
      When searching
      Then separate groups are shown for each space

  Rule: Result display

    Scenario: Result shows memory name and space
      Given a search result for "my-memory" in "projects/test"
      When the result displays
      Then it shows the memory name "my-memory"
      And it shows the space "projects/test"

    Scenario: Result shows tier badge
      Given a search result for a T2 memory
      When the result displays
      Then a T2 badge is shown

    Scenario: Result shows content preview
      Given a search result with matching content
      When the result displays
      Then a content preview is shown with matched terms

    Scenario: Highlight matched terms in preview
      When displaying search results
      Then matched terms are highlighted
      And the highlight uses cyan glow

  Rule: Navigation

    Scenario: Click navigates to space and memory
      Given a search result for "my-memory" in "projects/test"
      When clicking the result
      Then navigation goes to the space
      And the memory panel opens

    Scenario: Search while in space searches within space
      Given viewing space "projects/test"
      When searching for "term"
      Then results are filtered to that space
