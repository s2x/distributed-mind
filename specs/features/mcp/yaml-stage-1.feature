@delta-added @mcp @product/mcp-yaml
Feature: MCP YAML content stage 1

  Scenario: Structured MCP tools return one raw YAML content item matching structuredContent
    Given an in-scope structured MCP tool response
    When the tool returns both content and structuredContent
    Then content contains exactly one text item
    And that text item is raw YAML
    And parsing that YAML yields the same payload as structuredContent

  Scenario: checkpoint_query missing-space responses include an explicit error field
    Given the requested project space does not exist
    When checkpoint_query is called
    Then the response includes checkpoints []
    And the response includes total 0
    And the response includes error.code "space_not_found"
    And the YAML content matches the structured payload

  Scenario: text-only tools remain text-only in stage 1
    When system_instructions, space_delete, memory_delete, link_create, and link_delete are called
    Then they do not expose structuredContent
