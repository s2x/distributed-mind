Feature: checkpoint-session-transformation

  Scenario: checkpoint_done creates session memory in sessions/<repo> and deletes checkpoint
    Given a space "projects/mind" with an active checkpoint
    And the checkpoint has goal "Complete API refactor"
    And the checkpoint has pending "Write tests"
    And the checkpoint has linked_memories ["memory-1", "memory-2"]
    When I call checkpoint_done(space="projects/mind", name="current")
    Then a new memory is created in "sessions/mind"
    And the memory has tags ["type:session", "cat:summary"]
    And the memory content includes "Complete API refactor"
    And the memory has linked references to "memory-1" and "memory-2"
    And the original checkpoint is deleted from "projects/mind"

  Scenario: checkpoint_done fails if sessions/<repo> space doesn't exist and auto-create fails
    Given a space "projects/mind" with an active checkpoint
    But the sessions space cannot be created
    When I call checkpoint_done(space="projects/mind", name="current")
    Then I receive an error about sessions space

  Scenario: calling checkpoint_done twice returns error on second call (checkpoint already deleted)
    Given a space "projects/mind" with an active checkpoint
    When I call checkpoint_done(space="projects/mind")
    And the checkpoint is transformed and deleted
    And I call checkpoint_done(space="projects/mind") again
    Then I receive an error "No active checkpoint found"
    And no duplicate session memory is created
