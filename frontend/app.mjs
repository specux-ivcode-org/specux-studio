import "/shared/validation.js";
import { parse as parseSpecuxYaml } from "/shared/yaml.mjs";
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
import { ScreenController } from "./browser/ScreenController.mjs";
import { ScreenAnnotationController } from "./browser/ScreenAnnotationController.mjs";
import { ScreenSelectionController } from "./browser/ScreenSelectionController.mjs";
import { ScreenRulerController } from "./browser/ScreenRulerController.mjs";
import { ScreenCanvasViewportController } from "./browser/ScreenCanvasViewportController.mjs";
import { MaterialCanvasViewportController } from "./browser/MaterialCanvasViewportController.mjs";
import { ScreenYamlEditor } from "./browser/ScreenYamlEditor.mjs";
import { MaterialCanvas } from "./browser/MaterialCanvas.mjs";
import { ScreenMaterialController } from "./browser/ScreenMaterialController.mjs";
import { ScreenMaterialRenderer } from "./browser/ScreenMaterialRenderer.mjs";
import {
  countScreenPlacementReferences,
  createScreenPlacementUrl,
  rewriteScreenPlacementReferences
} from "./browser/PlacementReferenceUpdater.mjs";
import {
  canGroupScreenPlacements,
  getScreenPlacementIdPath,
  getSelectedGroupAncestorPath,
  getScreenPlacementAtPath,
  getScreenPlacementPathById,
  isScreenGroup
} from "../shared/ScreenGroups.mjs";
import { getSelectedText, SpecEditor } from "./browser/SpecEditor.mjs";
import { SplitViewLayout } from "./browser/SplitViewLayout.mjs";
import { ThemeEditor } from "./browser/ThemeEditor.mjs";
import { TemplateMarkupRenderer } from "./browser/TemplateMarkupRenderer.mjs";
import { WorkspaceViewRenderer } from "./browser/WorkspaceViewRenderer.mjs";
import { WorkflowEditor } from "./browser/WorkflowEditor.mjs";

// Read launch parameters and environment settings before creating the editor views.
const appRoot = new URL("./specux/", window.location.href);
const sharedValidation = globalThis.SpecuxValidation;
const { MATERIAL_FILE_EXTENSION, themeModeNames } = sharedValidation;
const systemThemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
const renderParameters = new URLSearchParams(window.location.search);
const renderRequestedScreen = renderParameters.get("render");
const renderRequestedState = renderParameters.get("state");
const renderRequestedAnnotations = renderParameters.get("annotations") === "true";
const isRenderOnly = renderRequestedScreen !== null;

/** Looks up a DOM element by its ID. */
const byId = (id) => document.getElementById(id);
const editorClientId = window.crypto.randomUUID();

// Share the project model, active selection, and pending edits with focused controllers.
let project;
let screens = [];
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
let fileHashes = new Map();
let activeMaterialFilePath = null;
let activeInstancePath = [];
let activeInstancePaths = [];
let screenPlacementMenuTarget = null;
let screenPlacementCopyTarget = null;
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
let activeSpecScreenFile = null;
let activeSpecInstancePath = [];
let activeSpecOwner = "instance";
let activeProjectFilePath = null;
let specIndicatorsEnabled = false;
let editorMessageTimer = null;
let hasEdits = false;
const dirtyFiles = new Map();
const deletedFiles = new Map();
const invalidYamlFiles = new Map();
const invalidWorkflowFiles = new Map();
const createdScreenFiles = new Set();
const createdMaterialFiles = new Set();
const createdSpecFiles = new Set();
const createdWorkflowFiles = new Set();
const createdSpecDrafts = new Map();
const elementSpecOwners = new Map();
const externalWriteConflicts = new Map();
let editVersion = 0;
let isSaving = false;
let historyUpdateSuppressed = false;
let selectionPublishQueue = Promise.resolve();
let previewTimer = null;
let previewVersion = 0;
let editorFieldId = 0;
let workflowEditor;

// Wire repositories, editors, and renderers to shared state and cross-view services.
const browserHistory = new BrowserHistory({
  windowObject: window,
  getCurrentSelection: currentUiSelection,
  getSelectionFilePath,
  getWorkspaceContext: () => editorNavigation.getWorkspaceContext(),
  getCanvasSpecuxTarget: () => editorNavigation.getCanvasSpecuxTarget(),
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
  materialFileExtension: MATERIAL_FILE_EXTENSION
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
  saveRecoveryDraft: (...args) => projectPersistence.saveRecoveryDraft(...args),
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
  editorTrackProperty: "--spec-markdown-track",
  onViewModeChanged: () => publishSelection()
});
const materialViewLayout = new SplitViewLayout({
  windowObject: window,
  documentObject: document,
  modes: ["split", "preview", "source"],
  viewIdPrefix: "material-view",
  viewAttribute: "data-material-view",
  headingId: "material-view-heading",
  headingLabels: { split: "Preview", preview: "Preview", source: "Source" },
  resizerId: "material-split-resizer",
  previewTrackProperty: "--material-preview-track",
  editorTrackProperty: "--material-source-track",
  onViewModeChanged: () => publishSelection()
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
  editorTrackProperty: "--workflow-diagram-track",
  onViewModeChanged: () => publishSelection()
});
const specEditor = new SpecEditor({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    set activeProjectFilePath(value) { activeProjectFilePath = value; },
    get activeWorkflowPath() { return activeWorkflowPath; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get elementSpecOwners() { return elementSpecOwners; },
    get specSources() { return specSources; },
    get workflowSources() { return workflowSources; },
    get viewingSpec() { return viewingSpec; },
    get viewingWorkflow() { return viewingWorkflow; },
    set viewingSpec(value) { viewingSpec = value; },
    set viewingMaterialFile(value) { viewingMaterialFile = value; },
    get viewingTheme() { return viewingTheme; },
    set viewingTheme(value) { viewingTheme = value; },
    get viewingProject() { return viewingProject; },
    set viewingProject(value) { viewingProject = value; },
    get viewingPreviewState() { return viewingPreviewState; },
    set viewingPreviewState(value) { viewingPreviewState = value; },
    get activeSpecPath() { return activeSpecPath; },
    set activeSpecPath(value) { activeSpecPath = value; },
    get activeSpecScreenFile() { return activeSpecScreenFile; },
    set activeSpecScreenFile(value) { activeSpecScreenFile = value; },
    get activeSpecOwner() { return activeSpecOwner; },
    set activeSpecOwner(value) { activeSpecOwner = value; },
    get activeSpecInstancePath() { return activeSpecInstancePath; },
    set activeSpecInstancePath(value) { activeSpecInstancePath = value; },
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
    refreshElementSpecOwner,
    clearEdited,
    renderNavigation,
    markEdited,
    renderInspector,
    selectInstanceInPreview,
    getElementLabel,
    getElementSpecPath,
    safeProjectUrl,
    fetcher: (url, options) => fetch(url, options),
    projectFileTree,
    getScreenPreviewStates,
    showSpecReference,
    showSpecWorkflowReference: (reference, filePath) =>
      showSpecWorkflowDock(reference, filePath),
    showWorkflowNodeSpec: (spec, nodeId) =>
      workflowEditor.showSpecPreview([spec], nodeId),
    clearSpecWorkflowPreview: () => clearSpecWorkflowDock(),
    publishSelection
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
    beginEditTransaction,
    endEditTransaction,
    renderNavigation,
    renderScreen,
    getVisibleCanvasPlacementPosition: (size) =>
      screenCanvasViewportController.getVisibleCanvasPlacementPosition(size),
    selectInstance,
    openScreenPlacementContextMenu,
    getScreenPreviewStates,
    getActivePreviewStateId,
    resolvePlacementForState,
    persistStatePlacements,
    isInstanceVisible,
    setInstanceVisible: (screen, instance, visible, stateId) =>
      previewStateController.setInstanceVisible(screen, instance, visible, stateId),
    setPreviewLayerVisibility: (screen, layer, visible, stateId) =>
      previewStateController.setLayerVisible(screen, layer, visible, stateId),
    removePlacementStateOverrides: (screen, placementIds, layerIds) =>
      previewStateController.removeStructuralOverrides(screen.data, placementIds, layerIds),
    updateScreenPlacementReferences,
    confirmUngroupPlacementReferences,
    confirm: (message) => window.confirm(message)
  }
});
const projectPersistence = new ProjectPersistence({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get materialFiles() { return materialFiles; },
    get createdMaterialFiles() { return createdMaterialFiles; },
    get theme() { return theme; },
    get isSaving() { return isSaving; },
    set isSaving(value) { isSaving = value; },
    get dirtyFiles() { return dirtyFiles; },
    get deletedFiles() { return deletedFiles; },
    get invalidYamlFiles() { return invalidYamlFiles; },
    get invalidWorkflowFiles() { return invalidWorkflowFiles; },
    get workflowSources() { return workflowSources; },
    get editVersion() { return editVersion; },
    set editVersion(value) { editVersion = value; },
    get hasEdits() { return hasEdits; },
    set hasEdits(value) { hasEdits = value; },
    get specSources() { return specSources; },
    get createdSpecFiles() { return createdSpecFiles; },
    get createdWorkflowFiles() { return createdWorkflowFiles; },
    get createdScreenFiles() { return createdScreenFiles; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get elementSpecOwners() { return elementSpecOwners; },
    get projectFilePaths() { return projectFilePaths; },
    set projectFilePaths(value) { projectFilePaths = value; },
    get fileHashes() { return fileHashes; },
    get activeSpecPath() { return activeSpecPath; },
    get externalWriteConflicts() { return externalWriteConflicts; }
  },
  services: {
    byId,
    fetcher: (url, options) => fetch(url, options),
    recoveryStorage: window.localStorage,
    recoveryStorageKey: `specux-invalid-drafts:${new URL("project.yml", appRoot).href}`,
    externalConflictStorage: window.localStorage,
    externalConflictStorageKey: `specux-external-conflicts:${new URL("project.yml", appRoot).href}`,
    validation: sharedValidation,
    setScreenYamlStatus,
    getInstanceAtPath,
    findInstancePathById,
    validateScreenMaterials,
    showEditorMessage,
    renderNavigation,
    showExternalWriteConflicts,
    applyExternalFileContent,
    removeExternalFile,
    captureEditSnapshot,
    applyEditSnapshot,
    getRecoveryDraft
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
const screenController = new ScreenController({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    set activeScreenIndex(value) { activeScreenIndex = value; },
    get createdScreenFiles() { return createdScreenFiles; }
  },
  services: {
    prompt: (message, defaultValue) => window.prompt(message, defaultValue),
    fetcher: (url, options) => fetch(url, options),
    safeProjectUrl,
    showEditorMessage,
    projectFileTree,
    markEdited,
    beginEditTransaction,
    endEditTransaction,
    renderScreenSelector,
    renderNavigation,
    renderScreen,
    showFatalError
  }
});
const themeEditor = new ThemeEditor({
  state: {
    get theme() { return theme; },
    get project() { return project; },
    get screens() { return screens; },
    get materialFiles() { return materialFiles; },
    get activeScreenIndex() { return activeScreenIndex; },
    get activeInstancePath() { return activeInstancePath; },
    get themeModeNames() { return themeModeNames; },
    get themeModePreference() { return themeModePreference; },
    set themeModePreference(value) { themeModePreference = value; },
    get systemThemeMode() { return systemThemeMode; },
    get viewingTheme() { return viewingTheme; },
    set viewingTheme(value) { viewingTheme = value; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    set activeProjectFilePath(value) { activeProjectFilePath = value; },
    get previewTimer() { return previewTimer; },
    set previewTimer(value) { previewTimer = value; },
    get previewVersion() { return previewVersion; },
    set previewVersion(value) { previewVersion = value; },
    set viewingMaterialFile(value) { viewingMaterialFile = value; },
    set viewingProject(value) { viewingProject = value; },
    set viewingSpec(value) { viewingSpec = value; },
    set viewingPreviewState(value) { viewingPreviewState = value; },
    set activeSpecPath(value) { activeSpecPath = value; },
    set activeSpecScreenFile(value) { activeSpecScreenFile = value; },
    set activeSpecInstancePath(value) { activeSpecInstancePath = value; },
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
    document,
    getComputedStyle: (node, pseudoElement) =>
      window.getComputedStyle(node, pseudoElement),
    applyTheme,
    markEdited,
    renderInspector,
    discardUneditedActiveSpecDraft,
    hidePreviewStateControls,
    hideEditorMessage,
    updateNavigationSelection,
    getInstanceAtPath,
    selectInstance,
    clearPreviewSelection: () => selectInstanceInPreview([]),
    renderThemeScreen,
    renderThemeMaterial,
    showFatalError
  }
});
const materialFileEditor = new MaterialFileEditor({
  state: {
    get project() { return project; },
    get materialFiles() { return materialFiles; },
    get activeMaterialFilePath() { return activeMaterialFilePath; },
    set activeMaterialFilePath(value) { activeMaterialFilePath = value; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    set activeProjectFilePath(value) { activeProjectFilePath = value; },
    get previewTimer() { return previewTimer; },
    set previewTimer(value) { previewTimer = value; },
    get previewVersion() { return previewVersion; },
    set previewVersion(value) { previewVersion = value; },
    set activeInstancePath(value) {
      activeInstancePath = value;
      activeInstancePaths = value.length ? [value] : [];
    },
    set activeSpecPath(value) { activeSpecPath = value; },
    set activeSpecScreenFile(value) { activeSpecScreenFile = value; },
    set activeSpecInstancePath(value) { activeSpecInstancePath = value; },
    get viewingMaterialFile() { return viewingMaterialFile; },
    set viewingMaterialFile(value) { viewingMaterialFile = value; },
    set viewingTheme(value) { viewingTheme = value; },
    set viewingProject(value) { viewingProject = value; },
    set viewingSpec(value) { viewingSpec = value; },
    set viewingPreviewState(value) { viewingPreviewState = value; },
    get invalidYamlFiles() { return invalidYamlFiles; }
  },
  services: {
    byId,
    element,
    document,
    validation: sharedValidation,
    parseYamlSource,
    hidePreviewStateControls,
    updateScreenDomContext,
    discardUneditedActiveSpecDraft,
    updateNavigationSelection,
    publishSelection: () => publishSelection(),
    hideEditorMessage,
    setMaterialViewMode: (mode) => materialViewLayout.setViewMode(mode),
    centerMaterialCanvas: () => materialCanvasViewportController.centerMaterial(),
    renderInspector,
    renderNavigation,
    updateSaveControls,
    markEdited,
    saveRecoveryDraft: (...args) => projectPersistence.saveRecoveryDraft(...args),
    templateMarkupRenderer,
    setPreviewMessage,
    showEditorMessage
  }
});
const editorNavigation = new EditorNavigation({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    set activeScreenIndex(value) { activeScreenIndex = value; },
    get activeMaterialFilePath() { return activeMaterialFilePath; },
    set activeMaterialFilePath(value) { activeMaterialFilePath = value; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    get viewingProject() { return viewingProject; },
    get viewingTheme() { return viewingTheme; },
    get viewingSpec() { return viewingSpec; },
    get viewingWorkflow() { return viewingWorkflow; },
    get activeWorkflowPath() { return activeWorkflowPath; },
    get workflowScreenIndex() { return workflowScreenIndex; },
    set workflowScreenIndex(value) { workflowScreenIndex = value; },
    get selectedWorkflowNodeId() { return selectedWorkflowNodeId; },
    get activeSpecOwner() { return activeSpecOwner; },
    get activeSpecPath() { return activeSpecPath; },
    get activeSpecScreenFile() { return activeSpecScreenFile; },
    get activeSpecInstancePath() { return activeSpecInstancePath; },
    get workflowSources() { return workflowSources; },
    get materialFiles() { return materialFiles; },
    get viewingMaterialFile() { return viewingMaterialFile; },
    get activePreviewStateIds() { return activePreviewStateIds; },
    set viewingMaterialFile(value) { viewingMaterialFile = value; },
    get activeInstancePath() { return activeInstancePath; },
    get activeInstancePaths() { return activeInstancePaths; },
    set activeInstancePaths(value) { activeInstancePaths = value; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get elementSpecOwners() { return elementSpecOwners; },
    get hasEdits() { return hasEdits; }
  },
  services: {
    getInstanceAtPath,
    getElementLabel,
    getProjectFileAction,
    openProjectFile,
    selectInstance,
    selectInstancesInPreview: (paths) => selectInstanceInPreview(paths),
    renderScreen,
    selectScreenManually: (index) => editorNavigation.selectScreenManually(index),
    renderProjectOverview,
    createProjectSpec,
    createSpecForScreen,
    createSpecForInstance,
    renderSpecEditor,
    renderThemeView,
    renderMaterialFile,
    sameInstancePath,
    renderWorkflowEditor,
    restoreWorkflowNodeSelection: (nodeId) =>
      workflowEditor.restoreNodeSelection(nodeId),
    showLinkedWorkflowPreview: (reference, specPath) =>
      showSpecWorkflowDock(reference, specPath),
    showWorkflowNodeSpecPreview: (filePath, nodeId) =>
      specEditor.restoreWorkflowNodeSpecPreview(filePath, nodeId),
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
    get viewingTheme() { return viewingTheme; },
    get viewingProject() { return viewingProject; },
    get viewingSpec() { return viewingSpec; },
    get viewingWorkflow() { return viewingWorkflow; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    get activeSpecPath() { return activeSpecPath; },
    get materialFiles() { return materialFiles; },
    get activeMaterialFilePath() { return activeMaterialFilePath; },
    get viewingMaterialFile() { return viewingMaterialFile; },
    get specSources() { return specSources; },
    get workflowSources() { return workflowSources; },
    get activeWorkflowPath() { return activeWorkflowPath; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get createdScreenFiles() { return createdScreenFiles; },
    get createdSpecFiles() { return createdSpecFiles; },
    get elementSpecOwners() { return elementSpecOwners; },
    get historyUpdateSuppressed() { return historyUpdateSuppressed; },
    set historyUpdateSuppressed(value) { historyUpdateSuppressed = value; },
    get activeSpecOwner() { return activeSpecOwner; },
  },
  services: {
    document,
    window,
    byId,
    element,
    getMaterialDropGeometry: (...args) =>
      screenCanvasViewportController.getMaterialDropGeometry(...args),
    updateNavigationSelection,
    selectScreenManually: (index) => editorNavigation.selectScreenManually(index),
    renderScreen,
    showFatalError,
    renderProjectOverview,
    renderThemeView,
    renderMaterialFile,
    placeMaterialFile: (filePath, position) =>
      screenMaterialController.addFromFile(filePath, position),
    templateMarkupRenderer,
    renderSpecEditor,
    renderWorkflowEditor,
    syncBrowserHistory,
    closeScreenPlacementContextMenu,
    showEditorMessage
  },
  projectFileTree
});
if (!isRenderOnly) projectFileNavigator.bindSidebarTabs();
const materialCanvas = new MaterialCanvas({
  state: {
    get isRenderOnly() { return isRenderOnly; },
    get viewingSpec() { return viewingSpec; },
    get viewingWorkflow() { return viewingWorkflow; },
    get viewingTheme() { return viewingTheme; },
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
    get previewTimer() { return previewTimer; },
    set previewTimer(value) { previewTimer = value; },
    get previewVersion() { return previewVersion; },
    set previewVersion(value) { previewVersion = value; },
    set viewingMaterialFile(value) { viewingMaterialFile = value; },
    set viewingTheme(value) { viewingTheme = value; },
    set viewingProject(value) { viewingProject = value; },
    set viewingSpec(value) { viewingSpec = value; },
    set viewingWorkflow(value) { viewingWorkflow = value; },
    set activeWorkflowPath(value) { activeWorkflowPath = value; },
    set viewingPreviewState(value) { viewingPreviewState = value; },
    set activeSpecPath(value) { activeSpecPath = value; },
    set activeSpecScreenFile(value) { activeSpecScreenFile = value; },
    set activeSpecInstancePath(value) { activeSpecInstancePath = value; },
    set activeInstancePath(value) {
      activeInstancePath = value;
      activeInstancePaths = value.length ? [value] : [];
    },
    get theme() { return theme; },
    get specSources() { return specSources; }
  },
  services: {
    byId,
    element,
    discardUneditedActiveSpecDraft,
    closeScreenPlacementContextMenu,
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
    setSelectionTool: (tool) => screenSelectionController?.selectTool(tool),
    publishSelection: () => publishSelection()
  }
});
workflowEditor = new WorkflowEditor({
  state: {
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    get projectFilePaths() { return projectFilePaths; },
    set projectFilePaths(value) { projectFilePaths = value; },
    get workflowSources() { return workflowSources; },
    get createdWorkflowFiles() { return createdWorkflowFiles; },
    get invalidWorkflowFiles() { return invalidWorkflowFiles; },
    get dirtyFiles() { return dirtyFiles; },
    get viewingSpec() { return viewingSpec; },
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
    prompt: (message, value) => window.prompt(message, value),
    confirm: (message) => window.confirm(message),
    fetcher: (url, options) => fetch(url, options),
    safeProjectUrl,
    validation: sharedValidation,
    projectFileTree,
    showEditorMessage,
    setWorkflowViewMode: (mode) => workflowViewLayout.setViewMode(mode),
    saveRecoveryDraft: (...args) => projectPersistence.saveRecoveryDraft(...args),
    publishSelection: () => publishSelection(),
    renderNavigation,
    renderInspector,
    markEdited,
    markDeleted,
    updateSaveControls,
    renderWorkflowEditor,
    returnToScreen: () => editorNavigation.selectScreenManually(activeScreenIndex),
    showWorkflowNode,
    openWorkflowNodeSpec: (workflowPath, nodeId) =>
      specEditor.createForWorkflowNode(workflowPath, nodeId),
    closeWorkflowDockView: () => {
      if (editorNavigation.linkedDockStack.length) clearSpecWorkflowDock();
      else workflowEditor.closeWorkflowNodeSpecPreview();
    },
    getWorkflowSpecDocuments: async () => {
      const filePaths = [...specSources.keys()];
      return Promise.all(filePaths.map(async (filePath) => {
        let source = specSources.get(filePath);
        if (source === undefined) {
          source = await loadText(filePath);
          specSources.set(filePath, source);
        }
        return { filePath, source };
      }));
    },
    openWorkflowSpec: async (linkedSpecs, nodeId) => {
      const specs = await Promise.all(linkedSpecs.map(async (linkedSpec) => {
        const { filePath } = linkedSpec;
        const action = projectFileNavigator.getProjectFileAction(filePath);
        if (action?.kind !== "spec") {
          throw new Error(`Workflow spec "${filePath}" is not linked to this project.`);
        }
        let source = specSources.get(filePath);
        if (source === undefined) {
          source = await loadText(filePath);
          specSources.set(filePath, source);
        }
        return { ...linkedSpec, source };
      }));
      workflowEditor.showSpecPreview(specs, nodeId);
    }
  }
});
const screenSelectionController = new ScreenSelectionController({
  state: {
    get isRenderOnly() { return isRenderOnly; },
    get viewingProject() { return viewingProject; },
    get viewingMaterialFile() { return viewingMaterialFile; },
    get viewingWorkflow() { return viewingWorkflow; },
    get viewingTheme() { return viewingTheme; },
    get viewingSpec() { return viewingSpec; }
  },
  services: {
    byId,
    document,
    selectInstances,
    openPlacementSpec: (path) => createSpecForInstance(path),
    openScreenSpec: () => createSpecForScreen(),
    showFatalError,
    openPlacementContextMenu: openScreenPlacementContextMenu,
    openBackgroundContextMenu: openScreenBackgroundContextMenu,
    closePlacementContextMenu: closeScreenPlacementContextMenu,
    disableAnnotationMode: () => screenAnnotationController.setEnabled(false)
  }
});
const screenRulerController = new ScreenRulerController({
  documentObject: document,
  windowObject: window
});
const screenCanvasViewportController = new ScreenCanvasViewportController({
  documentObject: document,
  windowObject: window,
  renderRulers: () => screenRulerController.render(),
  isRenderOnly
});
const materialCanvasViewportController = new MaterialCanvasViewportController({
  documentObject: document,
  renderRulers: () => screenRulerController.render()
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
if (!isRenderOnly) screenCanvasViewportController.bind();
if (!isRenderOnly) materialCanvasViewportController.bind();
if (!isRenderOnly) responsiveToolbarController.bind();
if (!isRenderOnly) screenAnnotationController.bind();
if (!isRenderOnly) screenSelectionController.bind();
const inspectorRenderer = new InspectorRenderer({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get theme() { return theme; },
    get specSources() { return specSources; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get elementSpecOwners() { return elementSpecOwners; },
    get specIndicatorsEnabled() { return specIndicatorsEnabled; },
    get activeScreenIndex() { return activeScreenIndex; },
    get activeMaterialFilePath() { return activeMaterialFilePath; },
    get materialFiles() { return materialFiles; },
    get activeInstancePath() { return activeInstancePath; },
    get activeInstancePaths() { return activeInstancePaths; },
    get activeSpecOwner() { return activeSpecOwner; },
    get activeSpecPath() { return activeSpecPath; },
    get activeSpecScreenFile() { return activeSpecScreenFile; },
    get activeSpecInstancePath() { return activeSpecInstancePath; },
    get workflowSources() { return workflowSources; },
    get viewingPreviewState() { return viewingPreviewState; },
    get viewingProject() { return viewingProject; },
    get viewingTheme() { return viewingTheme; },
    get viewingSpec() { return viewingSpec; },
    get viewingWorkflow() { return viewingWorkflow; },
    get viewingMaterialFile() { return viewingMaterialFile; }
  },
  services: {
    byId,
    element,
    getInstanceAtPath,
    getActivePreviewStateId,
    getScreenPreviewStates,
    appendEditableField,
    renamePreviewState,
    describePreviewState,
    switchPreviewState,
    addPreviewState,
    deletePreviewState,
    showFatalError,
    getElementLabel,
    isInstanceVisible,
    isLayerVisible,
    resolvePlacementForState,
    persistPlacementState,
    setInstanceVisible: (screen, instance, visible, stateId) =>
      previewStateController.setInstanceVisible(screen, instance, visible, stateId),
    listPreviewStateOverrides: (screen, stateId) =>
      previewStateController.listStateOverrides(screen, stateId),
    resetPreviewStateOverride: (screen, stateId, selectedOverride) =>
      previewStateController.resetStateOverride(screen, stateId, selectedOverride),
    markEdited,
    renderScreen,
    renderMaterialFile,
    showEditorMessage,
    renderSpecEditor,
    createProjectSpec,
    createSpecForScreen,
    createSpecForInstance,
    renderScreenInstanceTree,
    renderWorkflowEditor,
    createWorkflowForScreen: () => workflowEditor.createForScreen(),
    deleteWorkflow: (filePath) => workflowEditor.deleteWorkflow(filePath),
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
    getElementSpecPath,
    themeEditor,
    createSpecForInstance,
    renderInspector: () => renderInspector()
  }
});

if (isRenderOnly) document.body.classList.add("render-only");

/** Creates a DOM element with the supplied content and attributes. */
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Returns the named preview states configured for a Screen. */
function getScreenPreviewStates(screen) {
  return sharedValidation.getPreviewStates(screen);
}

/** Returns the active preview state id. */
function getActivePreviewStateId(screen) {
  return previewStateController.getActiveId(screen);
}

/** Checks whether the instance is visible in the selected preview state. */
function isInstanceVisible(instance, stateId, screen = screens[activeScreenIndex]?.data) {
  return previewStateController.isInstanceVisible(
    instance,
    stateId,
    screen
  );
}

/** Checks whether the layer is visible in the selected preview state. */
function isLayerVisible(layer, stateId, screen = screens[activeScreenIndex]?.data) {
  return previewStateController.isLayerVisible(layer, stateId, screen);
}

/** Resolves one placement using the selected Screen preview state. */
function resolvePlacementForState(instance, stateId, screen = screens[activeScreenIndex]?.data) {
  return previewStateController.resolvePlacement(instance, stateId, screen);
}

/** Updates the placement state for the current editor state. */
function persistPlacementState(instance) {
  const screen = screens[activeScreenIndex];
  if (!screen) throw new Error("Select a Screen before editing a placement.");
  previewStateController.savePlacement(
    screen,
    instance,
    getActivePreviewStateId(screen.data)
  );
}

/** Updates the state placements for the current editor state. */
function persistStatePlacements(screen, placements, stateId) {
  for (const placement of placements) {
    previewStateController.savePlacement(screen, placement, stateId);
  }
}

/** Returns the element label. */
function getElementLabel(instance) {
  const definition = typeof instance.src === "string" ? materialFiles.get(instance.src) : null;
  return getMaterialInstanceLabel(instance, definition) || getFallbackElementLabel(instance, definition);
}

/** Returns the material instance label. */
function getMaterialInstanceLabel(instance, definition) {
  return Object.entries(definition?.data.attributes || {})
    .map(([name, attribute]) => instance.attributes?.[name] ?? attribute.default)
    .find((value) => typeof value === "string" && value.trim());
}

/** Returns the fallback element label. */
function getFallbackElementLabel(instance, definition) {
  if (definition) return definition.data.name || definition.id;
  return instance.type === "text"
    ? instance.content || instance.id || "Text"
    : instance.label || instance.id || "Button";
}

/** Renders the preview state controls from the current editor data. */
function renderPreviewStateControls(screen) {
  previewStateController.renderControls(screen);
}

/** Opens the screen preview in the editor. */
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

/** Hides the preview state controls for the current editor state. */
function hidePreviewStateControls() {
  screenYamlEditor.hideControls();
  if (!viewingSpec) byId("main").classList.remove("screen-editing");
}

/** Sets the screen yaml status from the supplied data. */
function setScreenYamlStatus(screen, message, isError = false) {
  screenYamlEditor.setStatus(screen, message, isError);
}

/** Synchronizes the screen view mode with the current editor state. */
function syncScreenViewMode() {
  screenYamlEditor.syncViewMode();
}

/** Sets the screen view mode from the supplied data. */
async function setScreenViewMode(mode) {
  screenYamlEditor.setViewMode(mode);
  if (mode === "yaml") screenAnnotationController?.setEnabled(false);
  else await screenAnnotationController?.setScreen(screens[activeScreenIndex]);
  publishSelection();
}

/** Updates the screen yaml source for the current editor state. */
async function prepareScreenYamlSource(screen) {
  return screenYamlEditor.prepareSource(screen);
}

/** Updates the screen yaml editor for the current editor state. */
function configureScreenYamlEditor(screen) {
  screenYamlEditor.configure(screen);
}

/** Parses the screen yaml into structured editor data. */
async function parseScreenYaml(screen, source, version) {
  return screenYamlEditor.parse(screen, source, version);
}

/** Renames a state and updates references to its former ID. */
function renamePreviewState(stateId, name) {
  previewStateController.rename(stateId, name);
}

/** Updates the selected state description and persists the Screen edit. */
function describePreviewState(stateId, description) {
  previewStateController.describe(stateId, description);
}

/** Updates the preview state for the current editor state. */
async function switchPreviewState(stateId) {
  return previewStateController.switchTo(stateId);
}

/** Creates a named state based on the current Screen defaults. */
async function addPreviewState() {
  return previewStateController.add();
}

/** Renders the screen instance tree from the current editor data. */
function renderScreenInstanceTree(panel, instances, parentPath = [], depth = 0, stateId = "default") {
  previewStateController.renderInstanceTree(panel, instances, parentPath, depth, stateId);
}

/** Deletes the selected named state and clears its active selection if necessary. */
async function deletePreviewState(stateId) {
  return previewStateController.delete(stateId);
}

/** Validates a project-relative path and resolves it below the project URL root. */
function safeProjectUrl(filePath, base = appRoot) {
  return projectRepository.safeProjectUrl(filePath, base);
}

/** Loads the text into the editor state. */
function loadText(filePath, base = appRoot) {
  return projectRepository.loadText(filePath, base);
}

/** Loads the yaml into the editor state. */
function loadYaml(filePath) {
  return projectRepository.loadYaml(filePath);
}

/** Parses the yaml source into structured editor data. */
function parseYamlSource(source, context) {
  return projectRepository.parseYamlSource(source, context);
}

/** Validates the screen materials before it is applied or saved. */
function validateScreenMaterials(screen) {
  projectRepository.validateScreenMaterials(screen);
}

/** Returns the nested path for the placement with the supplied ID. */
function findInstancePathById(instances, elementId, parentPath = []) {
  return projectRepository.findInstancePathById(instances, elementId, parentPath);
}

/** Updates the element spec owner for the current editor state. */
function refreshElementSpecOwner(filePath, source) {
  return projectRepository.refreshElementSpecOwner(filePath, source, screens, elementSpecOwners);
}

/** Updates saved Spec and Workflow sources after a placement tree changes. */
function updateScreenPlacementReferences(screen, previousPlacements, nextPlacements) {
  updatePlacementReferenceSources(
    specSources,
    "spec",
    screen,
    previousPlacements,
    nextPlacements
  );
  updatePlacementReferenceSources(
    workflowSources,
    "workflow",
    screen,
    previousPlacements,
    nextPlacements
  );
}

/** Rewrites a source map and synchronizes its active editor when necessary. */
function updatePlacementReferenceSources(sources, type, screen, previousPlacements, nextPlacements) {
  for (const [filePath, source] of sources) {
    const updatedSource = rewriteScreenPlacementReferences(
      source,
      type,
      screen.id,
      previousPlacements,
      nextPlacements
    );
    if (updatedSource === source) continue;
    sources.set(filePath, updatedSource);
    if (!syncActivePlacementReferenceEditor(type, filePath, updatedSource)) {
      markEdited(filePath);
    }
  }
}

/** Confirms ungrouping only when links target the group being removed. */
function confirmUngroupPlacementReferences(screen, groupId) {
  const referenceFiles = [];
  for (const [sources, type] of [
    [specSources, "spec"],
    [workflowSources, "workflow"]
  ]) {
    for (const [filePath, source] of sources) {
      const count = countScreenPlacementReferences(
        source,
        type,
        screen.id,
        screen.data.materials,
        groupId
      );
      if (count) referenceFiles.push({ filePath, count });
    }
  }
  if (referenceFiles.length === 0) return true;

  const total = referenceFiles.reduce((sum, reference) => sum + reference.count, 0);
  const listedFiles = referenceFiles.slice(0, 3)
    .map(({ filePath, count }) => `${filePath} (${count})`)
    .join(", ");
  const additionalFiles = referenceFiles.length > 3
    ? `, and ${referenceFiles.length - 3} more file(s)`
    : "";
  const linkLabel = total === 1 ? "reference" : "references";
  const message = `This group has ${total} existing ${linkLabel} in ${referenceFiles.length} file(s): ` +
    `${listedFiles}${additionalFiles}. Ungrouping will remove the group placement from those links ` +
    "while preserving their Screen and state. Continue?";
  return confirmInAppDialog(message);
}

/** Shows the application confirmation dialog and resolves whether the action was accepted. */
function confirmInAppDialog(message) {
  const dialog = byId("screen-confirmation-dialog");
  const messageElement = byId("screen-confirmation-message");
  if (!dialog?.showModal || !messageElement) {
    throw new Error("The confirmation dialog is unavailable.");
  }
  if (dialog.open) throw new Error("A confirmation dialog is already open.");
  messageElement.textContent = message;
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "confirm"),
      { once: true }
    );
    dialog.showModal();
  });
}

/** Keeps the active source editor in sync when its links are rewritten. */
function syncActivePlacementReferenceEditor(type, filePath, source) {
  if (type === "spec" && viewingSpec && activeSpecPath === filePath) {
    const editor = byId("spec-source");
    if (!editor) return false;
    editor.value = source;
    specEditor.handleSourceInput(filePath, source);
    return true;
  }
  if (type === "workflow" && viewingWorkflow && activeWorkflowPath === filePath) {
    const editor = byId("workflow-source");
    if (!editor) return false;
    editor.value = source;
    workflowEditor.handleSourceInput(filePath, source);
    return true;
  }
  return false;
}

/** Returns the element spec path. */
function getElementSpecPath(screen, instance) {
  for (const [filePath, owner] of elementSpecOwners) {
    if (owner.screenFile === screen.file && owner.elementId === instance.id) return filePath;
  }
  return null;
}

/** Returns the defined theme modes. */
function getDefinedThemeModes() {
  return themeEditor.getDefinedModes();
}

/** Returns the active theme mode. */
function getActiveThemeMode() {
  return themeEditor.getActiveMode();
}

/** Returns the theme tokens. */
function getThemeTokens(mode) {
  return themeEditor.getTokens(mode);
}

/** Updates the mode label for the current editor state. */
function themeModeLabel(mode) {
  return themeEditor.modeLabel(mode);
}

/** Captures persisted project artifacts without navigation, selection, or layout state. */
function captureEditSnapshot() {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const files = {
    "project.yml": { data: clone(project) }
  };
  for (const screen of screens) {
    files[screen.file] = screen.yamlSourceMode === "source"
      ? { content: screen.yamlSource }
      : { data: clone(screen.data) };
  }
  for (const [filePath, material] of materialFiles) {
    files[filePath] = { content: material.documentSource };
  }
  if (project?.theme && theme !== undefined) files[project.theme] = { data: clone(theme) };
  for (const [filePath, content] of specSources) files[filePath] = { content };
  for (const [filePath, content] of workflowSources) files[filePath] = { content };
  return {
    files,
    project: clone(project),
    screens: screens.map((screen) => ({
      id: screen.id,
      file: screen.file,
      data: clone(screen.data),
      yamlSource: screen.yamlSource,
      yamlSourceMode: screen.yamlSourceMode
    })),
    materials: [...materialFiles].map(([filePath, material]) => [filePath, {
      file: material.file,
      id: material.id,
      data: clone(material.data),
      documentSource: material.documentSource
    }]),
    theme: theme === undefined ? null : clone(theme),
    specSources: [...specSources],
    workflowSources: [...workflowSources],
    invalidYamlFiles: [...invalidYamlFiles],
    invalidWorkflowFiles: [...invalidWorkflowFiles],
    createdScreenFiles: [...createdScreenFiles],
    createdMaterialFiles: [...createdMaterialFiles],
    createdSpecFiles: [...createdSpecFiles],
    createdWorkflowFiles: [...createdWorkflowFiles],
    createdSpecDrafts: [...createdSpecDrafts].map(([filePath, draft]) => [filePath, clone(draft)]),
    elementSpecOwners: [...elementSpecOwners].map(([filePath, owner]) => [filePath, clone(owner)]),
    projectFilePaths: [...projectFilePaths]
  };
}

/** Returns the invalid source draft for one file, if the restored model still has one. */
function getRecoveryDraft(filePath) {
  const yamlMessage = invalidYamlFiles.get(filePath);
  if (yamlMessage) {
    const screen = screens.find((entry) => entry.file === filePath);
    if (screen) return { content: screen.yamlSource, message: yamlMessage, type: "screen" };
    const material = materialFiles.get(filePath);
    if (material) {
      return { content: material.documentSource, message: yamlMessage, type: "material" };
    }
  }
  const workflowMessage = invalidWorkflowFiles.get(filePath);
  if (workflowMessage && workflowSources.has(filePath)) {
    return {
      content: workflowSources.get(filePath),
      message: workflowMessage,
      type: "workflow"
    };
  }
  return null;
}

/** Restores artifact models while preserving the current navigation and selection. */
async function applyEditSnapshot(snapshot) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const priorScreens = new Map(screens.map((screen) => [screen.file, screen]));
  const priorMaterials = new Map(materialFiles);
  const selectedPath = [...activeInstancePath];
  project = clone(snapshot.project);
  screens = snapshot.screens.map((saved) => {
    const previous = priorScreens.get(saved.file);
    return {
      ...previous,
      ...clone(saved),
      yamlTimer: null,
      yamlParseVersion: (previous?.yamlParseVersion || 0) + 1,
      yamlSerializeVersion: (previous?.yamlSerializeVersion || 0) + 1
    };
  });
  materialFiles = new Map(snapshot.materials.map(([filePath, saved]) => {
    const previous = priorMaterials.get(filePath);
    return [filePath, {
      ...previous,
      ...clone(saved),
      parseTimer: null,
      parseVersion: (previous?.parseVersion || 0) + 1
    }];
  }));
  theme = snapshot.theme === null ? undefined : clone(snapshot.theme);
  specSources = new Map(snapshot.specSources);
  workflowSources = new Map(snapshot.workflowSources);
  invalidYamlFiles.clear();
  for (const [filePath, message] of snapshot.invalidYamlFiles) invalidYamlFiles.set(filePath, message);
  invalidWorkflowFiles.clear();
  for (const [filePath, message] of snapshot.invalidWorkflowFiles) {
    invalidWorkflowFiles.set(filePath, message);
  }
  for (const [set, values] of [
    [createdScreenFiles, snapshot.createdScreenFiles],
    [createdMaterialFiles, snapshot.createdMaterialFiles],
    [createdSpecFiles, snapshot.createdSpecFiles],
    [createdWorkflowFiles, snapshot.createdWorkflowFiles]
  ]) {
    set.clear();
    for (const value of values) set.add(value);
  }
  createdSpecDrafts.clear();
  for (const [filePath, draft] of snapshot.createdSpecDrafts) {
    createdSpecDrafts.set(filePath, clone(draft));
  }
  elementSpecOwners.clear();
  for (const [filePath, owner] of snapshot.elementSpecOwners) {
    elementSpecOwners.set(filePath, clone(owner));
  }
  projectFilePaths = [...snapshot.projectFilePaths];
  activeScreenIndex = Math.min(activeScreenIndex, Math.max(0, screens.length - 1));
  if (viewingMaterialFile && !materialFiles.has(activeMaterialFilePath)) {
    viewingMaterialFile = false;
    activeMaterialFilePath = null;
  }
  if (viewingWorkflow && !workflowSources.has(activeWorkflowPath)) {
    viewingWorkflow = false;
    activeWorkflowPath = null;
  }
  if (viewingSpec && !specSources.has(activeSpecPath)) {
    viewingSpec = false;
    activeSpecPath = null;
  }
  applyTheme();
  renderNavigation();
  renderScreenSelector();
  if (viewingTheme) await renderThemeView();
  else if (viewingMaterialFile) await renderMaterialFile(activeMaterialFilePath);
  else if (viewingWorkflow) await renderWorkflowEditor(activeWorkflowPath, workflowScreenIndex);
  else if (viewingSpec) await renderSpecEditor(activeSpecPath, activeSpecInstancePath, activeSpecOwner);
  else {
    await renderScreen(activeScreenIndex);
    const selected = getInstanceAtPath(screens[activeScreenIndex], selectedPath);
    if (selected) selectInstance(selectedPath, selected.src || null);
  }
  renderInspector();
}

/** Resets the project before load for the current editor state. */
function resetProjectBeforeLoad() {
  projectPersistence.resetAutosave();
  projectPersistence.resetEditHistory();
  deletedFiles.clear();
  clearTimeout(previewTimer);
  previewTimer = null;
  previewVersion += 1;
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
  createdWorkflowFiles.clear();
  createdSpecDrafts.clear();
  elementSpecOwners.clear();
  activeProjectFilePath = null;
  activeMaterialFilePath = null;
}

/** Applies the loaded project to the current editor state. */
function applyLoadedProject(loaded) {
  project = loaded.project;
  projectFilePaths = loaded.projectFilePaths;
  fileHashes = loaded.fileHashes || new Map();
  externalWriteConflicts.clear();
  screens = loaded.screens;
  materialFiles = loaded.materialFiles;
  activePreviewStateIds.clear();
  specSources = loaded.specSources;
  workflowSources = loaded.workflowSources;
  elementSpecOwners.clear();
  for (const [filePath, owner] of loaded.elementSpecOwners) {
    elementSpecOwners.set(filePath, owner);
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
  activeSpecScreenFile = null;
  activeSpecInstancePath = [];
  activeSpecOwner = "instance";
  hasEdits = false;
  dirtyFiles.clear();
  deletedFiles.clear();
  invalidYamlFiles.clear();
  invalidWorkflowFiles.clear();
  byId("create-screen").disabled = false;
  updateSaveControls();
  applyTheme();
  renderNavigation();
  renderScreenSelector();
}

/** Selects the render only screen and updates the related editor state. */
function selectRenderOnlyScreen() {
  const renderIndex = screens.findIndex((screen) => screen.id === renderRequestedScreen);
  if (renderIndex < 0) throw new Error(`Unknown Screen "${renderRequestedScreen}".`);
  if (renderRequestedState !== null) {
    const renderScreenData = screens[renderIndex].data;
    const stateExists = getScreenPreviewStates(renderScreenData)
      .some((state) => state.id === renderRequestedState);
    if (!stateExists) {
      throw new Error(
        `Unknown Screen State "${renderRequestedState}" for Screen "${renderRequestedScreen}".`
      );
    }
    activePreviewStateIds.set(screens[renderIndex].id, renderRequestedState);
  }
  return renderIndex;
}

/** Loads the render annotations into the editor state. */
async function loadRenderAnnotations() {
  const annotationResponse = await fetch(
    `/api/render-annotations?screenId=${encodeURIComponent(renderRequestedScreen)}`
  );
  const annotationSet = await annotationResponse.json();
  if (!annotationResponse.ok) {
    throw new Error(annotationSet.error || `HTTP ${annotationResponse.status}`);
  }
  screenAnnotationController.renderStaticAnnotations(annotationSet);
}

/** Marks the render only page ready for the current editor state. */
function markRenderOnlyPageReady() {
  if (!document.body.dataset.specuxRenderHeight) {
    document.body.dataset.specuxRenderHeight = String(Math.ceil(Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      byId("screen-preview").scrollHeight
    )));
  }
  document.body.dataset.specuxRenderReady = "true";
}

/** Renders the only project from the current editor data. */
async function renderOnlyProject() {
  const renderIndex = selectRenderOnlyScreen();
  await renderScreen(renderIndex);
  if (byId("screen-preview").classList.contains("error")) {
    throw new Error(byId("screen-preview").textContent.trim() || "Screen render failed.");
  }
  if (renderRequestedAnnotations) await loadRenderAnnotations();
  markRenderOnlyPageReady();
  if (new URLSearchParams(window.location.search).get("format") === "html") {
    document.body.dataset.specuxRenderHtml = encodeBase64(await standaloneScreenHtml());
  }
}

/** Opens the project overview and restores its navigation state. */
async function restoreProjectSelection(selectionToRestore) {
  const wasHistoryUpdateSuppressed = historyUpdateSuppressed;
  const restoringUrl = selectionToRestore.view === "url";
  if (restoringUrl) historyUpdateSuppressed = true;
  try {
    await restoreUiSelection(selectionToRestore);
  } finally {
    historyUpdateSuppressed = wasHistoryUpdateSuppressed;
    if (restoringUrl && !wasHistoryUpdateSuppressed) syncBrowserHistory(true);
  }
}

/** Renders the loaded project from the current editor data. */
async function renderLoadedProject(selectionToRestore) {
  if (isRenderOnly) return renderOnlyProject();
  if (selectionToRestore) return restoreProjectSelection(selectionToRestore);
  return renderScreen(0);
}

/** Loads the project into the editor state. */
async function loadProject(selectionToRestore = null) {
  resetProjectBeforeLoad();
  setPreviewMessage("loading", "Reading project files...");
  try {
    const loaded = await projectRepository.load();
    applyLoadedProject(loaded);
    projectPersistence.restoreRecoveryDrafts();
    await projectPersistence.restoreExternalWriteConflicts();
    await renderLoadedProject(selectionToRestore);
    projectPersistence.initializeEditHistory();
  } catch (error) {
    showFatalError(error);
  }
}

/** Updates the base64 for the current editor state. */
function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Updates the rendered node for the current editor state. */
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

/** Updates the screen html for the current editor state. */
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

/** Returns the selection represented by the currently visible editor view. */
function currentUiSelection() {
  return editorNavigation.currentSelection();
}

/** Returns the project file represented by the supplied editor selection. */
function getSelectionFilePath(selection) {
  return editorNavigation.getSelectionFilePath(selection);
}

/** Builds an editor selection from the URL file, view, owner, and nested-path parameters. */
function selectionFromLocation() {
  return editorNavigation.selectionFromLocation();
}

/** Synchronizes the browser history with the current editor state. */
function syncBrowserHistory(forceReplace = false) {
  editorNavigation.syncHistory(forceReplace);
}

/** Restores the ui selection for the current editor state. */
async function restoreUiSelection(selection) {
  return editorNavigation.restoreSelection(selection);
}

/** Reloads the active editor view after project files change externally. */
function refreshFromExternalChanges() {
  return editorNavigation.refreshFromExternalChanges();
}

/** Normalizes the screenshot colors for the current editor state. */
function normalizeScreenshotColors(documentClone) {
  const srgbColor = /color\(\s*srgb\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))(?:\s*\/\s*([+-]?(?:\d+\.?\d*|\.\d+)))?\s*\)/gi;
  for (const element of documentClone.querySelectorAll("*")) {
    const computedStyle = documentClone.defaultView.getComputedStyle(element);
    for (const property of computedStyle) {
      const value = computedStyle.getPropertyValue(property);
      if (!value.includes("color(srgb")) continue;
      const compatibleValue = value.replace(
        srgbColor,
        (_match, red, green, blue, alpha) => {
          const channels = [red, green, blue].map((channel) =>
            Math.round(Math.max(0, Math.min(1, Number(channel))) * 255)
          );
          return `rgba(${channels.join(",")},${alpha === undefined ? 1 : Math.max(0, Math.min(1, Number(alpha)))})`;
        }
      );
      if (compatibleValue !== value) {
        element.style.setProperty(
          property,
          compatibleValue,
          computedStyle.getPropertyPriority(property)
        );
      }
    }
  }
}

/** Validates the preview capture dimensions before it is applied or saved. */
function validatePreviewCaptureDimensions(previews) {
  if (previews.length === 0) {
    throw new Error("There are no visible preview panes to capture.");
  }
  const requestedWidth = Math.max(...previews.map(({ width }) => width));
  const requestedHeight = previews.reduce((total, { height }) => total + height, 0);
  const invalidPreview = previews.some(({ width, height }) =>
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 1 || height < 1 || width > 16384 || height > 16384
  );
  if (invalidPreview || requestedWidth > 16384 || requestedHeight > 16384) {
    throw new Error("The combined preview image exceeds the 16384px image limit.");
  }
}

/** Sets the capture element bounds from the supplied data. */
function setCaptureElementBounds(element, width, height) {
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  element.style.minWidth = "0";
  element.style.minHeight = "0";
  element.style.maxWidth = "none";
  element.style.maxHeight = "none";
  element.style.overflow = "visible";
  element.style.flex = "none";
}

/** Updates the captured workflow diagram for the current editor state. */
function positionCapturedWorkflowDiagram(cloneTarget, workflowDiagramLeft) {
  const cloneWorkflowDiagram = cloneTarget.querySelector(":scope > svg.flowchart");
  if (!cloneWorkflowDiagram || workflowDiagramLeft === null) return;
  const cloneTargetLeft = cloneTarget.getBoundingClientRect().left;
  const cloneDiagramLeft = cloneWorkflowDiagram.getBoundingClientRect().left;
  cloneWorkflowDiagram.style.transform =
    `translateX(${workflowDiagramLeft - (cloneDiagramLeft - cloneTargetLeft)}px)`;
}

/** Updates the preview clone for the current editor state. */
function preparePreviewClone(documentClone, preview, workflowDiagramLeft) {
  const { id, width, height } = preview;
  const cloneTarget = documentClone.querySelector(
    `[data-annotation-capture-preview="${id}"]`
  );
  const cloneScrollTarget = documentClone.querySelector(
    `[data-annotation-capture-scroll="${id}"]`
  );
  if (!cloneTarget || !cloneScrollTarget) {
    throw new Error(`The "${id}" preview changed during image capture.`);
  }
  Object.assign(cloneTarget.style, {
    position: "fixed",
    top: "0",
    left: "0",
    margin: "0",
    zIndex: "2147483647"
  });
  setCaptureElementBounds(cloneTarget, width, height);
  if (id === "screen") cloneTarget.style.zoom = "1";
  cloneScrollTarget.scrollTop = 0;
  cloneScrollTarget.scrollLeft = 0;
  if (cloneScrollTarget !== cloneTarget) {
    setCaptureElementBounds(cloneScrollTarget, width, height);
  }
  positionCapturedWorkflowDiagram(cloneTarget, workflowDiagramLeft);
  let ancestor = cloneTarget.parentElement;
  while (ancestor && ancestor.id !== "main") {
    ancestor.style.overflow = "visible";
    ancestor.style.contain = "none";
    ancestor = ancestor.parentElement;
  }
  normalizeScreenshotColors(documentClone);
}

/** Updates the preview canvas for the current editor state. */
function flattenPreviewCanvas(canvas, backgroundColor, previewId) {
  const flattened = document.createElement("canvas");
  flattened.width = canvas.width;
  flattened.height = canvas.height;
  const context = flattened.getContext("2d");
  if (!context) throw new Error(`Could not flatten the "${previewId}" preview image.`);
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(canvas, 0, 0);
  return flattened;
}

/** Captures the preview canvas for the current editor state. */
async function capturePreviewCanvas(preview, mainBackground) {
  const { id, width, height, captureElement, scrollElement, hostElement } = preview;
  const bounds = captureElement.getBoundingClientRect();
  const workflowDiagram = captureElement.querySelector(":scope > svg.flowchart");
  const workflowDiagramLeft = workflowDiagram
    ? workflowDiagram.getBoundingClientRect().left - bounds.left + scrollElement.scrollLeft
    : null;
  const surfaceBackground = window.getComputedStyle(hostElement).backgroundColor;
  const backgroundColor = surfaceBackground === "rgba(0, 0, 0, 0)"
    ? mainBackground
    : surfaceBackground;
  const canvas = await window.html2canvas(captureElement, {
    width,
    height,
    windowWidth: Math.max(window.innerWidth, Math.ceil(Math.max(0, bounds.left) + width)),
    windowHeight: Math.max(window.innerHeight, Math.ceil(Math.max(0, bounds.top) + height)),
    scrollX: 0,
    scrollY: 0,
    scale: 1,
    useCORS: true,
    logging: false,
    backgroundColor,
    foreignObjectRendering: true,
    onclone: (documentClone) => preparePreviewClone(documentClone, preview, workflowDiagramLeft)
  });
  return flattenPreviewCanvas(canvas, backgroundColor, id);
}

/** Updates the preview canvases for the current editor state. */
async function combinePreviewCanvases(canvases, mainBackground) {
  const compositeWidth = Math.max(...canvases.map((canvas) => canvas.width));
  const compositeHeight = canvases.reduce((height, canvas) => height + canvas.height, 0);
  if (compositeWidth > 16384 || compositeHeight > 16384) {
    throw new Error("The combined preview image exceeds the 16384px image limit.");
  }
  const flattenedCanvas = document.createElement("canvas");
  flattenedCanvas.width = compositeWidth;
  flattenedCanvas.height = compositeHeight;
  const context = flattenedCanvas.getContext("2d");
  if (!context) throw new Error("The browser could not combine the preview images.");
  context.fillStyle = mainBackground;
  context.fillRect(0, 0, compositeWidth, compositeHeight);
  let verticalOffset = 0;
  for (const canvas of canvases) {
    context.drawImage(canvas, 0, verticalOffset);
    verticalOffset += canvas.height;
  }
  const image = await new Promise((resolve) =>
    flattenedCanvas.toBlob(resolve, "image/png")
  );
  if (!image) throw new Error("The browser could not encode the editor image.");
  return image;
}

/** Updates the captured image for the current editor state. */
async function uploadCapturedImage(request, image) {
  const response = await fetch(
    `/api/editor-image?requestId=${encodeURIComponent(request.requestId)}` +
      `&clientId=${encodeURIComponent(editorClientId)}`,
    { method: "POST", headers: { "Content-Type": "image/png" }, body: image }
  );
  if (!response.ok) throw new Error(await response.text());
}

/** Updates the editor image capture failure for the current editor state. */
async function reportEditorImageCaptureFailure(request, error) {
  try {
    await fetch("/api/editor-image/failure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: request.requestId,
        clientId: editorClientId,
        message: error.message || String(error)
      })
    });
  } catch (reportError) {
    console.error("Could not report the editor image capture failure.", reportError);
  }
}

/** Captures the current editor image for the current editor state. */
async function captureCurrentEditorImage(request) {
  if (!request || request.clientId !== editorClientId ||
      typeof request.requestId !== "string") return;
  try {
    await screenAnnotationController?.saveQueue;
    if (typeof window.html2canvas !== "function") {
      throw new Error("The editor image capture library is unavailable.");
    }
    await document.fonts?.ready;
    const previews = screenAnnotationController?.getPreviewCaptureTargets() || [];
    validatePreviewCaptureDimensions(previews);
    const mainBackground = window.getComputedStyle(byId("main")).backgroundColor;
    const capturedPreviews = [];
    for (const preview of previews) {
      capturedPreviews.push(await capturePreviewCanvas(preview, mainBackground));
    }
    const image = await combinePreviewCanvases(capturedPreviews, mainBackground);
    await uploadCapturedImage(request, image);
  } catch (error) {
    console.error("Could not capture the active editor image.", error);
    await reportEditorImageCaptureFailure(request, error);
  }
}

if (!isRenderOnly && typeof EventSource !== "undefined") {
  const projectEvents = new EventSource("/api/events");
  projectEvents.addEventListener("project-updated", refreshFromExternalChanges);
  projectEvents.addEventListener("capture-editor-image", (event) => {
    try {
      captureCurrentEditorImage(JSON.parse(event.data)).catch((error) => {
        console.error("Could not capture the active editor image.", error);
      });
    } catch (error) {
      console.error("Could not read the editor image capture request.", error);
    }
  });
}

/** Applies the theme to the current editor state. */
function applyTheme() {
  const tokens = getThemeTokens();
  const tokenNames = new Set(Object.keys(tokens));
  const themeRoots = [byId("screen-preview"), byId("material-selector-list")];
  for (const name of appliedThemeTokens) {
    if (!tokenNames.has(name)) {
      themeRoots.forEach((root) => root.style.removeProperty(`--theme-${name}`));
    }
  }
  for (const [name, value] of Object.entries(tokens)) {
    themeRoots.forEach((root) => root.style.setProperty(`--theme-${name}`, value));
  }
  appliedThemeTokens = tokenNames;
  byId("screen-preview").style.colorScheme = getActiveThemeMode();
}

/** Renders the navigation from the current editor data. */
function renderNavigation() {
  return projectFileNavigator.renderNavigation();
}

/** Renders the screen selector from the current editor data. */
function renderScreenSelector() {
  return projectFileNavigator.renderScreenSelector();
}

/** Sets the screen selector open from the supplied data. */
function setScreenSelectorOpen(open, restoreFocus = false) {
  return projectFileNavigator.setScreenSelectorOpen(open, restoreFocus);
}

/** Collects project files and generated drafts for the navigation tree. */
function getProjectTreeFilePaths() {
  return projectFileNavigator.getProjectTreeFilePaths();
}

/** Renders the project file from the current editor data. */
function renderProjectFile(file) {
  return projectFileNavigator.renderProjectFile(file);
}

/** Returns the project file action. */
function getProjectFileAction(filePath) {
  return projectFileNavigator.getProjectFileAction(filePath);
}

/** Opens the project file in the editor. */
async function openProjectFile(filePath) {
  return projectFileNavigator.openProjectFile(filePath);
}

/** Validates the proposed name, creates the Screen file, and updates the project manifest. */
async function createScreen() {
  return screenController.createScreen();
}

/** Walks a nested instance path and returns its target placement. */
function getInstanceAtPath(screen, path) {
  const materials = screen.data?.materials || screen.materials || [];
  return getScreenPlacementAtPath(materials, path);
}

/** Selects the instance in preview and updates the related editor state. */
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

/** Renders the screen from the current editor data. */
async function renderScreen(index, options = {}) {
  const previousScreenIndex = activeScreenIndex;
  const filePath = options.preserveWorkflow
    ? activeWorkflowPath
    : screens[index]?.file;
  await screenAnnotationController?.fileLoaded(filePath);
  if (!options.preserveWorkflow) workflowEditor?.deactivate();
  await workspaceViewRenderer.renderScreen(index, options);
  renderSpecIndicators();
  if (!isRenderOnly) {
    await screenAnnotationController.setScreen(screens[index]);
    screenSelectionController.setScreen(screens[index]);
    if (viewingTheme) {
      screenAnnotationController.setEnabled(false);
      hidePreviewStateControls();
    }
    if (!options.preserveWorkflow &&
        (index !== previousScreenIndex || options.previewStateSelected ||
          options.centerPreview === true)) {
      const stateTargets = options.previewStateSelected
        ? getNewlyVisibleStatePlacementPaths(screens[index])
        : [];
      await centerPreviewTarget(null, stateTargets);
    }
    publishSelection();
  }
}

/** Renders the workflow editor from the current editor data. */
async function renderWorkflowEditor(filePath, screenIndex) {
  clearSpecWorkflowDock();
  await screenAnnotationController?.fileLoaded(filePath);
  screenAnnotationController?.setEnabled(false);
  return workflowEditor.render(filePath, screenIndex);
}

/** Opens a linked Workflow view under the current Spec without changing editor mode. */
async function showSpecWorkflowDock(reference, specPath) {
  while (editorNavigation.linkedDockStack.length) editorNavigation.popLinkedDock();
  editorNavigation.pushLinkedDock({
    view: "workflow",
    file: reference.workflowPath,
    nodeId: reference.nodeId,
    readOnly: true
  });
  try {
    await workflowEditor.showLinkedWorkflowPreview(reference, specPath);
  } catch (error) {
    editorNavigation.popLinkedDock();
    workflowEditor.clearLinkedWorkflowPreview();
    throw error;
  }
}

/** Closes the linked Workflow dock and restores its parent Spec view. */
function clearSpecWorkflowDock() {
  if (editorNavigation.linkedDockStack.length) editorNavigation.popLinkedDock();
  workflowEditor.clearLinkedWorkflowPreview();
}

/** Renders the theme screen from the current editor data. */
async function renderThemeScreen(index) {
  const preview = byId("screen-preview");
  preview.classList.remove("theme-material-preview");
  await workspaceViewRenderer.renderScreen(index, { preserveTheme: true });
  screenSelectionController.setScreen(screens[index]);
  hidePreviewStateControls();
}

/** Renders the theme material from the current editor data. */
function renderThemeMaterial(filePath) {
  const material = materialFiles.get(filePath);
  if (!material) throw new Error(`Material file "${filePath}" is not available.`);
  materialFileEditor.renderPreview(material);
  byId("screen-preview").classList.add("theme-material-preview");
}

/** Resolves the spec reference against the current project state. */
function resolveSpecReference(reference) {
  let selectedReference = reference;
  if (!selectedReference) {
    const ownerScreenIndex = screens.findIndex((screen) =>
      screen.file === activeSpecScreenFile
    );
    if (ownerScreenIndex < 0) return null;
    selectedReference = {
      screenId: screens[ownerScreenIndex].id,
      placementId: null,
      stateId: "default"
    };
  }
  const screenIndex = screens.findIndex((screen) => screen.id === selectedReference.screenId);
  const screen = screens[screenIndex];
  if (!screen) {
    throw new Error(`Spec Screen "${selectedReference.screenId}" is not available.`);
  }
  const stateAvailable = getScreenPreviewStates(screen.data)
    .some((previewState) => previewState.id === selectedReference.stateId);
  if (!stateAvailable) {
    throw new Error(
      `Screen State "${selectedReference.stateId}" is not available on Screen "${screen.id}".`
    );
  }

  let instancePath = [];
  if (selectedReference.placementId) {
    instancePath = getScreenPlacementPathById(
      screen.data.materials || [],
      selectedReference.placementId
    ) || [];
    if (instancePath.length === 0) {
      throw new Error(
        `Element "${selectedReference.placementId}" is not available on Screen "${screen.id}".`
      );
    }
  }

  return { reference: selectedReference, screen, screenIndex, instancePath };
}

/** Shows the spec reference for the current editor state. */
async function showSpecReference(reference, filePath) {
  workflowEditor.clearSpecReferencePreview();
  const resolved = resolveSpecReference(reference);
  if (!resolved) return [];
  const { reference: selectedReference, screen, screenIndex, instancePath } = resolved;

  activePreviewStateIds.set(screen.id, selectedReference.stateId);
  activeScreenIndex = screenIndex;
  activeInstancePath = instancePath;
  activeInstancePaths = instancePath.length ? [[...instancePath]] : [];
  await editorNavigation.navigateToReferencedScreen(screenIndex, "spec");
  screenAnnotationController.setEnabled(false);
  viewingSpec = true;
  activeSpecPath = filePath;
  activeProjectFilePath = filePath;
  hidePreviewStateControls();
  byId("screen-heading").textContent = `Spec: ${filePath}`;
  byId("breadcrumb").textContent = "Behavior spec";
  byId("screen-stage").setAttribute(
    "aria-label",
    `Screen preview linked from behavior spec "${filePath}"`
  );
  byId("spec-view-heading").textContent = "Screen preview";
  updateNavigationSelection();
  renderInspector();
  await centerPreviewTarget(instancePath.length ? instancePath : null);
  return instancePath;
}

/** Shows the workflow node for the current editor state. */
async function showWorkflowNode(link, ownerScreenIndex, workflowPath) {
  const screenIndex = screens.findIndex((screen) => screen.id === link.screenId);
  const screen = screens[screenIndex];
  if (!screen) {
    return { warning: `Workflow Screen "${link.screenId}" is not available.` };
  }

  const stateId = link.stateId;
  if (!getScreenPreviewStates(screen.data).some((previewState) =>
    previewState.id === stateId
  )) {
    return {
      warning: `Screen State "${stateId}" is not available on Screen "${screen.id}".`
    };
  }

  const placementIds = link.placementIds || (link.placementId ? [link.placementId] : []);
  const instancePaths = placementIds.map((placementId) =>
    getScreenPlacementPathById(screen.data.materials || [], placementId) || []
  );
  const missingIndex = instancePaths.findIndex((instancePath) => !instancePath.length);
  if (missingIndex >= 0) {
    return {
      warning: `Element "${placementIds[missingIndex]}" is not available on Screen "${screen.id}".`
    };
  }

  activePreviewStateIds.set(screen.id, stateId);
  activeInstancePath = instancePaths.at(-1) || [];
  activeInstancePaths = instancePaths.map((instancePath) => [...instancePath]);
  activeScreenIndex = screenIndex;
  await editorNavigation.navigateToReferencedScreen(screenIndex, "workflow", {
    previewStateSelected: false
  });
  specEditor.updatePreviewFocus(activeInstancePath);

  screenAnnotationController.setEnabled(false);
  viewingWorkflow = true;
  activeWorkflowPath = workflowPath;
  workflowScreenIndex = ownerScreenIndex;
  activeProjectFilePath = workflowPath;
  workflowEditor.activate();
  workflowEditor.setViewMode(workflowViewMode);
  updateNavigationSelection();
  renderInspector();
  await centerPreviewTarget(null, instancePaths, true);
}

/** Centers the selected placement or Screen in the preview. */
async function centerPreviewTarget(instancePath, stateTargetPaths = [], fitTargets = false) {
  const preview = byId("screen-preview");
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  const content = preview.querySelector(":scope > .form-content");
  const host = instancePath
    ? byId(`specux-material-${instancePath.join("-")}`)
    : null;
  if (instancePath) {
    screenCanvasViewportController.centerOnTarget(
      host?.closest(".material-frame") || content
    );
    return;
  }
  const targetPaths = new Set(stateTargetPaths.map((path) => JSON.stringify(path)));
  const stateTargets = stateTargetPaths.length
    ? [...(content?.querySelectorAll(".material-frame") || [])]
      .filter((frame) => targetPaths.has(frame.dataset.instancePath))
    : [];
  if (stateTargets.length) {
    centerPreviewTargets(stateTargets, { fitTargets, preferLargestTarget: true });
    return;
  }
  const placements = [...(content?.querySelectorAll(":scope > .material-frame") || [])];
  centerPreviewTargets(placements, { fitTargets, fallback: content });
}

/** Centers or fits the target placements, falling back to their Screen content. */
function centerPreviewTargets(
  targets,
  { fitTargets = false, preferLargestTarget = false, fallback = null } = {}
) {
  if (!targets.length) {
    screenCanvasViewportController.centerOnTarget(fallback);
    return;
  }
  if (fitTargets) {
    screenCanvasViewportController.fitOnTargets(targets, { maxZoom: 1.15 });
  }
  else {
    screenCanvasViewportController.centerOnTargets(targets, { preferLargestTarget });
  }
}

/** Returns visible placements introduced by the selected Screen State. */
function getNewlyVisibleStatePlacementPaths(screen) {
  const screenData = screen?.data;
  const stateId = (screen && activePreviewStateIds.get(screen.id)) || "default";
  if (!screenData || stateId === "default") return [];
  const statePaths = [];
  const visit = (placements, parentPath, stateParentVisible, defaultParentVisible) => {
    placements.forEach((placement, index) => {
      const path = [...parentPath, index];
      const layer = parentPath.length
        ? null
        : screenData.layers?.find((candidate) => candidate.id === placement.layer);
      const { isVisibleInState, isVisibleByDefault } = getStatePlacementVisibility(
        placement,
        layer,
        stateId,
        screenData,
        stateParentVisible,
        defaultParentVisible,
        parentPath.length > 0
      );
      if (isVisibleInState && !isVisibleByDefault) {
        statePaths.push(path);
        return;
      }
      if (isScreenGroup(placement)) {
        visit(
          placement.children,
          path,
          isVisibleInState,
          isVisibleByDefault
        );
      }
    });
  };
  visit(screenData.materials || [], [], true, true);
  return statePaths;
}

/** Compares a placement's effective visibility in a state with its Default visibility. */
function getStatePlacementVisibility(
  placement,
  layer,
  stateId,
  screenData,
  stateParentVisible,
  defaultParentVisible,
  isNested
) {
  return {
    isVisibleInState: stateParentVisible &&
      isInstanceVisible(placement, stateId, screenData) &&
      (isNested || isLayerVisible(layer, stateId, screenData)),
    isVisibleByDefault: defaultParentVisible &&
      isInstanceVisible(placement, "default", screenData) &&
      (isNested || isLayerVisible(layer, "default", screenData))
  };
}

/** Renders the spec editor from the current editor data. */
async function renderSpecEditor(filePath, instancePath = activeInstancePath, owner = "instance") {
  clearSpecWorkflowDock();
  await screenAnnotationController?.fileLoaded(filePath);
  workflowEditor?.deactivate();
  screenAnnotationController?.setEnabled(false);
  return specEditor.render(filePath, instancePath, owner);
}

/** Updates the unedited active spec draft for the current editor state. */
function discardUneditedActiveSpecDraft() {
  specEditor.discardUneditedActiveDraft();
}

/** Creates an Element spec for the selected instance path. */
async function createSpecForInstance(instancePath) {
  return specEditor.createForInstance(instancePath);
}

/** Creates the project-level behavior spec and registers its pending file path. */
async function createProjectSpec() {
  return specEditor.createForProject();
}

/** Creates a behavior spec owned by the selected Screen. */
async function createSpecForScreen() {
  return specEditor.createForScreen();
}

/** Renders the project overview from the current editor data. */
async function renderProjectOverview() {
  await screenAnnotationController?.fileLoaded("project.yml");
  workflowEditor?.deactivate();
  screenAnnotationController?.setEnabled(false);
  return workspaceViewRenderer.renderProjectOverview();
}

/** Renders the material file from the current editor data. */
async function renderMaterialFile(filePath) {
  await screenAnnotationController?.fileLoaded(filePath);
  workflowEditor?.deactivate();
  screenAnnotationController?.setEnabled(false);
  return materialFileEditor.render(filePath);
}

/** Checks whether two Element instance paths identify the same instance. */
function sameInstancePath(left, right) {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}


/** Sets the screen dom context from the supplied data. */
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

/** Updates DOM metadata used to interpret Screen preview events. */
function updateScreenDomContext(screen) {
  [
    byId("workspace-context"),
    byId("main"),
    byId("screen-stage"),
    byId("screen-preview")
  ].forEach((node) => setScreenDomContext(node, screen));
}

/** Copies the selected instance paths and refreshes their canvas controls. */
function updateSelectedInstancePaths(path, options) {
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
}

/** Clears the spec selection view and resets its associated state. */
function clearSpecSelectionView() {
  viewingTheme = false;
  viewingProject = false;
  viewingSpec = false;
  viewingPreviewState = false;
  activeSpecPath = null;
  activeSpecScreenFile = null;
  activeSpecInstancePath = [];
  byId("main").classList.remove("spec-editing");
  byId("spec-editor-panel").hidden = true;
  byId("spec-source").oninput = null;
}

/** Selects the instance and updates the related editor state. */
function selectInstance(path, _materialSrc, options = {}) {
  if (viewingWorkflow) return;
  updateSelectedInstancePaths(path, options);
  if (viewingTheme) {
    selectInstanceInPreview(activeInstancePaths);
    renderInspector();
    return;
  }
  if (viewingSpec) {
    selectInstanceInPreview(activeInstancePaths);
    return;
  }
  clearSpecSelectionView();
  selectInstanceInPreview(activeInstancePaths);
  updateNavigationSelection();
  renderInspector();
}

/** Selects the instances and updates the related editor state. */
function selectInstances(paths) {
  const selectedPaths = Array.isArray(paths)
    ? paths.filter((path) => Array.isArray(path) && path.length)
    : [];
  selectInstance(selectedPaths.at(-1) || [], null, { paths: selectedPaths });
}

/** Updates the screen placement menu for the current editor state. */
function prepareScreenPlacementMenu(placement, selectedCount = activeInstancePaths.length) {
  const groupButton = byId("screen-placement-context-group");
  const ungroupButton = byId("screen-placement-context-ungroup");
  const copyButton = byId("screen-placement-context-copy-url");
  const themeButton = byId("screen-placement-context-theme");
  const placements = screens[activeScreenIndex]?.data?.materials || [];
  const isDefaultState = getActivePreviewStateId(screens[activeScreenIndex]?.data) === "default";
  const canGroupSelection = canGroupScreenPlacements(placements, activeInstancePaths);
  groupButton.hidden = !isDefaultState || activeInstancePaths.length < 2;
  groupButton.disabled = !canGroupSelection;
  groupButton.title = canGroupSelection
    ? ""
    : "Select at least two sibling placements from the same layer to group them.";
  ungroupButton.hidden = !isDefaultState || !isScreenGroup(placement);
  copyButton.hidden = false;
  copyButton.disabled = selectedCount > 1;
  copyButton.title = copyButton.disabled ? "Select one placement to copy its URL." : "";
  themeButton.hidden = false;
  return true;
}

/** Prepares the context menu for a Screen background target. */
function prepareScreenBackgroundMenu() {
  for (const id of [
    "screen-placement-context-group",
    "screen-placement-context-ungroup",
    "screen-placement-context-copy-url"
  ]) {
    byId(id).hidden = true;
  }
  byId("screen-placement-context-theme").hidden = false;
}

/** Updates the screen placement menu for the current editor state. */
function positionScreenPlacementMenu(event) {
  const menu = byId("screen-placement-context-menu");
  const groupButton = byId("screen-placement-context-group");
  const ungroupButton = byId("screen-placement-context-ungroup");
  const copyButton = byId("screen-placement-context-copy-url");
  const themeButton = byId("screen-placement-context-theme");
  menu.hidden = false;
  const menuWidth = menu.offsetWidth || 210;
  const menuHeight = menu.offsetHeight || 150;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))}px`;
  const focusTarget = !groupButton.hidden && !groupButton.disabled
    ? groupButton
    : !ungroupButton.hidden
      ? ungroupButton
      : !copyButton.hidden
        ? copyButton
        : themeButton;
  focusTarget.focus();
}

/** Checks whether the selected placement can open its context menu. */
function canOpenPlacementContextMenu(path) {
  return !isRenderOnly && !viewingWorkflow && !viewingTheme && !viewingSpec &&
    Array.isArray(path) && path.length > 0;
}

/** Checks whether the supplied instance path is in the current selection. */
function isPlacementSelected(path) {
  return activeInstancePaths.some((selectedPath) => sameInstancePath(selectedPath, path));
}

/** Opens the screen placement context menu in the editor. */
function openScreenPlacementContextMenu(event, path) {
  if (!canOpenPlacementContextMenu(path)) return;
  const screen = screens[activeScreenIndex];
  const selectedCount = activeInstancePaths.length;
  const selectedCopyPath = selectedCount === 1 ? [...activeInstancePaths[0]] : null;
  event.preventDefault();
  const selectedGroupPath = getSelectedGroupAncestorPath(
    screen?.data?.materials,
    activeInstancePaths,
    path
  );
  const contextPath = selectedGroupPath || path;
  const placement = getInstanceAtPath(screen, contextPath);
  if (!placement) return;
  if (!isPlacementSelected(contextPath)) {
    selectInstance(contextPath, placement.src || null);
  }
  screenPlacementMenuTarget = [...contextPath];
  screenPlacementCopyTarget = selectedCopyPath || [...contextPath];
  if (!prepareScreenPlacementMenu(placement, selectedCount)) {
    closeScreenPlacementContextMenu();
    return;
  }
  positionScreenPlacementMenu(event);
}

/** Opens the Theme entry menu on an empty Screen background. */
function openScreenBackgroundContextMenu(event) {
  if (isRenderOnly || viewingWorkflow || viewingTheme || viewingSpec ||
      !screens[activeScreenIndex]) return;
  event.preventDefault();
  screenPlacementMenuTarget = null;
  screenPlacementCopyTarget = null;
  prepareScreenBackgroundMenu();
  positionScreenPlacementMenu(event);
}

/** Copies the selected placement's SpecUX reference URL to the clipboard. */
async function copyScreenPlacementUrl(path) {
  const screen = screens[activeScreenIndex];
  if (!screen) throw new Error("Select a Screen before copying a placement URL.");
  const url = createScreenPlacementUrl(
    screen.id,
    screen.data.materials,
    path,
    getActivePreviewStateId(screen.data)
  );
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable in this browser.");
  }
  await navigator.clipboard.writeText(url);
  showEditorMessage("SpecUX URL copied", url);
}

/** Closes the screen placement context menu and restores the related editor state. */
function closeScreenPlacementContextMenu() {
  const menu = byId("screen-placement-context-menu");
  if (menu) menu.hidden = true;
  screenPlacementMenuTarget = null;
  screenPlacementCopyTarget = null;
}

/** Registers event listeners for screen placement context menu interactions. */
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
  byId("screen-placement-context-copy-url").addEventListener("click", () => {
    const path = screenPlacementCopyTarget;
    closeScreenPlacementContextMenu();
    if (path) {
      copyScreenPlacementUrl(path).catch((error) =>
        showEditorMessage("Could not copy SpecUX URL", error.message || String(error))
      );
    }
  });
  byId("screen-placement-context-theme").addEventListener("click", () => {
    closeScreenPlacementContextMenu();
    renderThemeView().catch(showFatalError);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !menu.contains(event.target)) closeScreenPlacementContextMenu();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      closeScreenPlacementContextMenu();
    }
  });
}

/** Marks the navigation item that corresponds to the current editor view. */
function updateNavigationSelection() {
  updateWorkspaceToolbarContext();
  renderScreenSelector();
  document.querySelectorAll(".file-tree-file").forEach((button) => {
    const filePath = button.dataset.projectFile;
    const action = getProjectFileAction(filePath);
    const selected = activeProjectFilePath === filePath;
    button.classList.toggle("selected", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  syncBrowserHistory();
  publishSelection();
}

/** Keeps the persistent toolbar mode and canvas controls aligned with the active editor. */
function updateWorkspaceToolbarContext() {
  const mode = viewingMaterialFile
    ? "Material"
    : viewingTheme
      ? "Theme"
      : viewingWorkflow
        ? "Workflow"
        : viewingSpec
          ? "Spec"
          : viewingProject
            ? "Project"
            : "Screen";
  const topbar = byId("workspace-toolbar");
  topbar.dataset.mode = mode.toLocaleLowerCase();
  byId("workspace-mode-label").textContent = mode;
  byId("topbar-canvas-zoom-controls").hidden = mode === "Project" || mode === "Material";
  byId("theme-mode-exit").hidden = mode !== "Theme";
}

/** Returns a readable label for the active selection. */
function selectionName(selection) {
  const view = selection?.view;
  if (view === "project") return project?.name || "Project";
  if (view === "screen") return selection.screen?.name || selection.screen?.id;
  if (view === "material-file") return selection.material?.name || selection.material?.id;
  if (view === "workflow") {
    return selection.workflow?.file?.split("/").at(-1)?.replace(/\.mmd$/i, "");
  }
  if (view === "theme") return "Theme";
  if (view === "spec") return selection.spec?.file?.split("/").at(-1)?.replace(/\.md$/i, "");
  return null;
}

/** Returns the current layout mode for the active selection. */
function selectionViewMode(selection, main) {
  const modeByView = {
    screen: screenYamlEditor.mode,
    "material-file": main.dataset.materialView || "split",
    workflow: main.dataset.workflowView || "split",
    spec: main.dataset.specView || "split"
  };
  const mode = modeByView[selection?.view] || "preview";
  if (selection?.view !== "workflow") return mode;
  const surface = main.classList.contains("workflow-spec-preview-active")
    ? "spec"
    : byId("workflow-source").hidden ? "diagram" : "source";
  return `${main.dataset.workflowView || "split"}:${surface}`;
}

/** Publishes the active selection and its annotation coordinate context. */
function updateSelectionAnnotationContext(selection, file, viewMode) {
  if (selection?.view === "screen" && screenYamlEditor.mode !== "yaml") return;
  const contextType = selection?.view === "material-file" ? "material" : selection?.view;
  const contextKey = [
    contextType || "project",
    file || "overview",
    selection?.screen?.id || ""
  ].join(":");
  screenAnnotationController?.setEditorContext({
    key: contextKey,
    view: selection?.view || "project",
    type: contextType || "project",
    file: file || null,
    mode: viewMode
  });
}

/** Returns the published selection items. */
function getPublishedSelectionItems(selection, selectedScreen) {
  if (selection?.view === "workflow" && typeof selectedWorkflowNodeId === "string") {
    return [selectedWorkflowNodeId];
  }
  if (selection?.view === "screen" && selectedScreen) {
    return activeInstancePaths
      .map((instancePath) => getInstanceAtPath(selectedScreen, instancePath)?.id)
      .filter((id) => typeof id === "string");
  }
  if (["spec", "material-file"].includes(selection?.view)) {
    const editor = byId(selection.view === "spec" ? "spec-source" : "material-document-source");
    const textSelection = editor && getSelectedText(
      editor.value,
      editor.selectionStart,
      editor.selectionEnd
    );
    return textSelection ? [textSelection] : [];
  }
  return [];
}

/** Returns the preview placement ids. */
function getPreviewPlacementIds(selection, selectedScreen, selected) {
  if (!["screen", "spec"].includes(selection.view) || !selectedScreen) return selected;
  return activeInstancePaths
    .map((instancePath) =>
      getScreenPlacementIdPath(selectedScreen.data.materials, instancePath)?.join(".")
    )
    .filter((id) => typeof id === "string");
}

/** Returns the workflow selection preview. */
function getWorkflowSelectionPreview(selection) {
  if (selection?.view !== "workflow" || !selectedWorkflowNodeId || !selection.screen?.id) {
    return null;
  }
  const workflowName = (selection.workflow?.file || "").split("/").at(-1);
  if (!workflowName?.endsWith(".mmd")) return null;
  return `specux://screen/${encodeURIComponent(selection.screen.id)}` +
    `/workflows/${encodeURIComponent(workflowName)}?node=${encodeURIComponent(selectedWorkflowNodeId)}`;
}

/** Returns the screen selection preview. */
function getScreenSelectionPreview(selection, selectedScreen, screenId, selected) {
  if (!["screen", "spec"].includes(selection?.view) || !selection.screen?.id) return null;
  const parameters = new URLSearchParams();
  const placementIds = getPreviewPlacementIds(selection, selectedScreen, selected);
  if (placementIds.length === 1) parameters.set("placement", placementIds[0]);
  const stateId = selection.previewStateId || activePreviewStateIds.get(screenId) || "default";
  if (stateId && stateId !== "default") parameters.set("state", stateId);
  const query = parameters.toString();
  return `specux://screen/${encodeURIComponent(selection.screen.id)}/screen.yml` +
    (query ? `?${query}` : "");
}

/** Returns the selection preview. */
function getSelectionPreview(selection, selectedScreen, screenId, selected) {
  return getWorkflowSelectionPreview(selection) ||
    getScreenSelectionPreview(selection, selectedScreen, screenId, selected);
}

/** Builds the selection and annotation-context object published to the editor session. */
function createSelectionPayload(selection, details) {
  return {
    path: `${window.location.pathname}${window.location.search}`,
    file: details.file,
    type: details.type,
    name: details.name,
    preview: details.preview,
    selection: details.selection,
    selected: details.selected,
    clientId: editorClientId,
    ...(details.annotationContext || {})
  };
}

/** Updates the selection publication for the current editor state. */
function queueSelectionPublication(payload) {
  const operation = selectionPublishQueue.then(() => fetch("/api/selection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }));
  const published = operation.catch((error) => {
    console.warn("Could not publish the current SpecUX selection.", error);
    throw error;
  });
  selectionPublishQueue = published.catch(() => {});
  return published;
}

/** Publishes the selection for the current editor state. */
function publishSelection() {
  if (isRenderOnly) return;
  const selection = currentUiSelection();
  const screenId = selection?.screen?.id;
  const file = getSelectionFilePath(selection);
  const type = selection?.view === "material-file" ? "material" : selection?.view;
  const name = selectionName(selection);
  const publishedSelection = selection?.view === "screen"
    ? { ...selection, previewStateId: activePreviewStateIds.get(screenId) || "default" }
    : selection;
  const main = byId("main");
  const viewMode = selectionViewMode(selection, main);
  updateSelectionAnnotationContext(selection, file, viewMode);
  const annotationContext = screenAnnotationController?.getEditorAnnotationContext();
  const selectedScreen = screens[activeScreenIndex];
  const selected = getPublishedSelectionItems(selection, selectedScreen);
  const preview = getSelectionPreview(selection, selectedScreen, screenId, selected);
  const payload = createSelectionPayload(selection, {
    file,
    type,
    name,
    preview,
    selection: publishedSelection,
    selected,
    annotationContext
  });
  return queueSelectionPublication(payload);
}

/** Renders the inspector from the current editor data. */
function renderInspector() {
  inspectorRenderer.render();
  renderSpecIndicators();
}

/** Updates optional Screen and placement spec indicators in the visible workspace. */
function renderSpecIndicators() {
  const screen = screens[activeScreenIndex];
  const preview = byId("screen-preview");
  const screenHasSpec = Boolean(
    screen?.data.spec ||
    [...createdSpecDrafts.values()].some((draft) =>
      draft.owner === "screen" && draft.screenFile === screen?.file
    )
  );
  preview.classList.toggle("spec-indicators-enabled", specIndicatorsEnabled);
  preview.classList.toggle("has-screen-spec", screenHasSpec);
  for (const node of preview.querySelectorAll(".material-instance")) {
    let path;
    try {
      path = JSON.parse(node.dataset.instancePath || "[]");
    } catch (error) {
      node.classList.remove("has-spec");
      throw new Error("Could not read the Screen placement path for spec indicators.", {
        cause: error
      });
    }
    const samePath = (candidate) => Array.isArray(candidate) &&
      candidate.length === path.length &&
      candidate.every((part, index) => part === path[index]);
    const hasSpec = Boolean(screen && (
      [...elementSpecOwners.values()].some((owner) =>
        owner.screenFile === screen.file && samePath(owner.instancePath)
      ) ||
      [...createdSpecDrafts.values()].some((draft) =>
        draft.owner === "instance" &&
        draft.screenFile === screen.file &&
        samePath(draft.instancePath)
      )
    ));
    node.classList.toggle("has-spec", hasSpec);
  }
}

/** Adds the section for the current editor state. */
function appendSection(parent, title) {
  parent.append(element("div", "section-title", title));
}

/** Adds the detail for the current editor state. */
function appendDetail(parent, label, value) {
  if (value === undefined || value === null || value === "") return;
  parent.append(element("div", "detail-label", label));
  parent.append(element("div", "detail-value", String(value)));
}

/** Adds the note for the current editor state. */
function appendNote(parent, label, text) {
  parent.append(element("div", "detail-label", label));
  parent.append(element("div", "note-box", text));
}

/** Creates the accessible label associated with an editable inspector field. */
function createEditableFieldLabel(label, inputId) {
  const fieldLabel = element("label", "", label);
  fieldLabel.htmlFor = inputId;
  return fieldLabel;
}

/** Sets the editable select options from the supplied data. */
function setEditableSelectOptions(input, value, options) {
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
}

/** Sets the editable number input from the supplied data. */
function setEditableNumberInput(input, options) {
  if (options.numberFormat && input instanceof HTMLInputElement) {
    input.type = "number";
    input.step = options.numberFormat === "integer"
      ? "1"
      : options.numberFormat === "decimal" ? "any" : "0.01";
  } else if (input instanceof HTMLInputElement) {
    input.type = "text";
  }
}

/** Updates the editable value input for the current editor state. */
function configureEditableValueInput(input, value, options) {
  if (options.selectOptions) {
    setEditableSelectOptions(input, value, options);
  } else if (options.color) {
    input.type = "color";
    input.value = /^#[0-9a-f]{6}$/i.test(String(value)) ? value : "#4569e8";
  } else {
    setEditableNumberInput(input, options);
    input.value = value === undefined || value === null ? "" : String(value);
  }
}

/** Updates the editable field for the current editor state. */
function configureEditableField(wrapper, input, label, value, inputId, options) {
  if (options.checkbox) {
    input.type = "checkbox";
    input.checked = Boolean(value);
    wrapper.append(input, createEditableFieldLabel(label, inputId));
    return;
  }
  configureEditableValueInput(input, value, options);
  wrapper.append(createEditableFieldLabel(label, inputId), input);
}

/** Handles editable field change events and applies the corresponding editor action. */
function handleEditableFieldChange(input, onChange, options) {
  if (options.checkbox) {
    onChange(input.checked);
    return;
  }
  if (!options.numberFormat) {
    onChange(input.value);
    return;
  }
  if (input.value === "") {
    onChange(undefined);
    return;
  }
  if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
    input.reportValidity();
    return;
  }
  onChange(input.valueAsNumber);
}

/** Adds the editable field for the current editor state. */
function appendEditableField(parent, label, value, onChange, options = {}) {
  const wrapper = element("div", options.checkbox ? "editor-field checkbox" : "editor-field");
  const inputType = options.multiline ? "textarea" : options.selectOptions ? "select" : "input";
  const input = element(inputType);
  const inputId = options.id || `editor-field-${editorFieldId++}`;
  input.id = inputId;
  if (options.required) input.required = true;
  configureEditableField(wrapper, input, label, value, inputId, options);
  input.addEventListener("change", () => {
    handleEditableFieldChange(input, onChange, options);
  });
  parent.append(wrapper);
}

/** Records a changed file and updates the unsaved-edit indicators. */
function markEdited(filePath, options = {}) {
  projectPersistence.markEdited(filePath, options);
}

/** Begins a transaction spanning related project artifact mutations. */
function beginEditTransaction() {
  projectPersistence.beginEditTransaction();
}

/** Commits the active transaction after all coupled artifacts have been updated. */
function endEditTransaction() {
  projectPersistence.endEditTransaction();
}

/** Marks a project artifact deletion for undoable autosave. */
function markDeleted(filePath) {
  projectPersistence.markDeleted(filePath);
}

/** Clears the edited and resets its associated state. */
function clearEdited(filePath) {
  projectPersistence.clearEdited(filePath);
}

/** Updates the save controls to reflect the latest editor state. */
function updateSaveControls() {
  projectPersistence.updateSaveControls();
}

/** Persists the project changes to the project. */
async function saveProjectChanges() {
  return projectPersistence.save();
}

/** Renders the active Material or Screen again and restores selected placement paths. */
async function refreshActiveView() {
  try {
    if (viewingMaterialFile) {
      await renderMaterialFile(activeMaterialFilePath);
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

// Bind global controls after their view controllers and shared actions are available.
const editorEventController = new EditorEventController({
  state: {
    get hasEdits() { return hasEdits; },
    get historyUpdateSuppressed() { return historyUpdateSuppressed; },
    get specIndicatorsEnabled() { return specIndicatorsEnabled; },
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
    canDeleteSelectedPlacements: () => !isRenderOnly &&
      !viewingProject && !viewingMaterialFile && !viewingSpec && !viewingTheme &&
      !viewingWorkflow && activeInstancePaths.length > 0 &&
      getActivePreviewStateId(screens[activeScreenIndex]?.data) === "default",
    deleteSelectedPlacements: () =>
      screenMaterialController.deleteMany(activeInstancePaths.map((path) => [...path])),
    returnToScreen: () =>
      editorNavigation.selectScreenManually(activeScreenIndex),
    setSpecIndicatorsEnabled: (enabled) => {
      specIndicatorsEnabled = enabled;
      byId("spec-indicators-toggle").setAttribute("aria-pressed", String(enabled));
      byId("spec-indicators-toggle").title = enabled
        ? "Hide behavior spec indicators"
        : "Show behavior spec indicators";
      byId("spec-indicators-toggle").setAttribute(
        "aria-label",
        enabled ? "Hide behavior spec indicators" : "Show behavior spec indicators"
      );
      renderInspector();
    },
    exitTheme: () => editorNavigation.selectScreenManually(activeScreenIndex),
    hasWorkspaceEscapeView: () =>
      viewingTheme || viewingSpec || viewingWorkflow || editorNavigation.linkedDockStack.length > 0,
    handleWorkspaceEscape: async () => {
      if (viewingWorkflow && workflowEditor.closeWorkflowNodeSpecPreview()) {
        return { handled: true, action: "close-linked-spec" };
      }
      const result = await editorNavigation.handleWorkspaceEscape();
      if (result.action === "pop-linked") workflowEditor.clearLinkedWorkflowPreview();
      return result;
    },
    handleLocalEscape: () => {
      if (!byId("material-selector-context-menu").hidden) {
        projectFileNavigator.closeMaterialContextMenu();
        return true;
      }
      if (!byId("screen-placement-context-menu").hidden) {
        closeScreenPlacementContextMenu();
        return true;
      }
      if (!byId("screen-selector-panel").hidden) {
        projectFileNavigator.setScreenSelectorOpen(false, true);
        return true;
      }
      if (themeEditor.hasOpenColorPopup()) {
        themeEditor.closeColorPopup();
        return true;
      }
      return false;
    },
    renderScreenRulers: () => screenRulerController.render(),
    showFatalError,
    showEditorMessage,
    isRenderOnly,
    selectionFromLocation,
    restoreUiSelection,
    syncBrowserHistory
  }
});
editorEventController.bind();
byId("undo-project-edit").addEventListener("click", () => {
  projectPersistence.undo().catch((error) =>
    showEditorMessage("Could not undo project edit", error.message || String(error))
  );
});
byId("redo-project-edit").addEventListener("click", () => {
  projectPersistence.redo().catch((error) =>
    showEditorMessage("Could not redo project edit", error.message || String(error))
  );
});
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "z") return;
  event.preventDefault();
  const action = event.shiftKey ? projectPersistence.redo() : projectPersistence.undo();
  action.catch((error) =>
    showEditorMessage("Could not update project history", error.message || String(error))
  );
});
document.addEventListener("focusout", (event) => {
  if (["screen-yaml-source", "material-source", "spec-source", "workflow-source"]
    .includes(event.target?.id)) {
    projectPersistence.closeEditHistoryGroup();
  }
});
bindScreenPlacementContextMenu();

/** Renders the theme view from the current editor data. */
async function renderThemeView(filePath = project?.theme) {
  await screenAnnotationController?.fileLoaded(filePath);
  workflowEditor?.deactivate();
  screenAnnotationController?.setEnabled(false);
  themeEditor.render(filePath);
}

/** Shows the editor message for the current editor state. */
function showEditorMessage(title, message) {
  const output = byId("editor-message");
  clearEditorMessageTimer();
  output.replaceChildren(
    element("strong", "", title),
    element("div", "", message),
    createEditorMessageCloseButton()
  );
  output.classList.add("visible");
  editorMessageTimer = window.setTimeout(hideEditorMessage, 10000);
}

/** Creates the close control shared by editor notifications. */
function createEditorMessageCloseButton() {
  const close = element("button", "editor-message-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close notification");
  close.addEventListener("click", hideEditorMessage);
  return close;
}

/** Clears the current editor notification timeout. */
function clearEditorMessageTimer() {
  if (editorMessageTimer === null) return;
  window.clearTimeout(editorMessageTimer);
  editorMessageTimer = null;
}

/** Renders disk/local versions and explicit actions for external-write conflicts. */
function showExternalWriteConflicts(conflicts) {
  const output = byId("editor-message");
  if (!conflicts.length) {
    hideEditorMessage();
    return;
  }
  clearEditorMessageTimer();
  const content = [
    element("strong", "", "External file changes need review"),
    element("div", "", "Choose how to resolve each file before autosave continues.")
  ];
  for (const conflict of conflicts) {
    const section = element("section", "external-write-conflict");
    const heading = element("strong", "", conflict.path);
    const diskDetails = element("details");
    diskDetails.append(
      element("summary", "", "External disk version"),
      element("pre", "", conflict.diskContent ?? "The file was deleted on disk.")
    );
    const localDetails = element("details");
    localDetails.append(
      element("summary", "", "Local version"),
      element("pre", "", conflict.localDeleted ? "The file was deleted locally." : conflict.localContent)
    );
    const mergeSource = element("textarea", "external-write-merge");
    mergeSource.value = conflict.localContent;
    mergeSource.setAttribute("aria-label", `Merged content for ${conflict.path}`);
    const actions = element("div", "external-write-actions");
    const reload = element("button", "secondary-button", "Reload disk");
    const otherPendingEdits = dirtyFiles.size > 1 || externalWriteConflicts.size > 1;
    reload.disabled = conflict.diskContent === null || otherPendingEdits;
    reload.title = otherPendingEdits
      ? "Resolve other pending edits first to avoid discarding them."
      : "";
    reload.addEventListener("click", () => {
      projectPersistence.resolveExternalWriteConflict(conflict.path, "reload")
        .catch((error) => showEditorMessage("Could not reload disk version", error.message));
    });
    const keep = element("button", "secondary-button", "Keep local");
    keep.addEventListener("click", () => {
      projectPersistence.resolveExternalWriteConflict(conflict.path, "keep")
        .catch((error) => showEditorMessage("Could not keep local version", error.message));
    });
    const merge = element("button", "secondary-button", "Apply merge");
    merge.disabled = conflict.localDeleted;
    merge.addEventListener("click", () => {
      projectPersistence.resolveExternalWriteConflict(
        conflict.path,
        "merge",
        mergeSource.value
      ).catch((error) => showEditorMessage("Could not apply merged version", error.message));
    });
    actions.append(reload, keep, merge);
    section.append(heading, diskDetails, localDetails, mergeSource, actions);
    content.push(section);
  }
  content.push(createEditorMessageCloseButton());
  output.replaceChildren(...content);
  output.classList.add("visible");
}

/** Reconciles an external file version with the corresponding editor model. */
async function applyExternalFileContent(filePath, content, options = {}) {
  if (typeof content !== "string") {
    throw new Error(`The external version for "${filePath}" is unavailable.`);
  }
  if (options.reload) {
    const loaded = await projectRepository.load();
    applyLoadedProject(loaded);
    await renderLoadedProject();
    projectPersistence.initializeEditHistory();
    return;
  }
  if (filePath === "project.yml") {
    await applyExternalProjectContent(content, options.merged);
    return;
  }
  const screen = screens.find((entry) => entry.file === filePath);
  if (screen) {
    await applyExternalScreenContent(screen, content);
    return;
  }
  const material = materialFiles.get(filePath);
  if (material) {
    await applyExternalMaterialContent(material, content);
    return;
  }
  if (filePath === project.theme) {
    applyExternalThemeContent(filePath, content);
    return;
  }
  if (workflowSources.has(filePath)) {
    await applyExternalWorkflowContent(filePath, content);
    return;
  }
  if (specSources.has(filePath)) {
    await applyExternalSpecContent(filePath, content);
    return;
  }
  throw new Error(`The editor cannot apply an external version for "${filePath}".`);
}

/** Removes one externally conflicting file from the restored local artifact model. */
async function removeExternalFile(filePath) {
  const screenIndex = screens.findIndex((screen) => screen.file === filePath);
  if (screenIndex >= 0) {
    const [screen] = screens.splice(screenIndex, 1);
    project.screens = project.screens.filter((entry) =>
      entry !== screen.id && entry !== screen.file &&
      !(entry && typeof entry === "object" && (entry.id === screen.id || entry.file === screen.file))
    );
    activeScreenIndex = Math.min(activeScreenIndex, Math.max(0, screens.length - 1));
  }
  materialFiles.delete(filePath);
  specSources.delete(filePath);
  workflowSources.delete(filePath);
  invalidYamlFiles.delete(filePath);
  invalidWorkflowFiles.delete(filePath);
  elementSpecOwners.delete(filePath);
  createdSpecDrafts.delete(filePath);
  projectFilePaths = projectFilePaths.filter((path) => path !== filePath);
  if (activeWorkflowPath === filePath) {
    viewingWorkflow = false;
    activeWorkflowPath = null;
  }
  if (activeSpecPath === filePath) {
    viewingSpec = false;
    activeSpecPath = null;
  }
  if (activeMaterialFilePath === filePath) {
    viewingMaterialFile = false;
    activeMaterialFilePath = null;
  }
  renderNavigation();
  renderScreenSelector();
}

/** Applies an external project manifest version. */
async function applyExternalProjectContent(content, merged) {
  if (!merged) {
    const loaded = await projectRepository.load();
    applyLoadedProject(loaded);
    await renderLoadedProject();
    projectPersistence.initializeEditHistory();
    return;
  }
  const nextProject = projectRepository.parseYamlMapping(content, "project.yml");
  projectRepository.validateProjectDefinition(nextProject);
  if (JSON.stringify(nextProject.screens) !== JSON.stringify(project.screens) ||
      nextProject.theme !== project.theme) {
    throw new Error(
      "A merged project.yml cannot change Screen membership or Theme path in the current workspace."
    );
  }
  project = nextProject;
  renderNavigation();
  renderScreenSelector();
}

/** Applies an external Screen YAML version. */
async function applyExternalScreenContent(screen, content) {
  const version = ++screen.yamlParseVersion;
  await screenYamlEditor.parse(screen, content, version);
}

/** Applies an external Material source version. */
async function applyExternalMaterialContent(material, content) {
  const version = (material.parseVersion || 0) + 1;
  material.parseVersion = version;
  await materialFileEditor.parseDocument(material, content, version);
}

/** Applies an external Theme version. */
function applyExternalThemeContent(filePath, content) {
  const nextTheme = projectRepository.parseYamlMapping(content, filePath);
  sharedValidation.validateTheme(nextTheme, filePath);
  theme = nextTheme;
  applyTheme();
  renderInspector();
}

/** Applies an external workflow source version. */
async function applyExternalWorkflowContent(filePath, content) {
  workflowSources.set(filePath, content);
  const ownerIndex = screens.findIndex((entry) =>
    filePath.startsWith(`screens/${entry.id}/workflows/`)
  );
  if (activeWorkflowPath === filePath) await renderWorkflowEditor(filePath, ownerIndex);
}

/** Applies an external behavior-spec source version. */
async function applyExternalSpecContent(filePath, content) {
  specSources.set(filePath, content);
  if (activeSpecPath === filePath) {
    await renderSpecEditor(filePath, activeSpecInstancePath, activeSpecOwner);
  }
}

/** Hides the editor message for the current editor state. */
function hideEditorMessage() {
  clearEditorMessageTimer();
  const output = byId("editor-message");
  output.classList.remove("visible");
  output.replaceChildren();
}

/** Sets the preview message from the supplied data. */
function setPreviewMessage(state, message) {
  const preview = byId("screen-preview");
  preview.className = `screen-preview ${state}`;
  preview.replaceChildren(element("div", state === "error" ? "error-message" : "loading-message", message));
}

/** Shows the fatal error for the current editor state. */
function showFatalError(error) {
  setPreviewMessage("error", error.message || String(error));
  byId("screen-heading").textContent = "Could not load project";
  byId("inspector-content").replaceChildren(
    element("h2", "panel-heading", "Project load error"),
    element("div", "error-message", error.message || String(error)),
    element("div", "readonly-label", "Serve the repository root over HTTP so the editor can fetch the specux/ example project.")
  );
}

/** Handles system theme change events and applies the corresponding editor action. */
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
materialViewLayout.bind();
workflowViewLayout.bind();

loadProject(selectionFromLocation());
