const GRID_SIZE = 500;

let shouldUpdateGridPosition = true;

(async function () {
  const isArSessionSupported =
    navigator.xr &&
    navigator.xr.isSessionSupported &&
    (await navigator.xr.isSessionSupported('immersive-ar'));
  if (isArSessionSupported) {
    document
      .getElementById('enter-ar')
      .addEventListener('click', window.app.activateXR);
  } else {
    onNoXRDevice();
  }
})();

class App {
  constructor() {
    this.tapPositions = [];
    this.fieldCreated = false;
    this.fieldOrientation = new THREE.Quaternion();
  }

  activateXR = async () => {
    try {
      this.xrSession = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        domOverlay: { root: document.body },
      });

      this.createXRCanvas();

      await this.onSessionStarted();
    } catch (e) {
      console.log(e);
      onNoXRDevice();
    }
  };

  createXRCanvas() {
    this.canvas = document.createElement('canvas');
    document.body.appendChild(this.canvas);
    this.gl = this.canvas.getContext('webgl', { xrCompatible: true });

    this.xrSession.updateRenderState({
      baseLayer: new XRWebGLLayer(this.xrSession, this.gl),
    });
  }

  onSessionStarted = async () => {
    document.body.classList.add('ar');

    this.setupThreeJs();

    this.localReferenceSpace = await this.xrSession.requestReferenceSpace(
      'local'
    );

    this.viewerSpace = await this.xrSession.requestReferenceSpace('viewer');

    this.hitTestSource = await this.xrSession.requestHitTestSource({
      space: this.viewerSpace,
    });

    this.xrSession.requestAnimationFrame(this.onXRFrame);

    this.xrSession.addEventListener('select', this.onSelect);
  };

  onSelect = () => {
    if (this.fieldCreated) {
      while (this.scene.children.length > 0) {
        this.scene.remove(this.scene.children[0]);
      }
      this.fieldCreated = false;
      shouldUpdateGridPosition = true;
    }

    const position = this.reticle.position.clone();
    this.tapPositions.push(position);

    if (this.tapPositions.length === 1) {
      // Capture the field's orientation from the reticle
      this.fieldOrientation.copy(this.reticle.quaternion);
      shouldUpdateGridPosition = false;
    }

    if (this.tapPositions.length === 2) {
      this.createField();
    }
  };

  createField = () => {
    // Ensure there are two tapped positions
    if (this.tapPositions.length < 2) {
      console.error('Not enough tap positions to create the field.');
      return;
    }

    // Define pos1 and pos3 from tap positions
    const pos1 = this.tapPositions[0]; // First corner (v1)
    const pos3 = this.tapPositions[1]; // Opposite corner (v3)

    // Compute the other two corners (pos2 and pos4)
    const pos2 = new THREE.Vector3(pos3.x, pos1.y, pos1.z); // v2
    const pos4 = new THREE.Vector3(pos1.x, pos3.y, pos3.z); // v4

    // Create a group to hold the field components
    const fieldGroup = new THREE.Group();
    fieldGroup.position.set(0, 0, 0);
    fieldGroup.quaternion.copy(this.fieldOrientation);

    // Store the vertices in an array
    const vertices = [pos1, pos2, pos3, pos4];

    // Create an array to hold the line objects
    this.fieldLines = [];

    // Create line material
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 5,
    });

    // Create lines for each edge and add them to the fieldGroup
    for (let i = 0; i < 4; i++) {
      const start = vertices[i].clone().sub(fieldGroup.position);
      const end = vertices[(i + 1) % 4].clone().sub(fieldGroup.position);

      // Create geometry with positions at the start vertex
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([
        start.x,
        start.y,
        start.z,
        start.x,
        start.y,
        start.z, // Initialize both points at the start
      ]);
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3)
      );

      const line = new THREE.Line(geometry, material);
      line.position.set(0, 0.01, 0); // Relative to fieldGroup

      fieldGroup.add(line);

      this.fieldLines.push({
        line: line,
        start: start,
        end: end,
      });
    }

    // Add the fieldGroup to the scene
    this.scene.add(fieldGroup);

    // Set fieldCreated to true to prevent further field creation
    this.fieldCreated = true;

    // Start the animation
    this.animateFieldLines();

    // Start fading out the grid
    this.fadeOutGrid();

    // Clear tap positions for the next field
    this.tapPositions = [];
  };

  animateFieldLines = () => {
    let lineIndex = 0;
    const duration = 500; // Duration for each line animation in milliseconds

    const animateNextLine = () => {
      if (lineIndex >= this.fieldLines.length) {
        // All lines have been animated
        return;
      }

      const { line, start, end } = this.fieldLines[lineIndex];
      const startTime = performance.now();

      const animateLine = (time) => {
        const elapsed = time - startTime;
        const t = Math.min(elapsed / duration, 1);

        // Interpolate the line's end point
        const currentPoint = new THREE.Vector3().lerpVectors(start, end, t);

        // Update the line geometry
        const positions = line.geometry.attributes.position.array;
        positions[0] = start.x;
        positions[1] = start.y;
        positions[2] = start.z;
        positions[3] = currentPoint.x;
        positions[4] = currentPoint.y;
        positions[5] = currentPoint.z;

        line.geometry.attributes.position.needsUpdate = true;

        if (t < 1) {
          // Continue animating
          requestAnimationFrame(animateLine);
        } else {
          // Move to the next line
          lineIndex++;
          animateNextLine();
        }
      };

      requestAnimationFrame(animateLine);
    };

    // Start animating the first line
    animateNextLine();
  };

  fadeOutGrid = () => {
    const duration = 1000; // Duration in milliseconds
    const startTime = performance.now();

    const animateGridFadeOut = (time) => {
      const elapsed = time - startTime;
      const t = Math.min(elapsed / duration, 1);

      // Update the grid's material opacity
      const newOpacity = 1 - t; // Fade from 1 to 0

      if (this.grid.material) {
        this.grid.material.opacity = newOpacity;
        this.grid.material.needsUpdate = true;
      } else if (this.grid.children) {
        // For GridHelper, which may contain multiple materials
        this.grid.children.forEach((child) => {
          if (child.material) {
            child.material.opacity = newOpacity;
            child.material.transparent = true;
            child.material.needsUpdate = true;
          }
        });
      }

      if (t < 1) {
        // Continue animating
        requestAnimationFrame(animateGridFadeOut);
      } else {
        // Hide the grid after fading out
        this.grid.visible = false;
      }
    };

    requestAnimationFrame(animateGridFadeOut);
  };

  onXRFrame = (time, frame) => {
    this.xrSession.requestAnimationFrame(this.onXRFrame);

    const framebuffer = this.xrSession.renderState.baseLayer.framebuffer;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    this.renderer.setFramebuffer(framebuffer);

    const pose = frame.getViewerPose(this.localReferenceSpace);
    if (pose) {
      const view = pose.views[0];

      const viewport = this.xrSession.renderState.baseLayer.getViewport(view);
      this.renderer.setSize(viewport.width, viewport.height);

      // Clear the renderer before rendering the new frame
      this.renderer.clear();

      this.camera.matrix.fromArray(view.transform.matrix);
      this.camera.projectionMatrix.fromArray(view.projectionMatrix);
      this.camera.updateMatrixWorld(true);

      const hitTestResults = frame.getHitTestResults(this.hitTestSource);

      if (!this.stabilized && hitTestResults.length > 0) {
        this.stabilized = true;
        document.body.classList.add('stabilized');
      }
      if (hitTestResults.length > 0) {
        const hitPose = hitTestResults[0].getPose(this.localReferenceSpace);

        this.reticle.visible = true;
        this.reticle.position.set(
          hitPose.transform.position.x,
          hitPose.transform.position.y,
          hitPose.transform.position.z
        );
        this.reticle.quaternion.set(
          hitPose.transform.orientation.x,
          hitPose.transform.orientation.y,
          hitPose.transform.orientation.z,
          hitPose.transform.orientation.w
        );
        this.reticle.updateMatrixWorld(true);
        if (!this.fieldCreated) {
          this.planeFloor.visible = true;
          if (shouldUpdateGridPosition) {
            this.planeFloor.position.copy(this.reticle.position);
            // Rotate the grid to lay horizontally
            this.planeFloor.rotation.x = Math.PI / 2;
          }
          this.planeFloor.updateMatrixWorld(true);

          this.grid.visible = true;
          if (shouldUpdateGridPosition) {
            this.grid.position.copy(this.reticle.position);
          }
          this.grid.updateMatrixWorld(true);
        } else {
          this.planeFloor.visible = false;
          // Grid visibility is handled in fadeOutGrid()
        }
      }

      this.renderer.render(this.scene, this.camera);
    }
  };

  setupThreeJs() {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      canvas: this.canvas,
      context: this.gl,
    });
    this.renderer.autoClear = true; // Enable auto clearing of the canvas
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = Utils.createLitScene();
    this.reticle = new Reticle();
    this.scene.add(this.reticle);

    // Create the plane floor to display until the field is created
    this.planeFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE),
      new THREE.MeshBasicMaterial({
        color: 0x72d1e2, // Blue color for the grid lines
        side: THREE.DoubleSide, // Make sure both sides are visible
        transparent: true,
        opacity: 0.2,
      })
    );
    this.planeFloor.rotation.x = Math.PI / 2;
    this.planeFloor.visible = false;
    this.scene.add(this.planeFloor);

    // Set up the grid with a material that supports transparency
    this.grid = new THREE.GridHelper(
      GRID_SIZE,
      GRID_SIZE * 3,
      0x72d1e2,
      0x107ab2
    );
    this.grid.rotation.x = Math.PI / 2;
    this.grid.material.opacity = 1.0;
    this.grid.material.transparent = true;
    this.grid.visible = false;
    this.scene.add(this.grid);

    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
  }
}

window.app = new App();
