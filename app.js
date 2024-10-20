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
      return; // Do nothing if the field has been created
    }
    const position = this.reticle.position.clone();
    this.tapPositions.push(position);

    if (this.tapPositions.length === 1) {
      // Capture the device's orientation
      this.fieldOrientation.copy(this.camera.quaternion);
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

    // Compute other two corners (pos2 and pos4)
    const pos2 = new THREE.Vector3(pos3.x, pos1.y, pos1.z);
    const pos4 = new THREE.Vector3(pos1.x, pos1.y, pos3.z);

    // Compute center position
    const centerX = (pos1.x + pos3.x) / 2;
    const centerY = (pos1.y + pos3.y) / 2;
    const centerZ = (pos1.z + pos3.z) / 2;

    // Compute width and height
    const width = pos2.distanceTo(pos1);
    const height = pos4.distanceTo(pos1);

    // Create a group to hold the field components
    const fieldGroup = new THREE.Group();
    fieldGroup.position.set(centerX, centerY, centerZ);
    fieldGroup.quaternion.copy(this.fieldOrientation);

    // Create geometry for the field
    const planeGeometry = new THREE.PlaneGeometry(width, height);
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x008800,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    });
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    plane.rotateX(-Math.PI / 2); // Make it horizontal

    // Create geometry for the field outline
    const vertices = [
      new THREE.Vector3(-width / 2, 0, -height / 2),
      new THREE.Vector3(width / 2, 0, -height / 2),
      new THREE.Vector3(width / 2, 0, height / 2),
      new THREE.Vector3(-width / 2, 0, height / 2),
      new THREE.Vector3(-width / 2, 0, -height / 2),
    ]; // Closing the loop

    const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      lineWidth: 10,
    });
    const lineLoop = new THREE.LineLoop(geometry, material);

    // Add the plane and lineLoop to the fieldGroup
    plane.position.set(0, 0, 0);
    lineLoop.position.set(0, 0.01, 0); // Slightly above the plane
    fieldGroup.add(plane);
    fieldGroup.add(lineLoop);

    this.scene.add(fieldGroup);

    // Create paddles and ball
    this.createPongObjects(fieldGroup, width, height);

    // Set fieldCreated to true to prevent further field creation
    this.fieldCreated = true;

    // Clear tap positions
    this.tapPositions = [];
  };

  createPongObjects = (fieldGroup, width, height) => {
    // Create the paddles
    const paddleWidth = width * 0.3; // Paddles are 30% of the field width
    const paddleHeight = 0.05; // Arbitrary thickness
    const paddleDepth = 0.1; // Depth of the paddle

    const paddleGeometry = new THREE.BoxGeometry(
      paddleWidth,
      paddleHeight,
      paddleDepth
    );
    const paddleMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });

    // Paddle 1 (near side)
    const paddle1 = new THREE.Mesh(paddleGeometry, paddleMaterial);
    paddle1.position.set(0, paddleHeight / 2, -height / 2 + paddleDepth / 2);

    // Paddle 2 (far side)
    const paddle2 = new THREE.Mesh(paddleGeometry, paddleMaterial);
    paddle2.position.set(0, paddleHeight / 2, height / 2 - paddleDepth / 2);

    // Create the ball
    const ballRadius = Math.min(width, height) * 0.02; // Ball radius is 2% of the smaller dimension
    const ballGeometry = new THREE.SphereGeometry(ballRadius, 32, 32);
    const ballMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const ball = new THREE.Mesh(ballGeometry, ballMaterial);
    ball.position.set(0, ballRadius, 0);

    // Add paddles and ball to the fieldGroup
    fieldGroup.add(paddle1);
    fieldGroup.add(paddle2);
    fieldGroup.add(ball);

    // Store references to paddles and ball if needed for future movement
    this.paddle1 = paddle1;
    this.paddle2 = paddle2;
    this.ball = ball;
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
        this.reticle.updateMatrixWorld(true);

        if (!this.fieldCreated) {
          this.planeFloor.visible = true;
          this.planeFloor.position.copy(this.reticle.position);
          this.planeFloor.quaternion.copy(this.camera.quaternion);
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
      canvas: this.canvas,
      context: this.gl,
    });
    this.renderer.autoClear = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();

    this.reticle = new Reticle();
    this.scene.add(this.reticle);

    // Create the plane floor to display until the field is created
    this.planeFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
      })
    );
    this.planeFloor.rotateX(-Math.PI / 2); // Make it horizontal
    this.planeFloor.visible = false;
    this.scene.add(this.planeFloor);

    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
  }
}

window.app = new App();
