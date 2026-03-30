@mcp @product/memories
Feature: MCP Memory Tools

  MCP tools for memory CRUD operations with links support.

  Background:
    Given the MCP server is running
    And a space "test-space" exists with memories "mem1" and "mem2"

  Rule: memory.add tool

    Scenario: memory.add requires tags
      When calling memory_add with space "test-space" name "new" content "content"
      Then an error "tags required" is returned

    Scenario: memory.add creates a memory
      When calling memory_add with space "test-space" name "new" content "content" tags ["cat:decision"]
      Then the memory is created
      And the response includes the memory id

    Scenario: memory.add with tier parameter
      When calling memory_add with space "test-space" name "cold" content "c" tags ["cat:discovery"] tier 3
      Then the memory is created in tier 3

    Scenario: memory.add with pinned=true
      When calling memory_add with space "test-space" name "pinned" content "c" tags ["cat:preference"] pinned true
      Then the memory is pinned

    Scenario: memory.add with links_to creates links
      When calling memory_add with space "test-space" name "new" content "c" tags ["cat:decision"] links_to ["mem1"]
      Then the memory is created
      And a link exists from "new" to "mem1"

    Scenario: memory.add with invalid links_to throws
      When calling memory_add with space "test-space" name "new" content "c" tags ["cat:decision"] links_to ["nonexistent"]
      Then an error "memory not found" is returned

  Rule: memory.read tool

    Scenario: memory.read returns memory content
      Given a memory "mem1" with content "test content"
      When calling memory_read with space "test-space" name "mem1"
      Then the response includes the content

    Scenario: memory.read records access and promotes
      Given a memory "mem1" in tier 2
      When calling memory_read with space "test-space" name "mem1"
      Then the memory tier becomes 1
      And access_count is incremented

    Scenario: memory.read with noPromote=true
      Given a memory "mem1" in tier 2
      When calling memory_read with space "test-space" name "mem1" noPromote true
      Then the memory stays in tier 2
      And access_count is not incremented

    Scenario: memory.read returns links_to and linked_by
      Given a link from "mem1" to "mem2"
      When calling memory_read with space "test-space" name "mem1"
      Then the response includes links_to with "mem2"
      And the response includes linked_by

    Scenario: memory.read for non-existent throws
      When calling memory_read with space "test-space" name "nonexistent"
      Then an error "memory not found" is returned

  Rule: memory.update tool

    Scenario: memory.update changes content
      When calling memory_update with space "test-space" name "mem1" content "new content"
      Then the memory content is updated

    Scenario: memory.update can rename
      When calling memory_update with space "test-space" name "mem1" newName "renamed"
      Then the memory is found by "renamed"
      And "mem1" no longer exists

    Scenario: memory.update with tags replaces tags
      When calling memory_update with space "test-space" name "mem1" tags ["cat:bugfix"]
      Then the memory tags are replaced

  Rule: memory.delete tool

    Scenario: memory.delete removes the memory
      When calling memory_delete with space "test-space" name "mem1"
      Then the memory no longer exists
      And all links to/from it are removed

    Scenario: memory.delete non-existent throws
      When calling memory_delete with space "test-space" name "nonexistent"
      Then an error "memory not found" is returned

  Rule: Reference format validation

    Scenario: invalid ref format throws "invalid memory reference"
      When calling memory_read with space "invalid-no-colon" name "mem1"
      Then an error "invalid memory reference" is returned
