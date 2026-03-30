@core @product/spaces
Feature: Space Operations

  Spaces are named containers for memories with metadata and visibility controls.

  Background:
    Given a mind store is initialized

  Rule: Creating spaces

    Scenario: createSpace with tags creates a space
      When creating a space "projects/test" with tags "type:project"
      Then the space "projects/test" exists
      And the space has the specified tags

    Scenario: createSpace without tags throws error
      When creating a space "projects/test" with no tags
      Then an error "tags required" is thrown

    Scenario: createSpace with duplicate name throws
      Given a space "projects/test" exists
      When creating a space "projects/test"
      Then an error "space already exists" is thrown

  Rule: Listing spaces

    Scenario: listSpaces returns all non-hidden spaces
      Given spaces "visible-1" and "visible-2" exist (not hidden)
      When listing all spaces
      Then both spaces are returned

    Scenario: listSpaces excludes hidden spaces by default
      Given a hidden space "secret" exists
      When listing all spaces
      Then "secret" is not returned

    Scenario: listSpaces with --hidden includes hidden spaces
      Given a hidden space "secret" exists
      When listing all spaces with --hidden flag
      Then "secret" is returned

    Scenario: listSpaces with --tag filters by tag
      Given spaces "proj-1" with tag "type:project" and "proj-2" with tag "type:user"
      When listing spaces with --tag "type:project"
      Then only "proj-1" is returned

  Rule: Renaming spaces

    Scenario: renameSpace updates the space name
      Given a space "old-name" exists
      When renaming "old-name" to "new-name"
      Then the space is renamed
      And memories in the space are accessible by new space name

    Scenario: renameSpace cascades to memories FK
      Given a memory "mem1" exists in space "old-name"
      When renaming "old-name" to "new-name"
      Then the memory is still accessible in "new-name"

    Scenario: renameSpace to existing name throws
      Given spaces "space-1" and "space-2" exist
      When renaming "space-1" to "space-2"
      Then an error "space already exists" is thrown

  Rule: Updating spaces

    Scenario: updateSpace changes description
      Given a space "test" exists with description "old"
      When updating space "test" description to "new"
      Then the space description is "new"

    Scenario: updateSpace can hide a space
      Given a space "test" is visible
      When updating space "test" to hidden
      Then the space is hidden
      And listSpaces without --hidden does not include it

    Scenario: updateSpace can unhide a space
      Given a space "test" is hidden
      When updating space "test" to visible
      Then the space is visible

    Scenario: updateSpace with tags replaces all tags
      Given a space "test" with tags "type:project"
      When updating space "test" with tags "type:user"
      Then the space tags are "type:user"

  Rule: Deleting spaces

    Scenario: deleteSpace removes the space
      Given a space "to-delete" exists
      When deleting the space
      Then the space no longer exists

    Scenario: deleteSpace cascades to memories
      Given a memory "mem1" exists in space "to-delete"
      When deleting the space "to-delete"
      Then the memory is also deleted

    Scenario: deleteSpace cascades to links
      Given memories linked in space "to-delete"
      When deleting the space "to-delete"
      Then all links are removed

    Scenario: deleteSpace cascades to space_tags
      Given a space "to-delete" with tags
      When deleting the space
      Then the tags are removed
