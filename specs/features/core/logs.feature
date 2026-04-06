@core @product/logs
Feature: Operation Audit Logging

  All operations are logged for auditing with configurable retention.

  Background:
    Given a mind store is initialized

  Rule: Operation logging

    Scenario: addMemory logs the operation
      When adding a memory "test" to a space
      Then a log entry is created
      And the log has operation "add_memory"
      And the log has the memory id

    Scenario: updateMemory logs the operation
      Given a memory exists
      When updating the memory content
      Then a log entry is created with operation "update_memory"

    Scenario: deleteMemory logs the operation
      Given a memory exists
      When deleting the memory
      Then a log entry is created with operation "delete_memory"

    Scenario: link operations log correctly
      When creating a link between memories
      Then a log entry is created with operation "link_create"

    Scenario: space operations log correctly
      When creating a space
      Then a log entry is created with operation "create_space"

  Rule: Log entry fields

    Scenario: log entry includes source
      When adding a memory
      Then the log entry has source "cli" or "mcp" or "api"

    Scenario: log entry includes level
      When adding a memory
      Then the log entry has level "info" or "error"

    Scenario: log entry includes timestamp
      When adding a memory
      Then the log entry has a timestamp

    Scenario: log entry includes duration_ms
      When adding a memory
      Then the log entry has duration_ms

  Rule: Log retention

    Scenario: old logs are pruned based on retention setting
      Given MIND_LOG_RETENTION_MINUTES is set to 10080 (7 days)
      When querying logs
      Then logs older than 7 days are not returned

    Scenario: default retention is 7 days
      Given no MIND_LOG_RETENTION_MINUTES is set
      When querying logs
      Then logs older than 7 days are pruned

  Rule: Querying logs

    Scenario: query logs with source filter
      When querying logs with source "cli"
      Then only logs from cli source are returned

    Scenario: query logs with operation filter
      When querying logs with operation "add_memory"
      Then only add_memory operations are returned

    Scenario: query logs with level filter
      When querying logs with level "error"
      Then only error logs are returned

    Scenario: query logs with search term
      When querying logs with search "memory_name"
      Then logs containing the term are returned

    Scenario: query logs with pagination
      When querying logs with limit 50 and offset 100
      Then 50 logs are returned starting at offset 100
