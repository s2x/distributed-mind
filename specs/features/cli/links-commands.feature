@cli @product/links
Feature: CLI Link Commands

  CLI commands for link management.

  Background:
    Given the CLI is initialized
    And a space "test" with memories "mem1" and "mem2" exists

  Rule: link command

    Scenario: link creates a directional link
      When running "./mind link test/mem1 test/mem2"
      Then a link exists from "mem1" to "mem2"

    Scenario: link with --label sets label
      When running "./mind link test/mem1 test/mem2 --label depends_on"
      Then the link label is "depends_on"

    Scenario: link with default label
      When running "./mind link test/mem1 test/mem2"
      Then the link label is "related"

    Scenario: link self throws error
      When running "./mind link test/mem1 test/mem1"
      Then an error "self-links not allowed" is shown

  Rule: unlink command

    Scenario: unlink removes link
      Given a link from "mem1" to "mem2"
      When running "./mind unlink test/mem1 test/mem2"
      Then the link no longer exists

  Rule: links command

    Scenario: links shows all links for a memory
      Given links from "mem1" to "mem2" and "mem1" to "mem3"
      When running "./mind links test mem1"
      Then both links are shown
