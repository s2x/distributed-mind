@mcp @product/system
Feature: MCP System Tools

  MCP tools for system-level operations.

  Background:
    Given the MCP server is running
    And the mind store is initialized

  Rule: system.status tool

    Scenario: system.status returns storage stats
      When calling system_status
      Then the response includes memory counts per tier
      And the response includes space usage
      And the response includes link totals

    Scenario: system.status reflects actual data
      Given a space with 5 T1, 10 T2, and 20 T3 memories
      When calling system_status
      Then the tier counts match the actual data
