# Screen Grouping

## MR-SCR-001: Group and ungroup placements

**Preconditions:** Open a Screen in Default with at least two consecutive placements that share a parent and layer. Record their IDs and order before starting. Use a disposable copy if you intend to save.

| Step | Action | Expected result |
|---|---|---|
| 1 | Select the placements and choose **Group**. | Grouping completes without an error. One group replaces the selected placements. |
| 2 | Select the new group and choose **Ungroup**. | Ungrouping completes without an error. The original placements return as siblings in their original order. |
| 3 | Check the Screen and Layers panel for visible errors; compare the resulting placement IDs and order with the recorded starting values. | The Screen remains usable, the original placements are present exactly once, and no error is shown. |
| 4 | Optional: save and reload in the disposable copy. | The Screen loads without errors and retains the ungrouped placements. |

- **Result:** Not run
- **Build:** Not recorded
- **Failure details / notes:**
