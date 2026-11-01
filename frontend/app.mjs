import "/shared/yaml.js";
import "/shared/validation.js";
import { AssetEditor } from "./browser/AssetEditor.mjs";
import { BrowserHistory } from "./browser/BrowserHistory.mjs";
import { EditorNavigation } from "./browser/EditorNavigation.mjs";
import { EditorEventController } from "./browser/EditorEventController.mjs";
import { InspectorRenderer } from "./browser/InspectorRenderer.mjs";
import { MaterialFileEditor } from "./browser/MaterialFileEditor.mjs";
import { ProjectFileTree } from "./browser/ProjectFileTree.mjs";
import { ProjectFileNavigator } from "./browser/ProjectFileNavigator.mjs";
import { ResizablePanels } from "./browser/ResizablePanels.mjs";
import { ProjectPersistence } from "./browser/ProjectPersistence.mjs";
import { ProjectRepository } from "./browser/ProjectRepository.mjs";
import { PreviewStateController } from "./browser/PreviewStateController.mjs";
import { ResponsiveToolbarController } from "./browser/ResponsiveToolbarController.mjs";
import { ScreenElementController } from "./browser/ScreenElementController.mjs";
import { ScreenAnnotationController } from "./browser/ScreenAnnotationController.mjs";
import { ScreenSelectionController } from "./browser/ScreenSelectionController.mjs";
import { ScreenRulerController } from "./browser/ScreenRulerController.mjs";
import { ScreenYamlEditor } from "./browser/ScreenYamlEditor.mjs";
import { ScreenInstanceRenderer } from "./browser/ScreenInstanceRenderer.mjs";
import { MaterialCanvas } from "./browser/MaterialCanvas.mjs";
import { ScreenMaterialController } from "./browser/ScreenMaterialController.mjs";
import { ScreenMaterialRenderer } from "./browser/ScreenMaterialRenderer.mjs";
import {
  canGroupScreenPlacements,
  getScreenPlacementAtPath,
  getScreenPlacementPathById,
  isScreenGroup
} from "../shared/ScreenGroups.mjs";
import { SpecEditor } from "./browser/SpecEditor.mjs";
import { SplitViewLayout } from "./browser/SplitViewLayout.mjs";
import { ThemeEditor } from "./browser/ThemeEditor.mjs";
import { TemplateMarkupRenderer } from "./browser/TemplateMarkupRenderer.mjs";
import { WorkspaceViewRenderer } from "./browser/WorkspaceViewRenderer.mjs";
import { WorkflowEditor } from "./browser/WorkflowEditor.mjs";

const appRoot = new URL("./specux/", window.location.href);
const sharedValidation = globalThis.SpecuxValidation;
const parseSpecuxYaml = globalThis.SpecuxYamlParser;
const { TEMPLATE_FILE_EXTENSION, attributeTypes, numberFormats, themeModeNames } = sharedValidation;
const systemThemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
const renderParameters = new URLSearchParams(window.location.search);
const renderRequestedScreen = renderParameters.get("render");
const renderRequestedState = renderParameters.get("state");
const renderRequestedAnnotations = renderParameters.get("annotations") === "true";
const isRenderOnly = renderRequestedScreen !== null;
const assetDragType = "application/x-specux-asset-template";
const assetInstanceDragType = "application/x-specux-asset-instance";
const byId = (id) => document.getElementById(id);

let project;
let screens = [];
let assets = new Map();
let materialFiles = new Map();
let specSources = new Map();
let workflowSources = new Map();
let theme;
let themeModePreference = "system";
let systemThemeMode = systemThemeQuery?.matches ? "dark" : "light";
let appliedThemeTokens = new Set();
let activeScreenIndex = 0;
const activePreviewStateIds = new Map();
let projectFilePaths = [];
let assetFiles = new Map();
let activeAssetId = null;
let activeMaterialFilePath = null;
let activeInstancePath = [];
let activeInstancePaths = [];
let screenPlacementMenuTarget = null;
let viewingAssetTemplate = false;
let viewingMaterialFile = false;
let viewingTheme = false;
let viewingProject = false;
let viewingSpec = false;
let viewingPreviewState = false;
let viewingWorkflow = false;
let activeWorkflowPath = null;
let workflowScreenIndex = 0;
let selectedWorkflowNodeId = null;
let workflowViewMode = "split";
let activeSpecPath = null;
let activeSpecInstancePath = [];
let activeSpecOwner = "instance";
let activeProjectFilePath = null;
let assetEditorRestoreId = null;
let paletteAssetDropHandled = false;
let reviewedInSession = false;
let hasEdits = false;
let assetContextMenuTarget = null;
let pendingAssetDeletion = null;
let deleteDialogReturnFocus = null;
const pendingAssetCopies = [];
const dirtyFiles = new Map();
const invalidYamlFiles = new Map();
const invalidWorkflowFiles = new Map();
const pendingAssetSerializations = new Set();
const createdScreenFiles = new Set();
const createdMaterialFiles = new Set();
const createdSpecFiles = new Set();
const createdSpecDrafts = new Map();
const assetSpecOwners = new Map();
let editVersion = 0;
let isSaving = false;
let historyUpdateSuppressed = false;
let assetPreviewTimer = null;
let assetPreviewVersion = 0;
let editorFieldId = 0;
let assetStyleScopeId = 0;
let workflowEditor;
const browserHistory = new BrowserHistory({
  windowObject: window,
  getCurrentSelection: currentUiSelection,
  getSelectionFilePath,
  isRenderOnly: () => isRenderOnly,
  isUpdatesSuppressed: () => historyUpdateSuppressed
});
const templateMarkupRenderer = new TemplateMarkupRenderer({
  appRoot
});
const projectRepository = new ProjectRepository({
  appRoot,
  fetcher: (url, options) => fetch(url, options),
  parseYaml: parseSpecuxYaml,
  validation: sharedValidation,
  templateFileExtension: TEMPLATE_FILE_EXTENSION
});
const projectFileTree = new ProjectFileTree({
  container: byId("project-file-tree"),
  createElement: element,
  getFilePaths: getProjectTreeFilePaths,
  renderFile: renderProjectFile
});
const screenYamlEditor = new ScreenYamlEditor({
  documentObject: document,
  fetcher: (url, options) => fetch(url, options),
  getActiveScreen: () => screens[activeScreenIndex],
  getActiveScreenIndex: () => activeScreenIndex,
  getScreenIndex: (screen) => screens.indexOf(screen),
  invalidYamlFiles,
  markEdited,
  renderNavigation,
  renderScreen,
  updateSaveControls,
  validatePreviewStates: sharedValidation.validatePreviewStates,
  validateScreenMaterials
});
const specViewLayout = new SplitViewLayout({
  windowObject: window,
  documentObject: document,
  modes: ["split", "preview", "markdown"],
  viewIdPrefix: "spec-view",
  viewAttribute: "data-spec-view",
  headingId: "spec-view-heading",
  headingLabels: { split: "Preview", preview: "Preview", markdown: "Markdown" },
  resizerId: "spec-split-resizer",
  previewTrackProperty: "--spec-preview-track",
  editorTrackProperty: "--spec-markdown-track"
});
const assetViewLayout = new SplitViewLayout({
  windowObject: window,
  documentObject: document,
  modes: ["split", "preview", "source"],
  viewIdPrefix: "asset-view",
  viewAttribute: "data-asset-view",
  headingId: "asset-view-heading",
  headingLabels: { split: "Preview", preview: "Preview", source: "Source" },
  resizerId: "asset-split-resizer",
  previewTrackProperty: "--asset-preview-track",
  editorTrackProperty: "--asset-source-track"
});
const workflowViewLayout = new SplitViewLayout({
  windowObject: window,
  documentObject: document,
  modes: ["split", "preview", "diagram"],
  viewIdPrefix: "workflow-view",
  viewAttribute: "data-workflow-view",
  headingId: "workflow-view-heading",
  headingLabels: { split: "Selected node", preview: "Selected node", diagram: "Workflow" },
  resizerId: "workflow-split-resizer",
  previewTrackProperty: "--workflow-preview-track",
  editorTrackProperty: "--workflow-diagram-track"
});
const specEditor = new SpecEditor({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    set activeProjectFilePath(value) { activeProjectFilePath = value; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get assetSpecOwners() { return assetSpecOwners; },
    get specSources() { return specSources; },
    get viewingSpec() { return viewingSpec; },
    get viewingWorkflow() { return viewingWorkflow; },
    set viewingSpec(value) { viewingSpec = value; },
    get viewingAssetTemplate() { return viewingAssetTemplate; },
    set viewingAssetTemplate(value) { viewingAssetTemplate = value; },
    set viewingMaterialFile(value) { viewingMaterialFile = value; },
    get viewingTheme() { return viewingTheme; },
    set viewingTheme(value) { viewingTheme = value; },
    get viewingProject() { return viewingProject; },
    set viewingProject(value) { viewingProject = value; },
    get viewingPreviewState() { return viewingPreviewState; },
    set viewingPreviewState(value) { viewingPreviewState = value; },
    get activeSpecPath() { return activeSpecPath; },
    set activeSpecPath(value) { activeSpecPath = value; },
    get activeSpecOwner() { return activeSpecOwner; },
    set activeSpecOwner(value) { activeSpecOwner = value; },
    get activeSpecInstancePath() { return activeSpecInstancePath; },
    set activeSpecInstancePath(value) { activeSpecInstancePath = value; },
    get activeAssetId() { return activeAssetId; },
    set activeAssetId(value) { activeAssetId = value; },
    get activeInstancePath() { return activeInstancePath; },
    set activeInstancePath(value) {
      activeInstancePath = value;
      activeInstancePaths = value.length ? [value] : [];
    },
    get createdSpecFiles() { return createdSpecFiles; },
    get isSaving() { return isSaving; }
  },
  services: {
    validation: sharedValidation,
    byId,
    setSpecViewMode: (mode) => specViewLayout.setViewMode(mode),
    hidePreviewStateControls,
    getInstanceAtPath,
    sameInstancePath,
    loadText,
    hideEditorMessage,
    showEditorMessage,
    updateNavigationSelection,
    refreshAssetSpecOwner,
    clearEdited,
    renderNavigation,
    markEdited,
    renderInspector,
    selectInstanceInPreview,
    getElementLabel,
    getTemplateByPath,
    getAssetSpecPath,
    safeProjectUrl,
    fetcher: (url, options) => fetch(url, options),
    projectFileTree,
    getScreenPreviewStates
  }
});
const screenMaterialController = new ScreenMaterialController({
  state: {
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    get activeInstancePath() { return activeInstancePath; },
    get materialFiles() { return materialFiles; },
    get createdMaterialFiles() { return createdMaterialFiles; },
    get projectFilePaths() { return projectFilePaths; },
    get appRoot() { return appRoot; }
  },
  services: {
    markEdited,
    renderNavigation,
    renderScreen,
    selectInstance,
    openScreenPlacementContextMenu,
    getScreenPreviewStates,
    getActivePreviewStateId,
    resolvePlacementForState,
    persistStatePlacements,
    isInstanceVisible,
    setInstanceVisible: (screen, instance, visible, stateId) =>
      previewStateController.setInstanceVisible(screen.data, instance, visible, stateId),
    setPreviewLayerVisibility: (screen, layer, visible, stateId) =>
      previewStateController.setLayerVisible(screen.data, layer, visible, stateId),
    removePlacementStateOverrides: (screen, placementIds, layerIds) =>
      previewStateController.removeStructuralOverrides(screen.data, placementIds, layerIds),
    confirm: (message) => window.confirm(message)
  }
});
const projectPersistence = new ProjectPersistence({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get assets() { return assets; },
    get materialFiles() { return materialFiles; },
    get createdMaterialFiles() { return createdMaterialFiles; },
    get theme() { return theme; },
    get activeAssetId() { return activeAssetId; },
    get viewingAssetTemplate() { return viewingAssetTemplate; },
    get isSaving() { return isSaving; },
    set isSaving(value) { isSaving = value; },
    get dirtyFiles() { return dirtyFiles; },
    get invalidYamlFiles() { return invalidYamlFiles; },
    get invalidWorkflowFiles() { return invalidWorkflowFiles; },
    get workflowSources() { return workflowSources; },
    get editVersion() { return editVersion; },
    set editVersion(value) { editVersion = value; },
    get hasEdits() { return hasEdits; },
    set hasEdits(value) { hasEdits = value; },
    set reviewedInSession(value) { reviewedInSession = value; },
    get pendingAssetSerializations() { return pendingAssetSerializations; },
    get specSources() { return specSources; },
    get createdSpecFiles() { return createdSpecFiles; },
    get createdScreenFiles() { return createdScreenFiles; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get assetSpecOwners() { return assetSpecOwners; },
    get pendingAssetCopies() { return pendingAssetCopies; },
    get projectFilePaths() { return projectFilePaths; },
    set projectFilePaths(value) { projectFilePaths = value; },
    get activeSpecPath() { return activeSpecPath; }
  },
  services: {
    byId,
    fetcher: (url, options) => fetch(url, options),
    validation: sharedValidation,
    setAssetDocumentStatus,
    setScreenYamlStatus,
    getInstanceAtPath,
    findInstancePathById,
    validateScreenMaterials,
    showEditorMessage,
    renderNavigation
  }
});
const previewStateController = new PreviewStateController({
  state: {
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    get activePreviewStateIds() { return activePreviewStateIds; },
    get activeInstancePath() { return activeInstancePath; },
    get viewingPreviewState() { return viewingPreviewState; },
    get isRenderOnly() { return isRenderOnly; }
  },
  services: {
    byId,
    element,
    getScreenPreviewStates,
    getElementLabel,
    showEditorMessage,
    markEdited,
    renderScreen,
    renderInspector,
    selectInstance,
    getInstanceAtPath,
    showFatalError,
    confirm: (message) => window.confirm(message),
    switchPreviewState: (...args) => switchPreviewState(...args),
    addPreviewState: (...args) => addPreviewState(...args)
  }
});
const screenInstanceRenderer = new ScreenInstanceRenderer({
  state: {
    get activeInstancePath() { return activeInstancePath; },
    get assetStyleScopeId() { return assetStyleScopeId; },
    set assetStyleScopeId(value) { assetStyleScopeId = value; },
    get assetInstanceDragType() { return assetInstanceDragType; },
    get assetDragType() { return assetDragType; },
    get viewingSpec() { return viewingSpec; },
    get viewingWorkflow() { return viewingWorkflow; },
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    get isRenderOnly() { return isRenderOnly; },
    get assetFiles() { return assetFiles; },
    get paletteAssetDropHandled() { return paletteAssetDropHandled; },
    set paletteAssetDropHandled(value) { paletteAssetDropHandled = value; }
  },
  services: {
    element,
    isInstanceVisible,
    isValidAttributeValue,
    sameInstancePath,
    getElementLabel,
    templateMarkupRenderer,
    safeProjectUrl,
    clearDropIndicators,
    readDraggedInstance,
    moveAssetInstance,
    showAddAssetError,
    showEditorMessage,
    addAssetToContainer,
    getEventInstance,
    selectInstance,
    getInstanceAtPath,
    getAssetSpecPath,
    createSpecForInstance,
    renderSpecEditor,
    openAssetContextMenu,
    addAssetToSlot,
    getTemplateByPath
  }
});
const screenElementController = new ScreenElementController({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    set activeScreenIndex(value) { activeScreenIndex = value; },
    get assets() { return assets; },
    get assetFiles() { return assetFiles; },
    get createdScreenFiles() { return createdScreenFiles; },
    get pendingAssetCopies() { return pendingAssetCopies; },
    get templateFileExtension() { return TEMPLATE_FILE_EXTENSION; }
  },
  services: {
    prompt: (message, defaultValue) => window.prompt(message, defaultValue),
    fetcher: (url, options) => fetch(url, options),
    safeProjectUrl,
    showEditorMessage,
    projectFileTree,
    markEdited,
    renderScreenSelector,
    renderNavigation,
    renderScreen,
    showFatalError,
    validation: sharedValidation,
    getTemplateByPath,
    getElementLabel,
    selectInstance,
    findAssetInstances,
    byId
  }
});
const themeEditor = new ThemeEditor({
  state: {
    get theme() { return theme; },
    get project() { return project; },
    get themeModeNames() { return themeModeNames; },
    get themeModePreference() { return themeModePreference; },
    set themeModePreference(value) { themeModePreference = value; },
    get systemThemeMode() { return systemThemeMode; },
    get viewingTheme() { return viewingTheme; },
    set viewingTheme(value) { viewingTheme = value; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    set activeProjectFilePath(value) { activeProjectFilePath = value; },
    get assetPreviewTimer() { return assetPreviewTimer; },
    set assetPreviewTimer(value) { assetPreviewTimer = value; },
    get assetPreviewVersion() { return assetPreviewVersion; },
    set assetPreviewVersion(value) { assetPreviewVersion = value; },
    set viewingAssetTemplate(value) { viewingAssetTemplate = value; },
    set viewingMaterialFile(value) { viewingMaterialFile = value; },
    set viewingProject(value) { viewingProject = value; },
    set viewingSpec(value) { viewingSpec = value; },
    set viewingPreviewState(value) { viewingPreviewState = value; },
    set activeSpecPath(value) { activeSpecPath = value; },
    set activeSpecInstancePath(value) { activeSpecInstancePath = value; },
    set activeAssetId(value) { activeAssetId = value; },
    set activeInstancePath(value) {
      activeInstancePath = value;
      activeInstancePaths = value.length ? [value] : [];
    }
  },
  services: {
    appendSection,
    appendEditableField,
    element,
    byId,
    applyTheme,
    markEdited,
    renderInspector,
    discardUneditedActiveSpecDraft,
    hidePreviewStateControls,
    hideEditorMessage,
    updateNavigationSelection
  }
});
const assetEditor = new AssetEditor({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get assets() { return assets; },
    get activeScreenIndex() { return activeScreenIndex; },
    get activeAssetId() { return activeAssetId; },
    set activeAssetId(value) { activeAssetId = value; },
    get activeInstancePath() { return activeInstancePath; },
    set activeInstancePath(value) {
      activeInstancePath = value;
      activeInstancePaths = value.length ? [value] : [];
    },
    get viewingAssetTemplate() { return viewingAssetTemplate; },
    get viewingMaterialFile() { return viewingMaterialFile; },
    set viewingAssetTemplate(value) { viewingAssetTemplate = value; },
    set viewingMaterialFile(value) { viewingMaterialFile = value; },
    set viewingTheme(value) { viewingTheme = value; },
    set viewingProject(value) { viewingProject = value; },
    set viewingSpec(value) { viewingSpec = value; },
    set viewingPreviewState(value) { viewingPreviewState = value; },
    set activeSpecPath(value) { activeSpecPath = value; },
    set activeSpecInstancePath(value) { activeSpecInstancePath = value; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    set activeProjectFilePath(value) { activeProjectFilePath = value; },
    get invalidYamlFiles() { return invalidYamlFiles; },
    get pendingAssetSerializations() { return pendingAssetSerializations; },
    get assetPreviewTimer() { return assetPreviewTimer; },
    set assetPreviewTimer(value) { assetPreviewTimer = value; },
    get assetPreviewVersion() { return assetPreviewVersion; },
    set assetPreviewVersion(value) { assetPreviewVersion = value; },
    get assetContextMenuTarget() { return assetContextMenuTarget; },
    set assetContextMenuTarget(value) { assetContextMenuTarget = value; },
    get pendingAssetDeletion() { return pendingAssetDeletion; },
    set pendingAssetDeletion(value) { pendingAssetDeletion = value; },
    get deleteDialogReturnFocus() { return deleteDialogReturnFocus; },
    set deleteDialogReturnFocus(value) { deleteDialogReturnFocus = value; }
  },
  services: {
    byId,
    element,
    window,
    document,
    clipboard: navigator.clipboard,
    validation: sharedValidation,
    parseYamlSource,
    validateAssetCategory: assetCategoryPath,
    validateAssetAttributes,
    validateAssetSlots,
    validateAssetSlotMarkup,
    hidePreviewStateControls,
    discardUneditedActiveSpecDraft,
    updateScreenDomContext,
    hideEditorMessage,
    updateNavigationSelection,
    renderNavigation,
    updateSaveControls,
    renderInspector,
    markEdited,
    setPreviewMessage,
    renderInstance,
    getInstanceAtPath,
    getTemplateByPath,
    getElementLabel,
    setAssetViewMode: (mode) => assetViewLayout.setViewMode(mode),
    showEditorMessage
  }
});
const materialFileEditor = new MaterialFileEditor({
  state: {
    get materialFiles() { return materialFiles; },
    get activeMaterialFilePath() { return activeMaterialFilePath; },
    set activeMaterialFilePath(value) { activeMaterialFilePath = value; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    set activeProjectFilePath(value) { activeProjectFilePath = value; },
    get assetPreviewTimer() { return assetPreviewTimer; },
    set assetPreviewTimer(value) { assetPreviewTimer = value; },
    get assetPreviewVersion() { return assetPreviewVersion; },
    set assetPreviewVersion(value) { assetPreviewVersion = value; },
    get activeAssetId() { return activeAssetId; },
    set activeAssetId(value) { activeAssetId = value; },
    set activeInstancePath(value) {
      activeInstancePath = value;
      activeInstancePaths = value.length ? [value] : [];
    },
    set activeSpecPath(value) { activeSpecPath = value; },
    set activeSpecInstancePath(value) { activeSpecInstancePath = value; },
    get viewingMaterialFile() { return viewingMaterialFile; },
    set viewingMaterialFile(value) { viewingMaterialFile = value; },
    set viewingAssetTemplate(value) { viewingAssetTemplate = value; },
    set viewingTheme(value) { viewingTheme = value; },
    set viewingProject(value) { viewingProject = value; },
    set viewingSpec(value) { viewingSpec = value; },
    set viewingPreviewState(value) { viewingPreviewState = value; },
    get invalidYamlFiles() { return invalidYamlFiles; }
  },
  services: {
    byId,
    element,
    validation: sharedValidation,
    parseYamlSource,
    hidePreviewStateControls,
    closeAssetContextMenu,
    updateScreenDomContext,
    discardUneditedActiveSpecDraft,
    updateNavigationSelection,
    hideEditorMessage,
    setAssetViewMode: (mode) => assetViewLayout.setViewMode(mode),
    renderInspector,
    renderNavigation,
    updateSaveControls,
    markEdited,
    templateMarkupRenderer,
    setPreviewMessage,
    showEditorMessage
  }
});
const editorNavigation = new EditorNavigation({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get assets() { return assets; },
    get activeScreenIndex() { return activeScreenIndex; },
    set activeScreenIndex(value) { activeScreenIndex = value; },
    get activeAssetId() { return activeAssetId; },
    get activeMaterialFilePath() { return activeMaterialFilePath; },
    set activeMaterialFilePath(value) { activeMaterialFilePath = value; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    get viewingProject() { return viewingProject; },
    get viewingTheme() { return viewingTheme; },
    get viewingSpec() { return viewingSpec; },
    get viewingWorkflow() { return viewingWorkflow; },
    get activeWorkflowPath() { return activeWorkflowPath; },
    get workflowScreenIndex() { return workflowScreenIndex; },
    get activeSpecOwner() { return activeSpecOwner; },
    get activeSpecPath() { return activeSpecPath; },
    get activeSpecInstancePath() { return activeSpecInstancePath; },
    get materialFiles() { return materialFiles; },
    get viewingAssetTemplate() { return viewingAssetTemplate; },
    get viewingMaterialFile() { return viewingMaterialFile; },
    set viewingMaterialFile(value) { viewingMaterialFile = value; },
    get activeInstancePath() { return activeInstancePath; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get assetSpecOwners() { return assetSpecOwners; },
    get hasEdits() { return hasEdits; }
  },
  services: {
    getInstanceAtPath,
    getTemplateByPath,
    getElementLabel,
    getProjectFileAction,
    openProjectFile,
    selectInstance,
    renderScreen,
    renderProjectOverview,
    createProjectSpec,
    createSpecForScreen,
    createSpecForInstance,
    renderSpecEditor,
    renderThemeView,
    renderAssetTemplate,
    renderMaterialFile,
    sameInstancePath,
    renderWorkflowEditor: (filePath, screenIndex) => {
      screenAnnotationController?.setEnabled(false);
      return workflowEditor.render(filePath, screenIndex);
    },
    showEditorMessage,
    loadProject
  },
  browserHistory
});
const projectFileNavigator = new ProjectFileNavigator({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    set activeScreenIndex(value) { activeScreenIndex = value; },
    get projectFilePaths() { return projectFilePaths; },
    get theme() { return theme; },
    get viewingAssetTemplate() { return viewingAssetTemplate; },
    get viewingTheme() { return viewingTheme; },
    get viewingProject() { return viewingProject; },
    get viewingSpec() { return viewingSpec; },
    get viewingWorkflow() { return viewingWorkflow; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    get activeSpecPath() { return activeSpecPath; },
    get activeAssetId() { return activeAssetId; },
    get assets() { return assets; },
    get materialFiles() { return materialFiles; },
    get activeMaterialFilePath() { return activeMaterialFilePath; },
    get viewingMaterialFile() { return viewingMaterialFile; },
    get specSources() { return specSources; },
    get workflowSources() { return workflowSources; },
    get activeWorkflowPath() { return activeWorkflowPath; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get createdScreenFiles() { return createdScreenFiles; },
    get createdSpecFiles() { return createdSpecFiles; },
    get pendingAssetCopies() { return pendingAssetCopies; },
    get assetFiles() { return assetFiles; },
    get assetSpecOwners() { return assetSpecOwners; },
    get historyUpdateSuppressed() { return historyUpdateSuppressed; },
    set historyUpdateSuppressed(value) { historyUpdateSuppressed = value; },
    get activeSpecOwner() { return activeSpecOwner; },
    get assetDragType() { return assetDragType; },
    get assetEditorRestoreId() { return assetEditorRestoreId; },
    set assetEditorRestoreId(value) { assetEditorRestoreId = value; },
    get paletteAssetDropHandled() { return paletteAssetDropHandled; },
    set paletteAssetDropHandled(value) { paletteAssetDropHandled = value; }
  },
  services: {
    byId,
    element,
    updateNavigationSelection,
    renderScreen,
    showFatalError,
    renderProjectOverview,
    renderThemeView,
    renderAssetTemplate,
    renderMaterialFile,
    renderSpecEditor,
    renderWorkflowEditor: (filePath, screenIndex) => {
      screenAnnotationController?.setEnabled(false);
      return workflowEditor.render(filePath, screenIndex);
    },
    syncBrowserHistory,
    clearDropIndicators,
    showEditorMessage
  },
  projectFileTree
});
const materialCanvas = new MaterialCanvas({
  state: {
    get isRenderOnly() { return isRenderOnly; },
    get viewingSpec() { return viewingSpec; },
    get viewingWorkflow() { return viewingWorkflow; },
    get activeInstancePath() { return activeInstancePath; },
    get activeInstancePaths() { return activeInstancePaths; },
    get scaleType() { return screenSelectionController?.scaleType || "xy"; }
  },
  services: {
    document,
    markEdited,
    renderInspector,
    selectInstance,
    openScreenPlacementContextMenu,
    persistPlacementState
  }
});
const screenMaterialRenderer = new ScreenMaterialRenderer({
  state: {
    get activeInstancePath() { return activeInstancePath; },
    get activeInstancePaths() { return activeInstancePaths; },
    get materialFiles() { return materialFiles; },
    get isRenderOnly() { return isRenderOnly; },
    get viewingSpec() { return viewingSpec; },
    get viewingWorkflow() { return viewingWorkflow; }
  },
  services: {
    document,
    sameInstancePath,
    selectInstance,
    openScreenPlacementContextMenu,
    templateMarkupRenderer
  }
});
const workspaceViewRenderer = new WorkspaceViewRenderer({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    set activeScreenIndex(value) { activeScreenIndex = value; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    set activeProjectFilePath(value) { activeProjectFilePath = value; },
    get assetPreviewTimer() { return assetPreviewTimer; },
    set assetPreviewTimer(value) { assetPreviewTimer = value; },
    get assetPreviewVersion() { return assetPreviewVersion; },
    set assetPreviewVersion(value) { assetPreviewVersion = value; },
    set viewingAssetTemplate(value) { viewingAssetTemplate = value; },
    set viewingMaterialFile(value) { viewingMaterialFile = value; },
    set viewingTheme(value) { viewingTheme = value; },
    set viewingProject(value) { viewingProject = value; },
    set viewingSpec(value) { viewingSpec = value; },
    set viewingWorkflow(value) { viewingWorkflow = value; },
    set activeWorkflowPath(value) { activeWorkflowPath = value; },
    set viewingPreviewState(value) { viewingPreviewState = value; },
    set activeSpecPath(value) { activeSpecPath = value; },
    set activeSpecInstancePath(value) { activeSpecInstancePath = value; },
    set activeAssetId(value) { activeAssetId = value; },
    set activeInstancePath(value) {
      activeInstancePath = value;
      activeInstancePaths = value.length ? [value] : [];
    },
    get assets() { return assets; },
    get theme() { return theme; },
    get specSources() { return specSources; }
  },
  services: {
    byId,
    element,
    discardUneditedActiveSpecDraft,
    closeAssetContextMenu,
    renderScreenSelector,
    projectFileTree,
    hideEditorMessage,
    updateNavigationSelection,
    updateScreenDomContext,
    renderPreviewStateControls,
    configureScreenYamlEditor,
    syncScreenViewMode,
    setScreenDomContext,
    renderMaterial: (material, index, path) => screenMaterialRenderer.render(material, index, path),
    getActivePreviewStateId,
    isInstanceVisible,
    isLayerVisible,
    resolvePlacementForState,
    createMaterialFrame: (host, instance, index, content, screen, path, parentTransform, rootContent) =>
      materialCanvas.createFrame(
        host,
        instance,
        index,
        content,
        screen,
        path,
        parentTransform,
        rootContent
      ),
    closeScreenPlacementContextMenu,
    renderInspector,
    setPreviewMessage,
    hidePreviewStateControls
  }
});
const screenAnnotationController = new ScreenAnnotationController({
  state: {},
  services: {
    byId,
    document,
    window,
    fetcher: (url, options) => fetch(url, options),
    prompt: (message, value) => window.prompt(message, value),
    getActivePreviewStateId: (screenId) => activePreviewStateIds.get(screenId) || "default",
    setSelectionTool: (tool) => screenSelectionController?.selectTool(tool)
  }
});
workflowEditor = new WorkflowEditor({
  state: {
    get workflowSources() { return workflowSources; },
    get invalidWorkflowFiles() { return invalidWorkflowFiles; },
    get viewingWorkflow() { return viewingWorkflow; },
    set viewingWorkflow(value) { viewingWorkflow = value; },
    get activeWorkflowPath() { return activeWorkflowPath; },
    set activeWorkflowPath(value) { activeWorkflowPath = value; },
    get workflowScreenIndex() { return workflowScreenIndex; },
    set workflowScreenIndex(value) { workflowScreenIndex = value; },
    get workflowViewMode() { return workflowViewMode; },
    set workflowViewMode(value) { workflowViewMode = value; },
    get selectedWorkflowNodeId() { return selectedWorkflowNodeId; },
    set selectedWorkflowNodeId(value) { selectedWorkflowNodeId = value; },
    get isSaving() { return isSaving; }
  },
  services: {
    byId,
    setWorkflowViewMode: (mode) => workflowViewLayout.setViewMode(mode),
    renderNavigation,
    renderInspector,
    markEdited,
    updateSaveControls,
    showWorkflowNode,
    getWorkflowSpecDocuments: async () => {
      const filePaths = projectFileNavigator.getProjectTreeFilePaths().filter((filePath) =>
        projectFileNavigator.getProjectFileAction(filePath)?.kind === "spec"
      );
      return Promise.all(filePaths.map(async (filePath) => {
        let source = specSources.get(filePath);
        if (source === undefined) {
          source = await loadText(filePath);
          specSources.set(filePath, source);
        }
        return { filePath, source };
      }));
    },
    openWorkflowSpec: async (filePath, references) => {
      const action = projectFileNavigator.getProjectFileAction(filePath);
      if (action?.kind !== "spec") {
        throw new Error(`Workflow spec "${filePath}" is not linked to this project.`);
      }
      let source = specSources.get(filePath);
      if (source === undefined) {
        source = await loadText(filePath);
        specSources.set(filePath, source);
      }
      workflowEditor.showSpecPreview(filePath, source, references);
    }
  }
});
const screenSelectionController = new ScreenSelectionController({
  state: {
    get isRenderOnly() { return isRenderOnly; },
    get viewingWorkflow() { return viewingWorkflow; }
  },
  services: {
    byId,
    document,
    selectInstances,
    openPlacementContextMenu: openScreenPlacementContextMenu,
    closePlacementContextMenu: closeScreenPlacementContextMenu,
    disableAnnotationMode: () => screenAnnotationController.setEnabled(false)
  }
});
const screenRulerController = new ScreenRulerController({
  documentObject: document,
  windowObject: window
});
const responsiveToolbarController = new ResponsiveToolbarController({
  documentObject: document,
  windowObject: window,
  toolbarConfigs: [
    {
      toolbarId: "preview-state-toolbar",
      toggleId: "preview-toolbar-overflow-toggle",
      menuId: "preview-toolbar-overflow-menu"
    },
    {
      toolbarId: "annotation-toolbar",
      toggleId: "annotation-toolbar-overflow-toggle",
      menuId: "annotation-toolbar-overflow-menu"
    }
  ]
});
if (!isRenderOnly) screenRulerController.bind();
if (!isRenderOnly) responsiveToolbarController.bind();
if (!isRenderOnly) screenAnnotationController.bind();
if (!isRenderOnly) screenSelectionController.bind();
const inspectorRenderer = new InspectorRenderer({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get assets() { return assets; },
    get theme() { return theme; },
    get specSources() { return specSources; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get activeScreenIndex() { return activeScreenIndex; },
    get activeAssetId() { return activeAssetId; },
    get activeMaterialFilePath() { return activeMaterialFilePath; },
    get materialFiles() { return materialFiles; },
    get activeInstancePath() { return activeInstancePath; },
    get activeInstancePaths() { return activeInstancePaths; },
    get activeSpecOwner() { return activeSpecOwner; },
    get activeSpecPath() { return activeSpecPath; },
    get activeSpecInstancePath() { return activeSpecInstancePath; },
    get viewingPreviewState() { return viewingPreviewState; },
    get viewingProject() { return viewingProject; },
    get viewingTheme() { return viewingTheme; },
    get viewingSpec() { return viewingSpec; },
    get viewingWorkflow() { return viewingWorkflow; },
    get viewingAssetTemplate() { return viewingAssetTemplate; },
    get viewingMaterialFile() { return viewingMaterialFile; },
    get reviewedInSession() { return reviewedInSession; },
    set reviewedInSession(value) { reviewedInSession = value; }
  },
  services: {
    byId,
    element,
    getInstanceAtPath,
    getTemplateByPath,
    getActivePreviewStateId,
    getScreenPreviewStates,
    appendEditableField,
    renamePreviewState,
    describePreviewState,
    deletePreviewState,
    showFatalError,
    getElementLabel,
    isInstanceVisible,
    isLayerVisible,
    resolvePlacementForState,
    persistPlacementState,
    setInstanceVisible: (screen, instance, visible, stateId) =>
      previewStateController.setInstanceVisible(screen.data, instance, visible, stateId),
    listPreviewStateOverrides: (screen, stateId) =>
      previewStateController.listStateOverrides(screen, stateId),
    resetPreviewStateOverride: (screen, stateId, selectedOverride) =>
      previewStateController.resetStateOverride(screen, stateId, selectedOverride),
    markEdited,
    renderScreen,
    renderMaterialFile,
    showEditorMessage,
    renderSpecEditor,
    placeMaterialFile: (filePath) => screenMaterialController.addFromFile(filePath),
    createProjectSpec,
    createSpecForScreen,
    renderScreenInstanceTree,
    deleteMaterial: (path) => screenMaterialController.delete(path),
    createLayer: () => screenMaterialController.createLayer(),
    renameLayer: (...args) => screenMaterialController.renameLayer(...args),
    setLayerVisibility: (...args) => screenMaterialController.setLayerVisibility(...args),
    moveLayer: (...args) => screenMaterialController.moveLayer(...args),
    reorderLayer: (...args) => screenMaterialController.reorderLayer(...args),
    moveMaterial: (...args) => screenMaterialController.moveMaterial(...args),
    movePlacement: (...args) => screenMaterialController.movePlacement(...args),
    reorderMaterial: (...args) => screenMaterialController.reorderMaterial(...args),
    reorderPlacement: (...args) => screenMaterialController.reorderPlacement(...args),
    deleteLayer: (...args) => screenMaterialController.deleteLayer(...args),
    assignMaterialLayer: (...args) => screenMaterialController.assignMaterialLayer(...args),
    assignPlacementLayer: (...args) => screenMaterialController.assignPlacementLayer(...args),
    groupPlacements: (...args) => screenMaterialController.group(...args),
    ungroupPlacement: (...args) => screenMaterialController.ungroup(...args),
    openScreenPlacementContextMenu,
    closeScreenPlacementContextMenu,
    selectInstance,
    confirm: (message) => window.confirm(message),
    renderNavigation,
    refreshActiveView,
    getAssetSpecPath,
    confirmDeleteAsset,
    markAssetTemplateEdited,
    attributeTypes,
    numberFormats,
    themeEditor,
    createSpecForInstance,
    renderInspector: () => renderInspector()
  }
});

if (isRenderOnly) document.body.classList.add("render-only");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function getScreenPreviewStates(screen) {
  return sharedValidation.getPreviewStates(screen);
}

function getActivePreviewStateId(screen) {
  return previewStateController.getActiveId(screen);
}

function isInstanceVisible(instance, stateId, screen = screens[activeScreenIndex]?.data) {
  return previewStateController.isInstanceVisible(
    instance,
    stateId,
    screen
  );
}

function isLayerVisible(layer, stateId, screen = screens[activeScreenIndex]?.data) {
  return previewStateController.isLayerVisible(layer, stateId, screen);
}

function resolvePlacementForState(instance, stateId, screen = screens[activeScreenIndex]?.data) {
  return previewStateController.resolvePlacement(instance, stateId, screen);
}

function persistPlacementState(instance) {
  const screen = screens[activeScreenIndex];
  if (!screen) throw new Error("Select a Screen before editing a placement.");
  previewStateController.savePlacement(
    screen,
    instance,
    getActivePreviewStateId(screen.data)
  );
}

function persistStatePlacements(screen, placements, stateId) {
  for (const placement of placements) {
    previewStateController.savePlacement(screen, placement, stateId);
  }
}

function getTemplateByPath(filePath) {
  return [...assets.values()].find((template) => template.templateFile === filePath) || null;
}

function getElementLabel(instance) {
  const definition = typeof instance.src === "string" ? materialFiles.get(instance.src) : null;
  const instanceLabel = Object.entries(definition?.data.attributes || {})
    .map(([name, attribute]) => instance.attributes?.[name] ?? attribute.default)
    .find((value) => typeof value === "string" && value.trim());
  if (instanceLabel) {
    return instanceLabel;
  }
  if (definition) return definition.data.name || definition.id;
  return instance.type === "text"
    ? instance.content || instance.id || "Text"
    : instance.label || instance.id || "Button";
}

function renderPreviewStateControls(screen) {
  previewStateController.renderControls(screen);
}

function openScreenPreview() {
  const screen = screens[activeScreenIndex];
  if (!screen) return;
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("render", screen.id);
  const stateId = previewStateController.getActiveId(screen.data);
  if (stateId !== "default") url.searchParams.set("state", stateId);
  window.open(url.href, "_blank", "noopener,noreferrer");
}

function hidePreviewStateControls() {
  screenYamlEditor.hideControls();
  byId("main").classList.remove("screen-editing");
}

function setScreenYamlStatus(screen, message, isError = false) {
  screenYamlEditor.setStatus(screen, message, isError);
}

function syncScreenViewMode() {
  screenYamlEditor.syncViewMode();
}

async function setScreenViewMode(mode) {
  screenYamlEditor.setViewMode(mode);
  if (mode === "yaml") screenAnnotationController?.setEnabled(false);
}

async function prepareScreenYamlSource(screen) {
  return screenYamlEditor.prepareSource(screen);
}

function configureScreenYamlEditor(screen) {
  screenYamlEditor.configure(screen);
}

async function parseScreenYaml(screen, source, version) {
  return screenYamlEditor.parse(screen, source, version);
}

function renamePreviewState(stateId, name) {
  previewStateController.rename(stateId, name);
}

function describePreviewState(stateId, description) {
  previewStateController.describe(stateId, description);
}

async function switchPreviewState(stateId) {
  return previewStateController.switchTo(stateId);
}

async function addPreviewState() {
  return previewStateController.add();
}

function renderScreenInstanceTree(panel, instances, parentPath = [], depth = 0, stateId = "default") {
  previewStateController.renderInstanceTree(panel, instances, parentPath, depth, stateId);
}

async function deletePreviewState(stateId) {
  return previewStateController.delete(stateId);
}

function safeProjectUrl(filePath, base = appRoot) {
  return projectRepository.safeProjectUrl(filePath, base);
}

function loadText(filePath, base = appRoot) {
  return projectRepository.loadText(filePath, base);
}

function loadYaml(filePath) {
  return projectRepository.loadYaml(filePath);
}

function parseYamlSource(source, context) {
  return projectRepository.parseYamlSource(source, context);
}

function validateScreenMaterials(screen) {
  projectRepository.validateScreenMaterials(screen);
}

function findInstancePathById(instances, assetId, parentPath = []) {
  return projectRepository.findInstancePathById(instances, assetId, parentPath);
}

function refreshAssetSpecOwner(filePath, source) {
  return projectRepository.refreshAssetSpecOwner(filePath, source, screens, assetSpecOwners);
}

function getAssetSpecPath(screen, instance) {
  for (const [filePath, owner] of assetSpecOwners) {
    if (owner.screenFile === screen.file && owner.elementId === instance.id) return filePath;
  }
  return null;
}

function assetCategoryPath(template, source) {
  return projectRepository.validation.assetCategoryPath(template, source);
}

function validateAssetAttributes(template, source) {
  return projectRepository.validation.validateAssetAttributes(template, source);
}

function validateAssetSlots(template, source) {
  return projectRepository.validation.validateAssetSlots(template, source);
}

function validateAssetSlotMarkup(template, markup, source) {
  return projectRepository.validation.validateAssetSlotMarkup(template, markup, source);
}

function getDefinedThemeModes() {
  return themeEditor.getDefinedModes();
}

function getActiveThemeMode() {
  return themeEditor.getActiveMode();
}

function getThemeTokens(mode) {
  return themeEditor.getTokens(mode);
}

function themeModeLabel(mode) {
  return themeEditor.modeLabel(mode);
}

function isValidAttributeValue(definition, value) {
  return sharedValidation.isValidAttributeValue(definition, value);
}

async function loadProject(selectionToRestore = null) {
  clearTimeout(assetPreviewTimer);
  assetPreviewTimer = null;
  assetPreviewVersion += 1;
  for (const template of assets.values()) {
    clearTimeout(template.yamlTimer);
    template.yamlParseVersion += 1;
  }
  for (const material of materialFiles.values()) {
    clearTimeout(material.parseTimer);
    material.parseVersion = (material.parseVersion || 0) + 1;
  }
  for (const screen of screens) {
    clearTimeout(screen.yamlTimer);
    screen.yamlParseVersion += 1;
    screen.yamlSerializeVersion += 1;
  }
  screenYamlEditor.resetViewMode();
  createdScreenFiles.clear();
  createdMaterialFiles.clear();
  createdSpecFiles.clear();
  createdSpecDrafts.clear();
  assetSpecOwners.clear();
  activeProjectFilePath = null;
  activeMaterialFilePath = null;
  pendingAssetCopies.length = 0;
  setPreviewMessage("loading", "Reading project files...");
  try {
    const loaded = await projectRepository.load();
    project = loaded.project;
    projectFilePaths = loaded.projectFilePaths;
    assetFiles = loaded.assetFiles;
    screens = loaded.screens;
    materialFiles = loaded.materialFiles;
    activePreviewStateIds.clear();
    assets = loaded.assets;
    specSources = loaded.specSources;
    workflowSources = loaded.workflowSources;
    assetSpecOwners.clear();
    for (const [filePath, owner] of loaded.assetSpecOwners) {
      assetSpecOwners.set(filePath, owner);
    }
    theme = loaded.theme;
    viewingTheme = false;
    viewingMaterialFile = false;
    viewingProject = false;
    viewingSpec = false;
    viewingPreviewState = false;
    viewingWorkflow = false;
    activeWorkflowPath = null;
    workflowScreenIndex = 0;
    selectedWorkflowNodeId = null;
    workflowViewMode = "split";
    activeSpecPath = null;
    activeSpecInstancePath = [];
    activeSpecOwner = "instance";
    hasEdits = false;
    dirtyFiles.clear();
    invalidYamlFiles.clear();
    invalidWorkflowFiles.clear();
    pendingAssetSerializations.clear();
    byId("create-screen").disabled = false;
    updateSaveControls();
    reviewedInSession = false;
    applyTheme();
    renderNavigation();
    renderScreenSelector();
    if (isRenderOnly) {
      const renderIndex = screens.findIndex((screen) => screen.id === renderRequestedScreen);
      if (renderIndex < 0) throw new Error(`Unknown Screen "${renderRequestedScreen}".`);
      if (renderRequestedState !== null) {
        const renderScreenData = screens[renderIndex].data;
        if (!getScreenPreviewStates(renderScreenData).some((state) => state.id === renderRequestedState)) {
          throw new Error(
            `Unknown preview state "${renderRequestedState}" for Screen "${renderRequestedScreen}".`
          );
        }
        activePreviewStateIds.set(screens[renderIndex].id, renderRequestedState);
      }
      await renderScreen(renderIndex);
      if (byId("screen-preview").classList.contains("error")) {
        throw new Error(byId("screen-preview").textContent.trim() || "Screen render failed.");
      }
      if (renderRequestedAnnotations) {
        const annotationResponse = await fetch(
          `/api/render-annotations?screenId=${encodeURIComponent(renderRequestedScreen)}`
        );
        const annotationSet = await annotationResponse.json();
        if (!annotationResponse.ok) {
          throw new Error(annotationSet.error || `HTTP ${annotationResponse.status}`);
        }
        screenAnnotationController.renderStaticAnnotations(annotationSet);
      }
      if (!document.body.dataset.specuxRenderHeight) {
        document.body.dataset.specuxRenderHeight = String(Math.ceil(Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
          byId("screen-preview").scrollHeight
        )));
      }
      document.body.dataset.specuxRenderReady = "true";
      if (new URLSearchParams(window.location.search).get("format") === "html") {
        document.body.dataset.specuxRenderHtml = encodeBase64(await standaloneScreenHtml());
      }
    } else if (selectionToRestore) {
      const wasHistoryUpdateSuppressed = historyUpdateSuppressed;
      const restoringUrl = selectionToRestore.view === "url";
      if (restoringUrl) historyUpdateSuppressed = true;
      try {
        await restoreUiSelection(selectionToRestore);
      } finally {
        historyUpdateSuppressed = wasHistoryUpdateSuppressed;
        if (restoringUrl && !wasHistoryUpdateSuppressed) syncBrowserHistory(true);
      }
    } else {
      await renderScreen(0);
    }
  } catch (error) {
    showFatalError(error);
  }
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function cloneRenderedNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
  if (node.nodeType !== Node.ELEMENT_NODE) return node.cloneNode(false);
  const copy = node.cloneNode(false);
  const children = node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
  if (node.shadowRoot) {
    const shadowTemplate = document.createElement("template");
    shadowTemplate.setAttribute("shadowrootmode", "open");
    for (const child of children) shadowTemplate.content.append(cloneRenderedNode(child));
    copy.append(shadowTemplate);
  } else {
    for (const child of children) copy.append(cloneRenderedNode(child));
  }
  return copy;
}

async function standaloneScreenHtml() {
  const outputDocument = document.implementation.createHTMLDocument("");
  outputDocument.documentElement.lang = "en";
  const rootStyle = document.documentElement.getAttribute("style") || "";
  if (rootStyle) outputDocument.documentElement.setAttribute("style", rootStyle);
  const themeBackground = getThemeTokens().background;
  if (themeBackground !== undefined) outputDocument.body.style.backgroundColor = themeBackground;
  const charset = outputDocument.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  outputDocument.head.append(charset);
  const stylesheetLink = document.querySelector('link[rel="stylesheet"]');
  if (!stylesheetLink) throw new Error("The Studio stylesheet link is missing.");
  const stylesheetResponse = await fetch(stylesheetLink.href);
  if (!stylesheetResponse.ok) {
    throw new Error(`Could not load standalone stylesheet (HTTP ${stylesheetResponse.status}).`);
  }
  const globalStyles = outputDocument.createElement("style");
  globalStyles.textContent = await stylesheetResponse.text();
  outputDocument.head.append(globalStyles);
  for (const style of document.head.querySelectorAll("style")) {
    outputDocument.head.append(style.cloneNode(true));
  }
  outputDocument.body.append(cloneRenderedNode(byId("screen-preview")));
  return `<!doctype html>\n${outputDocument.documentElement.outerHTML}\n`;
}

function currentUiSelection() {
  return editorNavigation.currentSelection();
}

function getSelectionFilePath(selection) {
  return editorNavigation.getSelectionFilePath(selection);
}

function selectionFromLocation() {
  return editorNavigation.selectionFromLocation();
}

function syncBrowserHistory(forceReplace = false) {
  editorNavigation.syncHistory(forceReplace);
}

async function restoreUiSelection(selection) {
  return editorNavigation.restoreSelection(selection);
}

function refreshFromExternalChanges() {
  return editorNavigation.refreshFromExternalChanges();
}

if (!isRenderOnly && typeof EventSource !== "undefined") {
  const projectEvents = new EventSource("/api/events");
  projectEvents.addEventListener("project-updated", refreshFromExternalChanges);
}

function applyTheme() {
  const tokens = getThemeTokens();
  const tokenNames = new Set(Object.keys(tokens));
  const themeRoot = byId("screen-preview");
  for (const name of appliedThemeTokens) {
    if (!tokenNames.has(name)) themeRoot.style.removeProperty(`--theme-${name}`);
  }
  for (const [name, value] of Object.entries(tokens)) {
    themeRoot.style.setProperty(`--theme-${name}`, value);
  }
  appliedThemeTokens = tokenNames;
  byId("screen-preview").style.colorScheme = getActiveThemeMode();
}

function renderNavigation() {
  return projectFileNavigator.renderNavigation();
}

function renderScreenSelector() {
  return projectFileNavigator.renderScreenSelector();
}

function setScreenSelectorOpen(open, restoreFocus = false) {
  return projectFileNavigator.setScreenSelectorOpen(open, restoreFocus);
}

function getProjectTreeFilePaths() {
  return projectFileNavigator.getProjectTreeFilePaths();
}

function renderProjectFile(file) {
  return projectFileNavigator.renderProjectFile(file);
}

function getProjectFileAction(filePath) {
  return projectFileNavigator.getProjectFileAction(filePath);
}

async function openProjectFile(filePath) {
  return projectFileNavigator.openProjectFile(filePath);
}

function updateAssetTemplateTreeFile(button, asset) {
  return projectFileNavigator.updateAssetTemplateTreeFile(button, asset);
}

async function createScreen() {
  return screenElementController.createScreen();
}

function createAssetInstanceId(screen, name, fallback) {
  return screenElementController.createInstanceId(screen, name, fallback);
}

function createTemplateElement(template, siblings, screen) {
  return screenElementController.createTemplateElement(template, siblings, screen);
}

async function ensureAssetOnScreen(template, screen) {
  return screenElementController.ensureAssetOnScreen(template, screen);
}

function getInstanceAtPath(screen, path) {
  const materials = screen.data?.materials || screen.materials || [];
  return getScreenPlacementAtPath(materials, path);
}

function getSiblingList(screen, parentPath, slotId) {
  return screenElementController.getSiblingList(screen, parentPath, slotId);
}

function getInstanceLocation(screen, path) {
  return screenElementController.getInstanceLocation(screen, path);
}

function instancePathFor(parentPath, slotId, index) {
  return screenElementController.instancePathFor(parentPath, slotId, index);
}

async function addAssetToContainer(assetPath, parentPath, slotId, requestedIndex = null) {
  return screenElementController.addToContainer(assetPath, parentPath, slotId, requestedIndex);
}

async function addAssetToScreen(assetPath, position) {
  return screenElementController.addToScreen(assetPath, position);
}

function addAssetToSlot(parentPath, slotId, assetPath) {
  return screenElementController.addToSlot(parentPath, slotId, assetPath);
}

function pathStartsWith(path, prefix) {
  return screenElementController.pathStartsWith(path, prefix);
}

function findInstancePathByReference(screen, target) {
  return screenElementController.findInstancePathByReference(screen, target);
}

async function moveAssetInstance(sourcePath, parentPath, slotId, requestedIndex = null) {
  return screenElementController.move(sourcePath, parentPath, slotId, requestedIndex);
}

async function deleteAssetInstance(path) {
  return screenElementController.delete(path);
}

function readDraggedInstance(dataTransfer) {
  const payload = dataTransfer.getData(assetInstanceDragType);
  if (!payload) return null;
  let path;
  try {
    path = JSON.parse(payload);
  } catch {
    throw new Error("The dragged Element has an invalid position.");
  }
  if (!Array.isArray(path) || path.length === 0 || path.length % 2 !== 1 ||
      path.some((part, index) => index % 2 === 0
        ? !Number.isInteger(part) || part < 0
        : typeof part !== "string" || !part)) {
    throw new Error("The dragged Element has an invalid position.");
  }
  return path;
}

function clearDropIndicators() {
  for (const host of findAssetInstances(byId("screen-preview"))) {
    host.classList.remove("dragging", "drop-before", "drop-after");
    host.querySelectorAll(".specux-drop-slot.drop-target")
      .forEach((slot) => slot.classList.remove("drop-target"));
    host.shadowRoot?.querySelectorAll(".specux-drop-slot.drop-target")
      .forEach((slot) => slot.classList.remove("drop-target"));
  }
}

function findAssetInstances(root, instances = []) {
  for (const node of root.querySelectorAll(".asset-instance")) {
    instances.push(node);
    if (node.shadowRoot) findAssetInstances(node.shadowRoot, instances);
  }
  return instances;
}

function selectInstanceInPreview(path) {
  const selectedPaths = (Array.isArray(path?.[0]) ? path : [path])
    .map((selectedPath) => JSON.stringify(selectedPath));
  let selectedNode = null;
  for (const node of byId("screen-preview").querySelectorAll(".material-instance")) {
    const selected = selectedPaths.includes(node.dataset.instancePath);
    node.classList.toggle("selected", selected);
    if (selected) selectedNode = node;
  }
  return selectedNode;
}

function showAddAssetError(error) {
  showEditorMessage("Could not add asset", error.message || String(error));
}

async function renderScreen(index, options = {}) {
  if (!options.preserveWorkflow) workflowEditor?.deactivate();
  await workspaceViewRenderer.renderScreen(index, options);
  if (!isRenderOnly) {
    await screenAnnotationController.setScreen(screens[index]);
    screenSelectionController.setScreen(screens[index]);
    publishSelection();
  }
}

async function showWorkflowNode(link, ownerScreenIndex, workflowPath) {
  const screenIndex = screens.findIndex((screen) => screen.id === link.screenId);
  const screen = screens[screenIndex];
  if (!screen) {
    throw new Error(`Workflow Screen "${link.screenId}" is not available.`);
  }

  const stateId = link.stateId;
  if (!getScreenPreviewStates(screen.data).some((previewState) =>
    previewState.id === stateId
  )) {
    throw new Error(`Preview State "${stateId}" is not available on Screen "${screen.id}".`);
  }

  let instancePath = [];
  if (link.placementId) {
    instancePath = getScreenPlacementPathById(
      screen.data.materials || [],
      link.placementId
    ) || [];
    if (instancePath.length === 0) {
      throw new Error(
        `Element "${link.placementId}" is not available on Screen "${screen.id}".`
      );
    }
  }

  activePreviewStateIds.set(screen.id, stateId);
  activeInstancePath = instancePath;
  activeInstancePaths = instancePath.length ? [[...instancePath]] : [];
  activeScreenIndex = screenIndex;
  await renderScreen(screenIndex, {
    preserveWorkflow: true,
    previewStateSelected: !link.placementId && stateId !== "default"
  });

  screenAnnotationController.setEnabled(false);
  activeAssetId = null;
  viewingWorkflow = true;
  activeWorkflowPath = workflowPath;
  workflowScreenIndex = ownerScreenIndex;
  activeProjectFilePath = workflowPath;
  workflowEditor.activate();
  workflowEditor.setViewMode(workflowViewMode);
  updateNavigationSelection();
  renderInspector();
  if (link.placementId) {
    await scrollPreviewToPlacement(instancePath);
  }
}

async function scrollPreviewToPlacement(instancePath) {
  const preview = byId("screen-preview");
  const host = byId(`specux-material-${instancePath.join("-")}`);
  const frame = host?.closest(".material-frame");
  if (!frame) return;

  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  const previewRect = preview.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  const content = preview.querySelector(":scope > .form-content");
  const contentRect = content?.getBoundingClientRect();
  const scaleX = contentRect && content.offsetWidth
    ? contentRect.width / content.offsetWidth
    : 1;
  const scaleY = contentRect && content.offsetHeight
    ? contentRect.height / content.offsetHeight
    : 1;
  const viewportLeft = previewRect.left + preview.clientLeft;
  const viewportTop = previewRect.top + preview.clientTop;
  const viewportRight = viewportLeft + preview.clientWidth;
  const viewportBottom = viewportTop + preview.clientHeight;
  const isVisible = frameRect.left >= viewportLeft &&
    frameRect.right <= viewportRight &&
    frameRect.top >= viewportTop &&
    frameRect.bottom <= viewportBottom;
  if (isVisible) return;

  const horizontalOffset = (frameRect.left + frameRect.width / 2 -
    (viewportLeft + preview.clientWidth / 2)) / scaleX;
  const verticalOffset = (frameRect.top + frameRect.height / 2 -
    (viewportTop + preview.clientHeight / 2)) / scaleY;
  preview.scrollTo({
    left: preview.scrollLeft + horizontalOffset,
    top: preview.scrollTop + verticalOffset,
    behavior: "smooth"
  });
}

async function renderSpecEditor(filePath, instancePath = activeInstancePath, owner = "instance") {
  workflowEditor?.deactivate();
  screenAnnotationController?.setEnabled(false);
  return specEditor.render(filePath, instancePath, owner);
}

function discardUneditedActiveSpecDraft() {
  specEditor.discardUneditedActiveDraft();
}

async function createSpecForInstance(instancePath) {
  return specEditor.createForInstance(instancePath);
}

async function createProjectSpec() {
  return specEditor.createForProject();
}

async function createSpecForScreen() {
  return specEditor.createForScreen();
}
function renderProjectOverview() {
  workflowEditor?.deactivate();
  screenAnnotationController?.setEnabled(false);
  return workspaceViewRenderer.renderProjectOverview();
}

async function renderAssetTemplate(assetId, filePath = null) {
  workflowEditor?.deactivate();
  screenAnnotationController?.setEnabled(false);
  return assetEditor.renderTemplate(assetId, filePath);
}

async function renderMaterialFile(filePath) {
  workflowEditor?.deactivate();
  screenAnnotationController?.setEnabled(false);
  return materialFileEditor.render(filePath);
}

function setAssetDocumentStatus(template, message, isError = false) {
  return assetEditor.setDocumentStatus(template, message, isError);
}

async function renderInstance(instance, template, instancePath, screenId = "", screenName = "") {
  return screenInstanceRenderer.render(instance, template, instancePath, screenId, screenName);
}

function getEventInstance(event) {
  return event.composedPath().find((node) =>
    node instanceof HTMLElement && node.classList.contains("asset-instance")
  );
}

function openAssetContextMenu(event, host, instancePath, assetId) {
  return assetEditor.openContextMenu(event, host, instancePath, assetId);
}

function closeAssetContextMenu(restoreFocus = false) {
  return assetEditor.closeContextMenu(restoreFocus);
}

async function copyAssetDetails(target) {
  return assetEditor.copyDetails(target);
}

function confirmDeleteAsset(target) {
  return assetEditor.confirmDelete(target);
}

function closeAssetDeleteDialog(restoreFocus = false) {
  return assetEditor.closeDeleteDialog(restoreFocus);
}

function sameInstancePath(left, right) {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}


function setScreenDomContext(node, screen) {
  if (!node) return;
  if (!screen) {
    node.removeAttribute("data-specux-screen-id");
    node.removeAttribute("data-specux-screen-name");
    return;
  }
  node.dataset.specuxScreenId = screen.id;
  node.dataset.specuxScreenName = screen.data.name || screen.id;
}

function updateScreenDomContext(screen) {
  [
    byId("workspace-context"),
    byId("main"),
    byId("screen-stage"),
    byId("screen-preview")
  ].forEach((node) => setScreenDomContext(node, screen));
}

function selectInstance(path, assetId, options = {}) {
  if (viewingWorkflow) return;
  const selectedPath = Array.isArray(path) ? path : [];
  if (Array.isArray(options.paths)) {
    activeInstancePaths = options.paths
      .filter((candidate) => Array.isArray(candidate) && candidate.length)
      .map((candidate) => [...candidate]);
    activeInstancePath = activeInstancePaths.at(-1) || [];
  } else if (options.toggle && selectedPath.length) {
    const existingIndex = activeInstancePaths.findIndex((candidate) =>
      sameInstancePath(candidate, selectedPath)
    );
    if (existingIndex >= 0) activeInstancePaths.splice(existingIndex, 1);
    else activeInstancePaths.push([...selectedPath]);
    activeInstancePath = activeInstancePaths.at(-1) || [];
  } else {
    activeInstancePath = [...selectedPath];
    activeInstancePaths = selectedPath.length ? [[...selectedPath]] : [];
  }
  const activeInstance = getInstanceAtPath(
    screens[activeScreenIndex],
    activeInstancePath
  );
  activeAssetId = activeInstancePath.length
    ? activeInstance?.src || assetId || null
    : null;
  if (viewingSpec) {
    selectInstanceInPreview(activeInstancePaths);
    return;
  }
  viewingAssetTemplate = false;
  viewingTheme = false;
  viewingProject = false;
  viewingSpec = false;
  viewingPreviewState = false;
  activeSpecPath = null;
  activeSpecInstancePath = [];
  byId("main").classList.remove("spec-editing");
  byId("spec-editor-panel").hidden = true;
  byId("spec-source").oninput = null;
  selectInstanceInPreview(activeInstancePaths);
  updateNavigationSelection();
  renderInspector();
}

function selectInstances(paths) {
  const selectedPaths = Array.isArray(paths)
    ? paths.filter((path) => Array.isArray(path) && path.length)
    : [];
  selectInstance(selectedPaths.at(-1) || [], null, { paths: selectedPaths });
}

function openScreenPlacementContextMenu(event, path) {
  if (isRenderOnly || viewingWorkflow || !Array.isArray(path) || path.length === 0) return;
  const screen = screens[activeScreenIndex];
  if (getActivePreviewStateId(screen?.data) !== "default") {
    closeScreenPlacementContextMenu();
    return;
  }
  event.preventDefault();
  const placement = getInstanceAtPath(screen, path);
  if (!placement) return;
  if (!activeInstancePaths.some((selectedPath) => sameInstancePath(selectedPath, path))) {
    selectInstance(path, placement.src || null);
  }
  screenPlacementMenuTarget = [...path];
  const menu = byId("screen-placement-context-menu");
  const groupButton = byId("screen-placement-context-group");
  const ungroupButton = byId("screen-placement-context-ungroup");
  const placements = screens[activeScreenIndex]?.data?.materials || [];
  groupButton.hidden = !canGroupScreenPlacements(placements, activeInstancePaths);
  ungroupButton.hidden = !isScreenGroup(placement);
  if (groupButton.hidden && ungroupButton.hidden) {
    closeScreenPlacementContextMenu();
    return;
  }
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - 210))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - 96))}px`;
  (groupButton.hidden ? ungroupButton : groupButton).focus();
}

function closeScreenPlacementContextMenu() {
  const menu = byId("screen-placement-context-menu");
  if (menu) menu.hidden = true;
  screenPlacementMenuTarget = null;
}

function bindScreenPlacementContextMenu() {
  const menu = byId("screen-placement-context-menu");
  byId("screen-placement-context-group").addEventListener("click", () => {
    const paths = activeInstancePaths.map((path) => [...path]);
    closeScreenPlacementContextMenu();
    screenMaterialController.group(paths).catch(showFatalError);
  });
  byId("screen-placement-context-ungroup").addEventListener("click", () => {
    const path = screenPlacementMenuTarget;
    closeScreenPlacementContextMenu();
    if (path) screenMaterialController.ungroup(path).catch(showFatalError);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !menu.contains(event.target)) closeScreenPlacementContextMenu();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) closeScreenPlacementContextMenu();
  });
}

function updateNavigationSelection() {
  document.querySelectorAll(".file-tree-file").forEach((button) => {
    const filePath = button.dataset.projectFile;
    const action = getProjectFileAction(filePath);
    const selected = activeProjectFilePath === filePath;
    button.classList.toggle("selected", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    if (action?.kind === "asset") updateAssetTemplateTreeFile(button, action.asset);
  });
  syncBrowserHistory();
  publishSelection();
}

function publishSelection() {
  if (isRenderOnly) return;
  const selection = currentUiSelection();
  const screenId = selection?.screen?.id;
  const publishedSelection = selection?.view === "screen"
    ? {
        ...selection,
        previewStateId: activePreviewStateIds.get(screenId) || "default"
      }
    : selection;
  fetch("/api/selection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selection: publishedSelection })
  }).catch((error) => console.warn("Could not publish the current SpecUX selection.", error));
}

function renderInspector() {
  inspectorRenderer.render();
}

function appendSection(parent, title) {
  parent.append(element("div", "section-title", title));
}

function appendDetail(parent, label, value) {
  if (value === undefined || value === null || value === "") return;
  parent.append(element("div", "detail-label", label));
  parent.append(element("div", "detail-value", String(value)));
}

function appendNote(parent, label, text) {
  parent.append(element("div", "detail-label", label));
  parent.append(element("div", "note-box", text));
}

function attributeInputOptions(definition) {
  if (definition.type === "boolean") return { checkbox: true };
  if (definition.type === "list") return { selectOptions: definition.options || [] };
  if (definition.type === "number") return { numberFormat: definition.format || "decimal" };
  return {};
}

function appendEditableField(parent, label, value, onChange, options = {}) {
  const wrapper = element("div", options.checkbox ? "editor-field checkbox" : "editor-field");
  const input = element(options.multiline ? "textarea" : options.selectOptions ? "select" : "input");
  const inputId = options.id || `editor-field-${editorFieldId++}`;
  input.id = inputId;
  if (options.required) input.required = true;

  if (options.checkbox) {
    input.type = "checkbox";
    input.checked = Boolean(value);
    const fieldLabel = element("label", "", label);
    fieldLabel.htmlFor = inputId;
    wrapper.append(input, fieldLabel);
  } else {
    if (options.selectOptions) {
      const placeholder = element("option", "", "Select an option");
      placeholder.value = "";
      placeholder.disabled = true;
      input.append(placeholder);
      for (const optionValue of options.selectOptions) {
        const option = element("option", "", String(optionValue));
        option.value = String(optionValue);
        input.append(option);
      }
      input.value = value === undefined || value === null ? "" : String(value);
    } else if (options.color) {
      input.type = "color";
      input.value = /^#[0-9a-f]{6}$/i.test(String(value)) ? value : "#4569e8";
    } else {
      if (options.numberFormat && input instanceof HTMLInputElement) {
        input.type = "number";
        input.step = options.numberFormat === "integer"
          ? "1"
          : options.numberFormat === "decimal" ? "any" : "0.01";
      } else if (input instanceof HTMLInputElement) {
        input.type = "text";
      }
      input.value = value === undefined || value === null ? "" : String(value);
    }
    const fieldLabel = element("label", "", label);
    fieldLabel.htmlFor = inputId;
    wrapper.append(fieldLabel, input);
  }

  input.addEventListener("change", () => {
    let updated;
    if (options.checkbox) updated = input.checked;
    else if (options.numberFormat) {
      if (input.value === "") updated = undefined;
      else if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
        input.reportValidity();
        return;
      } else updated = input.valueAsNumber;
    } else updated = input.value;
    onChange(updated);
  });
  parent.append(wrapper);
}

function markEdited(filePath, options = {}) {
  projectPersistence.markEdited(filePath, options);
}

function clearEdited(filePath) {
  projectPersistence.clearEdited(filePath);
}

function markAssetTemplateEdited(template) {
  projectPersistence.markAssetTemplateEdited(template);
}

function updateSaveControls() {
  projectPersistence.updateSaveControls();
}

async function saveProjectChanges() {
  return projectPersistence.save();
}
async function refreshActiveView() {
  try {
    if (viewingMaterialFile) {
      await renderMaterialFile(activeMaterialFilePath);
      return;
    }
    if (viewingAssetTemplate) {
      await renderAssetTemplate(activeAssetId);
      return;
    }
    const screenIndex = activeScreenIndex;
    const instancePath = [...activeInstancePath];
    await renderScreen(screenIndex);
    const instance = getInstanceAtPath(screens[screenIndex], instancePath);
    if (instance) selectInstance(instancePath, instance.src || null);
  } catch (error) {
    showFatalError(error);
  }
}

const editorEventController = new EditorEventController({
  state: {
    get hasEdits() { return hasEdits; },
    get activeScreenIndex() { return activeScreenIndex; },
    get assetContextMenuTarget() { return assetContextMenuTarget; },
    get pendingAssetDeletion() { return pendingAssetDeletion; },
    get historyUpdateSuppressed() { return historyUpdateSuppressed; },
    set historyUpdateSuppressed(value) { historyUpdateSuppressed = value; }
  },
  services: {
    byId,
    window,
    document,
    confirm: (message) => window.confirm(message),
    loadProject,
    createScreen,
    openScreenPreview,
    setScreenViewMode,
    setScreenSelectorOpen,
    renderScreenSelector,
    saveProjectChanges,
    closeAssetContextMenu,
    getTemplateByPath,
    renderAssetTemplate,
    renderScreenRulers: () => screenRulerController.render(),
    showFatalError,
    copyAssetDetails,
    confirmDeleteAsset,
    closeAssetDeleteDialog,
    deleteAssetInstance,
    showEditorMessage,
    isRenderOnly,
    selectionFromLocation,
    restoreUiSelection,
    syncBrowserHistory
  }
});
editorEventController.bind();
bindScreenPlacementContextMenu();

function renderThemeView(filePath = project?.theme) {
  workflowEditor?.deactivate();
  screenAnnotationController?.setEnabled(false);
  themeEditor.render(filePath);
}

function showEditorMessage(title, message) {
  const output = byId("editor-message");
  output.replaceChildren(element("strong", "", title), element("div", "", message));
  output.classList.add("visible");
}

function hideEditorMessage() {
  const output = byId("editor-message");
  output.classList.remove("visible");
  output.replaceChildren();
}

function setPreviewMessage(state, message) {
  const preview = byId("screen-preview");
  preview.className = `screen-preview ${state}`;
  preview.replaceChildren(element("div", state === "error" ? "error-message" : "loading-message", message));
}

function showFatalError(error) {
  setPreviewMessage("error", error.message || String(error));
  byId("screen-heading").textContent = "Could not load project";
  byId("inspector-content").replaceChildren(
    element("h2", "panel-heading", "Project load error"),
    element("div", "error-message", error.message || String(error)),
    element("div", "readonly-label", "Serve the repository root over HTTP so the editor can fetch the specux/ example project.")
  );
}

function handleSystemThemeChange(event) {
  systemThemeMode = event.matches ? "dark" : "light";
  if (!theme || themeModePreference !== "system") return;
  applyTheme();
  if (viewingTheme) renderInspector();
}

if (typeof systemThemeQuery?.addEventListener === "function") {
  systemThemeQuery.addEventListener("change", handleSystemThemeChange);
} else {
  systemThemeQuery?.addListener?.(handleSystemThemeChange);
}

const resizablePanels = new ResizablePanels({
  windowObject: window,
  documentObject: document,
  workspace: byId("workspace"),
  showMessage: showEditorMessage
});
resizablePanels.bind();
specViewLayout.bind();
assetViewLayout.bind();
workflowViewLayout.bind();

loadProject(selectionFromLocation());
