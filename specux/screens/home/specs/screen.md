# Home behavior

## Purpose

Describe Home Screen behaviors, including when named visual states activate and how Add item submission is saved.

[Home Screen](specux://screen/home/screen.yml)
[Add item dialog state](specux://screen/home/screen.yml?state=add-item-open)

## Requirements

### Requirement: Show the Add item dialog state
The Home Screen SHALL show the Add item dialog state when the user opens the dialog.

#### Scenario: User opens the Add item dialog
- **WHEN** the user opens the Add item dialog
- **THEN** the dialog is displayed over the dashboard
- **SHOW** add-item-open

### Requirement: Save an item through the backend
The Home Screen SHALL send the Add item details to the backend server and show the created item in Recent activity after a successful save.

#### Scenario: Item is saved successfully
- **GIVEN** the Add item dialog is open with a name and type entered
- **WHEN** the user activates Add item
- **THEN** the Studio sends the item details to the backend server
- **AND** after the backend confirms the save, the created item appears at the top of Recent activity
- **SHOW** default

[Save item workflow](specux://screen/home/workflows/add-item.mmd?node=saveItem)
