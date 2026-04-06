@web @product/spa-routing
Feature: SPA Routing

  Client-side URL routing with history support and route restoration.

  Background:
    Given the web application is loaded

  Rule: URL contract

    Scenario: Home route shows space list
      When navigating to "/"
      Then the space list is displayed

    Scenario: Space route shows memories
      When navigating to "/spaces/projects/test"
      Then the memories for that space are displayed

    Scenario: Space with list view param
      When navigating to "/spaces/projects/test?view=list"
      Then the list view is shown

    Scenario: Space with map view param
      When navigating to "/spaces/projects/test?view=map"
      Then the neural map is shown

    Scenario: Space with memory param opens panel
      When navigating to "/spaces/projects/test?memory=my-memory"
      Then the memory panel opens for "my-memory"

    Scenario: Encoded space names in URL
      When navigating to "/spaces/projects%2Ftest"
      Then the space "projects/test" is shown

    Scenario: Encoded memory names in URL
      When navigating to "/spaces/test?memory=my-memory%20name"
      Then the memory "my memory name" panel opens

  Rule: pushState on navigation

    Scenario: Clicking a space updates URL with pushState
      Given the home page is displayed
      When clicking on space "projects/test"
      Then the URL changes to "/spaces/projects/test"
      And pushState is used (no page reload)

    Scenario: View toggle updates URL
      Given viewing space "test"
      When switching to neural map view
      Then the URL updates to include "?view=map"

    Scenario: Selecting memory updates URL
      Given viewing space "test"
      When clicking memory "my-memory"
      Then the URL updates to include "?memory=my-memory"

  Rule: popState on browser back/forward

    Scenario: Browser back navigates to previous route
      Given navigated to "/spaces/test"
      When pressing the browser back button
      Then the URL changes to the previous route
      And the UI updates without reload

    Scenario: Browser forward navigates forward
      Given navigated back to previous page
      When pressing the browser forward button
      Then the URL changes to the next route

    Scenario: popState restores correct view state
      Given navigated to "/spaces/test?view=map"
      When pressing back
      Then the list view is restored
      And the URL is "/spaces/test"

  Rule: Route restoration on reload

    Scenario: Reload restores current route
      Given viewing "/spaces/test?view=map"
      When reloading the page
      Then the same view is restored
      And the map view is shown

    Scenario: Reload restores memory panel
      Given viewing "/spaces/test?memory=my-memory"
      When reloading the page
      Then the memory panel is open

    Scenario: Invalid route falls back to home
      When navigating to an invalid route
      Then the URL is canonicalized to a valid route
      And the home page is shown

  Rule: Deep linking

    Scenario: Direct URL to space works
      When opening "/spaces/projects/test" directly
      Then the correct space and view are shown

    Scenario: Direct URL with memory param works
      When opening "/spaces/test?memory=my-memory" directly
      Then the memory panel opens
