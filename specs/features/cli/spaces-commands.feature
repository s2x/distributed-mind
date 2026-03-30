@cli @product/spaces
Feature: CLI Space Commands

  CLI commands for space management.

  Background:
    Given the CLI is initialized

  Rule: create command

    Scenario: create space with name and description
      When running "./mind create my-space \"A test space\""
      Then a space "my-space" exists
      And it has description "A test space"

    Scenario: create space with tags
      When running "./mind create my-space \"Desc\" --tags type:project,cat:decision"
      Then the space has tags "type:project" and "cat:decision"

    Scenario: create space without tags throws
      When running "./mind create my-space \"Desc\""
      Then an error about tags is shown

  Rule: list command (spaces)

    Scenario: list shows non-hidden spaces
      Given spaces "visible-1" and "visible-2" exist
      When running "./mind list"
      Then both spaces are listed

    Scenario: list --hidden shows hidden spaces
      Given a hidden space "secret" exists
      When running "./mind list --hidden"
      Then "secret" is listed

    Scenario: list --tag filters by tag
      Given space "proj1" with tag "type:project" and space "user1" with tag "type:user"
      When running "./mind list --tag type:project"
      Then only "proj1" is listed

  Rule: delete command

    Scenario: delete removes space and memories
      Given a space "to-delete" with memories
      When running "./mind delete to-delete"
      Then the space no longer exists
      And the memories are deleted

    Scenario: delete non-existent throws
      When running "./mind delete nonexistent"
      Then an error is shown

  Rule: rename command

    Scenario: rename updates space name
      When running "./mind rename old-name new-name"
      Then the space is renamed
      And memories are still accessible

  Rule: describe command

    Scenario: describe changes description
      When running "./mind describe my-space \"New description\""
      Then the space description is updated

  Rule: update command

    Scenario: update --description changes description
      When running "./mind update my-space --description \"New desc\""
      Then the description is updated

    Scenario: update --hidden hides space
      When running "./mind update my-space --hidden"
      Then the space is hidden

    Scenario: update --no-hidden unhides space
      When running "./mind update my-space --no-hidden"
      Then the space is visible

  Rule: tag command (space tagging)

    Scenario: tag space adds tag
      When running "./mind tag my-space cat:decision"
      Then the space has tag "cat:decision"

    Scenario: untag removes tag
      Given space "my-space" has tag "cat:decision"
      When running "./mind untag my-space cat:decision"
      Then the tag is removed
