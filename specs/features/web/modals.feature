@web @product/modals
Feature: Modals

  Modal dialogs for creating and editing spaces and memories.

  Background:
    Given the web application is loaded

  Rule: New space modal

    Scenario: Open new space modal
      When clicking the new space button
      Then a modal appears with name and description inputs

    Scenario: New space modal has tags input
      When the new space modal is open
      Then a tags input field is shown

    Scenario: Submit creates space
      Given the new space modal is open
      When entering name "projects/new" and description "A new project"
      And clicking submit
      Then the space is created
      And the modal closes

    Scenario: Cancel closes modal
      Given the new space modal is open
      When clicking cancel or outside the modal
      Then the modal closes
      And no space is created

  Rule: New memory modal

    Scenario: Open new memory modal
      When clicking the new memory button
      Then a modal appears with name, content, and tags inputs

    Scenario: New memory modal has tier selector
      When the new memory modal is open
      Then a tier selector is shown

    Scenario: Submit creates memory
      Given the new memory modal is open
      When entering name "my-memory" content "Memory content" tags "cat:decision"
      And clicking submit
      Then the memory is created
      And the modal closes

    Scenario: Cancel closes modal without creating
      Given the new memory modal is open
      When clicking cancel
      Then the modal closes
      And no memory is created

  Rule: Delete confirmation modal

    Scenario: Delete memory shows confirmation
      Given a memory exists
      When clicking delete on the memory
      Then a confirmation modal appears

    Scenario: Confirm delete removes memory
      Given the delete confirmation is shown
      When clicking confirm
      Then the memory is deleted
      And the modal closes

    Scenario: Cancel delete keeps memory
      Given the delete confirmation is shown
      When clicking cancel
      Then the memory is preserved
      And the modal closes

  Rule: Inline edit

    Scenario: Inline edit appears in place
      Given a memory item is displayed
      When double-clicking the name
      Then an edit input replaces the name
      And other elements remain visible

    Scenario: Enter saves inline edit
      Given an inline edit is active
      When pressing Enter
      Then the edit is saved
      And normal display returns

    Scenario: Escape cancels inline edit
      Given an inline edit is active
      When pressing Escape
      Then the original value is restored
      And normal display returns

  Rule: Modal styling

    Scenario: Modal has glassmorphism backdrop
      When a modal is open
      Then the backdrop has blur effect

    Scenario: Modal has glowing border
      When a modal is open
      Then the border has cyan glow

    Scenario: Modal input glows on focus
      Given a modal with input fields
      When an input receives focus
      Then the input border glows cyan
