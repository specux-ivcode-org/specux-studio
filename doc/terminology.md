# Terminology

This glossary defines terms used throughout the project, including in the [Screen Editor Requirements](screen-editor-requirements.md) and [Screen file schema](../schema/screen.md).

## Screen

| Term | Definition |
|---|---|
| **Screen** | A named visual composition in a SpecUX project. Its data includes ordered layers, Material placements and groups, and optional preview states. |
| **Canvas** | The Screen's absolute-positioned coordinate plane. Its origin is the top-left; top-level placement positions use Screen-canvas pixels, while nested placements use their containing group's coordinate space. |
| **Canvas viewport** | The visible editor area through which the canvas is viewed. Scrolling and zooming change the viewport, not saved canvas coordinates or placement transforms. |
| **Layer** | A named, ordered stacking level within a Screen. Layer order and visibility determine how its placements are rendered. Each top-level placement belongs to one layer; placements inside a group inherit the group's layer. |
| **Material** | A reusable STML template containing shared visual markup and variable definitions. It is not a positioned object on a Screen. |
| **Placement** | A Screen-local object with its own ID, transform, and visibility. A Material placement references a reusable Material and can override its variables; a top-level placement has a layer assignment. A group is also a placement, but contains child placements instead of referencing a Material. |
| **Group** | A Screen-local placement container that holds an ordered set of child placements. It has its own transform and effective layer, and is not a reusable Material. |
