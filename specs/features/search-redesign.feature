Feature: Search Tools Redesign (Phase 2.3)

  Background:
    Given a Mind store with spaces "projects/mind" and "projects/other"
    And memories exist in both spaces

  Rule: search tool requires space parameter

    Scenario: search without space parameter throws validation error
      When calling search tool with args missing space
      Then error "space is required" is thrown

    Scenario: search with space="*" searches all spaces
      When calling search with space="*" and query "auth"
      Then results include memories from all spaces

    Scenario: search with specific space filters results
      When calling search with space="projects/mind" and query "auth"
      Then only memories from projects/mind are returned

    Scenario: search returns search_method in response
      When calling search with valid args
      Then response includes search_method field

    Scenario: search supports simple query
      When calling search with query "typescript"
      Then matching memories are returned

    Scenario: search supports quoted phrase for exact match
      When calling search with query '"exact phrase"'
      Then only exact phrase matches are returned

    Scenario: search supports prefix matching
      When calling search with query "type*"
      Then all memories matching prefix are returned

  Rule: memory.query tool provides unified query interface

    Scenario: memory.query with space="*" returns all memories including T4
      When calling memory_query with space="*"
      Then all memories from all tiers including T4 are returned

    Scenario: memory.query with specific space filters results
      When calling memory_query with space="projects/mind"
      Then only memories from that space are returned

    Scenario: memory.query includes T4 frozen memories
      When calling memory_query for a space with T4 memories
      Then T4 memories are included in results

    Scenario: memory.query without space throws validation error
      When calling memory_query with empty args
      Then error "space is required" is thrown

    Scenario: memory.query supports tag filter
      When calling memory_query with tag filter
      Then only memories with matching tag are returned

    Scenario: memory.query supports tier filter
      When calling memory_query with tier filter
      Then only memories with matching tier are returned

    Scenario: memory.query supports pagination
      When calling memory_query with limit=3 and offset=0
      Then only 3 memories are returned with pagination metadata

    Scenario: memory.query supports date range filter
      When calling memory_query with from and to dates
      Then only memories within date range are returned

  Rule: searchFallback implements FTS5 → LIKE → embeddings chain

    Scenario: searchFallback returns fts5 method when FTS5 has results
      When calling searchFallback with a query that matches FTS5
      Then search_method is "fts5"

    Scenario: searchFallback falls back to LIKE when FTS5 returns empty
      When calling searchFallback with a query that FTS5 cannot match
      Then search_method is "like"
