---
element-id: dialog-save
---

# Add item button behavior

## Purpose

Define the behavior of the Add item button in the Home Screen dialog.

## Requirements

### Requirement: Save the entered item
The Add item button SHALL submit the entered item details and close the dialog after a successful save.

#### Scenario: Item is saved
- **GIVEN** the Add item dialog is open with the required details entered
- **WHEN** the user activates Add item
- **THEN** the item is saved and appears in Recent activity
- **AND** the dialog closes
- **SHOW** default

[Add item workflow](specux://screen/home/workflows/add-item.mmd?node=saveItem)
