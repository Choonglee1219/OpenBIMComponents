import * as OBC from "openbim-components"
import { FragmentsGroup } from "bim-fragment"
import { IProject, ProjectStatus, UserRole } from "./classes/Project"
import { ProjectsManager } from "./classes/ProjectsManager"

function showModal(id: string) {
  const modal = document.getElementById(id)
  if (modal && modal instanceof HTMLDialogElement) {
    modal.showModal()
  } else {
    console.warn("The provided modal wasn't found. ID: ", id)
  }
}

function closeModal(id: string) {
  const modal = document.getElementById(id)
  if (modal && modal instanceof HTMLDialogElement) {
    modal.close()
  } else {
    console.warn("The provided modal wasn't found. ID: ", id)
  }
}

const projectsListUI = document.getElementById("projects-list") as HTMLElement
const projectsManager = new ProjectsManager(projectsListUI)

// This document object is provided by the browser, and its main purpose is to help us interact with the DOM.
const newProjectBtn = document.getElementById("new-project-btn")
if (newProjectBtn) {
  newProjectBtn.addEventListener("click", () => {showModal("new-project-modal")})
} else {
  console.warn("New projects button was not found")
}

const projectForm = document.getElementById("new-project-form")
if (projectForm && projectForm instanceof HTMLFormElement) {
  projectForm.addEventListener("submit", (e) => {
    e.preventDefault()
    const formData = new FormData(projectForm)
    const projectData: IProject = {
      name: formData.get("name") as string,
      description: formData.get("description") as string,
      status: formData.get("status") as ProjectStatus,
      userRole: formData.get("userRole") as UserRole,
      finishDate: new Date(formData.get("finishDate") as string)
    }
    try {
      const project = projectsManager.newProject(projectData)
      console.log(project)
      projectForm.reset()
      closeModal("new-project-modal")
    } catch (err) {
      alert(err)
    }
  })
} else {
	console.warn("The project form was not found. Check the ID!")
}

const exportProjectsBtn= document.getElementById("export-projects-btn")
if (exportProjectsBtn) {
  exportProjectsBtn.addEventListener("click", () => {
    projectsManager.exportToJSON()
  })
}

const importProjectsBtn = document.getElementById("import-projects-btn")
if (importProjectsBtn) {
  importProjectsBtn.addEventListener("click", () => {
    projectsManager.importFromJSON()
  })
}

//OpenBIM-Components viewer
const viewer = new OBC.Components()

const sceneComponent = new OBC.SimpleScene(viewer)
sceneComponent.setup()
viewer.scene = sceneComponent
const scene = sceneComponent.get()
scene.background = null

const viewerContainer = document.getElementById("viewer-container") as HTMLDivElement
const rendererComponent = new OBC.PostproductionRenderer(viewer, viewerContainer)
viewer.renderer = rendererComponent

const cameraComponent = new OBC.OrthoPerspectiveCamera(viewer)
viewer.camera = cameraComponent

const raycasterComponent = new OBC.SimpleRaycaster(viewer)
viewer.raycaster = raycasterComponent

viewer.init()
cameraComponent.updateAspect()
rendererComponent.postproduction.enabled = true

const fragmentManager = new OBC.FragmentManager(viewer)

function exportFragments(model: FragmentsGroup) {
  const fragmentBinary = fragmentManager.export(model)
  const fragBlob = new Blob([fragmentBinary])
  const fragUrl = URL.createObjectURL(fragBlob)
  const fragLink = document.createElement('a')
  fragLink.href = fragUrl
  fragLink.download = `${model.name.replace(".ifc", "")}.frag`
  fragLink.click()
  URL.revokeObjectURL(fragUrl)
  
  const json = JSON.stringify(model.properties, null, 2) 
  const propBlob = new Blob([json], { type: "application/json" })
  const propUrl = URL.createObjectURL(propBlob)
  const propLink = document.createElement('a')
  propLink.href = propUrl
  propLink.download = `${model.name.replace(".ifc", "")}.json`
  propLink.click();
  URL.revokeObjectURL(propUrl)
}

const ifcLoader = new OBC.FragmentIfcLoader(viewer)
ifcLoader.settings.wasm = {
  path: "https://unpkg.com/web-ifc@0.0.43/",
  absolute: true
}

const highlighter = new OBC.FragmentHighlighter(viewer)
highlighter.setup()

const propertiesProcessor = new OBC.IfcPropertiesProcessor(viewer)
highlighter.events.select.onClear.add(() => {
  propertiesProcessor.cleanPropertiesList()
})

const classifier = new OBC.FragmentClassifier(viewer)
const classificationWindow = new OBC.FloatingWindow(viewer)
classificationWindow.visible = false
viewer.ui.add(classificationWindow)
classificationWindow.title = "Model Groups"

const classificationsBtn = new OBC.Button(viewer)
classificationsBtn.materialIcon = "account_tree"

classificationsBtn.onClick.add(() => {
  classificationWindow.visible = !classificationWindow.visible
  classificationsBtn.active = classificationWindow.visible
})

async function createModelTree() {
  const fragmentTree = new OBC.FragmentTree(viewer)
  await fragmentTree.init()
  await fragmentTree.update(["storeys", "entities"])
  fragmentTree.onHovered.add((fragmentMap) => {
    highlighter.highlightByID("hover", fragmentMap)
  })
  fragmentTree.onSelected.add((fragmentMap) => {
    highlighter.highlightByID("select", fragmentMap)
  })
  const tree = fragmentTree.get().uiElement.get("tree")
  return tree
}

const culler = new OBC.ScreenCuller(viewer)
cameraComponent.controls.addEventListener("sleep", () => {
  culler.needsUpdate = true
})

async function onModelLoaded(model: FragmentsGroup) {
  highlighter.update()
  for (const fragment of model.items) {culler.add(fragment.mesh)}
  culler.needsUpdate = true

  try {
    classifier.byStorey(model)
    classifier.byEntity(model)
    const tree = await createModelTree()
    await classificationWindow.slots.content.dispose(true)
    classificationWindow.addChild(tree)
    
    propertiesProcessor.process(model)
    highlighter.events.select.onHighlight.add((fragmentMap) => {
      const expressID = [...Object.values(fragmentMap)[0]][0]
      propertiesProcessor.renderProperties(model, Number(expressID))
    })
  } catch (error) {
    alert(error)
  }
}

ifcLoader.onIfcLoaded.add(async (model) => {
  exportFragments(model)
  onModelLoaded(model)
})

fragmentManager.onFragmentsLoaded.add(async (model) => {
  importJSONProperties(model) // Added for challenge class 3.10.
  if (!fragmentManager.baseCoordinationModel) {
    fragmentManager.baseCoordinationModel = fragmentManager.groups[0].uuid
  }
})

function importJSONProperties(model: FragmentsGroup) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json'
  const reader = new FileReader()
  reader.addEventListener("load", () => {
    const json = reader.result
    if (!json) { return }
    model.properties = JSON.parse(json as string)
    onModelLoaded(model)
  })
  input.addEventListener('change', () => {
    const filesList = input.files
    if (!filesList) { return }
    reader.readAsText(filesList[0])
  })
  input.click()
}

const importFragmentBtn = new OBC.Button(viewer)
importFragmentBtn.materialIcon = "upload"
importFragmentBtn.tooltip = "Load FRAG"

importFragmentBtn.onClick.add(() => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.frag'
  const reader = new FileReader()
  reader.addEventListener("load", async () => {
    const binary = reader.result
    if (!(binary instanceof ArrayBuffer)) { return }
    const fragmentBinary = new Uint8Array(binary)
    await fragmentManager.load(fragmentBinary)
  })
  input.addEventListener('change', () => {
    const filesList = input.files
    if (!filesList) { return }
    reader.readAsArrayBuffer(filesList[0])
  })
  input.click()
})

const toolbar = new OBC.Toolbar(viewer)
toolbar.addChild(
  ifcLoader.uiElement.get("main"),
  importFragmentBtn,
  classificationsBtn,
  propertiesProcessor.uiElement.get("main"),
  fragmentManager.uiElement.get("main")
)
viewer.ui.addToolbar(toolbar)