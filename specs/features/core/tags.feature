@core @product/tags
Feature: Tags System

  Tags are normalized strings used to categorize and filter spaces and memories.

  Background:
    Given a mind store is initialized
    And a space "test-space" exists

  Rule: Tag normalization

    Scenario: tags are converted to lowercase
      When adding a tag "Type:Project"
      Then the tag is stored as "type:project"

    Scenario: leading hash is stripped
      When adding a tag "#cat:decision"
      Then the tag is stored as "cat:decision"

    Scenario: empty tags are rejected
      When adding an empty tag ""
      Then an error "tag cannot be empty" is thrown

    Scenario: tags with spaces are rejected
      When adding a tag "invalid tag"
      Then an error "invalid tag characters" is thrown

  Rule: Tag validation regex

    Scenario: valid tags pass validation
      When adding a tag "cat:decision"
      Then the tag is accepted

    Scenario: tags with allowed special chars pass
      When adding a tag "type:project/path"
      Then the tag is accepted

    Scenario: tags with underscores pass
      When adding a tag "cat:my_category"
      Then the tag is accepted

    Scenario: tags with dots pass
      When adding a tag "cat:v1.0.0"
      Then the tag is accepted

    Scenario: tags with equals pass
      When adding a tag "env=production"
      Then the tag is accepted

    Scenario: tags with plus pass
      When adding a tag "cat:a+b"
      Then the tag is accepted

    Scenario: tags with at pass
      When adding a tag "cat:@mention"
      Then the tag is accepted

  Rule: Space tagging

    Scenario: tag space adds tag
      When tagging space "test-space" with "type:project"
      Then the space has tag "type:project"

    Scenario: untag space removes tag
      Given space "test-space" has tag "type:project"
      When untagging space "test-space" tag "type:project"
      Then the space no longer has that tag

    Scenario: tagging space twice is idempotent
      When tagging space "test-space" with "type:project" twice
      Then the space has exactly one "type:project" tag

  Rule: Memory tagging

    Scenario: tag memory adds tag
      Given a memory "test" exists in "test-space"
      When tagging memory "test" with "cat:decision"
      Then the memory has tag "cat:decision"

    Scenario: untag memory removes tag
      Given memory "test" has tag "cat:decision"
      When untagging memory "test" tag "cat:decision"
      Then the memory no longer has that tag

    Scenario: tagging memory twice is idempotent
      Given memory "test" exists
      When tagging memory "test" with "cat:bugfix" twice
      Then the memory has exactly one "cat:bugfix" tag
