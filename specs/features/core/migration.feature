@core @product/migration
Feature: Database Migration

  Schema migrations upgrade databases incrementally from v1 to v7.

  Background:
    Given a mind store is initialized

  Rule: v1 to v2 migration (12-step rename-recreate)

    Scenario: migration creates new tables with correct schema
      Given a v1 database exists
      When the store initializes
      Then the schema version is 2
      And memories have required columns

    Scenario: migration is idempotent
      Given migration to v2 has run
      When the store initializes again
      Then no error is thrown
      And schema version remains 2

  Rule: v2 to v3 migration (ADD COLUMN embedding)

    Scenario: migration adds embedding column
      Given a v2 database exists
      When the store initializes
      Then memories table has embedding BLOB column
      And existing memories have NULL embedding

  Rule: v3 to v4 migration (ADD COLUMN changed_at)

    Scenario: migration adds changed_at column
      Given a v3 database exists
      When the store initializes
      Then memories table has changed_at column
      And existing memories have changed_at set to updated_at

  Rule: v4 to v5 migration (ADD spaces.hidden)

    Scenario: migration adds hidden column to spaces
      Given a v4 database exists
      When the store initializes
      Then spaces table has hidden column
      And existing spaces have hidden=false

  Rule: v5 to v6 migration (CREATE TABLE logs)

    Scenario: migration creates logs table
      Given a v5 database exists
      When the store initializes
      Then logs table exists with correct schema
      And logs table has indexes

  Rule: v6 to v7 migration (T4 removal)

    Scenario: migration removes T4 tier and migrates to T3
      Given a v6 database with T4 memories exists
      When the store initializes
      Then schema version is 7
      And all T4 memories are now T3
      And no memories have tier 4

    Scenario: migration updates CHECK constraint
      Given a v6 database exists
      When the store initializes
      Then tier CHECK allows only 1, 2, 3

    Scenario: T3 becomes unlimited after v7
      Given a v7 database
      When adding many T3 memories
      Then all are added successfully
      And no capacity error occurs

  Rule: Migration idempotency

    Scenario: running migration twice does not error
      Given a database at version 7
      When the store initializes twice
      Then no error is thrown either time
      And schema version remains 7

    Scenario: skipping versions is handled
      Given a database at version 3
      When the store initializes
      Then all migrations from v3 to v7 run
      And final schema version is 7
