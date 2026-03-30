@core @product/memories
Feature: Memory Operations

  Memories are the core data unit with content, tags, links, and tier placement.

  Background:
    Given a mind store is initialized
    And a space "test-space" exists

  Rule: Adding memories

    Scenario: addMemory creates a new memory with tags
      When adding a memory with name "test-memory" and tags "cat:decision"
      Then the memory exists in the space
      And the memory has the specified tags

    Scenario: addMemory with tier parameter creates in correct tier
      When adding a memory with name "cold-memory" tier 3
      Then the memory exists in tier 3

    Scenario: addMemory with pinned=true creates pinned memory
      When adding a memory with name "pinned-memory" pinned true
      Then the memory is pinned
      And the memory is immune to eviction

    Scenario: addMemory with links_to creates directional links
      Given a memory "existing-memory" exists
      When adding a memory with name "new-memory" links_to "existing-memory"
      Then a link exists from "new-memory" to "existing-memory"

  Rule: Recording access

    Scenario: recordAccess increments access_count
      Given a memory with access_count 5
      When recording an access on the memory
      Then access_count becomes 6

    Scenario: recordAccess updates lastAccessedAt
      Given a memory with lastAccessedAt "2024-01-01T00:00:00Z"
      When recording an access on the memory
      Then lastAccessedAt is updated to current time

    Scenario: recordAccess promotes T3 to T2
      Given a memory in tier 3
      When recording an access on the memory
      Then the memory tier becomes 2

  Rule: Capacity enforcement

    Scenario: ensureCapacity allows T3 unlimited growth
      Given a space with 200 T3 memories
      When adding a new T3 memory
      Then the memory is added successfully

    Scenario: ensureCapacity evicts LRU from T1 when full
      Given a space at T1 capacity
      And a non-pinned LRU memory exists in T1
      When adding a new T1 memory
      Then the LRU memory is evicted to T2
      And the new memory is added to T1

  Rule: Updating memories

    Scenario: updateMemory changes content
      Given a memory "test-memory" exists
      When updating the memory content to "new content"
      Then the memory content is "new content"

    Scenario: updateMemory changes name
      Given a memory "old-name" exists
      When renaming the memory to "new-name"
      Then the memory is found by "new-name"
      And "old-name" no longer exists

    Scenario: updateMemory replaces tags
      Given a memory with tags "cat:decision"
      When updating the memory with tags "cat:bugfix"
      Then the memory tags are "cat:bugfix"

  Rule: Deleting memories

    Scenario: deleteMemory removes the memory
      Given a memory "to-delete" exists
      When deleting the memory
      Then the memory no longer exists

    Scenario: deleteMemory cascades to links
      Given a memory "to-delete" exists with links to "other"
      When deleting the memory
      Then all links to "to-delete" are removed
      And all links from "to-delete" are removed
