@web @product/logs-page
Feature: Logs Page

  Logs page displays operation audit logs with filtering and pagination.

  Background:
    Given the web application is loaded
    And the logs page is accessible

  Rule: Log display

    Scenario: Logs are listed with operation and timestamp
      When viewing the logs page
      Then each log entry shows operation type
      And each shows timestamp

    Scenario: Logs show source and level
      When viewing logs
      Then each log shows source (cli/mcp/api)
      And each shows level (info/error)

    Scenario: Logs show input/output data
      When viewing a log entry
      Then input_data and output_data are displayed

    Scenario: Expandable log details
      Given a log entry is collapsed
      When clicking to expand
      Then full details are shown including error messages

  Rule: Filtering

    Scenario: Filter by source
      When filtering logs by source "cli"
      Then only cli source logs are shown

    Scenario: Filter by operation
      When filtering logs by operation "add_memory"
      Then only add_memory operations are shown

    Scenario: Filter by level
      When filtering logs by level "error"
      Then only error logs are shown

    Scenario: Search logs
      When searching logs for "memory_name"
      Then logs containing that term are shown

    Scenario: Clear filters
      Given filters are applied
      When clicking clear filters
      Then all logs are shown again

  Rule: Pagination

    Scenario: Pagination controls
      When viewing logs with many entries
      Then pagination controls are shown

    Scenario: Navigate to next page
      Given on page 1
      When clicking next
      Then page 2 is shown

    Scenario: Navigate to specific page
      When clicking on page 3
      Then page 3 is shown

  Rule: Live mode

    Scenario: Live mode enables polling
      When enabling live mode
      Then logs poll for new entries every few seconds

    Scenario: Live mode can be disabled
      Given live mode is enabled
      When disabling it
      Then polling stops

    Scenario: New log entries appear in live mode
      Given live mode is enabled
      When a new operation occurs
      Then the new log entry appears automatically
