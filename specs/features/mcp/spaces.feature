@mcp @product/spaces
Feature: MCP Spaces Tools

  MCP tools for space management.

  Background:
    Given the MCP server is running
    And the mind store is initialized

  Rule: space.create tool

    Scenario: space.create requires tags
      When calling space_create with name "projects/test" and description "Test"
      Then an error "tags required" is returned

    Scenario: space.create creates a space
      When calling space_create with name "projects/test" description "Test" tags ["type:project"]
      Then the space is created
      And the response includes the space name

    Scenario: space.create with duplicate name throws
      Given a space "projects/test" exists
      When calling space_create with name "projects/test" tags ["type:project"]
      Then an error "space already exists" is returned

  Rule: space.list tool

    Scenario: space.list returns all spaces
      Given spaces "space1" and "space2" exist
      When calling space_list
      Then both spaces are in the response

    Scenario: space.list with tag filter
      Given space "proj1" with tag "type:project" and space "user1" with tag "type:user"
      When calling space_list with tag "type:project"
      Then only "proj1" is returned

  Rule: space.get tool

    Scenario: space.get returns space details
      Given a space "projects/test" with description "Test project"
      When calling space_get with name "projects/test"
      Then the response includes description
      And the response includes tags

    Scenario: space.get includes hot_memories preview
      Given a space with T1 and T2 memories
      When calling space_get with name "test"
      Then the response includes hot_memories (T1 + T2)

    Scenario: space.get for non-existent space throws
      When calling space_get with name "nonexistent"
      Then an error "space not found" is returned

  Rule: space.update tool

    Scenario: space.update changes description
      Given a space "test" exists
      When calling space_update with name "test" description "new description"
      Then the space description is updated

    Scenario: space.update with tags replaces tags
      Given a space "test" with tags "type:project"
      When calling space_update with name "test" tags ["type:user"]
      Then the space tags are replaced

    Scenario: space.update can hide a space
      Given a space "test" is visible
      When calling space_update with name "test" hidden true
      Then the space is hidden

  Rule: space.delete tool

    Scenario: space.delete removes the space
      Given a space "to-delete" exists
      When calling space_delete with name "to-delete"
      Then the space no longer exists
      And all its memories are deleted

    Scenario: space.delete non-existent throws
      When calling space_delete with name "nonexistent"
      Then an error "space not found" is returned
