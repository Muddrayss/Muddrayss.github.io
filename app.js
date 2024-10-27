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
        this.scene.remove(scene.children[0]);
      }
      this.fieldCreated = false;
    }

    const position = this.reticle.position.clone();
    this.tapPositions.push(position);

    if (this.tapPositions.length === 1) {
      // Capture the field's orientation from the reticle
      this.fieldOrientation.copy(this.reticle.quaternion);
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
    const pos1 = this.tapPositions[0]; // First corner
    const pos3 = this.tapPositions[1]; // Opposite corner

    console.log('Creating field with corners:', pos1, pos3);

    // Compute the other two corners (pos2 and pos4)
    const pos2 = new THREE.Vector3(pos3.x, pos1.y, pos1.z);
    const pos4 = new THREE.Vector3(pos1.x, pos3.y, pos3.z);

    // Compute center position
    const centerX = (pos1.x + pos3.x) / 2;
    const centerY = (pos1.y + pos3.y) / 2;
    const centerZ = (pos1.z + pos3.z) / 2;

    // Create a group to hold the field components
    const fieldGroup = new THREE.Group();
    fieldGroup.position.set(centerX, centerY, centerZ);
    fieldGroup.quaternion.copy(this.fieldOrientation);

    // Array of vertices to form the rectangle
    const vertices = [pos1, pos2, pos3, pos4, pos1]; // Closing the loop

    // Create geometry from the vertices
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices);

    // Create a line material
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 10,
    });

    // Create a LineLoop to connect the vertices
    const lineLoop = new THREE.LineLoop(geometry, material);
    lineLoop.position.set(0, 0.01, 0);

    fieldGroup.add(lineLoop);

    // Add the LineLoop to the scene
    this.scene.add(fieldGroup);

    // Set fieldCreated to true to prevent further field creation
    this.fieldCreated = true;

    // Clear tap positions for the next field
    this.tapPositions = [];
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
          this.planeFloor.position.copy(this.reticle.position);
          this.planeFloor = new THREE.GridHelper(3, 100, 0x0000cc, 0x0000cc); // 3 units, 10 divisions, blue lines

          // Copy the reticle's orientation and rotate it to align the plane horizontally
          this.planeFloor.quaternion.copy(this.reticle.quaternion);
          // Set the plane to be horizontal
          const horizontalQuaternion = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            -Math.PI / 2
          );
          this.planeFloor.quaternion.multiply(horizontalQuaternion);

          this.planeFloor.updateMatrixWorld(true);
        } else {
          this.planeFloor.visible = false;
        }
      }

      this.renderer.render(this.scene, this.camera);
    }
  };

  setupThreeJs() {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      // Remove 'preserveDrawingBuffer: true' to allow clearing between frames
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
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial({
        color: 0x0000ff, // Blue color for the grid lines
        side: THREE.DoubleSide, // Make sure both sides are visible
        transparent: true,
        opacity: 0.8,
      })
    );
    // No need to rotate the plane floor here; we'll align it with the reticle
    this.planeFloor.visible = false;
    this.scene.add(this.planeFloor);

    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
  }
}

window.app = new App();
