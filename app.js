/*
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Query for WebXR support. If there's no support for the `immersive-ar` mode,
 * show an error.
 */
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

/**
 * Container class to manage connecting to the WebXR Device API
 * and handle rendering on every frame.
 */
class App {
  constructor() {
    this.tapPositions = [];
  }

  /**
   * Run when the Start AR button is pressed.
   */
  activateXR = async () => {
    try {
      // Initialize a WebXR session using "immersive-ar".
      this.xrSession = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        domOverlay: { root: document.body },
      });

      // Create the canvas that will contain our camera's background and our virtual scene.
      this.createXRCanvas();

      // With everything set up, start the app.
      await this.onSessionStarted();
    } catch (e) {
      console.log(e);
      onNoXRDevice();
    }
  };

  /**
   * Add a canvas element and initialize a WebGL context that is compatible with WebXR.
   */
  createXRCanvas() {
    this.canvas = document.createElement('canvas');
    document.body.appendChild(this.canvas);
    this.gl = this.canvas.getContext('webgl', { xrCompatible: true });

    this.xrSession.updateRenderState({
      baseLayer: new XRWebGLLayer(this.xrSession, this.gl),
    });
  }

  /**
   * Called when the XRSession has begun. Here we set up our three.js
   * renderer, scene, and camera and attach our XRWebGLLayer to the
   * XRSession and kick off the render loop.
   */
  onSessionStarted = async () => {
    // Add the `ar` class to our body, which will hide our 2D components
    document.body.classList.add('ar');

    // To help with working with 3D on the web, we'll use three.js.
    this.setupThreeJs();

    // Setup an XRReferenceSpace using the "local" coordinate system.
    this.localReferenceSpace = await this.xrSession.requestReferenceSpace(
      'local'
    );

    // Create another XRReferenceSpace that has the viewer as the origin.
    this.viewerSpace = await this.xrSession.requestReferenceSpace('viewer');
    // Perform hit testing using the viewer as origin.
    this.hitTestSource = await this.xrSession.requestHitTestSource({
      space: this.viewerSpace,
    });

    // Start a rendering loop using this.onXRFrame.
    this.xrSession.requestAnimationFrame(this.onXRFrame);

    // Listen for 'select' events (e.g., screen taps)
    this.xrSession.addEventListener('select', this.onSelect);
  };

  /** Handle screen taps to create fields */
  onSelect = () => {
    const position = this.reticle.position.clone();
    this.tapPositions.push(position);

    if (this.tapPositions.length === 2) {
      this.createField();
    }
  };

  /**
   * Create a rectangular field by connecting two tapped positions.
   * Only the walls (lines) are created without filling the rectangle.
   */
  createField = () => {
    // Ensure there are two tapped positions
    if (this.tapPositions.length < 2) {
      console.error('Not enough tap positions to create the field.');
      return;
    }

    // Define pos1 and pos3 from tap positions
    const pos1 = this.tapPositions[0]; // First corner
    const pos3 = this.tapPositions[1]; // Opposite corner

    // Compute the other two corners (pos2 and pos4)
    const pos2 = new THREE.Vector3(pos3.x, pos1.y, pos1.z);
    const pos4 = new THREE.Vector3(pos1.x, pos1.y, pos3.z);

    // Array of vertices to form the rectangle (closing the loop)
    const vertices = [pos1, pos2, pos3, pos4, pos1];

    // Create geometry from the vertices
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices);

    // Create a line material
    const material = new THREE.LineBasicMaterial({ color: 0x000000 });

    // Create a LineLoop to connect the vertices
    const lineLoop = new THREE.LineLoop(geometry, material);

    // Add the LineLoop to the scene
    this.scene.add(lineLoop);

    // Optionally, you can store the lineLoop for future reference or manipulation
    // this.fields.push(lineLoop);

    // Clear tap positions for the next field
    this.tapPositions = [];
  };

  /**
   * Called on the XRSession's requestAnimationFrame.
   * Called with the time and XRPresentationFrame.
   */
  onXRFrame = (time, frame) => {
    // Queue up the next draw request.
    this.xrSession.requestAnimationFrame(this.onXRFrame);

    // Bind the graphics framebuffer to the baseLayer's framebuffer.
    const framebuffer = this.xrSession.renderState.baseLayer.framebuffer;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    this.renderer.setFramebuffer(framebuffer);

    // Retrieve the pose of the device.
    // XRFrame.getViewerPose can return null while the session attempts to establish tracking.
    const pose = frame.getViewerPose(this.localReferenceSpace);
    if (pose) {
      // In mobile AR, we only have one view.
      const view = pose.views[0];

      const viewport = this.xrSession.renderState.baseLayer.getViewport(view);
      this.renderer.setSize(viewport.width, viewport.height);

      // Use the view's transform matrix and projection matrix to configure the THREE.camera.
      this.camera.matrix.fromArray(view.transform.matrix);
      this.camera.projectionMatrix.fromArray(view.projectionMatrix);
      this.camera.updateMatrixWorld(true);

      // Conduct hit test.
      const hitTestResults = frame.getHitTestResults(this.hitTestSource);

      // If we have results, consider the environment stabilized.
      if (!this.stabilized && hitTestResults.length > 0) {
        this.stabilized = true;
        document.body.classList.add('stabilized');
      }
      if (hitTestResults.length > 0) {
        const hitPose = hitTestResults[0].getPose(this.localReferenceSpace);

        // Update the reticle position
        this.reticle.visible = true;
        this.reticle.position.set(
          hitPose.transform.position.x,
          hitPose.transform.position.y,
          hitPose.transform.position.z
        );
        this.reticle.updateMatrixWorld(true);
      } else {
        // Hide the reticle if no hit test results
        this.reticle.visible = false;
      }

      // Clear the renderer to remove old frames
      this.renderer.clear();

      // Render the scene with THREE.WebGLRenderer.
      this.renderer.render(this.scene, this.camera);
    }
  };

  /**
   * Initialize three.js specific rendering code, including a WebGLRenderer,
   * a demo scene, and a camera for viewing the 3D content.
   */
  setupThreeJs() {
    // Initialize our demo scene.
    this.scene = DemoUtils.createLitScene();

    // Initialize the reticle and add it to the scene.
    this.reticle = new Reticle();
    this.scene.add(this.reticle);

    // Set up the WebGLRenderer, which handles rendering to our session's base layer.
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      preserveDrawingBuffer: true,
      canvas: this.canvas,
      context: this.gl,
    });

    // **Important Correction**:
    // Set autoClear to true to ensure old frames are cleared.
    this.renderer.autoClear = true;

    // Enable shadow maps if needed (not necessary for lines)
    this.renderer.shadowMap.enabled = false; // Disable shadows since we're only drawing lines

    // Initialize the camera
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
  }
}

window.app = new App();
