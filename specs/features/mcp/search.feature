@mcp @product/search
Feature: MCP Search Tools

  MCP tools for full-text search and memory querying.

  Background:
    Given the MCP server is running
    And spaces "projects/mind" and "projects/other" exist with memories

  Rule: search tool

    Scenario: search requires space parameter
      When calling search with query "test" and no space
      Then an error "space is required" is returned

    Scenario: search with space="*" searches all spaces
      When calling search with space "*" query "typescript"
      Then results include memories from all spaces

    Scenario: search with specific space filters
      When calling search with space "projects/mind" query "auth"
      Then only memories from projects/mind are returned

    Scenario: search returns search_method in response
      When calling search with valid args
      Then the response includes search_method field

    Scenario: search supports simple query
      When calling search with query "typescript"
      Then matching memories are returned

    Scenario: search supports quoted phrase
      When calling search with query '"exact phrase"'
      Then only exact phrase matches are returned

    Scenario: search supports prefix matching
      When calling search with query "type*"
      Then all memories matching prefix are returned

    Scenario: search supports AND operator
      When calling search with query "auth AND jwt"
      Then memories containing both terms are returned

    Scenario: search with tag filter
      When calling search with query "test" tag "cat:decision"
      Then only memories with that tag are returned

    Scenario: search with tier filter
      When calling search with query "test" tier 1
      Then only T1 memories are returned

  Rule: memory.query tool

    Scenario: memory.query requires space
      When calling memory_query with no space
      Then an error "space is required" is returned

    Scenario: memory.query with space="*" returns all memories
      When calling memory_query with space "*"
      Then all memories from all tiers are returned

    Scenario: memory.query with specific space filters
      When calling memory_query with space "projects/mind"
      Then only memories from that space are returned

    Scenario: memory.query includes T3 cold memories
      When calling memory_query with space "projects/mind"
      Then T3 memories are included in results

    Scenario: memory.query supports tag filter
      When calling memory_query with space "projects/mind" tag "cat:decision"
      Then only memories with matching tag are returned

    Scenario: memory.query supports tier filter
      When calling memory_query with space "projects/mind" tier 1
      Then only T1 memories are returned

    Scenario: memory.query supports pagination
      When calling memory_query with space "projects/mind" limit 3 offset 0
      Then 3 memories are returned with pagination metadata

    Scenario: memory.query supports date range
      When calling memory_query with space "projects/mind" from "2024-01-01" to "2024-12-31"
      Then only memories within date range are returned

  Rule: searchFallback chain

    Scenario: searchFallback returns fts5 when FTS5 has results
      When calling searchFallback with a query that matches FTS5
      Then search_method is "fts5"

    Scenario: searchFallback falls back to LIKE when FTS returns empty
      When calling searchFallback with a query that FTS cannot match
      Then search_method is "like"
