# Language: en
Feature: Links Tools Redesign (Phase 2.4)

  Phase 2.4 of Mind MCP redesign refactors link tools to accept memory reference
  strings in "space:name" format or bare "name" shorthand, replacing numeric IDs.

  Background:
    Given the mind store is initialized with a test space "proj"

  Rule: link.create accepts memory references as strings

    Scenario: 2.4.1 - link.create accepts "space:name" format for sourceRef and targetRef
      Given memories "mem1" and "mem2" exist in space "proj"
      When I call link_create with sourceRef "proj:mem1" and targetRef "proj:mem2"
      Then the link is created from "mem1" to "mem2"

    Scenario: 2.4.2 - link.create accepts "name" shorthand (same space)
      Given memories "mem1" and "mem2" exist in space "proj"
      When I call link_create with sourceRef "mem1" and targetRef "mem2"
      Then the link is created using the source memory's space

    Scenario: 2.4.3 - link.create with invalid ref format throws "invalid memory reference"
      Given memory "mem1" exists in space "proj"
      When I call link_create with sourceRef "invalid-no-colon" and targetRef "proj:mem1"
      Then an error "invalid memory reference" is thrown

    Scenario: 2.4.4 - link.create with non-existing memory throws error
      Given memory "mem1" exists in space "proj"
      When I call link_create with sourceRef "proj:mem1" and targetRef "proj:nonexistent"
      Then an error "memory not found" is thrown

  Rule: link.delete accepts memory references as strings

    Scenario: 2.4.5 - link.delete accepts "space:name" format
      Given a link exists from memory "mem1" to "mem2" in space "proj"
      When I call link_delete with sourceRef "proj:mem1" and targetRef "proj:mem2"
      Then the link is removed

    Scenario: 2.4.6 - link.delete accepts "name" shorthand (same space)
      Given a link exists from memory "mem1" to "mem2" in space "proj"
      When I call link_delete with sourceRef "mem1" and targetRef "mem2"
      Then the link is removed

  Rule: links_list tool is removed

    Scenario: 2.4.7 - links_list no longer exists as a tool
      Given the link tools are created from the store
      Then links_list is undefined
      And memory links can be retrieved via memory.get or memory.read instead
