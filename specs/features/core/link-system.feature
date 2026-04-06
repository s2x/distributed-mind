@core @product/links
Feature: Link System

  Links are directional edges between memories with optional labels.

  Background:
    Given a mind store is initialized
    And a space "test-space" exists with memories "mem1" and "mem2"

  Rule: Creating links

    Scenario: link.create with space:name format
      When creating a link from "test-space:mem1" to "test-space:mem2"
      Then the link exists from "mem1" to "mem2"

    Scenario: link.create with bare name uses source space
      When creating a link from "mem1" to "mem2" (bare names)
      Then the link is created in "test-space"

    Scenario: link.create with label sets the label
      When creating a link from "mem1" to "mem2" with label "depends_on"
      Then the link label is "depends_on"

    Scenario: link.create with default label
      When creating a link from "mem1" to "mem2" without label
      Then the link label is "related"

    Scenario: link.create with self throws error
      When creating a link from "mem1" to "mem1"
      Then an error "self-links not allowed" is thrown

    Scenario: link.create with non-existent memory throws
      When creating a link from "mem1" to "test-space:nonexistent"
      Then an error "memory not found" is thrown

    Scenario: link.create with invalid ref format throws
      When creating a link from "invalid-no-colon" to "mem2"
      Then an error "invalid memory reference" is thrown

  Rule: Deleting links

    Scenario: link.delete removes the link
      Given a link exists from "mem1" to "mem2"
      When deleting the link from "mem1" to "mem2"
      Then the link no longer exists

    Scenario: link.delete with space:name format
      Given a link exists from "mem1" to "mem2"
      When deleting the link from "test-space:mem1" to "test-space:mem2"
      Then the link no longer exists

  Rule: Cascade on memory delete

    Scenario: deleting memory removes all its links
      Given a link exists from "mem1" to "mem2"
      When deleting memory "mem1"
      Then the link is removed
      And no orphaned links remain

    Scenario: deleting target memory removes incoming links
      Given a link exists from "mem1" to "mem2"
      When deleting memory "mem2"
      Then the link is removed
