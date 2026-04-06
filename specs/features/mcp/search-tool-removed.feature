Feature: search-tool-removed

  Scenario: Calling the removed search tool returns error
    Given the MCP server is running
    When I call `search(space="projects/mind", query="test")`
    Then I receive an error with code "tool_not_found"
    And the error message contains "search"
