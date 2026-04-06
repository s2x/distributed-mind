Feature: links-to-best-effort

  Scenario: memory_add with valid and invalid links creates memory, reports what worked and what failed
    Given a space "projects/mind" with memory "existing-memory"
    When I call memory_add with space="projects/mind", name="new-memory", content="test content", tags=["cat:decision"], links_to=["existing-memory", "nonexistent-memory"]
    Then the memory "new-memory" is created in "projects/mind"
    And the response includes links_created with "existing-memory"
    And the response includes links_failed with ref "nonexistent-memory"
    And no error is thrown

  Scenario: memory_add with all invalid links still creates the memory
    Given a space "projects/mind"
    When I call memory_add with space="projects/mind", name="new-memory", content="test content", tags=["cat:decision"], links_to=["missing-1", "missing-2"]
    Then the memory "new-memory" is created in "projects/mind"
    And the response includes links_created: []
    And the response includes links_failed with ref "missing-1"
    And the response includes links_failed with ref "missing-2"
    And no error is thrown

  Scenario: memory_add with all valid links has empty links_failed array
    Given a space "projects/mind" with memory "existing-memory-1"
    And space "projects/mind" with memory "existing-memory-2"
    When I call memory_add with space="projects/mind", name="new-memory", content="test content", tags=["cat:decision"], links_to=["existing-memory-1", "existing-memory-2"]
    Then the memory "new-memory" is created in "projects/mind"
    And a link from "new-memory" to "existing-memory-1" exists
    And a link from "new-memory" to "existing-memory-2" exists
    And the response includes links_created with "existing-memory-1" and "existing-memory-2"
    And the response includes links_failed: []
